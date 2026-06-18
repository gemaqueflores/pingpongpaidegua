# PP-016 — Partidas Previstas calibradas por evidência observada

Domínio instável: TDD Red-Green-Refactor verificável no Git — atenção redobrada (classe [[E01]] ativa,
`Documents/estudos/EPISODIC_MEMORY.md`). Esta entrega exige par de commits Red/Green **individual por T-***,
com hashes declarados separadamente no relatório — não agrupar T-* no mesmo commit.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é cálculo numérico interno sobre dados já lidos do próprio banco via Prisma; nenhuma superfície nova de input do usuário, auth, SQL dinâmico ou integração externa é tocada.
- e2e-playwright-agent: não — mudança é renderização condicional de texto estático (tooltip) e valor numérico já exibido; cobertura unitária + componente é suficiente.
- report-builder-agent: não — não há exigência de relatório estruturado de evidências para esta entrega.

## Objetivo

A badge "Partidas Previstas", exibida na página pública de evento (`/events/[id]`), usa hoje um modelo
teórico fixo de chaveamento (grupos de 3 atletas, mata-mata simples) para estimar quantas partidas uma
categoria deveria gerar. Esse modelo não reflete o formato real de disputa usado pela CBTM e pode subestimar
drasticamente o valor real — no evento 51 (3TMB26), a badge mostrava 1129 partidas previstas contra 3350
partidas realmente jogadas (3547 publicadas), uma divergência de ~3x que transmite informação enganosa ao
usuário final sobre o tamanho real do evento.

Esta entrega corrige a métrica para nunca ser menor que o que já foi efetivamente publicado, e adiciona um
indicador de proveniência para deixar claro ao usuário quando o número é observado (calibrado por dado real)
versus estimado (ainda só o modelo teórico, categoria sem partidas publicadas).

## Contexto

Auditoria de produção (evento 51, ver `docs/specs/AUDIT-3TMB26-producao.md` e sessão de chat que originou
este PP) confirmou via API e SQL direto:
- `totalPartidasPrevistas = 1129`, `totalPartidasPublicadas = 3547`, `totalPartidasJogadas = 3350`,
  `totalPartidasWo = 197` (`3547 = 3350 + 197`, aritmética interna correta).
- Não há nenhuma partida com `phase = ELIMINATORIA` em produção para os eventos 51/52/53 — achado lateral
  confirmado fora de escopo deste PP (normalização legada `ELIMINATORIA -> RESULTADOS`, parser com
  `ELIMINATORIA_ENABLED = false`).
- Inferir o formato real via `Match.round` foi avaliado e descartado como fonte única: `round` está ausente
  em 2097 de 3439 partidas do evento 51 e a nomenclatura não é consistente entre eventos/categorias de
  duplas (unidade competitiva diferente de atleta individual).

Decisão tomada no ciclo tripartite (`docs/specs/PP-016-partidas-previstas-draft.md`, aprovado ✅ por Leo):
calibrar a métrica pelo **piso observado** — partidas já publicadas nunca podem ser maiores que o "previsto"
exibido — sem tentar reconstruir o chaveamento exato.

## Causa raiz

- **Causa imediata:** `computeOfficialCategoryMatchesCount` (`packages/shared/src/index.ts:321-366`) calcula
  partidas previstas a partir de `registeredCount` usando um modelo fixo (grupos de 3 + mata-mata simples,
  sem 3º lugar/repescagem) para qualquer categoria que não seja "Rating". O resultado nunca é comparado contra
  quantas partidas já foram de fato publicadas para aquela categoria.
- **Causa sistêmica:** o sistema nunca teve, desde sua origem, uma fonte de verdade para o formato real de
  disputa por categoria/evento (tamanho de grupo, existência de consolação/repescagem) — o modelo teórico foi
  uma aproximação inicial que nunca foi recalibrada contra dados reais conforme eventos foram concluídos.
- **Padrão:** não há classe E registrada em `EPISODIC_MEMORY.md` para "métrica de previsão divergente do
  observado" — primeira ocorrência detectada para este tipo de falha.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — categoria com partidas publicadas acima do teórico (caso real do evento 51)
DADO uma categoria com `calculatedMatchesCount = 6` (modelo teórico) e `publishedMatchesCount = 9`
QUANDO `getEventSummary` agrega as métricas dessa categoria
ENTÃO o valor de partidas previstas usado na agregação do evento é `9` (o maior dos dois), não `6`

### Cenário 2 — categoria com teórico ainda maior que o publicado (sem regressão)
DADO uma categoria com `calculatedMatchesCount = 6` e `publishedMatchesCount = 5` (caso já coberto pelo
teste existente `user-service.event-summary-cache.test.ts`)
QUANDO `getEventSummary` agrega as métricas dessa categoria
ENTÃO o valor de partidas previstas permanece `6` (comportamento atual preservado, sem regressão)

### Cenário 3 — categoria sem nenhuma partida publicada
DADO uma categoria com `calculatedMatchesCount = 6` e `publishedMatchesCount = 0`
QUANDO `getEventSummary` agrega as métricas dessa categoria
ENTÃO o valor de partidas previstas é `6` (fallback puro do modelo teórico, `max(6, 0) = 6`)

### Cenário 4 — proveniência "observada" no payload do evento
DADO um evento onde ao menos uma categoria teve `publishedMatchesCount > calculatedMatchesCount`
QUANDO `getEventSummary(eventId)` é chamado
ENTÃO o payload retorna `totalPartidasPrevistasFonte: "observada"`

### Cenário 5 — proveniência "estimada" quando nenhuma categoria foi calibrada
DADO um evento onde todas as categorias têm `publishedMatchesCount <= calculatedMatchesCount`
QUANDO `getEventSummary(eventId)` é chamado
ENTÃO o payload retorna `totalPartidasPrevistasFonte: "estimada"`

### Cenário 6 — evento agregado (canonical + filhos) com fontes mistas
DADO um evento agregado (ex.: 51+52+53) onde a categoria do evento filho 52 foi calibrada (observada) mas
todas as categorias do canonical 51 e do filho 53 permanecem na estimativa teórica
QUANDO `getEventSummary(51)` agrega os três escopos
ENTÃO `totalPartidasPrevistasFonte` do payload agregado é `"observada"` (basta uma categoria calibrada em
qualquer evento do escopo para a fonte do agregado virar "observada")

### Cenário 7 — UI exibe indicador apenas quando a fonte é observada
DADO `event.totalPartidasPrevistasFonte === "observada"` no payload recebido pelo frontend
QUANDO a página do evento renderiza a badge "Partidas Previstas"
ENTÃO um indicador/tooltip é exibido junto à badge informando que o valor é calibrado por dado real

### Cenário 8 — UI não exibe indicador quando a fonte é estimada
DADO `event.totalPartidasPrevistasFonte === "estimada"` (ou campo ausente, por payload de cache antigo)
QUANDO a página do evento renderiza a badge "Partidas Previstas"
ENTÃO nenhum indicador de "observada" é exibido (comportamento atual da badge, sem alteração visual)

## Critérios de aceitação

- Para toda categoria, o valor de partidas previstas usado na agregação nunca é menor que o número de
  partidas já publicadas daquela categoria (`totalPartidasPrevistas >= totalPartidasPublicadas` ao nível de
  evento, decorrência do `max()` por categoria).
- Para o evento 51 especificamente, após a mudança, `totalPartidasPrevistas` recalculado deve ser `>= 3547`
  (não é necessário validar o valor exato em produção nesta Spec — a verificação de produção é evidência
  já levantada via Codex/SSH na sessão que originou este PP, não um T-* automatizado).
- Categorias Rating mantêm a regra especial existente (`ratingMatchFormat`) sem alteração de comportamento.
- Novo campo `totalPartidasPrevistasFonte: "observada" | "estimada"` presente em todo payload de
  `getEventSummary`.
- Cache de read model migra de `event-summary-v12` para `event-summary-v13` — nenhum payload antigo
  (`v12`) é lido como se already tivesse o campo novo.
- UI exibe indicador apenas quando a fonte é `"observada"`; ausência do campo ou valor `"estimada"` não
  altera a aparência atual da badge.

## Fora de escopo

- Reconstrução do chaveamento real via `Match.round` (descartado no ciclo tripartite — fonte inconsistente).
- Tratamento de partidas com `phase = ELIMINATORIA` (achado lateral confirmado irrelevante para o evento 51
  em produção — `ELIMINATORIA_ENABLED = false` no parser atual).
- Qualquer novo campo de configuração manual de formato de chaveamento por evento/categoria (tamanho de
  grupo, repescagem, 3º lugar) — não cadastrado em nenhuma tela ou modelo Prisma nesta entrega.
- Migração/backfill de dados históricos — a mudança é de cálculo em tempo de leitura; eventos antigos só são
  recalculados quando acessados novamente (cache invalidado pela troca de versão da chave).
- Alteração do filtro `phase IN (GRUPOS, RESULTADOS)` usado para `publishedMatchesCount`.

## Impacto técnico

### Arquivos a modificar

- `apps/api/src/user/user.service.ts`
  - `computeCategoryMatchMetrics` (linhas 743-766): aplicar
    `calculatedMatchesCount = Math.max(toNonNegativeInt(input.calculatedMatchesCount), publishedMatchesCount)`
    antes de retornar — preservar `playedMatchesCount` calculado a partir do `publishedMatchesCount` original
    (não do `calculatedMatchesCount` ajustado).
  - `loadScopedEventSummaryMetrics` (linhas 1336-1360, loop que popula `metricsByEventId`): nenhuma mudança
    estrutural — já consome o retorno de `computeCategoryMatchMetrics`, que passa a vir calibrado.
  - `aggregateScopedEventSummary` (linhas 1382-1468): adicionar cálculo de
    `totalPartidasPrevistasFonte` — `"observada"` se, para qualquer categoria de qualquer evento do escopo
    (`allEventIds`), `publishedMatchesCount > calculatedMatchesCountOriginal` (antes do `max`); caso
    contrário `"estimada"`. Requer expor, junto de `metricsByEventId`, um sinal por evento (ex.:
    `calibratedByEventId: Map<number, boolean>`) construído dentro de `loadScopedEventSummaryMetrics` no
    mesmo loop que já calcula `metricsByEventId` (linha ~1336-1360), já que ali se tem acesso aos dois
    valores originais antes do `max()`.
  - `getEventSummary` (linha 1579): trocar `"event-summary-v12"` por `"event-summary-v13"` em
    `buildReadModelKey`.
  - Incluir `totalPartidasPrevistasFonte: aggregate.totalPartidasPrevistasFonte` no objeto retornado por
    `getEventSummary` (próximo aos demais campos de `aggregate`, por volta da linha 1659-1671) e no payload
    placeholder de `_meta.building` (linhas 1602-1621, usar `"estimada"` como valor neutro enquanto o cache
    está sendo construído).
  - `listEvents` (linhas 1520+): incluir o mesmo campo no retorno por evento, usando a mesma
    `aggregateScopedEventSummary` já compartilhada — sem necessidade de nova lógica, apenas garantir que o
    campo propague do mesmo agregador.

- `apps/web/app/user/events/[id]/page.tsx`
  - Linha 626: condicionar exibição de um indicador/tooltip (ex.: ícone ou texto pequeno "calibrado por
    resultados publicados") quando `event?.totalPartidasPrevistasFonte === "observada"`. Sem alteração de
    layout quando o valor for `"estimada"` ou ausente.

- `apps/api/test/user-service.event-summary-cache.test.ts`
  - Fixture existente (linha 38: `published=5`) já cobre o Cenário 2 (teórico > publicado, sem regressão) —
    adicionar asserção de `totalPartidasPrevistasFonte === "estimada"` neste teste já existente.
  - Adicionar novo cenário de fixture com `published > calculated` para cobrir Cenário 1 e 4.

### Arquivos que NÃO devem ser tocados

- `packages/shared/src/index.ts` — `computeOfficialCategoryMatchesCount` permanece sem alteração; o `max()`
  é aplicado depois, sobre o valor que ela retorna, em `computeCategoryMatchMetrics`.
- Qualquer lógica de `phase IN (GRUPOS, RESULTADOS)` / filtro de `ELIMINATORIA` — fora de escopo declarado.
- Schema Prisma (`prisma/schema.prisma`) — nenhum campo novo de modelo de dados é necessário.
- `apps/worker/**` — pipeline de scraping não é afetado; a mudança é só de leitura/agregação na API.

### Cache de read model

- Chave: `event-summary-v12` → `event-summary-v13`. Linhas antigas `v12` ficam órfãs no banco (inofensivas,
  sem limpeza automática exigida nesta entrega).
- Efeito: próximo `GET /events/:id` de qualquer evento recalcula sob demanda (lazy), sem job de backfill em
  massa.

### Dependências novas

Nenhuma.

## Plano de testes

### Cobertura geral
- Camadas: unitário (função pura `computeCategoryMatchMetrics`) + integração (`getEventSummary`/`listEvents`
  via harness Prisma fake já usado em `user-service.event-summary-cache.test.ts`) + componente (frontend,
  renderização condicional do indicador).
- Arquivos de teste a criar/editar:
  - `apps/api/test/user-service.event-summary-cache.test.ts` (editar — estender fixtures existentes)
  - `apps/api/test/user-service.match-metrics.test.ts` (criar, se não existir teste unitário isolado para
    `computeCategoryMatchMetrics`; verificar com `Glob` antes de criar arquivo novo)
  - `apps/web/__tests__/event-metrics-badge.test.tsx` (criar, ou arquivo de teste de componente equivalente
    já usado no projeto para a página de evento — confirmar convenção existente antes de nomear)
- Fixtures: harness Prisma fake já existente em `createServiceHarness()` (linhas 5-158 do arquivo de cache
  test) — estender com segundo cenário de categoria onde `published > calculated`.

### T-U-01 — max() preserva o maior valor quando teórico supera o publicado
Camada: função pura (`computeCategoryMatchMetrics`)
DADO: `calculatedMatchesCount = 6`, `publishedMatchesCount = 5`, `walkoverMatchesCount = 1`
QUANDO: `computeCategoryMatchMetrics` é chamado
ENTÃO: retorno tem `calculatedMatchesCount === 6` (sem alteração — Cenário 2, sem regressão)

### T-U-02 — max() calibra para o publicado quando este supera o teórico
Camada: função pura (`computeCategoryMatchMetrics`)
DADO: `calculatedMatchesCount = 6`, `publishedMatchesCount = 9`, `walkoverMatchesCount = 2`
QUANDO: `computeCategoryMatchMetrics` é chamado
ENTÃO: retorno tem `calculatedMatchesCount === 9` (Cenário 1) e `playedMatchesCount === 7` (9 - 2, baseado no
publicado real, não no teórico ajustado)

### T-U-03 — categoria sem partidas publicadas mantém fallback teórico puro
Camada: função pura (`computeCategoryMatchMetrics`)
DADO: `calculatedMatchesCount = 6`, `publishedMatchesCount = 0`, `walkoverMatchesCount = 0`
QUANDO: `computeCategoryMatchMetrics` é chamado
ENTÃO: retorno tem `calculatedMatchesCount === 6` (Cenário 3)

### T-I-01 — getEventSummary retorna fonte "estimada" quando nenhuma categoria foi calibrada
Camada: integração (`getEventSummary` via harness Prisma fake)
DADO: harness padrão de `user-service.event-summary-cache.test.ts` (categoria única, `published=5`,
`calculated=6`)
QUANDO: `getEventSummary(1)` é chamado
ENTÃO: payload retorna `totalPartidasPrevistas === 6` (sem regressão) e
`totalPartidasPrevistasFonte === "estimada"` (Cenário 5)

### T-I-02 — getEventSummary retorna fonte "observada" quando ao menos uma categoria foi calibrada
Camada: integração (`getEventSummary` via harness Prisma fake estendido)
DADO: harness com categoria onde `published=9 > calculated=6`
QUANDO: `getEventSummary(1)` é chamado
ENTÃO: payload retorna `totalPartidasPrevistas === 9` e `totalPartidasPrevistasFonte === "observada"`
(Cenário 4)

### T-I-03 — evento agregado com fontes mistas entre canonical e filho
Camada: integração (`getEventSummary` com escopo multi-evento, seguindo o padrão de
`resolveEventScope`/`allEventIds` já usado nos testes de escopo agregado deste arquivo)
DADO: escopo com 2 eventos — evento A com todas categorias estimadas, evento B com 1 categoria calibrada
(`published > calculated`)
QUANDO: `getEventSummary` do evento canonical é chamado
ENTÃO: `totalPartidasPrevistasFonte === "observada"` no payload agregado (Cenário 6)

### T-I-04 — cache key versionada não reaproveita payload antigo sem o campo novo
Camada: integração (harness Prisma fake)
DADO: um registro de cache pré-existente sob a chave antiga `event-summary-v12|event:1`
QUANDO: `getEventSummary(1)` é chamado após a mudança de versão da chave
ENTÃO: o cache antigo não é reaproveitado (nova chave `event-summary-v13|event:1` é usada), e o payload
retornado contém `totalPartidasPrevistasFonte` definido

### T-U-04 — componente exibe indicador quando fonte é observada
Camada: componente (página do evento / badge de métricas)
DADO: `event.totalPartidasPrevistasFonte === "observada"`
QUANDO: a seção de métricas do evento é renderizada
ENTÃO: o indicador/tooltip de calibração aparece junto à badge "Partidas Previstas" (Cenário 7)

### T-U-05 — componente não exibe indicador quando fonte é estimada ou ausente
Camada: componente (página do evento / badge de métricas)
DADO: `event.totalPartidasPrevistasFonte === "estimada"` e, em variação do mesmo teste, campo ausente
(`undefined`, simulando payload de cache antigo nunca recalculado)
QUANDO: a seção de métricas do evento é renderizada
ENTÃO: nenhum indicador de calibração aparece, badge idêntica ao comportamento atual (Cenário 8)

### Cobertura de falhas silenciosas
- A UI não deve "inventar" o indicador quando o campo está ausente — T-U-05 cobre exatamente esse caso de
  payload antigo/incompleto, evitando falso positivo visual.
- A agregação não deve silenciosamente ignorar uma categoria calibrada dentro de um evento filho ao compor o
  agregado do canonical — T-I-03 cobre esse caso.

### Categorias não aplicáveis
- Formulário/Cadastro, Edição/Atualização, Exclusão, Upload/Arquivo: não aplicável — esta entrega não introduz
  nenhuma operação de escrita/cadastro de usuário.
- Autenticação/Autorização: não aplicável — rota pública já existente, sem mudança de controle de acesso.
- Integração externa: não aplicável — nenhum novo consumo de serviço externo.

### Comando para rodar a suite
```
npm --prefix apps/api test
npm --prefix apps/web test
```
