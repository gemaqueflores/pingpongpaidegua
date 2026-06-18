# PP-005 — Draft Tripartite — Dados ausentes em evento agregado 3TMB26 (IDs 5680/5688/5691)

**Status:** FECHADO — Leo aprovou [LEO DECIDE 1]=A e [LEO DECIDE 2]=A em 2026-06-10  
**Data:** 2026-06-10  
**Tipo de análise:** Ciclo tripartite pré-Spec  
**Evidências coletadas via:** SSH → PostgreSQL produção + leitura direta do código-fonte + resposta técnica do Codex (Rodada 2)

---

## Itens [LEO DECIDE] — responder antes de fechar o ciclo

### [LEO DECIDE 1] — Exibição de pares de duplas na aba "Atletas"

**Contexto:** O filtro `nameDisplay NOT LIKE '%#%'` em `listAthletes` exclui todos os pares de duplas (ex: `"SILVA A # SILVA B"`). O Codex confirmou que não encontrou evidência de que esse filtro era intencional para o contexto de eventos de duplas/merged.

**Opções:**
- **A (recomendada):** Remover o filtro de `#` nas rotas do evento para permitir que pares apareçam na aba "Atletas" — com renderização adequada do nome do par
- **B:** Criar uma aba dedicada "Duplas" separada da aba "Atletas" (mais trabalho, mais contexto visual)
- **C:** Manter filtro como está — pares de duplas não aparecem na aba, apenas atletas individuais mesmo para eventos merged de duplas

### [LEO DECIDE 2] — Aba de Confrontos/Horários

**Contexto:** O banco tem 776 partidas com `match_datetime` preenchido para o evento 51 (confrontos de 2026-06-14 em diante). O site atual não tem aba de confrontos na página do evento — partidas só são visíveis pelo detalhe individual do atleta.

**Opções:**
- **A:** Implementar aba "Confrontos" na página do evento mostrando tabela de partidas agendadas com horário, mesa e duplas/atletas
- **B:** Não implementar — confrontos continuam acessíveis apenas pelo detalhe do atleta individual
- **C:** Implementar somente link externo para o site da CBTM (app.cbtm.org.br) para os confrontos oficiais

---

---

## Contexto

Evento agregado "3TMB26 - Mestre Bianor Coelho" composto por três eventos CBTM:

| cbtmEventId | id interno | nome                          | nivel    |
|-------------|-----------|-------------------------------|----------|
| 5680        | 51        | 3TMB26 - Mestre Bianor Coelho | ESTADUAL |
| 5688        | 52        | 3TMB26 (duplas)               | ESTADUAL |
| 5691        | 53        | 3TMB26 (DUPLAS MISTAS)        | ESTADUAL |

Configuração de merge em produção (tabela `event_merges`):
- primary=51, secondary=52, suffix=` - DUPLAS`
- primary=51, secondary=53, suffix=` - DUPLAS MISTAS`

O evento foi publicado com as URLs oficiais da CBTM já mostrando atletas, confrontos e horários. O nosso site não exibe nada nessas sub-rotas para duplas e duplas mistas.

---

## Diagnóstico técnico — Rodada 1 (Claude)

### Fato 1 — Dados existem no banco de produção

Todos os três eventos têm dados scrapeados e populados:

| event_id | atletas | categorias | partidas (RESULTADOS) | last_scrape_at |
|----------|---------|------------|----------------------|----------------|
| 51       | 257     | ~55        | 757                  | 2026-06-10 13:32 |
| 52       | 59      | 13         | 13                   | 2026-06-10 13:33 |
| 53       | 26      | 5          | 6                    | 2026-06-10 13:33 |

Inscrições nos eventos 52 e 53 incluem registros `INSCRITO` e `PRE_INSCRITO` com categorias de duplas (ABSOLUTO A MAS, ABSOLUTO C MAS, DUPLA MISTA etc.).

Partidas existem com `phase = RESULTADOS` em todos os três eventos. O evento 51 tem `match_datetime` com horários definidos (2026-06-14). Isso confirma: **os dados estão no banco, o problema não é de scraping**.

---

### Fato 2 — read_model_caches ausente para eventos secundários

A tabela `read_model_caches` armazena os payloads pré-computados para as rotas `event-summary`, `event-medalists` e `event-efficiency`.

| event_id | kind            | source_scrape_run_id | updated_at |
|----------|-----------------|----------------------|------------|
| 51       | event-summary   | 6131                 | 2026-06-10 13:33 |
| 51       | event-medalists | 6131                 | 2026-06-10 13:33 |
| 51       | event-efficiency| 6131                 | 2026-06-10 13:33 |
| 52       | (nenhum)        | —                    | —          |
| 53       | event-summary   | **3339**             | **2026-04-28** |
| 53       | event-medalists | 3339                 | 2026-04-28 |
| 53       | event-efficiency| 3339                 | 2026-04-28 |
| 53       | athlete-summary | 3339                 | 2026-04-28 |

**Achados:**
- Evento 52: zero entradas em `read_model_caches`. A API sempre recalcula ao receber requisição.
- Evento 53: entradas existem, mas `source_scrape_run_id = 3339` — um run de 2026-04-28, correspondente a um dos primeiros scrapes desse evento logo após criação. O `latestReliableRunId` atual é 6131. Como `cached.sourceScrapeRunId !== latestReliableRunId`, a condição de hit do cache falha → `compute()` é chamado em toda requisição.

---

### Fato 3 — A chave de cache usa `canonicalEventId` (51), não os IDs secundários

`buildReadModelKey("event-summary-v12", scope.canonicalEventId)` → `"event-summary-v12|event:51"`

Quando o frontend acessa `/events/52` ou `/events/53`, a API:
1. Chama `resolveEventScope(52)` → retorna `canonicalEventId = 51`
2. Usa `cacheKey = "event-summary-v12|event:51"`
3. Encontra cache fresco para o evento 51 → **retorna o resumo do evento 51**, não do 52

**Isso não é o bug das páginas de atletas e clubes.** O `event-summary` de 52 redireciona corretamente para o canonical 51.

---

### Fato 4 — A causa do bug está nas rotas `listAthletes` e `listClubs`

Código em `user.service.ts`:

```typescript
// listAthletes (linha 1573)
const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
if (eligibleClubIds.size === 0) {
  return [];
}
```

`getStateCircuitEligibleClubIds()` retorna apenas clubes que têm atletas em eventos com `nivel IN ('ESTADUAL', 'OPEN')`.

**Verificado em produção:** todos os 12 clubes participantes do evento 51/52/53 são elegíveis. O filtro não está causando retorno vazio.

A segunda questão: **as URLs da CBTM que os atletas reportam apontam diretamente para os eventos secundários** (cbtmEventId 5688 ou 5691). No nosso sistema, a rota `/events/52/athletes` resolve o scope para `[51, 52, 53]` e deveria retornar atletas.

**Verificado:** a query de `listAthletes` filtra por `eventId: { in: scope.allEventIds }` — portanto ao acessar o evento 52, scope inclui [51, 52, 53] e retorna atletas de todos eles. **Isso não produz lista vazia para atletas individuais.**

---

### Fato 5 — O bug real: página de detalhe do evento aponta para `/events/51` mas os links oficiais apontam para 5688 ou 5691

O frontend usa o campo `id` retornado pela API (que é o `id` interno do banco, não o `cbtmEventId`). A lista de eventos retorna apenas os primários (eventos secundários são ocultados pelo filtro `hiddenSecondaryIds`). Logo:

- Na lista de eventos: só aparece o evento 51 (3TMB26 - Mestre Bianor Coelho)
- O site nunca exibe links para eventos 52 e 53 diretamente
- As URLs oficiais da CBTM apontam para as páginas desses eventos com seus próprios IDs
- Se um atleta navegar para `/events/52` ou `/events/53` diretamente no nosso site, o sistema resolve para o canonical 51 e retorna dados do evento principal

**A questão real levantada pelos atletas**: os links que eles têm são as URLs do site da CBTM (ex: `sistemaresultados.cbtm.org.br/evento/5688` ou similar), e nosso site não tem uma rota pública que corresponda a esses IDs da CBTM.

[PENDENTE: Quais são exatamente as URLs oficiais que os atletas estão reportando como problema? São URLs do próprio site pingpong ou da CBTM?]

---

### Fato 6 — `situacaoComputada` dos eventos pode estar incorreta para os secundários

Todos os três eventos têm:
- `concluido = false`
- `fim_inscricoes = 2026-06-06` (já passou)
- `inicio_realizacao = 2026-06-13` (futuro — hoje é 10/06)
- Partidas publicadas com `phase = RESULTADOS` e horários a partir de 2026-06-14

A `situacaoComputada` é computada em runtime por `computeEventSituation()`. Com `hasPublishedMatches = true` (757 partidas no evento 51) e `fimInscricoes` passado, o status provavelmente resolve para `GRADES_PUBLICADAS_PRE_JOGO` ou `POS_INSCRICOES_PRE_EVENTO`.

Isso impacta qual aba é exibida ao abrir o evento: o frontend auto-seleciona a aba "atletas" quando `situacaoComputada === 'GRADES_PUBLICADAS_PRE_JOGO'`. Se o status computado estiver incorreto, o usuário pode ver a aba errada ou dados inconsistentes.

[PENDENTE: Confirmar qual `situacaoComputada` está sendo retornada atualmente para o evento 51 via chamada real à API. Pode ser verificado pelo Codex via `curl https://api.pingpongpaidegua.com.br/events/51` ou equivalente.]

---

### Fato 7 — Partidas com horários definidos não aparecem na UI

O evento 51 tem 757 partidas com `match_datetime` preenchido (ex: `2026-06-14 21:30:00`). A página de detalhe do evento não tem uma aba de "confrontos/tabela" — só mostra atletas, clubes e eficiência. As partidas com horário só são visíveis na página do atleta individual (`/events/:id/athletes/:athleteId`).

[PENDENTE: O relato dos atletas menciona especificamente "confrontos e horários"? A ausência de uma aba de confrontos/tabela é intencional ou uma lacuna de funcionalidade?]

---

### Fato 8 — Eventos 52 e 53 têm scrapes PARTIAL, sem entrada no read_model_caches para evento 52

O scraper roda regularmente para os três eventos:
- Evento 52: 923 runs PARTIAL, último em 2026-06-10 13:33. Zero entradas em `read_model_caches`.
- Evento 53: 922 runs PARTIAL, último em 2026-06-10 13:33. Entradas existem mas com run ID stale (3339, de abril).

**Hipótese:** o worker que popula `read_model_caches` para eventos secundários pode não estar sendo disparado, ou está falhando silenciosamente sem gerar novas entradas após o scrape.

[PENDENTE: Verificar no código do worker/scheduler se o cache de read_model é gerado apenas para o evento canonical (51) ou também para os secundários (52, 53). Confirmar se há job de cache-warming para eventos merged.]

---

## Resolução das pendências (Rodadas 2 e 3)

### [RESOLVIDO A] — URLs oficiais são do site da CBTM, não do nosso site
Leo confirmou: os três links oficiais são `app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=5680/5688/5691`. O ponto de entrada do nosso site é `/events/51`. O problema relatado pelos atletas é que **a página `/events/51` não exibe os dados das categorias de duplas** (eventos 52 e 53), mesmo que o banco tenha esses dados completos.

### [RESOLVIDO B] — Cache de read_model para secundários é por design, não é bug
Codex confirmou via leitura de `read-model-prewarm.service.ts`: o prewarm chama `/events/{eventId}` e a API resolve para o canonical antes de gravar cache. Para `event-summary`, `event-efficiency` e `event-medalists`, o desenho atual popula apenas o canonical (evento 51). Evento 52 sem cache próprio é esperado. Cache stale em 53 é sobra histórica pré-merge — não impacta o fluxo atual.

**Verificado em produção:** a API retorna para `/events/51`:
```json
{
  "situacaoComputada": "POS_INSCRICOES_PRE_EVENTO",
  "groupsDefined": true,
  "totalInscritos": 259,
  "totalCategorias": 68,
  "totalPartidasPublicadas": 776,
  "associacoesAtletaCategoria": 634
}
```
O `totalCategorias: 68` já inclui as categorias dos eventos 52 e 53 (55 do evento 51 + 11 do 52 + 5 do 53 = ~68, elegíveis com cbtmCategoryId não nulo). O aggregate está correto. O problema é de exibição.

### [RESOLVIDO C] — Categorias de duplas não são exibidas de forma navegável na página canonical
Codex confirmou: a API suporta corretamente os sufixos (`ABSOLUTO A MAS - DUPLAS`) em `listCategories`, e há teste cobrindo esse comportamento. Porém **a página do evento não chama `apiGetCategories()`** — categorias só aparecem na aba "Eficiência → Medalhistas por categoria". O fluxo atual em `POS_INSCRICOES_PRE_EVENTO` com `groupsDefined: true` redireciona o usuário direto para a aba "Atletas" — onde os pares de duplas são **excluídos pelo filtro `not contains '#'`**.

Verificado em produção:
- 316 atletas/pares no scope [51,52,53]
- **71 pares de duplas** com `nameDisplay LIKE '%#%'` → todos excluídos da aba "Atletas"
- 245 atletas individuais → aparecem normalmente

### [RESOLVIDO D — parcial] — Confrontos/horários: funcionalidade ausente (não é bug de exibição)
O banco tem 776 partidas com `match_datetime` preenchido (horários a partir de 2026-06-14). A página do evento não tem aba de confrontos — partidas só são vistas no detalhe individual do atleta. Isso é lacuna de funcionalidade, não bug. **Decisão sobre implementar cabe a Leo** → ver [LEO DECIDE 2].

---

## Hipótese de impacto técnico preliminar

Dependendo das respostas às pendências acima, as correções podem envolver:

1. **Se o problema é exibição de categorias de duplas na página do evento canonical:**
   - Arquivo: `apps/api/src/user/user.service.ts` → `listCategories()` já inclui categorias com sufixo — verificar se o frontend está exibindo essas categorias em algum contexto
   - Arquivo: `apps/web/app/user/events/[id]/page.tsx` → página não lista categorias explicitamente, só atletas e clubes

2. **Se o problema é que atletas acessam `/events/52` e não veem os dados corretos:**
   - Investigar se `resolveEventScope(52)` retorna scope correto em todos os endpoints
   - Verificar se a API retorna dados dos atletas de duplas (nomes com `#`) — a query de `listAthletes` tem filtro `nameDisplay: { not: { contains: '#' } }` que **exclui duplas** da lista de atletas

3. **[CRÍTICO] Filtro `contains: '#'` em `listAthletes` exclui todos os atletas de duplas:**
   ```typescript
   // user.service.ts linha 1591
   nameDisplay: {
     not: {
       contains: "#",
     },
   },
   ```
   Atletas de duplas têm `nameDisplay` no formato `"NOME A # NOME B"`. Este filtro os exclui explicitamente da listagem de atletas. A aba "Atletas" do evento 52 e 53 ficará sempre vazia ou sem os pares de duplas.

4. **Se confrontos/horários são funcionalidade nova:**
   - Seria necessária nova spec para aba de confrontos com `match_datetime`

---

## Mapa de impacto técnico consolidado

### Bug confirmado — Filtro `#` em `listAthletes`, `listClubs` e `listClubAthletes`

Três ocorrências em `user.service.ts` com filtro `nameDisplay: { not: { contains: '#' } }`:

| Linha | Método | Efeito |
|-------|--------|--------|
| ~1591 | `listAthletes` | Exclui pares da aba "Atletas" do evento |
| ~1708 | `listClubs` (contagem de atletas por clube) | Contagem de atletas por clube ignora pares |
| ~3583 | `listClubAthletes` | Expansão "ver atletas do clube" não mostra pares |

O filtro faz sentido para o **diretório global de atletas** (evitar duplicar no carrossel cada membro de par já listado individualmente), mas **não faz sentido para a listagem contextual de um evento que é de duplas**.

### Lacuna de funcionalidade — Sem aba de confrontos

Existe dados suficientes no banco:
- 776 partidas com `phase = RESULTADOS`, `match_datetime`, `table_number`, `round` preenchidos
- Participantes identificáveis via `match_participants` + `athletes`
- Merge de categorias dos três eventos funcionando corretamente na API

A exibição de confrontos por categoria/rodada na página do evento é funcionalidade não implementada.

### Fora de escopo confirmado

- Cache de read_model para eventos secundários: por design, não é bug
- Dados de scraping: completos nos três eventos, não há lacuna de dados
- Filtro de elegibilidade estadual: todos os 12 clubes participantes são elegíveis

---

## Rascunho de Spec — escopo após [LEO DECIDE]

### Item 1 — Corrigido (depende de [LEO DECIDE 1])

**Se Leo escolher opção A ou B:**

Remover/condicionar o filtro `not contains '#'` nos métodos de listagem de evento:
- `listAthletes` — exibir pares de duplas com nome formatado (`SILVA A / SILVA B` ou como Leo decidir)
- `listClubs` — contagem de atletas por clube deve incluir ou excluir pares (decisão: contar par como 1 entrada ou 2?)
- `listClubAthletes` — expansão de clube deve mostrar os pares inscritos nas categorias de duplas

Arquivos impactados:
- `apps/api/src/user/user.service.ts` — métodos `listAthletes`, `listClubs`, `listClubAthletes`
- `apps/web/app/user/events/[id]/page.tsx` — renderização do nome do par na aba "Atletas" e "Clubes"

### Item 2 — Aba de Confrontos (depende de [LEO DECIDE 2])

**Se Leo escolher opção A:**

Nova aba "Confrontos" na página do evento exibindo partidas agendadas:
- Endpoint novo ou reuso de dado existente (partidas já estão no banco)
- Agrupamento por categoria/rodada ou cronológico por horário
- Campos: horário, mesa, categoria, fase, atletas/pares, placar (se disponível)

Arquivos impactados:
- `apps/api/src/user/user.controller.ts` — nova rota `GET /events/:id/schedule`
- `apps/api/src/user/user.service.ts` — novo método `listEventSchedule`
- `apps/web/app/user/events/[id]/page.tsx` — nova aba "Confrontos"
- `apps/web/lib/user-api.ts` — nova função `apiGetEventSchedule`

---

*Gerado por: Claude — Rodada 3 do ciclo tripartite PP-005*  
*Próxima ação: Leo decide os itens [LEO DECIDE 1] e [LEO DECIDE 2] → Claude converte draft em Spec formal*
