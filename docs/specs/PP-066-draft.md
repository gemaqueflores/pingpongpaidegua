## Rascunho — PP-066
Projeto: PingPong PaiD'egua (`appcbtmeventos`)
Objetivo: corrigir duplicação de partidas em fase ELIMINATORIA (bug relatado por Leo no evento "Open Bosque")

### Contexto técnico levantado (Read/Grep executados nesta rodada)

- `phase: "ELIMINATORIA"` é hoje **hard-disabled na origem**:
  - `apps/worker/src/scraper/live-http-capture.service.ts:258-388` — `shouldFetchEliminatoria = false`
    fixo, comentário explícito: "Hard-disabled: fase eliminatoria nao faz mais parte do scraping oficial."
  - `apps/worker/src/pipeline/scrape.processor.ts:391-409` — `fetchEliminatoria: false` fixo em todos os
    pontos de decisão de política de scrape.
  - `packages/parser/src/index.ts:22` — `const ELIMINATORIA_ENABLED = false;`, guarda os dois blocos que
    chamariam `parseEliminationMatches` (linhas 1767 e 1808) — com `ELIMINATORIA_ENABLED = false`, nenhum
    payload de `api/GameResult` é parseado, então **nenhuma partida nova de fase ELIMINATORIA é gerada
    pelo pipeline atual**.
  - `packages/shared/src/index.ts:1042-1055` (`normalizeLegacyMatchPhase`) já converte `ELIMINATORIA` →
    `RESULTADOS` — usado em `match-merge.ts:656` (`mergeGroup`), mas **não** é chamado no caminho de
    persistência direta em `upsert.service.ts:1748` (`persistedPhase = parsedMatch.phase as MatchPhase`
    sem passar por `normalizeLegacyMatchPhase`). Como hoje nenhum `ParsedMatch` chega com
    `phase: "ELIMINATORIA"` (fetch desabilitado), essa lacuna é inofensiva na prática atual — mas é uma
    inconsistência: a normalização de fase legada não é aplicada uniformemente nos dois caminhos.
  - `apps/worker/src/pipeline/scrape.processor.ts:1488-1493,1666-1670` — auditoria pós-persistência
    (`AUDITORIA_ELIMINATORIA_BLOQUEADA`) apenas **emite warning** se encontrar `phase: "ELIMINATORIA"` no
    banco; não bloqueia scrape nem remove os registros.

- Conclusão preliminar: se existem hoje partidas duplicadas com `phase = 'ELIMINATORIA'` no evento "Open
  Bosque", a causa mais provável é **dado legado remanescente no banco** (criado antes do hard-disable,
  quando o fetch de `api/GameResult` ainda rodava), não uma regressão ativa do pipeline de scrape atual.
  PP-055 (script `scripts/pp-055-saneamento-matches-duplicados.ts`) já tratou duplicação de partidas em
  outro evento via saneamento **pontual e manual** (dry-run/execute por `--event-id`), não uma correção
  estrutural — não impede recorrência, só limpa o que já existe quando executado.

- Não encontrei nenhuma referência a "Open Bosque" no código ou em `docs/` — é informação nova desta
  sessão, presumivelmente fornecida por Leo fora do repositório (nome do evento em produção).

### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**O QUE**
[PENDENTE: Leo confirma que o problema é "partidas duplicadas visíveis para o usuário" (ex.: mesmo
confronto aparecendo 2x na aba de chaveamento/atletas de um evento) e que a fase envolvida é
especificamente `ELIMINATORIA` (não `GRUPOS`/`RESULTADOS` mal rotuladas como eliminatória na UI)?]

[PENDENTE: o "Open Bosque" é um evento específico em produção (cbtmEventId conhecido) que Leo pode
informar, para eu confirmar via leitura read-only (SSH/Prisma) se há registros com `phase = 'ELIMINATORIA'`
duplicados hoje, antes de propor a correção?]

**COMO**
[PENDENTE: dado que o fetch de ELIMINATORIA já está hard-disabled, o objetivo da correção é (a) só limpar
o dado legado duplicado já existente (saneamento pontual, como PP-055), (b) adicionar uma proteção
estrutural que impeça duplicação futura desse tipo de dado (ex.: aplicar `normalizeLegacyMatchPhase` de
forma consistente em `upsert.service.ts`, e/ou fazer a auditoria `AUDITORIA_ELIMINATORIA_BLOQUEADA`
efetivamente bloquear/reconciliar em vez de só alertar), ou (c) as duas coisas?]

**ONDE**
[PENDENTE: a duplicação foi observada em qual superfície — frontend (`apps/web`, aba de chaveamento ou
lista de partidas do atleta), API (`apps/api`), ou diretamente no banco (contagem de linhas em `Match`)?
Isso muda se a causa é dado duplicado na tabela `Match` ou uma renderização duplicada no frontend a partir
de dado correto.]

**Definição de pronto**
[PENDENTE: Leo define o critério objetivo — ex.: "evento Open Bosque em produção não mostra mais partida
duplicada na aba X" + "nenhuma outra categoria/evento com o mesmo padrão de duplicação" + "não há
regressão futura possível pelo pipeline atual"?]

### Proposta de abordagem técnica por item (sujeita aos PENDENTE acima)

1. Confirmar por leitura read-only (Prisma/SSH) se há partidas com `phase = 'ELIMINATORIA'` duplicadas
   hoje no evento Open Bosque em produção — mesma metodologia de verificação independente usada em
   PP-062/PP-055 (nunca aceitar "está duplicado" sem consulta própria).
2. Se confirmado dado legado duplicado: propor saneamento pontual no mesmo padrão de PP-055 (script
   dry-run → execute, escopado por `--event-id`, com backup antes de `--execute` em produção).
3. Avaliar se cabe fechar a lacuna estrutural identificada (`normalizeLegacyMatchPhase` não aplicado em
   `upsert.service.ts:1748`) como prevenção de recorrência, mesmo que hoje seja inofensiva — decisão de
   escopo depende da resposta ao PENDENTE de COMO acima.
4. Não reabilitar fetch de ELIMINATORIA (`ELIMINATORIA_ENABLED`/`fetchEliminatoria`) — fora de escopo
   presumido, a menos que Leo indique o contrário.

### Hipótese de impacto técnico (arquivos / contratos / DDL)

- Leitura/consulta: sem impacto em código, apenas queries read-only para confirmar causa raiz.
- Se saneamento pontual: novo script em `scripts/` (padrão PP-055), sem migration.
- Se correção estrutural: possível alteração cirúrgica em `apps/worker/src/pipeline/upsert.service.ts`
  (aplicar `normalizeLegacyMatchPhase` antes de `persistedPhase`) — sem DDL, sem mudança de contrato de
  API.
- Nenhuma mudança de schema (`prisma/schema.prisma`) prevista até aqui.

### Fora de escopo (proposto, sujeito a confirmação)
- Reabilitação do scraping de ELIMINATORIA.
- Mudanças em GRUPOS/RESULTADOS não relacionadas à duplicação relatada.
