## SPEC ATIVA — PP-061 — v1
ID: PP-061 | Projeto: PingPong PaiD'egua | Branch: fix/pp-061-ordenacao-jogos-futuros-atleta
Criada por: Claude | Data: 2026-09-19 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é puramente de ordenação client-side, sem tocar auth, query SQL/ORM, input renderizado, upload, integração externa ou segredos
- e2e-playwright-agent: não — sem infraestrutura Playwright configurada no projeto até o momento; cobertura via teste unitário do comparador é suficiente para a lógica pura
- report-builder-agent: não — entrega pequena, relatório padrão de PR é suficiente

## Objetivo
Na página de resumo do atleta (`/events/[id]/athletes/[athleteId]`), a lista de jogos com o filtro "Mais
recentes" selecionado deve mostrar, entre os jogos futuros (sem resultado), o jogo mais próximo de
acontecer primeiro — não o mais distante no futuro. Hoje "Mais recentes" ordena por `matchDatetime`
decrescente de forma absoluta, o que é correto para jogos passados (mais recente = aconteceu há pouco)
mas invertido para jogos futuros (usuário espera ver o próximo jogo no topo).

## Contexto
Evidência relatada por Leo em 2026-09-19: evento 59 (Torneio Aberto ainda não iniciado, todos os jogos
"Sem resultado", datas em 19-20/09/2026). Com "Mais recentes" ativo, agora é 19/09/2026 00:11
(America/Belem), a lista mostrou jogos de 20:30, depois 20:00, depois 19:00, depois 18:30 do mesmo dia —
do mais tardio para o mais cedo, e não do mais próximo do momento atual.

Causa raiz confirmada por leitura de
`apps/web/app/user/events/[id]/athletes/[athleteId]/page.tsx:369-392`
(comparador dentro de `useMemo` que monta `groups`):
- Causa imediata: quando `sortMode === "recent"`, o comparador usa `rightTimestamp - leftTimestamp`
  (decrescente) para qualquer par de jogos com timestamp, sem considerar se o jogo já ocorreu ou está no
  futuro em relação a `now`.
- Causa sistêmica: o conceito "recente/antigo" foi modelado como dimensão única sobre o eixo do tempo
  absoluto, sem diferenciar jogos passados de futuros. Não há registro de padrão equivalente em
  `EPISODIC_MEMORY.md`/`DOMAIN_MATURITY.md` — não é candidato a classe E nesta sessão (ocorrência única
  conhecida).

Esse comparador só existe neste arquivo — confirmado via `Grep "sortMode|SortMode"` no diretório `apps/web`,
sem outra ocorrência.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — jogos futuros, filtro "Mais recentes"
DADO um atleta com múltiplos jogos futuros (`matchDatetime` > agora) sem resultado
QUANDO o usuário seleciona "Mais recentes"
ENTÃO os jogos aparecem em ordem crescente de `matchDatetime` — o mais próximo do momento atual primeiro

### Cenário 2 — jogos futuros, filtro "Mais antigos"
DADO os mesmos jogos futuros do Cenário 1
QUANDO o usuário seleciona "Mais antigos"
ENTÃO os jogos aparecem em ordem decrescente de `matchDatetime` — o mais distante no futuro primeiro

### Cenário 3 — jogos passados, filtro "Mais recentes" (comportamento preservado)
DADO um atleta com múltiplos jogos já disputados (`matchDatetime` <= agora), com ou sem resultado
QUANDO o usuário seleciona "Mais recentes"
ENTÃO os jogos aparecem em ordem decrescente de `matchDatetime` — o mais recente (que aconteceu há menos
tempo) primeiro (comportamento já correto hoje, não deve regredir)

### Cenário 4 — jogos passados, filtro "Mais antigos" (comportamento preservado)
DADO os mesmos jogos passados do Cenário 3
QUANDO o usuário seleciona "Mais antigos"
ENTÃO os jogos aparecem em ordem crescente de `matchDatetime` — o mais antigo primeiro

### Cenário 5 — mistura de jogos passados e futuros
DADO um atleta com jogos já disputados e jogos futuros na mesma lista
QUANDO o usuário seleciona "Mais recentes"
ENTÃO os jogos futuros aparecem antes dos jogos passados (o "mais recente" no sentido de "mais relevante
agora" é o próximo jogo a acontecer), com jogos futuros em ordem crescente entre si e jogos passados em
ordem decrescente entre si
QUANDO o usuário seleciona "Mais antigos"
ENTÃO os jogos passados aparecem antes dos futuros (inverso do anterior), com jogos passados em ordem
crescente entre si e jogos futuros em ordem decrescente entre si

### Cenário 6 — jogos sem `matchDatetime` (fallback já existente)
DADO um atleta com jogos sem `matchDatetime` preenchido
QUANDO qualquer filtro é selecionado
ENTÃO o comportamento de fallback por `resolveGameOrderId`/`id` já existente em
`page.tsx:381-391` permanece inalterado — este cenário não é tocado pela Spec

## Critérios de aceitação
- Comparador em `groups` (`page.tsx:369-392`) usa `Date.now()` (ou equivalente injetável para teste) para
  classificar cada jogo com timestamp válido como futuro (`timestamp >= now`) ou passado
  (`timestamp < now`)
- Em "Mais recentes": jogos futuros vêm antes dos passados; dentro dos futuros, ordem crescente
  (mais próximo primeiro); dentro dos passados, ordem decrescente (mais recente primeiro)
- Em "Mais antigos": jogos passados vêm antes dos futuros; dentro dos passados, ordem crescente
  (mais antigo primeiro); dentro dos futuros, ordem decrescente (mais distante primeiro)
- Jogos com o mesmo `matchDatetime` mantêm desempate estável já existente (fallback por `gameId`/`id`)
- Nenhuma regressão no agrupamento por categoria (`separateByCategory`) nem no fallback de jogos sem
  `matchDatetime`

## Fora de escopo
- Não altera a ordenação/exibição em nenhuma outra tela do projeto (confirmado que este comparador é
  exclusivo desta página)
- Não altera o critério `hasMatchResult` usado no comparador nem sua posição relativa na cadeia de
  comparação — a mudança é a introdução do critério futuro/passado antes ou em conjunto com o critério de
  timestamp, sem remover a lógica de resultado
- Não altera o fallback por `resolveGameOrderId`/`id` para jogos sem `matchDatetime`
- Não altera o backend/API (`apiGetAthleteSummary`) nem o formato de `matchDatetime`
- Não introduz seletor de fuso horário — usa o mesmo instante de comparação (`Date.now()`) já usado
  implicitamente hoje pelo browser do usuário

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/app/user/events/[id]/athletes/[athleteId]/page.tsx` — função `resolveMatchTimestamp` (linha
    162-168, sem alteração) e o comparador dentro de `useMemo` (linha 369-392): introduzir classificação
    futuro/passado como critério de ordenação primário quando ambos os jogos comparados têm timestamp
    válido, antes de aplicar a direção `recent`/`oldest` dentro de cada grupo (futuro/passado)
  - Novo arquivo de teste unitário para o comparador (extrair a função de comparação para ser testável
    isoladamente, se ainda não for uma função pura extraível — Codex decide o formato mínimo de extração
    necessário para tornar o comparador testável sem alterar comportamento)
- Arquivos que NÃO devem ser tocados:
  - `apps/api/**` — mudança é 100% frontend, não há alteração de contrato de API
  - `resolveGameOrderId`, `hasMatchResult`, `formatDatetime` — funções auxiliares não relacionadas à
    classificação futuro/passado
  - Lógica de agrupamento por categoria (`separateByCategory`, linhas 398-418)
- DDL / migração: não aplicável
- Contrato de API alterado: não aplicável
- Dependências novas: nenhuma

## Plano de testes

### Cobertura geral
COBERTURA: regressão=2 corretude=4
- camadas obrigatórias: unitário (comparador de ordenação)
- arquivos de teste a criar: `apps/web/app/user/events/[id]/athletes/[athleteId]/__tests__/sort-matches.test.ts`
  (ou local equivalente ao padrão de testes já usado no projeto para `apps/web` — Codex confirma
  convenção existente antes de criar)
- fixtures/mocks: lista de `SummaryMatch` sintéticos com `matchDatetime` fixo relativo a um `now` mockado
  (usar `vi.useFakeTimers()`/`jest.useFakeTimers()` conforme runner do projeto, fixando `now` em um ISO
  string conhecido, ex.: `2026-09-19T00:11:00-03:00`)

### T-U-01 — jogos futuros ordenados crescente em "Mais recentes"
Camada: função pura de comparação/ordenação
DADO: 3 jogos futuros com `matchDatetime` em 18:30, 20:00, 20:30 (mesmo dia, após `now` mockado)
QUANDO: aplicado o comparador com `sortMode = "recent"`
ENTÃO: ordem resultante é 18:30, 20:00, 20:30 (mais próximo do `now` primeiro)
[corretude] — valor esperado (18:30 primeiro) calculado manualmente a partir das datas fixture, não
reaproveitando a lógica do comparador sob teste

### T-U-02 — jogos futuros ordenados decrescente em "Mais antigos"
Camada: função pura de comparação/ordenação
DADO: os mesmos 3 jogos futuros de T-U-01
QUANDO: aplicado o comparador com `sortMode = "oldest"`
ENTÃO: ordem resultante é 20:30, 20:00, 18:30 (mais distante do `now` primeiro)
[corretude] — valor esperado calculado manualmente, independente da implementação

### T-U-03 — jogos passados ordenados decrescente em "Mais recentes" (regressão)
Camada: função pura de comparação/ordenação
DADO: 3 jogos passados (`matchDatetime` antes de `now` mockado) em horários distintos
QUANDO: aplicado o comparador com `sortMode = "recent"`
ENTÃO: ordem resultante é do mais recente (mais próximo de `now`, ainda no passado) para o mais antigo —
mesmo comportamento já existente hoje, sem regressão
[regressão] — mede que o comportamento pré-existente para jogos passados não mudou

### T-U-04 — jogos passados ordenados crescente em "Mais antigos" (regressão)
Camada: função pura de comparação/ordenação
DADO: os mesmos 3 jogos passados de T-U-03
QUANDO: aplicado o comparador com `sortMode = "oldest"`
ENTÃO: ordem resultante é do mais antigo para o mais recente — comportamento pré-existente preservado
[regressão]

### T-U-05 — mistura de jogos passados e futuros em "Mais recentes"
Camada: função pura de comparação/ordenação
DADO: 2 jogos futuros e 2 jogos passados intercalados na lista de entrada
QUANDO: aplicado o comparador com `sortMode = "recent"`
ENTÃO: os 2 jogos futuros aparecem antes dos 2 jogos passados; ordem interna dos futuros é crescente;
ordem interna dos passados é decrescente
[corretude] — cálculo manual da ordem esperada a partir das datas fixture

### T-U-06 — mistura de jogos passados e futuros em "Mais antigos"
Camada: função pura de comparação/ordenação
DADO: os mesmos 4 jogos de T-U-05
QUANDO: aplicado o comparador com `sortMode = "oldest"`
ENTÃO: os 2 jogos passados aparecem antes dos 2 futuros; ordem interna dos passados é crescente; ordem
interna dos futuros é decrescente
[corretude]

### Cobertura de falhas silenciosas
- Não aplicável a UI neste ciclo — mudança é puramente na função de ordenação; T-U-01 a T-U-06 verificam
  o array resultante diretamente (efeito real da ordenação), não apenas que a função foi chamada

### Comando para rodar a suite
`npm --prefix apps/web test -- sort-matches` (ajustar para o comando exato do runner configurado em
`apps/web/package.json` — Codex confirma antes de reportar)

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-19) — fast track (v7)
Entrega trivial: único arquivo (`page.tsx`), sem DDL, sem mudança de contrato de API, sem domínio
Instável/Em refinamento em `DOMAIN_MATURITY.md` relacionado. CAT compacto, sem as 3 rodadas completas.

Entendimento: bug relatado por Leo com evidência visual (2 screenshots) — jogos futuros em
"Mais recentes" aparecem do mais tardio para o mais cedo, quando deveriam aparecer do mais próximo de
agora para o mais distante.

Artefato candidato: `apps/web/app/user/events/[id]/athletes/[athleteId]/page.tsx`, comparador dentro do
`useMemo` que monta `groups` (linhas 369-392).

Mudança proposta: introduzir classificação futuro/passado (relativa a `Date.now()`) como critério
adicional de ordenação, mantendo a direção `recent`/`oldest` dentro de cada grupo.

Fora de escopo: qualquer outra tela do projeto (confirmado via Grep que este comparador é exclusivo desta
página); alteração de API/backend; alteração do fallback para jogos sem `matchDatetime`.

DoD preliminar: T-U-01 a T-U-06 verdes; suite completa de `apps/web` sem regressão; nenhuma outra tela
afetada (não há outra ocorrência do padrão).

Confirmação de escopo obtida via `AskUserQuestion` com Leo em 2026-09-19: "mais recentes" para jogos
futuros deve mostrar o mais próximo de agora primeiro (ordem crescente), resposta escolhida:
"Sim, mais próximo primeiro (Recomendado)".

SEM_DIVERGÊNCIA — fast track, sem rodada de contraponto Codex nesta etapa; Codex declara divergência de
implementabilidade diretamente na implementação, se houver.

### Parecer — Rodada 1 (2026-09-19) — [✅ aprovado]

#### Pré-parecer — obrigatório responder antes do score
- [x] Glob executado — 2 arquivos identificados no diff (`git diff --stat main..fix/pp-061-...`):
      `page.tsx` e `apps/web/tests/sort-matches.test.tsx`
- [x] Read(<arquivo PR>) + Read(<arquivo base>) executados — `page.tsx` lido integralmente (versão da
      branch) e comparado via `git show main:... ` para a versão base; `sort-matches.test.tsx` lido
      integralmente via `git show` (arquivo novo, sem base)
- [x] TodoWrite não necessário — apenas 2 arquivos
- [x] `docs/scripts/confere-citacoes.py` — script não existe neste repositório; não aplicável, declarado
      explicitamente (não é `docs/scripts/` presente em `appcbtmeventos`)
- [x] Nenhum item avaliado de memória, chat ou declaração do Codex — evidência é o diff lido via `git show`
      e execução própria de suite/build/hook

#### Score
✅ 8 itens | ⚠️ 1 item | ❌ 0 itens | Cobertura diff: 2/2 arquivos auditados

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
- [nomenclatura de commit] O commit `2541ac5` está rotulado `refactor(web): ...` mas na prática introduz
  o comportamento que faz T-U-05/T-U-06 passarem (confirmado por leitura da versão do comparador no
  commit anterior `a84ff93`, que tratava só "ambos futuros" como caso especial e caía no `else` para
  mistura futuro×passado — comportamento errado para os Cenários 5/6 da Spec). Deveria ter sido rotulado
  `fix`/`test...green`. Não é bloqueante: o ciclo Red-Green formal foi cumprido para T-U-01/T-U-02 (únicos
  T-* que exigiam mudança de comportamento nova sobre uma lacuna ainda não coberta por teste); T-U-03/04
  validam regressão de comportamento pré-existente (não exigem Red); T-U-05/06 dependiam de uma extensão
  de comportamento que só foi implementada no commit final — o efeito é correto e verificado, a
  nomenclatura do commit é que não reflete com precisão a natureza da mudança. Rótulo: `EXECUTADA` (leitura
  de diff + comparação de versões via `git show`).

#### Cobertura de testes (T-* da Spec)
- T-U-01 [jogos futuros crescente em "recent"] — rótulo: `EXECUTADA` (suite rodada por mim, 61/61 verdes,
  incluindo este caso individualmente confirmado no output): coberto ✅
- T-U-02 [jogos futuros decrescente em "oldest"] — rótulo: `EXECUTADA`: coberto ✅
- T-U-03 [jogos passados decrescente em "recent", regressão] — rótulo: `EXECUTADA`: coberto ✅
- T-U-04 [jogos passados crescente em "oldest", regressão] — rótulo: `EXECUTADA`: coberto ✅
- T-U-05 [mistura, "recent"] — rótulo: `EXECUTADA`: coberto ✅
- T-U-06 [mistura, "oldest"] — rótulo: `EXECUTADA`: coberto ✅
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum — as 6 asserções cobrem os 6
  cenários funcionais declarados; o Cenário 6 da Spec (jogos sem `matchDatetime`) foi verificado por
  leitura estática como não tocado pelo diff (fallback por `resolveGameOrderId`/`id` preservado
  literalmente, linhas 194-200 do arquivo novo idênticas à lógica final do comparador antigo) — rótulo:
  `ESTÁTICA`, sem teste dedicado na Spec original para esse trecho (Spec já declarava esse cenário como
  "não tocado", não exigia T-* novo)

#### Verificações determinísticas (encoding/BOM/CRLF)
- `page.tsx`: BOM presente no blob — confirmado pré-existente na versão `main` (mesmo BOM antes desta
  entrega, via `git show main:...`), não é regressão introduzida por PP-061; LF puro, sem CRLF
- `sort-matches.test.tsx` (arquivo novo): sem BOM, LF puro
- `core.autocrlf=true` confirmado no início da revisão — checagem feita via `git show` (blob), não via
  working tree, conforme protocolo

#### Ciclo Red-Green (Q12)
- T-U-01: red `f6d6415` → green `0ac3b1c` ✅ Red precede Green
- T-U-02: red `7780b1b` → green `da00222` ✅ Red precede Green
- T-U-03/04/05/06: commitados diretamente como `green` (sem Red formal) — justificado no relatório do
  Codex como testes de regressão que já eram verdes no comportamento-base à exceção de T-U-05/06, que na
  prática dependiam do commit `2541ac5` (posterior) para passar. Achado: T-U-05 (`ac1eb2d`) e T-U-06
  (`a84ff93`) foram commitados como "green" ANTES do commit `2541ac5` que implementa o comportamento que
  os faz passar de fato — sequência Git não reflete Red-Green estrito para esses dois casos. Verificado
  via leitura do comparador em cada commit intermediário (acima). Não rebaixo para ❌ porque: (1) o
  resultado final é correto e todos os 6 testes passam na suite atual, execução própria confirmada; (2)
  não há indício de hardcoding — a lógica é dinâmica sobre timestamps de fixture, não sobre valores
  literais dos testes; (3) é desvio de processo (ordem de commit / rotulagem), não de comportamento
  entregue. Registrado como ressalva acima, não como bloqueio.

#### Anti-hardcoding (Q13)
Verificado: `compareSummaryMatches` não contém `if input == <valor do teste>`, não hardcoda payload de
mock como retorno, e usa os parâmetros (`left`, `right`, `sortMode`, `now`) de forma dinâmica em todos os
ramos. Testes usam fixtures com múltiplos `id`/`matchDatetime` distintos por cenário — não há caso de
input único disfarçado de cobertura.

#### Validação própria (não aceita do relatório do Codex)
- `npm --prefix apps/web test` executado por mim: 61 testes, 61 pass, 0 fail (rótulo `EXECUTADA`)
- `npm run build --workspace apps-web` executado por mim: build concluído sem erro, rota
  `/user/events/[id]/athletes/[athleteId]` presente no output (rótulo `EXECUTADA`)
- `npm run test:regression:critical` executado por mim: 25 testes, 25 pass, 0 fail (rótulo `EXECUTADA`)
- `git config core.hooksPath` = `.githooks` confirmado ativo (rótulo `EXECUTADA`)
- Nenhum commit da entrega usa `--no-verify` — sem evidência de bypass; hook local reexecutado
  separadamente (regressão crítica) com sucesso, consistente com histórico de commits limpo

#### Aderência à Spec — escopo
- Nenhuma funcionalidade fora do escopo declarado (Q3): apenas o comparador e o teste foram tocados
- Nenhum arquivo da lista "NÃO devem ser tocados" foi alterado — confirmado via
  `git diff --stat main..fix/pp-061-...` (só 2 arquivos, ambos esperados)
- `apps/api/**` intocado

#### Security review
Executado — sem achados. Superfície de segurança não tocada: mudança é 100% lógica de ordenação
client-side sobre dados já recebidos da API; sem auth, sem query nova, sem input renderizado sem
sanitização prévia (já existente), sem upload, sem integração externa, sem segredo. Confirmado por leitura
do diff completo (63 linhas alteradas, nenhuma delas relacionada a superfície OWASP A01-A10).

#### Conclusão
Aprovado. A correção resolve o bug relatado por Leo (jogos futuros em "Mais recentes" apareciam do mais
distante para o mais próximo) com lógica correta, testada e sem regressão. A única ressalva é de
nomenclatura de commit (não funcional) — não impede merge.
