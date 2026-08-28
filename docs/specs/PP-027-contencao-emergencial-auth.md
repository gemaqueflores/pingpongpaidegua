# PP-027 — Contenção emergencial: autenticação administrativa comprometida (P0)

## Status: v3 — C2+C3+C4 relatados como concluídos pelo Codex. Implementação de código (Cenários 1-2) ainda não iniciada.

## C2+C3+C4 — resultado relatado (não verificado por mim; ação em produção é do Codex, fora do meu acesso)

Relatado pelo Codex como concluído e validado em produção:
- `NODE_ENV=production` efetivo.
- `JWT_SECRET` rotacionado — token assinado com o segredo antigo agora retorna `401`.
- Credencial administrativa rotacionada; identidade default removida (0 registros ativos).
- Novo login retorna `201`; rota protegida retorna `200` com o novo token.
- API/worker/Postgres/Redis saudáveis, sem reinícios/erros recentes.
- Backup reversível preservado em `/home/ubuntu/.secrets/pp027-backup-20260817T184811Z` (produção, fora
  do repositório).
- Nenhuma alteração Git rastreada.

**Nota de escopo:** esta seção registra o que foi relatado, não uma verificação independente — eu não
tenho acesso a produção. A evidência é da mesma natureza da resposta de C1 (execução do Codex, aceita
pelo mérito e por já ter uma cadeia de código coerente confirmada anteriormente nesta sessão), não uma
confirmação própria via ferramenta.

**Pendência declarada pelo Codex:** foi criado `docker-compose.override.yml` **operacional, não
versionado**, para aplicar `NODE_ENV=production` como contenção imediata. A implementação definitiva
(Cenário 1/2 desta Spec) deve incorporar essa configuração ao `docker-compose.yml` versionado e remover o
override — hoje a correção de `NODE_ENV` existe apenas como patch operacional fora do controle de versão,
o que por si só é um estado transitório a não deixar permanente.

## C1 — resultado confirmado (comprometimento ativo, não hipótese)

Executado read-only pelo Codex em produção:
```
NODE_ENV=missing
JWT_SECRET=dev_default
ADMIN_USERNAME=dev_default
ADMIN_PASSWORD_HASH=compose_default
ADMIN_DEFAULT_USERNAME_ROWS=1
ADMIN_DEFAULT_USERNAME_AND_CONFIGURED_HASH_ROWS=1
```
Confirma a cadeia de código já verificada nesta sessão: produção roda hoje com segredo JWT e credencial
administrativa públicos e conhecidos. **Isto é comprometimento ativo em curso, não vulnerabilidade
teórica** — qualquer pessoa com acesso ao repositório pode, neste momento, forjar um JWT `role: "ADMIN"`
ou fazer login com a credencial default.

## C1 — resultado confirmado (comprometimento ativo, não hipótese)

Executado read-only pelo Codex em produção:
```
NODE_ENV=missing
JWT_SECRET=dev_default
ADMIN_USERNAME=dev_default
ADMIN_PASSWORD_HASH=compose_default
ADMIN_DEFAULT_USERNAME_ROWS=1
ADMIN_DEFAULT_USERNAME_AND_CONFIGURED_HASH_ROWS=1
```
Confirma a cadeia de código já verificada nesta sessão: produção roda hoje com segredo JWT e credencial
administrativa públicos e conhecidos. **Isto é comprometimento ativo em curso, não vulnerabilidade
teórica** — qualquer pessoa com acesso ao repositório pode, neste momento, forjar um JWT `role: "ADMIN"`
ou fazer login com a credencial default.

## Errata de escopo (aceita) — C2+C3+C4 devem ser uma operação única, não sequencial

Rotacionar apenas o JWT_SECRET deixaria a credencial default ainda válida para novo login (gerando novo
JWT legítimo com a role forjável revalidada). Rotacionar apenas a senha ainda permitiria forjar JWT com o
segredo público antigo. **As três ações (rotacionar JWT_SECRET, rotacionar credencial admin, corrigir
NODE_ENV=production) devem ser executadas na mesma janela de manutenção, antes de qualquer reabertura de
acesso administrativo.** Leo autorizou a operação conjunta C2+C3+C4.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — é a própria natureza desta Spec.
- e2e-playwright-agent: não.
- report-builder-agent: sim — relatório deve confirmar, item a item, que cada ação de contenção foi
  executada e validada (novo login funcionando, credencial antiga rejeitada), sem margem de "assumi que
  funcionou".

## Objetivo

Eliminar a possibilidade de forjar autenticação administrativa via token JWT assinado com segredo público
de desenvolvimento, e eliminar a credencial administrativa default como vetor de acesso caso ainda esteja
ativa em produção.

## Contexto e causa raiz

**Cadeia de código confirmada por leitura direta nesta sessão** (Claude), independente da alegação de
estado de produção:

1. `apps/api/src/auth/auth-config.ts:3`: `DEV_JWT_SECRET = "local-dev-jwt-secret-change-me"` — string
   literal, presente no repositório público/privado (não é segredo real, é fallback de desenvolvimento).
2. `resolveJwtSecret()` (`auth-config.ts:11-20`): só lança erro se `JWT_SECRET` estiver ausente **e**
   `NODE_ENV === "production"`. Se `NODE_ENV` não estiver setado (ou setado para outro valor) em
   produção, a função retorna silenciosamente o `DEV_JWT_SECRET` público, sem qualquer erro.
3. `apps/api/src/auth/jwt.strategy.ts:22-28` (`validate`): retorna `{ userId: payload.sub, username:
   payload.username, role: payload.role }` **diretamente do payload do JWT**, sem consultar
   `AdminCredential` no banco para confirmar que o usuário/role ainda são válidos.
4. `apps/api/src/common/roles.guard.ts:20-23` (`canActivate`): autoriza a rota checando apenas
   `user.role` (que veio do payload não revalidado do passo 3) contra os `requiredRoles` do endpoint —
   nenhuma segunda consulta ao banco.

**Consequência da cadeia:** se `JWT_SECRET` efetivo em produção for o valor público de desenvolvimento
(por `NODE_ENV` ausente/incorreto), qualquer pessoa com acesso ao código-fonte — que é público neste
contrato de repositório pessoal do FloresTech — pode assinar localmente um JWT com payload
`{ role: "ADMIN", username: "qualquer", sub: "qualquer" }` usando esse segredo conhecido, e o backend
aceitaria esse token como uma sessão administrativa válida, sem nunca ter havido login real.

**Origem do achado e confirmação:** reportado inicialmente por mensagem "Codex" nesta sessão; a cadeia de
código foi verificada por mim de forma independente. **C1 (executado pelo Codex, read-only, em
produção) confirmou o estado real**: `NODE_ENV=missing`, `JWT_SECRET=dev_default`,
`ADMIN_USERNAME=dev_default`, `ADMIN_PASSWORD_HASH=compose_default`, com 1 linha de `AdminCredential`
usando o username default e o hash configurado default. **Isto não é mais hipótese — é comprometimento
ativo confirmado em produção no momento da checagem.**

**Causa sistêmica:** o fail-fast de `resolveJwtSecret()`/`resolveAdminUsername()`/
`resolveBootstrapAdminPasswordHash()` depende inteiramente de `NODE_ENV === "production"` estar setado
corretamente no processo — não há segunda camada de proteção (ex.: verificar se o valor de `JWT_SECRET`
em uso é literalmente igual ao `DEV_JWT_SECRET` conhecido, independente de `NODE_ENV`).

## Cenários de contenção (DADO/QUANDO/ENTÃO)

**Cenário 1 — fail-fast independente de NODE_ENV, controlado por flag explícita de dev**
DADO que o processo da API inicia
QUANDO `JWT_SECRET` resolvido for identicamente igual ao valor `DEV_JWT_SECRET` conhecido
E/OU `ADMIN_PASSWORD_HASH` resolvido for identicamente igual ao hash bootstrap de desenvolvimento
conhecido (`hashSync(DEV_ADMIN_PASSWORD, 12)` calculado em runtime, comparado por `compareSync`)
E a variável explícita `ALLOW_INSECURE_DEV_AUTH_DEFAULTS` não estiver setada como `"true"`
ENTÃO o processo deve recusar iniciar (throw). **Ajuste aceito nesta v2:** `NODE_ENV=development` sozinho
não é sinal suficiente de "ambiente seguro para usar defaults" — precisa de uma flag dedicada e explícita
(`ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true`), setada apenas em `.env` de desenvolvimento local/CI, nunca em
produção. Sem essa flag, os defaults nunca são aceitos, independente do valor de `NODE_ENV`.

**Cenário 2 — revalidação de sessão administrativa contra o banco, role definido no servidor**
DADO um token JWT válido (assinatura correta) com `sub`, `username`, `role` no payload
QUANDO uma rota protegida por `RolesGuard` com `@Roles("ADMIN")` é acessada
ENTÃO o servidor consulta `AdminCredential` pelo `username` do payload — **existência do registro é a
única validação possível sem DDL** (ajuste aceito: `AdminCredential` não tem campo `active`, não inventar
checagem que a tabela não suporta); adicionalmente, o servidor **define `role: "ADMIN"` a partir do
registro do banco, nunca a partir do valor recebido no payload** — o payload deixa de ser fonte de
verdade para a role; e a validação confirma que `sub` e `username` do payload são coerentes entre si
(mesmo valor ou relação 1:1 esperada, Codex confirma a relação exata usada na emissão do token em
`AuthService.login`) — payload com `sub`/`username` divergentes é rejeitado como indício de token
adulterado/malformado.

**Cenário 3 — rotação de segredo invalida sessões existentes**
DADO qualquer token JWT emitido antes da rotação de `JWT_SECRET`
QUANDO `JWT_SECRET` é rotacionado para um valor novo, gerado de forma segura (não previsível)
ENTÃO tokens antigos (assinados com o segredo anterior, incluindo qualquer token forjado com o segredo
público) tornam-se inválidos imediatamente — verificação nativa do `passport-jwt`/`JwtService`, sem
código adicional necessário além da rotação em si.

## Ações de contenção

### C1 — CONCLUÍDO (read-only, executado pelo Codex, resultado acima)

Confirmou comprometimento ativo: `NODE_ENV=missing`, `JWT_SECRET=dev_default`,
`ADMIN_USERNAME=dev_default`, `ADMIN_PASSWORD_HASH=compose_default`, 1 credencial default persistida.

### C2+C3+C4 — Operação de contenção única (autorizada por Leo, executar em conjunto na mesma janela)

**Correção de escopo aceita:** estas três ações não podem ser sequenciais/independentes — rotacionar só o
JWT deixaria a credencial default ainda válida para login (gerando novo JWT legítimo); rotacionar só a
senha ainda permitiria forjar JWT com o segredo antigo. Executar todas na mesma janela de manutenção,
antes de reabrir qualquer acesso administrativo:

1. **Rotacionar `JWT_SECRET`** — gerar segredo novo e imprevisível (ex.: `openssl rand -base64 48`),
   configurar na variável de ambiente de produção.
2. **Corrigir `NODE_ENV=production`** — garantir que o processo real da API roda com esse valor, para que
   o fail-fast existente (e o novo, Cenário 1) funcione como desenhado.
3. **Rotacionar credencial administrativa** — gerar nova senha forte, novo hash bcrypt, atualizar
   `AdminCredential` no banco (ou via `ADMIN_PASSWORD_HASH` + atualização do registro), invalidando a
   credencial default.
4. **Recriar/reiniciar a API** com as três mudanças aplicadas simultaneamente.

**Efeito colateral esperado e aceito:** todas as sessões administrativas ativas são invalidadas, incluindo
qualquer sessão legítima de Leo — breve indisponibilidade da API durante o restart.

**Nenhum segredo/senha/hash novo aparece em log, chat ou código versionado** — apenas confirmação de que
a operação foi concluída e validada (novo login funciona, credencial antiga rejeitada).

### C5 — Auditoria de uso pós-incidente (read-only, após C2+C3+C4)
Revisar logs de acesso administrativo disponíveis (se existirem) no período anterior à contenção, buscando
qualquer atividade administrativa não explicada por Leo — não para atribuir culpa, mas para confirmar se
houve exploração real além da hipótese teórica, dado que a janela de exposição foi confirmada como real.

## Critérios de aceitação (para a parte de código, não a operação em produção)

- Cenário 1 implementado: novo fail-fast que dispara sempre que `JWT_SECRET`/`ADMIN_PASSWORD_HASH`
  resolvidos igualam os defaults de desenvolvimento conhecidos, **a menos que**
  `ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true` esteja explicitamente setada — não depende de `NODE_ENV` para a
  decisão de segurança (só a flag dedicada autoriza os defaults).
- Cenário 2 implementado: revalidação de `AdminCredential` real no banco (por existência do registro —
  schema não tem campo `active`) antes de autorizar uma rota `@Roles("ADMIN")`; `role` usado na
  autorização é definido a partir do registro do banco, nunca do valor recebido no payload JWT;
  coerência entre `sub` e `username` do payload validada antes de prosseguir.
- Nenhuma credencial nova (segredo real, senha real) aparece em código, log, commit ou mensagem de chat —
  toda rotação (operação C2+C3+C4) é ação de produção fora do versionamento.

## Fora de escopo

- Não implementar blacklist/revogação ativa de JWT nesta Spec (achado S6 do CAT PP-026, menor prioridade,
  Spec separada se priorizada).
- Não reescrever todo o sistema de auth — mudança mínima e cirúrgica para fechar o vetor identificado.
- C1-C5 (operação em produção) não são código a implementar — são ações que o Codex executa fora do ciclo
  normal de PR, mediante autorização item a item, registradas no relatório de entrega.

## Impacto técnico

- Arquivos a modificar:
  - `apps/api/src/auth/auth-config.ts` — novo fail-fast independente de `NODE_ENV` (Cenário 1).
  - `apps/api/src/auth/jwt.strategy.ts` e/ou `apps/api/src/common/roles.guard.ts` — revalidação contra
    banco (Cenário 2); Codex decide o ponto exato de menor impacto em latência (ex.: cache curto de
    validação para não bater no banco a cada requisição, se performance for preocupação — mas nunca
    voltar a confiar cegamente no payload).
- Arquivos que NÃO devem ser tocados: lógica de negócio fora de auth.
- DDL: nenhuma nesta Spec (Cenário 2 usa tabela `AdminCredential` já existente).
- Dependências novas: nenhuma esperada.

## Plano de testes

### T-U-01 — Fail-fast dispara mesmo com NODE_ENV incorreto/ausente, sem a flag
DADO: `NODE_ENV` não setado, `JWT_SECRET` não setado (cai no default), `ALLOW_INSECURE_DEV_AUTH_DEFAULTS`
não setada
QUANDO: `resolveJwtSecret()` é chamado
ENTÃO: lança erro — comportamento novo, não depende mais só de `NODE_ENV === "production"`.

### T-U-02 — Flag explícita de dev permite os defaults (não regressão do ambiente local)
DADO: `ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true` setada explicitamente (padrão de `.env` de dev local/CI)
QUANDO: `resolveJwtSecret()` é chamado sem `JWT_SECRET` configurado
ENTÃO: retorna o default de desenvolvimento normalmente — sem regressão no fluxo local/CI.

### T-U-03 — NODE_ENV=development sozinho NÃO basta (regressão que esta Spec corrige)
DADO: `NODE_ENV=development`, `ALLOW_INSECURE_DEV_AUTH_DEFAULTS` não setada, `JWT_SECRET` não configurado
QUANDO: `resolveJwtSecret()` é chamado
ENTÃO: lança erro — prova de que `NODE_ENV` sozinho não é mais aceito como sinal de ambiente seguro.

### T-I-01 — Token com role ADMIN só autoriza se credencial existe no banco
DADO: um JWT válido (assinado corretamente) com `role: "ADMIN"`, `username: "removido"`, mas nenhuma
`AdminCredential` correspondente no banco (usuário foi removido)
QUANDO: uma rota `@Roles("ADMIN")` é acessada com esse token
ENTÃO: acesso negado — revalidação contra o banco rejeita o payload isolado.

### T-I-03 — Role usada na autorização vem do banco, não do payload
DADO: um JWT válido cujo payload contém `role: "ADMIN"`, mas o registro `AdminCredential` correspondente
(por design de teste, não caso real hoje) representa um papel diferente ou o payload foi manipulado para
tentar elevar privilégio
QUANDO: a rota é acessada
ENTÃO: a decisão de autorização usa o papel resolvido a partir do banco, não o valor bruto do payload —
teste prova que alterar só o payload (mantendo assinatura válida via segredo de teste) não muda o
resultado da autorização se o banco disser outra coisa.

### T-I-04 — Payload com sub/username incoerentes é rejeitado
DADO: um JWT válido (assinatura correta) cujo `sub` e `username` não são coerentes entre si (violam a
relação usada em `AuthService.login`)
QUANDO: a rota é acessada
ENTÃO: acesso negado — indício de token adulterado ou malformado.

### T-I-02 — Fluxo de login legítimo continua funcionando (não regressão)
DADO: um `AdminCredential` real, login bem-sucedido gerando um JWT válido
QUANDO: esse token é usado em uma rota `@Roles("ADMIN")`
ENTÃO: acesso concedido normalmente — a revalidação não quebra o caso de uso legítimo.

### Comando para rodar a suite
`npm run test --workspace apps-api`.

## Encaminhamento imediato

Solicito autorização explícita para C1 (read-only) agora — é o passo que determina a urgência real dos
demais. C2-C4 aguardam confirmação de C1 antes de qualquer execução em produção.
