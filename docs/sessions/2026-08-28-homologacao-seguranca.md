# Sessão 2026-08-28 — Homologação retroativa de segurança (PP-027, PP-029, PP-030, PP-031, PP-034, PP-035)

## Estado atual
Branch `main`, commit topo `afda66a` (push pendente de credencial — ver sessão de higiene documental do
mesmo dia). Todas as 6 Specs já estavam mergeadas em produção antes desta homologação; nenhum código foi
alterado nesta sessão — apenas leitura, execução de suite/build e registro do parecer.

## Contexto
Auditoria de pendências/backlog a pedido de Leo revelou que 6 PRs de segurança (#30, #31, #32, #34, #36,
#37) foram mergeados sem parecer formal registrado no `SESSION_STATE.md`. Leo priorizou segurança antes de
qualquer nova implementação (PP-037). Esta sessão trata a homologação retroativa dessas 6 entregas.

## Concluído nesta sessão
- Leitura independente de `auth-config.ts`, `jwt.strategy.ts`, `auth.service.ts`, `auth.controller.ts`,
  `simple-rate-limit.middleware.ts`, `roles.guard.ts`, `docker-compose.yml`, `next.config.js`,
  `schema.prisma` (via subagente com instruções específicas por critério de segurança).
- Suite API reexecutada: 206/206 ✅. Build API ✅. Build web ✅.
- Encoding/BOM/CRLF verificado nas 6 Specs de segurança: todas OK-sem-BOM, OK-LF.
- `git show --stat` de cada commit confirmou autoria: todos os 5 commits de código são de Leonardo Flores
  (orquestrador), não do Codex — execução direta em resposta a contenção P0 (PP-027) e Specs subsequentes
  na mesma janela.
- Security review manual (via subagente dedicado) sobre os 6 critérios de segurança relevantes.

## Parecer — [⚠️ aprovado com ressalvas]

### Itens ✅ verificados corretos
- Fail-fast de `JWT_SECRET`/`ADMIN_PASSWORD_HASH` independe de `NODE_ENV`, só aceita defaults com
  `ALLOW_INSECURE_DEV_AUTH_DEFAULTS="true"` exato (PP-027).
- Role de autorização vem de consulta real ao banco (`AdminCredential`), nunca do payload JWT bruto
  (PP-027).
- `tokenVersion` do payload comparado contra o registro atual do banco; `resetPassword()` incrementa
  `tokenVersion` na mesma operação atômica da troca de senha (PP-034).
- `revokeSessions()` usa exclusivamente `user.username` do JWT autenticado — sem IDOR (PP-034).
- Senha do Redis não exposta em texto claro no healthcheck (`REDISCLI_AUTH`, `$$REDIS_PASSWORD` — escape
  correto) (PP-030).
- Segmentação de rede `postgres-tier`/`redis-tier`/`app-tier` confirmada — postgres e redis não
  compartilham rede diretamente (PP-031).

### Itens ⚠️ (ressalvas de segurança)
1. **[Alto defensivo, não explorável hoje]** `apps/web/next.config.js:8` — CSP com
   `script-src 'self' 'unsafe-inline'` anula a proteção contra XSS injetado via script inline. Sem sink
   `dangerouslySetInnerHTML`/`innerHTML` no frontend hoje (verificado), mas qualquer renderização futura de
   conteúdo externo (dado CBTM raspado, nome de atleta) ficaria desprotegida. Next.js App Router não exige
   `unsafe-inline` em `script-src`.
2. **[Médio]** `jwt.strategy.ts` — campo `role` no payload JWT é assinado mas nunca lido de volta (seguro
   hoje por design single-admin, decorativo).
3. **[Baixo]** `auth-config.ts` — sem checagem de comprimento mínimo de `JWT_SECRET` configurado.

### Achado de processo — Q12 (Red-Green rastreável)
5 commits de código (`73bed97`, `214d333`, `c51df1d`, `11cfcd8`, `6323a0e`+`c45cb2d`) sem par red/green por
T-* — cada um agregando toda a Spec em commit único. Autoria: Leonardo Flores, não Codex. Domínio "TDD
Red-Green-Refactor verificável no Git" já estava Instável (2 incidentes prévios PP-006). Registrado em
EPISODIC_MEMORY (E01) como exceção emergencial do orquestrador — **não imputado ao Codex**, não conta como
nova ocorrência de desvio de implementador.

### PP-028 (rotação senha Postgres) — status separado
Puramente operacional, sem código versionado. Spec já registra "R1 relatado como concluído pelo Codex" sem
verificação independente possível (sem acesso a produção nesta sessão). Permanece pendência de confirmação
factual — Leo ou Codex via SSH confirmam se a senha em produção ainda é a default.

## Ordem de correção acordada (Claude + Codex, Leo não contestou)
1. CSP com nonce antes da próxima mudança que renderize conteúdo externo/dinâmico.
2. Validação de comprimento mínimo do `JWT_SECRET`.
3. Comentário ou remoção futura do `role` decorativo no JWT.
4. PP-028 permanece pendência operacional separada até verificação factual em produção.
5. Q12 registrado em EPISODIC_MEMORY como exceção emergencial do orquestrador — feito nesta sessão.

## Decisões tomadas
- Não reabrir PRs já mergeados — ressalvas viram Specs de correção futuras, não bloqueio retroativo.
  Válida próxima sessão: S.
- Texto de proveniência "Codex:" desta sessão verificado por Grep em
  `~/.codex/sessions/2026/08/28/rollout-2026-08-28T10-48-22-...jsonl:181` — match exato, tratado como saída
  real do Codex antes de agir.

## Candidatos a regra de contrato
- Nenhum novo — achados desta sessão já se encaixam em processos existentes (backlog de segurança,
  EPISODIC_MEMORY E01).

## Padrões que funcionaram (reforço)
- Delegar a leitura de segurança a um subagente com critérios explícitos por arquivo:linha permitiu
  verificação determinística item a item sem consumir contexto da sessão principal. Reforçar: S.
- Verificar proveniência de mensagem "Codex:" por Grep antes de agir, mesmo quando o conteúdo parecia
  coerente com o parecer já formado. Reforçar: S.

## Estado para próxima sessão
- Pendências que seguem: CSP nonce, tamanho mínimo JWT_SECRET, comentário sobre role decorativa, PP-028
  (verificação factual), PP-037 aguardando autorização.
- T-* não auditados: nenhum nas 6 Specs desta homologação.
- Score: ⚠️ 5✅ 3⚠️ 0❌.

## Arquivos relevantes
- `apps/api/src/auth/auth-config.ts`, `jwt.strategy.ts`, `auth.service.ts`, `auth.controller.ts`
- `apps/api/src/common/simple-rate-limit.middleware.ts`, `roles.guard.ts`
- `docker-compose.yml`, `apps/web/next.config.js`, `prisma/schema.prisma`
- `docs/specs/PP-027-contencao-emergencial-auth.md`, `PP-029-parametrizacao-compose.md`,
  `PP-030-autenticacao-redis.md`, `PP-031-segmentacao-rede-docker.md`, `PP-034-revogacao-sessao-admin.md`,
  `PP-035-csp-frontend.md`, `PP-028-rotacao-senha-postgres.md`
