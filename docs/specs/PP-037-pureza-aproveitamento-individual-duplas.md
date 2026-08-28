# PP-037 — Separação total de medalhas/aproveitamento entre individual e duplas

## Status: Spec formal — CAT PP-036 concluído, decisões já fechadas com Leo (Tipo B)

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é lógica de cálculo interna sobre dado já público, sem superfície
  nova de auth/input/exposição.
- e2e-playwright-agent: sim — mudança afeta números exibidos publicamente (ranking de eficiência, página
  de carreira do atleta); verificar visualmente que a separação não quebra a UI existente.
- report-builder-agent: não.

## Objetivo

Garantir que medalhas/pontuação de categorias individuais nunca somem com medalhas/pontuação de
categorias de duplas (mistas ou não) na mesma métrica agregada — em nenhum dos pontos de cálculo de
aproveitamento/eficiência do sistema. Hoje a mistura é real em 2 pontos confirmados; um terceiro ponto já
está correto e serve de padrão de referência.

## Contexto

CAT PP-036, Frentes 1-2, confirmado por leitura direta de código:

**Pontos com mistura confirmada (bug):**
1. `computeEfficiencyRanking()` (`apps/api/src/user/user.service.ts:2980-3334`, ranking de eficiência por
   clube) — `isEfficiencyEligibleCategoryName()` (linha 527-531) sempre retorna `true`; `row[medalha] +=
   1` (linha 3325) soma medalhas de todas as categorias (individual + duplas + duplas mistas) no mesmo
   total por clube.
2. `buildCareerMedalTable()` (`apps/api/src/user/career-medals.ts:41-63`), consumida por
   `getAthleteCareer()` (`user.service.ts:4877`, chamada na linha 5177) — a rota `/career/{slug}`
   ("scouts", rota 1 confirmada por Leo). Agrega medalhas por `event.nivel`, iterando
   `performanceByCategory` sem checar se a categoria é individual ou duplas.

**Ponto já correto (padrão de referência, não bug):**
- `getAthleteSummary()` (`user.service.ts:4388`, rota `/events/:id/athletes/:athleteId/summary`, "scouts"
  rota 2) — `analyticalMatches` (linha 4557-4558) filtra `!match.isProjectedParticipant` antes de calcular
  `performance`/`performanceByCategory`. Partidas de duplas aparecem na lista visual mas não contaminam o
  cálculo. Teste real:
  `apps/api/test/user-service.athlete-summary-cache.test.ts:420-429`.

**Achado arquitetural relacionado (CAT PP-026, A1):** os helpers de detecção de duplas
(`isCompositePairName`, `isDoublesCategoryName`, `isDoublesEventName`,
`packages/shared/src/index.ts`/`user.service.ts`) já existem, mas são combinados de formas diferentes e
inconsistentes em cada ponto do código (`buildMedalistUnitKey` usa os 3; `buildCompetitiveEntryKey` usa
só 2; `computeEfficiencyRanking` não usa nenhum). Esta Spec centraliza a combinação numa função nomeada
única, reduzindo esse padrão de dívida.

## Causa raiz

- **Causa imediata:** `isEfficiencyEligibleCategoryName()` sempre `true`; `buildCareerMedalTable()` nunca
  recebeu filtro de modalidade desde sua criação.
- **Causa sistêmica:** ausência de uma função central "isto é uma entrada de duplas?" — cada consumidor
  decide por conta própria quais dos 3 detectores combinar, e alguns simplesmente não combinam nenhum.
- **Padrão:** já registrado como candidato em `EPISODIC_MEMORY.md`/CAT PP-026 (A1) — esta Spec é a
  correção concreta que fecha esse padrão nos pontos de medalha/eficiência.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — ranking de eficiência por clube separa individual de duplas**
DADO um clube com atletas que ganharam medalhas tanto em categorias individuais quanto em duplas no mesmo
evento
QUANDO `computeEfficiencyRanking()` é chamado
ENTÃO o total de medalhas/pontuação do clube reflete **apenas categorias individuais** por padrão — sem
somar medalhas de duplas ao mesmo total (Cenário exato de "separação total", conforme decidido).

**Cenário 2 — carreira do atleta separa individual de duplas**
DADO um atleta com medalhas em categorias individuais e em duplas ao longo da carreira
QUANDO `getAthleteCareer()`/`buildCareerMedalTable()` é chamado
ENTÃO a tabela de medalhas por nível (ESTADUAL/COPA/NACIONAL/OPEN) reflete **apenas categorias
individuais** — duplas não somam no mesmo total.

**Cenário 3 — dado de duplas não é descartado, é reclassificado**
DADO o mesmo atleta/clube do Cenário 1/2
QUANDO a separação é aplicada
ENTÃO os dados de duplas continuam calculados e disponíveis (não deletados/ignorados) — apenas em um
total/estrutura separada da métrica individual, para uso futuro (ex.: exibição separada na UI, se Leo
priorizar isso depois).

**Cenário 4 — `getAthleteSummary()` não regride (já correto)**
DADO o comportamento já existente e testado de `getAthleteSummary()`
QUANDO esta Spec é implementada
ENTÃO esse endpoint permanece exatamente como está — não é tocado, salvo se Codex identificar
oportunidade de reaproveitar a nova função centralizada sem alterar comportamento observável.

## Critérios de aceitação

- Nova função centralizada (nome sugerido: `isDoublesCategoryOrMatch` ou equivalente — Codex decide o
  nome final coerente com a convenção já usada no arquivo) combinando
  `isCompositePairName`/`isDoublesCategoryName`/`isDoublesEventName` — mesma combinação já usada em
  `buildMedalistUnitKey` (linha 673-677), que é a mais completa das combinações existentes hoje.
- `computeEfficiencyRanking()`: `isEfficiencyEligibleCategoryName()` passa a filtrar categorias de duplas
  fora do cálculo de eficiência por clube (usando a nova função centralizada) — resultado default é só
  individual.
- `buildCareerMedalTable()`: `getAthleteCareer()` filtra `performanceByCategory` por categoria individual
  antes de passar para `buildCareerMedalTable()` (ou `buildCareerMedalTable()` recebe um filtro
  equivalente — Codex decide o ponto exato de menor impacto).
- `getAthleteSummary()` não regride (Cenário 4).
- Nenhum dado de duplas é perdido — apenas separado do total individual (Cenário 3), estrutura de dado
  suficiente para exibição futura se priorizada.

## Fora de escopo

- Não expor uma UI de "visão combinada"/toggle individual-duplas nesta Spec — só a separação de cálculo
  no backend. Se Leo quiser essa UI depois, é Spec separada.
- Não migrar a detecção de duplas para campo estruturado no schema — decisão já fechada de reaproveitar
  os helpers existentes, sem DDL.
- Não alterar `getAthleteSummary()` além de eventual reaproveitamento da nova função centralizada, sem
  mudar comportamento observável.
- Não resolver o restante da dívida arquitetural de A1/A2 (tamanho de `user.service.ts`,
  `upsert.service.ts`) — só o ponto concreto de duplicação de detecção relacionado a esta correção.

## Impacto técnico

- Arquivos a criar/modificar:
  - `apps/api/src/user/user.service.ts` — nova função centralizada de detecção; ajuste em
    `isEfficiencyEligibleCategoryName()` (linha 527-531); ajuste no fluxo de `getAthleteCareer()` (linha
    ~5177) antes de chamar `buildCareerMedalTable`.
  - `apps/api/src/user/career-medals.ts` — possível ajuste em `buildCareerMedalTable()` para aceitar
    filtro de modalidade, ou o filtro é aplicado antes (Codex decide o ponto certo, documenta a escolha).
- Arquivos que NÃO devem ser tocados: `getAthleteSummary()` (linha 4388) além do reaproveitamento
  opcional já mencionado; `packages/shared/src/index.ts` (helpers de detecção já existentes, reaproveitar
  sem alterar assinatura).
- DDL: nenhuma.
- Contrato de API alterado: sim — payload de `computeEfficiencyRanking`/`getAthleteCareer` muda de
  conteúdo numérico (totais menores, já que duplas saem do total combinado) — não muda formato/schema de
  resposta, só o valor. Frontend consumidor não deveria quebrar estruturalmente, mas os números exibidos
  mudam — Codex confirma visualmente (e2e) antes de declarar pronto.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (API)
- arquivos de teste a criar/estender: teste de `computeEfficiencyRanking` (Codex localiza arquivo
  existente — provavelmente relacionado a `user-service.event-efficiency-ranking.test.ts`, já visto
  nesta sessão), teste de `getAthleteCareer`/`career-medals.ts`.

### T-U-01 — Ranking de eficiência exclui medalhas de duplas do total do clube
DADO: um clube com 1 medalha de ouro em categoria individual e 1 medalha de ouro em categoria de duplas
no mesmo evento
QUANDO: `computeEfficiencyRanking()` é chamado
ENTÃO: o total de ouro do clube é `1` (só a individual), não `2`.

### T-U-02 — Carreira do atleta exclui medalhas de duplas do total por nível
DADO: um atleta com 1 medalha de prata individual e 1 medalha de prata em duplas no mesmo evento ESTADUAL
QUANDO: `getAthleteCareer()` é chamado
ENTÃO: `medalTable.ESTADUAL.prata` é `1`, não `2`.

### T-U-03 — Categoria de duplas mistas também é excluída (não só "duplas" simples)
DADO: um atleta/clube com medalha em categoria de duplas mistas
QUANDO: os cálculos dos Cenários 1/2 são executados
ENTÃO: a medalha de duplas mistas também não soma no total individual — mesma regra vale para
mistas/não-mistas.

### T-U-04 — Categoria individual pura continua contando normalmente (não regressão)
DADO: um clube/atleta só com medalhas de categorias individuais
QUANDO: os cálculos são executados
ENTÃO: totais idênticos ao comportamento anterior a esta Spec — sem regressão no caso majoritário.

### T-I-01 — getAthleteSummary() não regride
DADO: o mesmo cenário já coberto por
`apps/api/test/user-service.athlete-summary-cache.test.ts:420-429`
QUANDO: a suite completa roda após esta Spec
ENTÃO: o teste existente continua passando sem alteração de resultado esperado.

### Cobertura de falhas silenciosas
- Regra de negócio: T-U-01/T-U-02 cobrem explicitamente a violação (mistura) que esta Spec corrige, não
  só o caso já correto.

### Comando para rodar a suite
`npm run test --workspace apps-api`.
