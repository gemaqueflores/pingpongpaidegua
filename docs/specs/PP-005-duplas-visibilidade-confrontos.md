# PP-005 — Visibilidade de duplas e confrontos no evento agregado

**Aprovação Leo:** 2026-06-10 (opções A+A para ambas as decisões)  
**Draft de origem:** `docs/specs/PP-005-draft.md`

---

## Objetivo

Corrigir dois problemas na página `/events/51` (3TMB26 - Mestre Bianor Coelho, evento agregado de três eventos CBTM):

1. Atletas de duplas (71 pares) não aparecem em nenhuma aba — excluídos pelo filtro `not contains '#'`
2. Confrontos com horários definidos (776 partidas com `match_datetime`) não têm visualização na página do evento

---

## Contexto

Evento canonical `id=51` agrega:
- `id=52` (3TMB26 duplas) com sufixo ` - DUPLAS`
- `id=53` (3TMB26 DUPLAS MISTAS) com sufixo ` - DUPLAS MISTAS`

Relação em `event_merges` já existe e funciona corretamente: `resolveEventScope(51)` retorna `allEventIds=[51,52,53]`. O scraping está completo nos três eventos. O problema é exclusivamente de exibição.

`situacaoComputada` atual do evento 51: `POS_INSCRICOES_PRE_EVENTO` com `groupsDefined=true` → frontend abre direto na aba "Atletas". Os pares de duplas têm `nameDisplay` no formato `"NOME A # NOME B"` e `club_id` associado.

---

## Causa raiz

**Causa imediata:** Três ocorrências de `nameDisplay: { not: { contains: '#' } }` em `user.service.ts` excluem todos os pares da listagem de atletas e da contagem de atletas por clube.

**Causa sistêmica:** O filtro foi introduzido provavelmente para o diretório global de atletas (evitar listar o mesmo par como dois indivíduos). Foi copiado para os métodos de listagem de evento sem distinção — contexto errado para a funcionalidade de eventos de duplas.

---

## Cenários funcionais

### Cenário 1 — Aba Atletas mostra pares de duplas
DADO evento canonical 51 aberto na aba "Atletas"  
QUANDO o usuário carrega a página  
ENTÃO pares de duplas dos eventos 52 e 53 aparecem na lista com nome formatado e clube  
E a busca por nome funciona para parte do nome do par

### Cenário 2 — Aba Clubes conta pares corretamente
DADO evento canonical 51 aberto na aba "Clubes"  
QUANDO o usuário expande um clube  
ENTÃO os pares de duplas inscritos naquele clube aparecem na lista de atletas do clube  
E a contagem de atletas por clube inclui os pares (cada par conta como 1 entrada)

### Cenário 3 — Aba Confrontos exibe partidas agendadas
DADO evento canonical 51 aberto  
QUANDO o evento está em `POS_INSCRICOES_PRE_EVENTO` ou `GRADES_PUBLICADAS_PRE_JOGO` com `groupsDefined=true`  
ENTÃO existe uma aba "Confrontos" na página  
E ela exibe as partidas agrupadas por categoria  
E cada partida mostra: horário (fuso Belém), mesa, fase/rodada, atleta/par A vs atleta/par B  
E o placar é exibido quando preenchido (`score_raw` não vazio)

### Cenário 4 — Aba Confrontos não aparece em eventos sem partidas
DADO evento sem partidas com `match_datetime` preenchido  
QUANDO o usuário abre a página do evento  
ENTÃO a aba "Confrontos" não aparece no menu de abas

---

## Critérios de aceitação

- A aba "Atletas" exibe pares de duplas com `nameDisplay` contendo `#`
- A aba "Clubes" → expansão de clube exibe pares de duplas do clube
- A contagem de atletas por clube (número exibido no card de clube) inclui os pares
- A aba "Confrontos" aparece somente quando `totalPartidasPublicadas > 0` (ou campo equivalente indicando que há partidas com horário)
- A aba "Confrontos" agrupa partidas por categoria, ordenadas por `match_datetime`
- Partidas sem `match_datetime` aparecem sem horário, não são omitidas
- O filtro `not contains '#'` no **diretório global de atletas** (`/athletes/directory`) NÃO é alterado

---

## Fora de escopo

- Diretório global de atletas (`listAthleteDirectory`) — filtro de pares mantido como está
- Página de carreira do atleta individual — sem alteração
- Detalhe individual do atleta (página de partidas do atleta) — sem alteração
- Worker de prewarm / read_model_caches — funcionamento por design, sem alteração
- Rota `/events/52` e `/events/53` — redirecionamento para canonical já funciona

---

## Impacto técnico

### Arquivos a modificar

**Backend — `apps/api/src/user/user.service.ts`**

1. `listAthletes` (~linha 1568)  
   Remover o filtro `nameDisplay: { not: { contains: '#' } }` da query de atletas do evento.  
   O `distinct` por `nameNormalized` já previne duplicatas de indivíduos que aparecem em múltiplas categorias. Para pares, `nameNormalized` do par é único por evento.

2. `listClubs` — query de contagem `athletesByClub` (~linha 1708)  
   Remover o filtro `nameDisplay: { not: { contains: '#' } }`.  
   Manter `distinct: ["clubId", "nameNormalized"]` — garante que par inscrito em múltiplas categorias conta como 1.

3. `listClubAthletes` (~linha 3583)  
   Remover o filtro `nameDisplay: { not: { contains: '#' } }`.  
   A deduplicação existente por `nameNormalized` já está correta.

4. Novo método `listEventSchedule(eventId: number)` — a implementar  
   Retorna partidas com `match_datetime` agrupadas por categoria. Estrutura do retorno:
   ```typescript
   {
     eventId: number;
     categories: Array<{
       categoryId: number;
       categoryName: string;         // com sufixo de evento filho se aplicável
       matches: Array<{
         id: number;
         round: string | null;
         tableNumber: string | null;
         matchDatetime: string | null; // ISO
         scoreRaw: string | null;
         playerA: { id: number | null; name: string; clubName: string | null } | null;
         playerB: { id: number | null; name: string; clubName: string | null } | null;
       }>;
     }>;
   }
   ```
   Query: buscar `matches` com `eventId IN scope.allEventIds`, incluir `participants → athlete → club`. Ordenar dentro de cada categoria por `match_datetime ASC NULLS LAST`, depois por `round`, depois por `table_number`.  
   Só retornar categorias que tenham pelo menos uma partida.  
   Filtrar categorias com `cbtmCategoryId IN IGNORED_CATEGORY_IDS` (igual ao restante do serviço).

**Backend — `apps/api/src/user/user.controller.ts`**

5. Nova rota `GET /events/:id/schedule` — `@PublicCacheTtl(30)` — delegar para `this.service.listEventSchedule(eventId)`

**Frontend — `apps/web/lib/user-api.ts`**

6. Novo tipo `EventScheduleResponse` e função `apiGetEventSchedule(eventId: number): Promise<EventScheduleResponse>` — `GET /events/${eventId}/schedule`

**Frontend — `apps/web/app/user/events/[id]/page.tsx`**

7. Adicionar aba "Confrontos" ao array `tabs` — condicional: só incluir quando `event.totalPartidasPublicadas > 0`  
8. Implementar painel da aba "Confrontos": lista de categorias dobráveis com suas partidas (horário, mesa, fase, atletas/pares, placar se disponível)  
9. Carregar dados via `apiGetEventSchedule` quando a aba "Confrontos" estiver ativa (mesmo padrão das outras abas — `useEffect` na mudança de `activeTab`)

### Arquivos que NÃO devem ser tocados

- `apps/api/src/user/user.service.ts` — método `listAthleteDirectory` (filtro de `#` deve ser mantido)
- `packages/shared/` — sem alteração
- `apps/worker/` — sem alteração
- Prisma schema — sem DDL

---

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: unitário (serviço) + integração (endpoint)
- Arquivos de teste a criar/modificar: `apps/api/test/user-service.event-athletes.test.ts` (novo ou existente), testes do controller se houver arquivo de testes de rota
- Fixtures: reutilizar setup existente de eventos com merge (scope allEventIds)

### T-U-01 — listAthletes inclui pares de duplas
Camada: `UserService.listAthletes`  
DADO scope com eventos [51, 52, 53] onde event 52 tem atletas com `nameDisplay LIKE '%#%'`  
QUANDO `listAthletes(51, "")` é chamado  
ENTÃO retorno inclui atletas com `nameDisplay` contendo `#`  
E retorno também inclui atletas individuais  
E pares não são duplicados (dedup por nameNormalized funciona)

### T-U-02 — listAthletes do diretório global ainda filtra pares
Camada: `UserService.listAthleteDirectory`  
DADO diretório com pares cadastrados  
QUANDO `listAthleteDirectory("")` é chamado  
ENTÃO pares com `nameDisplay` contendo `#` NÃO aparecem no resultado

### T-U-03 — listClubs contagem inclui pares
Camada: `UserService.listClubs`  
DADO evento com scope merged onde clube X tem 3 atletas individuais + 2 pares de duplas  
QUANDO `listClubs(eventId, "", null)` é chamado  
ENTÃO `athleteCount` do clube X = 5 (não 3)

### T-U-04 — listClubAthletes retorna pares do clube
Camada: `UserService.listClubAthletes`  
DADO clube X com par `"A # B"` inscrito em categoria de duplas  
QUANDO `listClubAthletes(eventId, clubId, null)` é chamado  
ENTÃO resposta inclui entrada com `nameDisplay = "A # B"`

### T-U-05 — listEventSchedule retorna partidas agrupadas por categoria
Camada: `UserService.listEventSchedule`  
DADO evento 51 com 776 partidas em eventos [51,52,53]  
QUANDO `listEventSchedule(51)` é chamado  
ENTÃO retorno contém categorias dos três eventos  
E categorias dos eventos 52/53 têm sufixo correto (` - DUPLAS`, ` - DUPLAS MISTAS`)  
E partidas dentro de cada categoria ordenadas por `match_datetime ASC NULLS LAST`

### T-U-06 — listEventSchedule ignora categorias sem partidas
Camada: `UserService.listEventSchedule`  
DADO evento onde categoria A tem partidas e categoria B não tem  
QUANDO `listEventSchedule(eventId)` é chamado  
ENTÃO resposta não inclui categoria B

### T-I-01 — GET /events/:id/athletes inclui pares (integração)
Camada: endpoint  
DADO event_id 51 em produção  
QUANDO `GET /events/51/athletes`  
ENTÃO status 200  
E body inclui ao menos um atleta com `nameDisplay` contendo `#`

### T-I-02 — GET /events/:id/schedule retorna estrutura correta (integração)
Camada: endpoint  
DADO event_id 51  
QUANDO `GET /events/51/schedule`  
ENTÃO status 200  
E body tem `{ eventId: 51, categories: [...] }`  
E ao menos uma categoria tem `matches` com `matchDatetime` preenchido

### Cobertura de falhas silenciosas
- `listAthletes`: após remoção do filtro, verificar que a deduplicação por `nameNormalized` ainda funciona (atleta individual inscrito em múltiplas categorias conta 1 vez)
- `listEventSchedule`: evento sem partidas → `categories: []` (não 500)
- Aba "Confrontos" no frontend: enquanto carrega → skeleton; sem dados → EmptyState

### Comando para rodar a suite
```bash
# Backend
cd apps/api && npx vitest run

# Frontend (se houver testes de componente)
cd apps/web && npx vitest run
```

---

## Ordem de implementação (Red-Green-Refactor por T-*)

Para cada T-*, em sequência:

1. T-U-01 red → T-U-01 green
2. T-U-02 red → T-U-02 green (garantir que diretório global não regride)
3. T-U-03 red → T-U-03 green
4. T-U-04 red → T-U-04 green
5. T-U-05 red → T-U-05 green (novo método + nova rota)
6. T-U-06 red → T-U-06 green
7. T-I-01 red → T-I-01 green
8. T-I-02 red → T-I-02 green
9. Ajustes frontend (aba Confrontos, exibição de pares) — sem ciclo Red separado por ser UI sem testes automatizados configurados; verificar manualmente

Ao final: rodar suite completa para confirmar ausência de regressão.
