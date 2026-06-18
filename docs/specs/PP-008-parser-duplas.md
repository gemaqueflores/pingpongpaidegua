# PP-008 — Correção do parser para jogos de duplas

**Status:** aguardando aprovação Leo

---

## Objetivo

Corrigir o parser para que jogos de categorias de duplas extraiam corretamente os dois lados da partida como pares compostos (`"ATLETA A # ATLETA B"` vs `"ATLETA C # ATLETA D"`), em vez de tratar os quatro atletas individuais como jogadores independentes.

Contexto: nos eventos filho 5688 (duplas simples) e 5691 (duplas mistas), agregados ao evento 51, os jogos aparecem com confronto incorreto — dois parceiros da mesma dupla são exibidos como adversários — ou não aparecem. A causa raiz está no parser, que extrai nomes individuais em vez de agrupar por lado.

---

## Causa raiz

### Causa imediata

Em `packages/parser/src/index.ts`, dois caminhos de extração tratam jogos de duplas como individuais:

**Caminho 1 — `parseSetScoresFromCardHtml` (linha ~863):**
Para uma tabela de resultados com 4 linhas (um atleta por linha por lado), a função pega `players[0]` como `athleteAName` e `players[1]` como `athleteBName`. Para duplas, `players[0]` e `players[1]` são os dois membros do lado A — não adversários.

**Caminho 2 — fallback `filteredNames` em `parseCardBasedMatches` (linha ~1033):**
Quando `cardScoreData` é `null` (card sem tabela de placar), o fallback usa `filteredNames[0]` como lado A e `filteredNames[1]` como lado B. Para duplas, `filteredNames` tem 4 nomes e os dois primeiros são do mesmo lado.

**Caminho 3 — `parseGroupMatches` (linha ~1156):**
Para grupos de duplas, `uniquePlayers` lista os atletas individuais (ex: 6 nomes para 3 duplas) e gera `pairs` por combinação cartesiana — produzindo 15 pares em vez de 3 confrontos entre duplas.

### Causa sistêmica

O parser foi projetado para individuais e não distingue categorias de duplas. A função `isDoublesLikeLabel` já existe em `@cbtm/shared` mas não é usada no parser.

---

## Fora de escopo

- Rollback ou alteração do `user.service.ts` (o código adicionado em PP-007 é inofensivo, não causa regressão — será tratado em housekeeping separado)
- Mudança no frontend
- Mudança no worker/upsert
- Outras categorias além de duplas

---

## Cenários funcionais

**DADO** um card de resultado de categoria `"SUB-15 FEM"` de evento de duplas (nome do evento ou da categoria contém `"DUPLA"`)  
**QUANDO** o parser extrai os participantes da tabela HTML com 4 linhas (dois atletas por lado)  
**ENTÃO** `athleteAName` é `"ATLETA1 # ATLETA2"` (membros do lado A compostos) e `athleteBName` é `"ATLETA3 # ATLETA4"` (membros do lado B compostos)

**DADO** um card de resultado de duplas sem tabela de placar (card textual com 4 nomes filtrados)  
**QUANDO** o parser extrai via fallback `filteredNames`  
**ENTÃO** `filteredNames[0]+"#"+filteredNames[1]` é lado A e `filteredNames[2]+"#"+filteredNames[3]` é lado B

**DADO** uma matriz de grupos de categoria de duplas com 3 duplas (6 nomes individuais)  
**QUANDO** `parseGroupMatches` processa o card  
**ENTÃO** são gerados exatamente 3 pares de confrontos (dupla vs dupla), não 15

**DADO** um card de resultado de categoria individual (sem "DUPLA" no nome)  
**QUANDO** o parser extrai  
**ENTÃO** comportamento atual é preservado sem alteração

---

## Critérios de aceitação

- `parseSetScoresFromCardHtml` agrupa membros por lado quando `isDoubles = true` e `players.length === 4`
- O fallback `filteredNames` agrupa quando `isDoubles = true` e `filteredNames.length >= 4`
- `parseGroupMatches` agrupa pares de nomes em entidades de dupla quando `isDoubles = true`
- Para categorias individuais: comportamento idêntico ao atual (nenhuma regressão)
- Os nomes compostos resultantes passam por `normalizeDoublesPairName` (ordenação alfabética dos membros)
- Scores/sets não mudam — apenas a atribuição de nomes

---

## Impacto técnico

### Arquivos a modificar

- `packages/parser/src/index.ts`
  - `parseSetScoresFromCardHtml`: receber parâmetro `isDoubles: boolean`; quando `true` e `players.length >= 4`, compor `athleteAName = players[0].name + " - " + players[1].name` (deixar para `normalizeDoublesPairName` ordenar), `athleteBName = players[2].name + " - " + players[3].name`; sets/scores usam `players[0]` e `players[2]` (primeiros de cada lado)
  - `parseCardBasedMatches`: passar `isDoubles` para `parseSetScoresFromCardHtml`; no fallback de `filteredNames`, quando `isDoubles && filteredNames.length >= 4`, usar `filteredNames[0] + " - " + filteredNames[1]` como `athleteANameRaw` e `filteredNames[2] + " - " + filteredNames[3]` como `athleteBNameRaw`
  - `parseGroupMatches`: quando `isDoubles`, agrupar `uniquePlayers` em pares consecutivos `[[0,1],[2,3],...]` formando as entidades de dupla antes de gerar os pares de confrontos
  - Importar `isDoublesLikeLabel` de `@cbtm/shared`

### Arquivos a criar

- `packages/parser/test/doubles-parser.test.ts` — testes unitários com HTML sintético (padrão de `result-master-30mas.test.ts`)

### Arquivos que NÃO devem ser tocados

- `packages/shared/src/index.ts` — `normalizeDoublesPairName` e `isDoublesLikeLabel` já corretos
- `apps/api/src/user/user.service.ts`
- `apps/web/`
- `apps/worker/`

### DDL / migração

Nenhuma. Os dados já no banco estão com nomes individuais — serão corrigidos no próximo scrape automático após o deploy.

---

## Plano de testes

### Cobertura geral

- Camadas obrigatórias: unitário (parser com HTML sintético)
- Arquivos de teste a criar: `packages/parser/test/doubles-parser.test.ts`
- Fixtures: HTML sintético inline (sem arquivo externo)
- Framework: vitest (padrão do projeto)

### T-U-01 — parseSetScoresFromCardHtml: tabela de duplas com 4 linhas

Camada: função interna (via `parseResultsText` com payload sintético)  
DADO: card HTML de categoria `"DUPLA MISTA - SUB-15 - Final"` com tabela:
```html
<table>
  <tr><td>KAYLANNE DEUS</td><td>2</td><td>11</td><td>11</td></tr>
  <tr><td>MARIANNY MORAES</td><td></td><td></td><td></td></tr>
  <tr><td>DEBORA FLORES</td><td>0</td><td>5</td><td>7</td></tr>
  <tr><td>REBECA FLORES</td><td></td><td></td><td></td></tr>
</table>
```
QUANDO: `parseResultsText(5691, payload)` é chamado  
ENTÃO:
- `match.athleteAName` contém `"KAYLANNE DEUS"` e `"MARIANNY MORAES"` separados por `" # "`
- `match.athleteBName` contém `"DEBORA FLORES"` e `"REBECA FLORES"` separados por `" # "`
- `match.setsResult` = `{ p1Sets: 2, p2Sets: 0 }`
- `match.sets` tem os sets corretos do lado A (não do lado B)

### T-U-02 — fallback filteredNames: card de duplas sem tabela

Camada: função `parseCardBasedMatches` via `parseResultsText`  
DADO: card textual de categoria de duplas sem tabela HTML de placar, com 4 linhas de nomes:
```
DUPLA MISTA - SUB-15 - Semifinal
Jogo 001 - Mesa 1 - 14:00
13/06/2026
CLAYTON FILHO
ESTER YOSHIDA
ANA PEREIRA
MISAEL TAVARES
```
QUANDO: `parseResultsText` processa  
ENTÃO:
- `match.athleteAName` é `"CLAYTON FILHO # ESTER YOSHIDA"` (ou ordem normalizada)
- `match.athleteBName` é `"ANA PEREIRA # MISAEL TAVARES"` (ou ordem normalizada)

### T-U-03 — categoria individual não afetada

Camada: função `parseCardBasedMatches`  
DADO: card de categoria `"ABSOLUTO MAS"` com tabela de 2 linhas  
QUANDO: `parseResultsText` processa  
ENTÃO: `athleteAName` e `athleteBName` são nomes individuais sem `#` (comportamento atual preservado)

### T-U-04 — parseGroupMatches: grupos de duplas

Camada: função `parseGroupMatches`  
DADO: card de grupo de categoria `"SUB-15 FEM"` em evento de duplas com 6 nomes individuais e 3 tokens de score `"2 x 0"`, `"2 x 1"`, `"0 x 2"`  
QUANDO: `parseGroupMatches` processa  
ENTÃO:
- São gerados exatamente 3 matches (3 confrontos entre duplas), não 15
- Cada `athleteAName` e `athleteBName` é nome composto com `#`

### T-U-05 — parseGroupMatches: grupos individuais não afetados

Camada: função `parseGroupMatches`  
DADO: card de grupo de categoria `"ABSOLUTO MAS"` com 4 nomes individuais e 6 tokens de score  
QUANDO: `parseGroupMatches` processa  
ENTÃO: são gerados exatamente 6 matches e nenhum nome contém `#`

### Cobertura de falhas silenciosas

- Tabela com 2 linhas em categoria de duplas (1 dupla desistiu): não crashar, produzir 1 player por lado
- Card de duplas com `filteredNames.length === 2` (apenas 2 nomes visíveis): usar comportamento atual (um por lado)
- `isDoublesLikeLabel(categoryName)` false em categoria com nome ambíguo: não agrupar

### Comando para rodar a suite

```bash
npm run test --workspace @cbtm/parser
```

---

## Self-review da Spec

- [x] Read dos arquivos relevantes executado antes de formular
- [x] Causa raiz com causa imediata e sistêmica separadas
- [x] Cada mudança tem localização exata (função + linha aproximada)
- [x] Arquivos que NÃO devem ser tocados declarados
- [x] Cobertura de testes: T-U-01 a T-U-05 + falhas silenciosas
- [x] Fora de escopo explícito
- [x] Rollback do `user.service.ts` explicitamente fora de escopo (sem regressão)
- [x] Aviso de colisão de nomes de categoria: isolado por `category.id` no backend — não é risco

---

## Orientação para o Codex (após aprovação Leo)

```
## Orientação para o Codex — PP-008

### Spec aprovada
caminho: docs/specs/PP-008-parser-duplas.md
aprovação Leo: <inserir referência>

### Plano de testes (resumo)
- IDs: T-U-01, T-U-02, T-U-03, T-U-04, T-U-05
- arquivo de teste a criar: packages/parser/test/doubles-parser.test.ts
- comando: npm run test --workspace @cbtm/parser

### Contexto
branch base: main
branch a criar: fix/pp-008-parser-duplas
commit topo base: f82d7ee

### Pré-condições
- git config user.email = gemaqueflores@gmail.com
- branch base: main (não fix/confrontos-duplas-filtros)
- Sem DDL

### Arquivos a criar/modificar
PRODUÇÃO:
- packages/parser/src/index.ts
  - Importar isDoublesLikeLabel de @cbtm/shared
  - parseSetScoresFromCardHtml: adicionar parâmetro isDoubles: boolean
    - quando isDoubles && players.length >= 4:
      - athleteAName = normalizeDoublesPairName(players[0].name + " - " + players[1].name)
      - athleteBName = normalizeDoublesPairName(players[2].name + " - " + players[3].name)
      - p1Sets = players[0].scores[0]; p1PerSet = players[0].scores.slice(1)
      - p2Sets = players[2].scores[0]; p2PerSet = players[2].scores.slice(1)
    - quando !isDoubles ou players.length < 4: comportamento atual sem mudança
  - parseCardBasedMatches: derivar isDoubles = isDoublesLikeLabel(categoryName)
    - passar isDoubles para parseSetScoresFromCardHtml
    - no fallback filteredNames: quando isDoubles && filteredNames.length >= 4:
      - athleteANameRaw = filteredNames[0] + " - " + filteredNames[1]
      - athleteBNameRaw = filteredNames[2] + " - " + filteredNames[3]
    - quando isDoubles && filteredNames.length < 4 ou !isDoubles: comportamento atual
  - parseGroupMatches: derivar isDoubles = isDoublesLikeLabel(categoryName)
    - quando isDoubles: antes de gerar pairs, agrupar uniquePlayers em duplas:
      - doublesEntities = [[uniquePlayers[0], uniquePlayers[1]], [uniquePlayers[2], uniquePlayers[3]], ...]
      - usar doublesEntities para gerar pairs e normalizar cada nome com normalizeDoublesPairName
    - quando !isDoubles: comportamento atual sem mudança

TESTES:
- packages/parser/test/doubles-parser.test.ts
  - usar buildSyntheticResultadosPayload do padrão de result-master-30mas.test.ts
  - cobrir T-U-01 a T-U-05

### Arquivos que NÃO devem ser tocados
- packages/shared/src/index.ts
- apps/api/src/user/user.service.ts
- apps/web/
- apps/worker/

### Ordem de implementação (Red-Green por T-*)
T-U-01: red → green
T-U-02: red → green
T-U-03: red → green (regressão)
T-U-04: red → green
T-U-05: red → green (regressão)
Ao final: npm run test --workspace @cbtm/parser (suite completa)

### Validação antes de reportar
- Todos T-U-01 a T-U-05 verdes
- npm run test --workspace @cbtm/parser verde completo
- npm run build --workspace @cbtm/parser verde
- npm run build --workspace apps-api verde (parser é dependência)
- npm run verify:encoding
```

---

## Correções obrigatórias — Parecer 2026-06-13

### ❌ Q12 — Red-Green-Refactor não existe no Git

**Estado atual:** worktree `fix/pp-008-parser-duplas` com `HEAD = f82d7ee` (base main). As modificações em `packages/parser/src/index.ts` estão unstaged e `packages/parser/test/doubles-parser.test.ts` está untracked. Nenhum commit foi criado.

**Correção obrigatória:**
1. Criar commits com ciclo Red-Green por T-*, nesta ordem para T-U-01 a T-U-05:
   - `test(parser): T-U-0N red — <desc>` — apenas o teste; produção intacta; suite deve falhar com erro coerente (não SyntaxError)
   - `fix(parser): T-U-0N green — <desc>` — código mínimo que faz o T-U-0N passar
2. Confirmar que o pre-commit hook estava ativo em cada commit (sem `--no-verify`)
3. Ao final: `npm run test --workspace @cbtm/parser` verde completo + log no relatório de entrega
4. Abrir PR

**Estratégia para recriar o ciclo:** como o código de produção já está implementado localmente, usar `git stash` para guardar o estado atual, criar commits Red por T-* (apenas testes), depois desempacotar stash progressivamente por T-* para os commits Green.

### ❌ Q10 — Pre-commit hook não verificável

Consequência direta do Q12: sem commits, o hook nunca foi exercido. Será resolvido automaticamente ao criar os commits acima.
