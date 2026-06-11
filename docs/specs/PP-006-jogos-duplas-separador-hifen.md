# PP-006 — Jogos de duplas/mistas com separador ` - ` ausentes na página do atleta

## Objetivo

Corrigir bug em que jogos de duplas e duplas mistas cujo par foi registrado com separador ` - ` (espaço-hífen-espaço) — em vez de `#` — não aparecem na página de resumo do atleta em `/events/:id/athletes/:athleteId`.

## Contexto

O método `getAthleteSummary` em `user.service.ts` usa duas queries para encontrar os jogos do atleta:

1. `directMatches` — busca matches onde o atleta é participante direto por `athleteId`
2. `projectedDoublesMatches` — busca matches onde algum participante tem `nameDisplay contains "#"`, para depois projetar o atleta individual a partir do nome do par

O problema: `isCompositePairName` e `splitPairNameParts` (L470–472 e L463–468) reconhecem **tanto `#` quanto ` - `** como separadores de par. Mas a query `projectedDoublesMatches` só filtra por `contains: "#"`, deixando de fora pares salvos como `"ATLETA A - ATLETA B"`.

O `buildAthleteSummaryMatch` e `resolveProjectedAthleteIndexFromPair` já estão preparados para lidar com ` - ` — o problema está exclusivamente no predicado da query de busca.

## Causa raiz

- **Imediata:** predicado `nameDisplay: { contains: "#" }` em `projectedDoublesMatches` não cobre o separador ` - ` que `isCompositePairName` reconhece como par composto
- **Sistêmica:** a query de projeção foi escrita assumindo que pares compostos sempre usam `#`, mas o scraper salva pares com ambos os formatos dependendo da fonte

## Cenários funcionais

**DADO** um atleta individual inscrito num evento agregado com filhos de duplas/mistas,
**QUANDO** ele acessa `/events/:canonicalId/athletes/:athleteId`,
**ENTÃO** todos os seus jogos aparecem — incluindo os de duplas/mistas cujo par foi salvo com ` - ` como separador.

**DADO** um atleta cujos pares usam ambos os formatos (alguns com `#`, outros com ` - `),
**QUANDO** ele acessa a página de resumo,
**ENTÃO** jogos de ambos os formatos são exibidos sem duplicação.

**DADO** um atleta que joga apenas individual (sem nenhum par composto),
**QUANDO** ele acessa a página de resumo,
**ENTÃO** os jogos individuais continuam exibidos sem regressão.

## Critérios de aceitação

1. Atleta `ADÔNIS CARDOSO AZEVEDO` (id `9372`) no evento `44` retorna os matches `54763` e `54765` (par `ADÔNIS AZEVEDO - GABRIEL BENAYON`) além dos já retornados atualmente
2. Nenhum match individual é perdido (regressão proibida)
3. Nenhum match é duplicado (deduplicação existente continua funcionando)
4. Atleta sem pares compostos não tem seus dados alterados

## Fora de escopo

- Alterar `buildAthleteSummaryMatch`, `resolveProjectedAthleteIndexFromPair` ou `deduplicateMatches` — essas funções já funcionam com ` - `
- Alterar a lógica de performance/analytics (`analyticalMatches`)
- Alterar frontend
- Normalizar o separador no scraper/importação
- Qualquer outra rota ou serviço que não seja `getAthleteSummary`

## Impacto técnico

**Arquivo a modificar:**
- `apps/api/src/user/user.service.ts` — dentro de `getAthleteSummary`, bloco `projectedDoublesMatches` (L3950–3964)

**Mudança:**

```typescript
// ANTES
const projectedDoublesMatches = await this.prisma.match.findMany({
  where: {
    eventId: { in: scope.allEventIds },
    participants: {
      some: {
        athlete: {
          nameDisplay: { contains: "#" },
        },
      },
    },
  },
  select: matchSelect,
});

// DEPOIS
const projectedDoublesMatches = await this.prisma.match.findMany({
  where: {
    eventId: { in: scope.allEventIds },
    participants: {
      some: {
        athlete: {
          OR: [
            { nameDisplay: { contains: "#" } },
            { nameDisplay: { contains: " - " } },
          ],
        },
      },
    },
  },
  select: matchSelect,
});
```

**Arquivos que NÃO devem ser tocados:**
- `buildAthleteSummaryMatch` (L4664) — já funciona com ` - `
- `resolveProjectedAthleteIndexFromPair` (L4800) — já funciona com ` - `
- `buildAthleteNameKeys` (L4767) — já funciona com ` - `
- `deduplicateMatches` — já funciona
- Todo o frontend
- Nenhuma outra rota ou serviço

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: unitário + integração
- Arquivos de teste: confirmar existência de `apps/api/src/user/user.service.spec.ts`; criar se ausente
- Fixtures: atleta com matches mistos (`#` e ` - `), atleta só individual, atleta sem matches de par

### T-U-01 — Projeção de par com separador hífen
Camada: unitário — `buildAthleteSummaryMatch`
DADO: match com participant `nameDisplay = "ATLAS - ZEUS"`, athleteId buscado = id de "ATLAS"
QUANDO: `buildAthleteSummaryMatch(match, atlasId, athleteNameKeys)` é chamado
ENTÃO: retorna objeto com `athleteIndex` definido (0 ou 1) e `isProjectedParticipant = true`

### T-U-02 — `isCompositePairName` aceita separador hífen
Camada: unitário — função pura
DADO: string `"ATLAS - ZEUS"`
QUANDO: `isCompositePairName("ATLAS - ZEUS")` é chamado
ENTÃO: retorna `true`

### T-I-01 — Endpoint retorna matches com par ` - `
Camada: integração — `GET /events/:id/athletes/:athleteId/summary`
DADO: evento canônico `44`, atleta `9372` (`ADÔNIS CARDOSO AZEVEDO`)
QUANDO: `GET /events/44/athletes/9372/summary`
ENTÃO: response `matches` contém ids `54763` e `54765`; total de matches ≥ 9

### T-I-02 — Sem duplicação após correção
Camada: integração
DADO: mesma request do T-I-01
QUANDO: response recebido
ENTÃO: `deduplicatedMatchesRemoved` não aumenta em relação ao baseline; nenhum `match.id` duplicado no array `matches`

### T-I-03 — Regressão: atleta só individual
Camada: integração
DADO: atleta sem par composto de nenhum formato
QUANDO: `GET /events/:id/athletes/:athleteId/summary`
ENTÃO: response idêntico ao baseline (mesmos match ids, mesmo count)

### Cobertura de falhas silenciosas
- T-I-01 verifica `match.id` presente no array, não só `count`
- T-I-02 verifica ausência de duplicação explicitamente
- T-I-03 garante não-regressão para atletas sem par

### Comando para rodar a suite
```bash
npm --prefix apps/api test
```
