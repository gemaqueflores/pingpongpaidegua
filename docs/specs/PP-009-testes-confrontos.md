# PP-009 — Testes de invariantes da aba Confrontos

**Aprovação Leo:** 2026-06-16

---

## Objetivo

Garantir cobertura de regressão para as três lógicas introduzidas no PR #12 (filtro por categoria, toggle de modo, ordenação por horário), usando o padrão de teste já estabelecido no projeto: leitura de source via `readFileSync` e SSR via `renderToStaticMarkup`.

---

## Contexto

`apps/web/app/user/events/[id]/page.tsx` contém toda a lógica da aba Confrontos:

- `scheduleCategoryFilter` (useState) + `useEffect` de invalidação automática quando categoria some dos dados
- `scheduleViewMode` ("categoria" | "horario")
- `filteredScheduleCategories` (useMemo) — aplica filtro de categoria
- `flatScheduleMatches` (useMemo) — lista flat cross-categoria ordenada por `compareScheduleMatches`
- `filteredScheduleMatchCount` — contagem de partidas após filtro
- `renderScheduleMatch` — função auxiliar; recebe `categoryName?` opcional (exibido no modo horário como Badge)
- `compareScheduleMatches` — ordenação por datetime ASC → tableNumber numérico → id

A página usa hooks e não é testável via `renderToStaticMarkup`. O padrão viável — já consolidado em PP-002/PP-004 — é:
1. **Source-inspection**: `readFileSync` para verificar invariantes estruturais
2. **Unitário puro via `__testables`**: exportar `compareScheduleMatches` e `renderScheduleMatch` para testes diretos

---

## Causa raiz

PR #12 foi commit de Leo (sem ciclo Red-Green — aceitável pelo papel), mas deixou cobertura zero nas lógicas de filtro/toggle/ordenação da aba Confrontos.

---

## Fora de escopo

- Testes e2e ou de browser (Playwright — sem infraestrutura configurada)
- Testes de integração com API real
- Outros painéis da página (grupos, atletas, clubes, eficiência)
- Qualquer alteração de lógica em arquivo de produção

---

## Cenários funcionais

**DADO** a lógica de filtro/toggle implementada em `page.tsx`
**QUANDO** o código-fonte é inspecionado
**ENTÃO** os estados, memos e a invalidação automática de filtro estão presentes

**DADO** a função `compareScheduleMatches`
**QUANDO** chamada com dois matches
**ENTÃO** ordena por datetime crescente, desempata por tableNumber numérico, desempata final por id

**DADO** a função `renderScheduleMatch`
**QUANDO** chamada com `categoryName` presente → HTML inclui o nome da categoria
**QUANDO** chamada sem `categoryName` → HTML não inclui badge de categoria

---

## Critérios de aceitação

1. Source de `page.tsx` contém todos os identificadores de filtro/toggle declarados na spec
2. `compareScheduleMatches` ordena corretamente nos três níveis (datetime → tableNumber → id)
3. `renderScheduleMatch` com `categoryName` produz HTML com o nome; sem `categoryName`, não produz badge

---

## Impacto técnico

### Arquivos a modificar

- `apps/web/app/user/events/[id]/page.tsx`
  - Mover `compareScheduleMatches` (linha 140) para fora do componente — já está fora, sem mudança
  - Mover `renderScheduleMatch` (linha 552) para fora do componente — atualmente é função interna do componente; mover para o escopo do módulo, recebendo os props necessários como parâmetros explícitos (sem captura de closure)
  - Adicionar ao final do arquivo:
    ```ts
    export const __testables = {
      compareScheduleMatches,
      renderScheduleMatch,
    };
    ```
  - **Invariante:** nenhuma lógica de produção deve ser alterada — apenas extração de escopo e exportação

### Arquivos a criar

- `apps/web/tests/confrontos-schedule.test.tsx`

### Arquivos que NÃO devem ser tocados

- Qualquer outro arquivo de produção
- Testes existentes em `apps/web/tests/`

### DDL / migração

Nenhuma.

### Dependências novas

Nenhuma.

---

## Plano de testes

### Cobertura geral

- Camadas obrigatórias: source-inspection + unitário puro
- Arquivo a criar: `apps/web/tests/confrontos-schedule.test.tsx`
- Framework: `node:test` + `node:assert/strict` + `renderToStaticMarkup` (padrão existente)
- Fixtures: objetos inline sintéticos (sem API)

---

### T-U-01 — invariantes de source da aba Confrontos

Camada: source-inspection via `readFileSync`
DADO: source de `apps/web/app/user/events/[id]/page.tsx`
QUANDO: inspecionado
ENTÃO cada um dos seguintes identificadores está presente:
- `scheduleCategoryFilter`
- `scheduleViewMode`
- `filteredScheduleCategories`
- `flatScheduleMatches`
- `compareScheduleMatches`
- `renderScheduleMatch`
- `setScheduleCategoryFilter(null)` dentro de `useEffect` (invalidação automática de filtro)

---

### T-U-02 — compareScheduleMatches: ordena por datetime crescente

Camada: unitário puro (via `__testables`)
DADO: matchA com `matchDatetime: "2026-06-10T10:00:00Z"` e matchB com `matchDatetime: "2026-06-10T09:00:00Z"`
QUANDO: `compareScheduleMatches(matchA, matchB)`
ENTÃO: retorna valor positivo (matchB vem antes de matchA)

---

### T-U-03 — compareScheduleMatches: datetime null vai para o final

DADO: matchA com `matchDatetime: null` e matchB com `matchDatetime: "2026-06-10T09:00:00Z"`
QUANDO: `compareScheduleMatches(matchA, matchB)`
ENTÃO: retorna valor positivo (matchA vai para o final)

---

### T-U-04 — compareScheduleMatches: desempate por tableNumber numérico

DADO: matchA e matchB com mesmo datetime, matchA com `tableNumber: "10"` e matchB com `tableNumber: "9"`
QUANDO: `compareScheduleMatches(matchA, matchB)`
ENTÃO: retorna valor positivo (matchB vem antes — "9" < "10" numericamente, não "10" < "9" lexicograficamente)

---

### T-U-05 — compareScheduleMatches: desempate final por id

DADO: matchA e matchB com mesmo datetime e mesmo tableNumber, matchA com `id: 20` e matchB com `id: 10`
QUANDO: `compareScheduleMatches(matchA, matchB)`
ENTÃO: retorna valor positivo (matchB vem antes de matchA)

---

### T-U-06 — renderScheduleMatch com categoryName exibe badge de categoria

Camada: SSR via `renderToStaticMarkup`
DADO: match sintético mínimo válido + `categoryName: "DUPLA MISTA - SUB-15"`
QUANDO: `renderToStaticMarkup(renderScheduleMatch(match, "DUPLA MISTA - SUB-15"))`
ENTÃO: HTML resultante contém `"DUPLA MISTA - SUB-15"`

---

### T-U-07 — renderScheduleMatch sem categoryName não exibe badge de categoria

DADO: mesmo match sintético
QUANDO: `renderToStaticMarkup(renderScheduleMatch(match))` — sem segundo argumento
ENTÃO: HTML resultante não contém `"DUPLA MISTA - SUB-15"` (ou qualquer nome de categoria)

---

### Cobertura de falhas silenciosas

- T-U-03 garante que matches sem horário ficam no final, não flutuam aleatoriamente
- T-U-04 garante que "Mesa 10" não vem antes de "Mesa 9" por ordem lexicográfica
- T-U-01 garante que refactors futuros em `page.tsx` não removem a invalidação automática de filtro

### Comando para rodar a suite

```
npm --prefix apps/web test -- confrontos-schedule.test.tsx
```

---

## Orientação para o Codex

```
## Orientação para o Codex — PP-009

### Spec aprovada
caminho: docs/specs/PP-009-testes-confrontos.md
aprovação Leo: 2026-06-16

### Plano de testes (resumo)
- IDs: T-U-01, T-U-02, T-U-03, T-U-04, T-U-05, T-U-06, T-U-07
- arquivo de teste a criar: apps/web/tests/confrontos-schedule.test.tsx
- comando: npm --prefix apps/web test -- confrontos-schedule.test.tsx

### Contexto
branch base: main
branch a criar: feat/pp-009-testes-confrontos
commit topo main: a102448 (após merge PR #16)

### Pré-condições
- git config user.email = gemaqueflores@gmail.com
- branch base: main
- Sem DDL

### Arquivos a modificar
PRODUÇÃO:
- apps/web/app/user/events/[id]/page.tsx
  - renderScheduleMatch (linha 552) é função interna do componente — mover para escopo do módulo
    antes do componente, tornando-a função pura que recebe os parâmetros necessários explicitamente
    (sem captura de closure de outros estados do componente — ela já não captura nenhum)
  - Adicionar ao final do arquivo (após a função do componente):
    export const __testables = { compareScheduleMatches, renderScheduleMatch };
  - INVARIANTE: nenhuma lógica alterada; apenas extração de escopo e exportação

TESTES:
- apps/web/tests/confrontos-schedule.test.tsx
  - usar node:test + node:assert/strict + renderToStaticMarkup (padrão de ui-snapshots.test.tsx)
  - importar __testables de ../app/user/events/[id]/page
  - cobrir T-U-01 a T-U-07

### Arquivos que NÃO devem ser tocados
- Qualquer outro arquivo de produção
- Testes existentes em apps/web/tests/

### Ordem de implementação (Red-Green por T-*)
T-U-01 (source-inspection): red → green — o red deve falhar por __testables não exportado ainda
T-U-02 a T-U-05 (compareScheduleMatches): red em lote (4 testes, compareScheduleMatches já existe) → green ao exportar
T-U-06 e T-U-07 (renderScheduleMatch): red → green ao mover e exportar renderScheduleMatch

Estratégia de commits sugerida:
1. test(web): T-U-01 red — invariantes de source da aba confrontos
2. feat(web): T-U-01 green — exporta __testables com compareScheduleMatches e renderScheduleMatch
3. test(web): T-U-02 a T-U-05 red — ordenação de compareScheduleMatches
4. (suite já verde por __testables exportado — commit green pode ser no mesmo commit ou separado)
5. test(web): T-U-06 e T-U-07 red — renderScheduleMatch com e sem categoryName
6. (suite já verde — idem)

### Validação antes de reportar
- npm --prefix apps/web test -- confrontos-schedule.test.tsx → T-U-01 a T-U-07 verdes
- npm run test --workspace apps-web → suite completa verde
- npm run build --workspace apps-web → ok
- npm run verify:encoding → ok
```
