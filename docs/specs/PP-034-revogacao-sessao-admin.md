# PP-034 — Revogação de sessão administrativa (token version)

## Prioridade: 1 de 4 (S6 do CAT PP-026) — segurança, sem dependência de outra Spec em andamento

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — objetivo direto é fechar lacuna de auth.
- e2e-playwright-agent: não.
- report-builder-agent: não — relatório de execução simples basta.

## Objetivo

Permitir invalidar sessões JWT administrativas ativas antes da expiração natural (hoje até 8h,
`JWT_EXPIRES_IN`), sem exigir infraestrutura nova (blacklist em Redis/tabela dedicada) — reaproveitando a
consulta ao `AdminCredential` que `JwtStrategy.validate()` já faz a cada requisição desde PP-027.

## Contexto e causa raiz

PP-027 corrigiu o vetor de forjar `role: "ADMIN"` via payload não confiável, adicionando consulta real ao
banco em `JwtStrategy.validate()` (`apps/api/src/auth/jwt.strategy.ts:23-49`) — mas essa consulta só
confirma que a credencial **existe** (`findUnique({ where: { username } })`), não que o token específico
ainda é válido. Hoje, se um admin troca a senha via `resetPassword()`
(`apps/api/src/auth/auth.service.ts:242-272`), qualquer sessão JWT emitida antes da troca continua válida
até expirar — não há como forçar logout remoto, nem revogar um token que vazou, sem esperar a expiração
natural.

**Causa raiz:** `AdminCredential` (`prisma/schema.prisma:373-381`) não tem nenhum campo que represente
"versão da sessão atual" — não há como o `validate()` distinguir um token emitido antes de uma
revogação de um token emitido depois.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — reset de senha invalida sessões existentes**
DADO um admin com uma sessão JWT ativa
QUANDO a senha é trocada via `resetPassword()`
ENTÃO o token JWT emitido antes da troca deixa de ser aceito em requisições subsequentes — mesmo que
ainda não tenha expirado pelo `exp` do JWT.

**Cenário 2 — login continua funcionando normalmente (não regressão)**
DADO um admin fazendo login com credenciais corretas
QUANDO `login()` é chamado
ENTÃO um novo token válido é emitido, aceito normalmente nas requisições seguintes.

**Cenário 3 — revogação manual explícita (endpoint novo)**
DADO um admin autenticado que deseja invalidar todas as suas sessões ativas (ex.: suspeita de vazamento
de token, sem trocar a senha)
QUANDO chama um novo endpoint de revogação (ex.: `POST /auth/revoke-sessions`)
ENTÃO todas as sessões emitidas antes desse momento passam a ser rejeitadas, incluindo a que fez a
própria chamada (o admin precisa logar de novo após revogar).

**Cenário 4 — token com iat anterior à revogação é rejeitado**
DADO um `AdminCredential` com `tokenVersion` incrementado após uma revogação/reset
QUANDO um JWT emitido com uma versão anterior (embutida no payload no momento do `login()`) é apresentado
ENTÃO `validate()` rejeita com `UnauthorizedException`, mesmo que a assinatura seja válida e o token não
tenha expirado.

## Critérios de aceitação

- `AdminCredential` ganha campo `tokenVersion` (Int, default `0`) via migration Prisma.
- `login()` inclui `tokenVersion` atual no payload do JWT assinado.
- `resetPassword()` incrementa `tokenVersion` do `AdminCredential` na mesma operação que troca a senha
  (mesma transação/`update`, para não deixar janela entre trocar senha e invalidar sessão).
- Novo endpoint `POST /auth/revoke-sessions` (protegido por `@Roles("ADMIN")`, mesmo guard já existente)
  incrementa `tokenVersion` do admin autenticado, sem exigir senha novamente (é uma ação de sessão já
  autenticada, não uma re-autenticação).
- `JwtStrategy.validate()` compara `payload.tokenVersion` contra o `tokenVersion` atual do
  `AdminCredential` já consultado (reaproveitando a mesma query, sem query adicional) — payload com
  versão desatualizada é rejeitado.
- Login continua funcionando sem exigir passo extra do usuário (Cenário 2).

## Fora de escopo

- Não implementar blacklist de tokens individuais — a granularidade é "todas as sessões do admin", não
  "este token específico" (suficiente para o modelo de single-admin do projeto).
- Não adicionar refresh token / rotação automática de token — fora do escopo desta Spec.
- Não alterar `JWT_EXPIRES_IN` nem a lógica de expiração natural já existente.
- Não expor `tokenVersion` em nenhuma resposta de API — é detalhe interno de validação.

## Impacto técnico

- Arquivos a criar/modificar:
  - `prisma/schema.prisma` — `AdminCredential.tokenVersion Int @default(0)`; nova migration.
  - `apps/api/src/auth/auth.service.ts` — `login()` inclui `tokenVersion` no payload;
    `resetPassword()` incrementa `tokenVersion`; novo método `revokeSessions(username)`.
  - `apps/api/src/auth/jwt.strategy.ts` — `validate()` compara `tokenVersion` do payload contra o do
    registro consultado.
  - `apps/api/src/auth/auth.controller.ts` — novo endpoint `POST /auth/revoke-sessions`.
- Arquivos que NÃO devem ser tocados: lógica de negócio fora de auth.
- DDL: sim — nova coluna `token_version` em `admin_credentials`, default `0`, sem impacto em dado
  existente (linhas atuais recebem o default automaticamente).
- Contrato de API alterado: sim — novo endpoint; payload interno do JWT ganha campo novo (não observável
  externamente, o cliente só vê o token opaco).

## Plano de testes

### T-U-01 — Payload de login inclui tokenVersion atual
DADO: um `AdminCredential` com `tokenVersion = 2`
QUANDO: `login()` é chamado com sucesso
ENTÃO: o payload assinado contém `tokenVersion: 2`.

### T-U-02 — resetPassword incrementa tokenVersion
DADO: um `AdminCredential` com `tokenVersion = 0`
QUANDO: `resetPassword()` é executado com sucesso
ENTÃO: `tokenVersion` do registro passa a `1`.

### T-I-01 — Token com tokenVersion desatualizado é rejeitado
DADO: um JWT válido (assinatura correta) com `tokenVersion: 0` no payload, mas o `AdminCredential`
correspondente já está em `tokenVersion: 1` (revogado)
QUANDO: uma rota protegida é acessada
ENTÃO: `UnauthorizedException` — sessão invalidada.

### T-I-02 — Token com tokenVersion atual continua válido (não regressão)
DADO: um JWT com `tokenVersion` igual ao valor atual do `AdminCredential`
QUANDO: uma rota protegida é acessada
ENTÃO: acesso concedido normalmente.

### T-I-03 — Endpoint de revogação incrementa tokenVersion do próprio admin
DADO: um admin autenticado chamando `POST /auth/revoke-sessions`
QUANDO: a requisição é processada
ENTÃO: `tokenVersion` do `AdminCredential` correspondente é incrementado; o próprio token usado na
chamada deixa de ser válido em requisições subsequentes.

### T-I-04 — Reset de senha e revogação manual não interferem em outros admins (se houver mais de um no futuro)
DADO: dois `AdminCredential` distintos (cenário hipotético de múltiplos admins, mesmo que hoje o projeto
tenha só um)
QUANDO: `tokenVersion` de um é incrementado
ENTÃO: o outro permanece inalterado.

### Comando para rodar a suite
`npm run test --workspace apps-api`.
