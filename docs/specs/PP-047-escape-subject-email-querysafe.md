## SPEC ATIVA — PP-047 — v1
ID: PP-047 | Projeto: PingPong PaiD'egua (appcbtmeventos) | Branch: fix/pp-047-escape-subject-querysafe
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — a entrega toca escaping de conteúdo de usuário em e-mail (superfície de HTML/header injection) e uso de `$queryRawUnsafe`, ambos itens de checklist OWASP (A03 Injection).
- e2e-playwright-agent: não — sem fluxo de UI ponta a ponta afetado; mudança é server-side (e-mail e healthcheck).
- report-builder-agent: não — evidência cabe no formato padrão de entrega (mapeamento T-* + log de suite), sem necessidade de relatório estruturado adicional.

## Objetivo
Fechar duas inconsistências de baixo risco identificadas na análise com as skills `react-best-practices` e
`security-threat-model`: (1) o assunto do e-mail de suporte não recebe o mesmo escaping HTML aplicado ao
corpo, criando uma inconsistência defensiva; (2) dois healthchecks usam `$queryRawUnsafe` para uma query
sem nenhum input externo, quando o padrão idiomático do Prisma (`$queryRaw` com tagged template) evita essa
superfície por completo.

## Contexto
`apps/api/src/user/user.service.ts` já escapa `description` com a função local `escapeHtml()` (linha 865)
antes de embutir no HTML do e-mail de suporte (`sendSupportEmail`, linhas 1018–1058). O `title`, porém, só
passa por remoção de quebras de linha (`safeTitle = title.replace(/\r?\n/g, " ").trim()`) e é usado cru no
`subject` do e-mail — nenhum escaping de `<`/`>`/`&` é aplicado. Não há CRLF injection (quebras de linha já
são removidas), mas alguns clientes de e-mail renderizam o assunto em contexto HTML (preview/notificação),
o que deixaria caracteres HTML do título passarem sem tratamento.

Separadamente, `apps/api/src/common/health-monitor.service.ts:89` e `apps/api/src/app.controller.ts:50`
usam `this.prismaRead.$queryRawUnsafe("SELECT 1")` — uma string literal fixa, sem nenhum input de usuário
interpolado. Não há vulnerabilidade de injeção hoje (nada é injetável em uma string constante), mas o uso do
método "Unsafe" para uma query sem parâmetros é desnecessário e reduz a força de sinal do padrão: se alguém
grepar `$queryRawUnsafe` no futuro para auditar risco de SQL injection, esses dois resultados são ruído.
Substituir por `$queryRaw` com tagged template remove essa superfície por completo.

## Causa raiz
- Causa imediata: `safeTitle` nunca recebeu o mesmo tratamento de `safeDescription` porque o escaping foi
  adicionado pensando apenas no corpo HTML (`<p>${safeDescriptionHtml}</p>`), não no `subject`. Os dois
  healthchecks foram escritos com `$queryRawUnsafe` provavelmente por cópia de um padrão comum de
  healthcheck Prisma, sem reavaliar se `$queryRaw` bastava (bastava, porque a query é literal).
- Causa sistêmica: não há regra de lint/revisão que force paridade de escaping entre campos irmãos (título
  vs. descrição) de uma mesma DTO destinada a um mesmo canal de saída (e-mail), nem um lint que sinalize
  `$queryRawUnsafe` sem interpolação como candidato a `$queryRaw`. Ambos são achados de leitura estática via
  as skills `react-best-practices`/`security-threat-model`, não de um incidente reportado.
- Padrão: não há classe E registrada em EPISODIC_MEMORY.md para escaping assimétrico de campos ou uso de
  `$queryRawUnsafe` sem input. Domínio "Security review — execução real vs. declaração" está **Em
  refinamento** (DOMAIN_MATURITY.md) — não há classe Instável aplicável, mas a Spec aplica atenção redobrada
  por precaução, dado que o backlog de segurança do projeto já lista "XSS em dados CBTM renderizados" como
  superfície de risco ativa (não é o mesmo item, mas é domínio adjacente).

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Subject do e-mail de suporte escapado
DADO um usuário anônimo envia `POST /support/report-problem` com `title` contendo caracteres HTML
(ex.: `<b>teste</b>` ou `<img src=x onerror=alert(1)>`)
QUANDO `sendSupportEmail` monta o e-mail de suporte
ENTÃO o `subject` e o corpo do e-mail devem conter o título com escaping HTML aplicado (mesma função
`escapeHtml` já usada para `description`), preservando o texto visível mas neutralizando tags/entidades.

### Cenário 2 — Healthcheck sem `$queryRawUnsafe`
DADO o serviço de banco de dados está disponível
QUANDO `HealthMonitorService.checkDatabase()` ou `AppController.checkDatabase()` executam a verificação de
conectividade
ENTÃO a consulta deve ser feita via `$queryRaw` com tagged template (`Prisma.sql` ou template literal
padrão do Prisma), nunca via `$queryRawUnsafe`, mantendo o mesmo comportamento observável (retorna sem
lançar exceção quando o banco responde).

### Cenário 3 — Regressão do fluxo de e-mail
DADO um `title` e `description` sem nenhum caractere especial (caso comum)
QUANDO `sendSupportEmail` é chamado
ENTÃO o e-mail deve ser enviado com o mesmo conteúdo visível de antes da mudança (nenhuma dupla-escapagem,
nenhuma alteração de texto para inputs sem caracteres HTML).

## Critérios de aceitação
- `subject` do e-mail de suporte usa texto escapado (verificável via mock do `transporter.sendMail`,
  inspecionando o argumento `subject` recebido).
- Nenhuma quebra de compatibilidade: e-mails com título "normal" (sem HTML) continuam idênticos ao
  comportamento atual.
- `HealthMonitorService.checkDatabase` e `AppController.checkDatabase` não contêm mais a string
  `$queryRawUnsafe` — apenas `$queryRaw`.
- Ambos os healthchecks continuam retornando sucesso quando o banco responde e erro/exception quando não
  responde (nenhuma mudança de contrato observável do endpoint `GET /` nem do log do monitor).
- Suite completa do projeto (`apps/api`) permanece verde.

## Fora de escopo
- Qualquer mudança em `description`/`safeDescriptionHtml` (já corretamente escapados) — não tocar.
- Qualquer mudança de contrato de API pública (`GET /`, `POST /support/report-problem`) — response shape
  permanece idêntico.
- Rate limiting, CORS, headers de segurança, autenticação — não tocados nesta Spec.
- Qualquer outro uso de `$queryRawUnsafe`/`$executeRawUnsafe` no projeto além dos dois arquivos citados —
  fora do escopo desta entrega pontual; se houver outros, registrar como candidato a nova Spec, não
  expandir esta.
- CSP, XSS em dados CBTM renderizados no frontend (PEND-CBTM-002, backlog SSRF/scraping) — domínios
  distintos, não relacionados a este ajuste.

## Impacto técnico

### Arquivos a criar/modificar
- `apps/api/src/user/user.service.ts` — método `sendSupportEmail` (linhas ~1018–1058): aplicar
  `escapeHtml()` (já definida na linha 865, reutilizar — não duplicar) sobre `safeTitle` antes de usá-lo em
  `subject` e em qualquer lugar do corpo do e-mail. Manter a remoção de `\r\n` já existente antes do
  escaping (ordem: remover quebras de linha → escapar HTML).
- `apps/api/src/common/health-monitor.service.ts` — método `checkDatabase` (linha ~87–95): trocar
  `this.prismaRead.$queryRawUnsafe("SELECT 1")` por `this.prismaRead.$queryRaw(Prisma.sql\`SELECT 1\`)` ou
  `` this.prismaRead.$queryRaw`SELECT 1` `` (tagged template padrão do Prisma). `Prisma` já está importado
  neste arquivo (linha 2) — não precisa de novo import se usar o tagged template direto sem `Prisma.sql`.
- `apps/api/src/app.controller.ts` — método `checkDatabase` (linha ~48–58): mesma troca. Este arquivo NÃO
  importa `Prisma` hoje — se a implementação usar apenas o tagged template `` this.prismaRead.$queryRaw`SELECT 1` ``
  (sem `Prisma.sql`), nenhum import novo é necessário; confirmar qual forma o Prisma Client instalado exige
  antes de decidir se precisa importar `Prisma` de `@prisma/client`.

### Arquivos que NÃO devem ser tocados
- `apps/api/src/user/user.service.ts` — qualquer método além de `sendSupportEmail` (arquivo é grande,
  ~1000+ linhas; escopo é estritamente esse método).
- `apps/api/src/common/health-monitor.service.ts` — qualquer método além de `checkDatabase` (o arquivo
  contém lógica extensa de auto-recuperação de scrape; não tocar `recoverDegradedScrapes`,
  `recoverStaleEventData`, `autoConcludeExpiredEvents`, etc.).
- `apps/api/src/app.controller.ts` — o método `health()` e a chamada a `queueService.getHealth()` não
  mudam; só o corpo interno de `checkDatabase`.
- Nenhum arquivo de schema Prisma, migration, DTO ou rota — nenhum dos dois ajustes altera contrato.

### DDL / migração
Não aplicável — nenhuma mudança de schema.

### Contrato de API alterado
Não aplicável — response shape de `GET /` e `POST /support/report-problem` permanece idêntico.

### Dependências novas
Nenhuma — `escapeHtml` já existe localmente; `Prisma`/`$queryRaw` já fazem parte do Prisma Client já
instalado.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário
- arquivos de teste a criar/estender:
  - teste unitário de `sendSupportEmail` (localizar/estender suite existente de `user.service` em
    `apps/api/test/` ou colocation equivalente ao padrão do projeto — Codex confirma o caminho exato
    seguindo a convenção já usada para outros métodos de `UserService`)
  - teste unitário de `HealthMonitorService.checkDatabase` (estender suite existente, se houver, ou criar
    uma mínima focada nesse método)
  - teste unitário de `AppController.checkDatabase`/`health()` (estender suite existente)
- fixtures/mocks: mock de `nodemailer.createTransport().sendMail` (capturar argumento `subject`/`html`);
  mock de `PrismaReadService.$queryRaw` (verificar que é chamado, não `$queryRawUnsafe`)
- COBERTURA: regressão=2 corretude=2

### T-U-01 — Subject do e-mail escapa HTML do título
Camada: função / serviço
DADO: `title = "<b>Bug</b> no ranking"`, `description = "texto normal"`
QUANDO: `reportProblem(title, description)` é chamado (com SMTP configurado via env de teste)
ENTÃO: o mock de `sendMail` recebe `subject` contendo `&lt;b&gt;Bug&lt;/b&gt; no ranking` (ou equivalente
escapado da função `escapeHtml` local), nunca a tag `<b>` crua — valor esperado calculado fora da função
sob teste (escaping manual do literal no teste, não reaproveitando `escapeHtml` importada).

### T-U-02 — Regressão: título sem caracteres especiais não muda
Camada: função / serviço
DADO: `title = "Erro no ranking"`, `description = "texto normal"` (sem HTML)
QUANDO: `reportProblem(title, description)` é chamado
ENTÃO: o `subject` recebido pelo mock é exatamente `"Bug Site: Erro no ranking"`, idêntico ao
comportamento anterior à mudança — mede o mesmo estado observável antes/depois para confirmar ausência de
regressão.

### T-U-03 — Healthcheck do monitor usa $queryRaw, não $queryRawUnsafe
Camada: função / serviço
DADO: `PrismaReadService.$queryRaw` mockado para resolver com sucesso; spy em `$queryRawUnsafe`
QUANDO: `HealthMonitorService["checkDatabase"]()` é invocado (método privado — Codex decide chamar via
`runChecks()` público ou expor para teste conforme convenção já usada no arquivo/projeto)
ENTÃO: `$queryRaw` foi chamado exatamente 1 vez; `$queryRawUnsafe` não foi chamado nenhuma vez — corretude
verificada pela chamada ao método correto, não pelo retorno (que é sempre `SELECT 1`).

### T-U-04 — Regressão: comportamento de erro do healthcheck do AppController preservado
Camada: função / serviço
DADO: `PrismaReadService.$queryRaw` mockado para rejeitar com um erro conhecido (`new Error("conexão
recusada")`)
QUANDO: `AppController.health()` é chamado
ENTÃO: a resposta mantém `checks.database = { status: "error", error: "conexão recusada" }` e
`status: "degraded"` no nível raiz — mede o mesmo estado observável (contrato de resposta) antes/depois da
troca de `$queryRawUnsafe` para `$queryRaw`, confirmando que a mudança não altera o comportamento de erro.

### Cobertura de falhas silenciosas
- Não aplicável a upload/formulário de UI — mudança é server-side sem view associada.
- E-mail: teste verifica o conteúdo efetivamente passado ao transporter (T-U-01/T-U-02), não apenas que
  `sendMail` foi chamado.
- Healthcheck: teste verifica qual método Prisma foi chamado e o efeito no contrato de resposta
  (T-U-03/T-U-04), não apenas ausência de exceção.

### Cobertura mínima por categoria
- Formulário / Cadastro: não aplicável — `report-problem` já tem validação de DTO coberta por Spec
  anterior; esta Spec não altera validação, só o e-mail de saída.
- Integração externa: coberta — nodemailer (T-U-01/T-U-02) e Prisma/banco (T-U-03/T-U-04) são as duas
  integrações externas tocadas.
- Regra de negócio: coberta — a "regra" é paridade de escaping entre título e descrição (T-U-01) e uso do
  método seguro do Prisma (T-U-03).
- Demais categorias (edição, exclusão, listagem, autenticação, upload, UI/componente): não aplicável —
  nenhuma delas é tocada por esta Spec.

### Comando para rodar a suite
`npm --prefix apps/api test`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Fast track (2026-09-18)
Entrega classificada como fast track pelo protocolo do orquestrador FloresTech: toca dois arquivos sem
dependência funcional entre si (e-mail de suporte vs. healthcheck de banco), sem DDL/migração, sem mudança
de contrato de API/rota pública, sem dado sensível novo, domínio "Security review — execução real vs.
declaração" está Em refinamento (não Instável) em DOMAIN_MATURITY.md — não força ciclo tripartite completo.
Origem: análise de Claude usando as skills `react-best-practices` e `security-threat-model` recém-instaladas
em `.claude/skills/`, aprovada por Leo para virar Spec unificada em 2026-09-18.

Leo encerrou o CAT compacto ao pedir explicitamente "vamos evoluir para uma spec unificada destes ajustes
juntos" — sem `[PENDENTE]` em aberto, sem necessidade de contraponto Codex prévio dado o baixo risco e
escopo já bem delimitado pela análise anterior.
