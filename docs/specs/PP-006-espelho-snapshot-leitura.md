# PP-006 — Espelho estável de leitura com publicação comparativa de snapshots

> **Origem:** ciclo tripartite — `docs/specs/PP-006-draft.md` (histórico de decisões D1–D4 e riscos R1–R5).
> **Aprovação Leo:** ✅ 2026-06-12 (sessão PP-006, mensagem "aprov" após self-review apresentado).

---

## Objetivo

1. O usuário da página pública de evento nunca vê o estado intermediário de um scrape em
   andamento ("zera e sobe tudo"): durante o run N+1, todas as abas servem o espelho estável N.
2. Um run instável/degradado (falha intermitente nos links oficiais da CBTM) **não regride** o
   que o usuário vê: a publicação do espelho N+1 é comparativa — adota progressões (placares
   novos, adversários definidos onde havia placeholder), preserva o que regrediu e só substitui
   integralmente quando o novo snapshot é igual ou melhor.

## Contexto

- O upsert do worker muta tabelas-base destrutivamente fora de transação
  (`upsert.service.ts` — deletes de matches/participants/athletes ao longo de minutos).
- Endpoints públicos coexistem em dois regimes: com `ReadModelCache`
  (`event-summary-v12`, `event-efficiency-v4`, `event-medalists-v2`, `athlete-summary`) e
  leitura ao vivo (`listAthletes`, `listClubs`, `listCategories`, `listEventSchedule`,
  `listClubAthletes`).
- O cache é invalidado quando um run novo termina (`sourceScrapeRunId` difere) ou quando a
  janela dinâmica expira (`isReadCacheFresh`) — inclusive no meio de um run.
- `getLatestReliableScrapeRunIdForScope` (`user.service.ts:6350-6367`) considera `PARTIAL`
  confiável — run degradado invalida cache saudável.
- O frontend usa `event.lastScrapeAt` como badge **e** como gatilho de reload das abas
  (`apps/web/app/user/events/[id]/page.tsx:276,287,298,524`).

## Causa raiz

- **Imediata:** camada de leitura exposta ao estado intermediário do banco durante o run
  (endpoints ao vivo + recompute de cache mid-run) e swap de cache incondicional ao fim do run,
  mesmo quando o run novo é pior que o anterior.
- **Sistêmica:** a fronteira scrape→publicação prevista no design original
  (`EventSyncState`/`EventSyncRun`, mortos no schema) nunca foi implementada; o
  `ReadModelCache` nasceu como otimização de performance, não como fronteira de consistência.
- **Padrão prévio:** classes EPISODIC_MEMORY — nenhuma registrada; domínio
  "Dupla verificação BullMQ + Prisma" sem histórico (atenção elevada declarada na abertura).

---

## Arquitetura da solução (Opção B do draft, com D3 de Leo)

```
[worker: scrape run N+1]──muta tabelas-base (inalterado)
        │ (fim do run, lock liberado)
        ▼
[worker: job refresh-read-model-cache]──HTTP──▶ [API: compute candidato N+1 por kind]
                                                       │
                                                       ▼
                                   [API: COMPARADOR espelho N vs candidato N+1]
                                   adota progressão / preserva regressão / decide N|N+1|merge
                                                       │
                                                       ▼
                                          [ReadModelCache = espelho publicado]
                                                       ▲
[usuário]──▶ [API: serving] ── run ativo? ── sim ──────┘  (serve espelho, nunca recomputa)
                                └─ não → fluxo de freshness atual (compute passa pelo comparador)
```

---

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### C1 — Espelho estável durante run
DADO um evento com espelho publicado N e um scrape run N+1 em andamento (lock ativo)
QUANDO o usuário acessa qualquer aba pública (resumo, atletas, clubes, categorias, agenda, atletas do clube, eficiência, medalhistas, resumo de atleta)
ENTÃO a API serve o espelho N integral, sem executar nenhuma query sobre as tabelas-base do evento, e o badge "Última atualização" continua exibindo o `publishedAt` de N.

### C2 — Publicação com progressão
DADO espelho N com partida `matchKey=X` sem placar e candidato N+1 com placar preenchido em X
QUANDO o prewarm publica
ENTÃO o espelho passa a exibir o placar de X e `publishedAt` avança.

### C3 — Publicação com regressão pontual (link instável)
DADO espelho N com 50 partidas na categoria C e candidato N+1 com 30 (20 sumiram por captura degradada), sendo 5 das 30 com placares novos
QUANDO o prewarm publica
ENTÃO o espelho resultante combina: mantém as 20 partidas preservadas de N (com proveniência), adota os 5 placares novos, e a decisão `merge` fica registrada.

### C4 — Regressão de conteúdo dentro do item
DADO partida com adversários definidos em N e o mesmo `matchKey` com placeholder (`V1`, `VENCEDOR DE GRUPO A`) em N+1, ou placar presente em N e ausente em N+1
QUANDO o comparador avalia
ENTÃO o conteúdo de N prevalece para aquele item.

### C5 — Run manual força substituição
DADO scrape disparado com `scrape-now-force*` (qualquer stage)
QUANDO o prewarm decorrente publica
ENTÃO o candidato N+1 substitui o espelho integralmente (modo `replace`, sem merge) — válvula de escape do admin para remoções legítimas.

### C6 — stage-1-reset
DADO reset manual stage-1
QUANDO o reset conclui
ENTÃO o espelho do evento é invalidado (linhas do `ReadModelCache` do evento removidas) e as abas servem shape vazio com `_meta.building` no summary até o próximo run publicar.

### C7 — Evento sem espelho (primeiro run)
DADO evento novo em primeiro scrape (run ativo, nenhum espelho)
QUANDO o usuário acessa a página
ENTÃO listas retornam vazias shape-compatible e o summary retorna `_meta.building: true`; o frontend exibe estado "dados sendo preparados" (sem parecer evento vazio).

### C8 — Lock vazado não congela o site
DADO `scrapeLockedAt` mais antigo que a janela de `resolveScrapeLockStaleMsFromEnv`
QUANDO o usuário acessa
ENTÃO a API trata como "sem run ativo" (fluxo de freshness atual).

### C9 — Paridade de busca/paginação
DADO snapshot de atletas cacheado
QUANDO o usuário busca/pagina (`search`, `page`, `pageSize`)
ENTÃO o resultado é idêntico ao da query ao vivo equivalente (mesma ordenação, mesmos `routeId`).

## Critérios de aceitação

1. Durante run ativo (lock dentro da janela de stale), nenhum endpoint público do evento executa query sobre `athletes`/`categories`/`matches`/`match_participants`; serve espelho ou shape building. Verificável por teste com spy/contagem de queries.
2. Endpoints migrados (`listAthletes`, `listClubs`, `listCategories`, `listEventSchedule`, `listClubAthletes`) servem de snapshots versionados por kind (R4) com payload autossuficiente: filtros, contagens e `routeId` reproduzíveis sem tabelas-base (B2). `ensureStableAthleteRouteIds` roda na construção do snapshot, nunca no request durante run.
3. Snapshots sempre na chave canônica (`scope.canonicalEventId`), inclusive quando o gatilho vem de evento filho (R2).
4. Comparador publica por kind com decisão registrada (`published_n1` | `kept_n` | `merged`) em `_meta.publishDecision` do payload e em log estruturado; partidas preservadas carregam proveniência (`preservedFromPublishedAt` ou equivalente).
5. Regras do comparador: (a) agenda/partidas — merge por `matchKey` com progressão adotada e regressão preservada (C2–C4); (b) listas (atletas/clubes/categorias) — all-or-nothing: queda além de limiar (reutilizar os limiares do regression guardrail: atletas <0.7 com base ≥100; categorias <0.75 com base ≥30; partidas <0.55 com base ≥200) mantém N integral, senão publica N+1; (c) summary/eficiência/medalhistas — all-or-nothing pela mesma sinalização de regressão do escopo.
6. Modo `replace` bypassa o comparador quando o scrape de origem foi `scrape-now-force*`; o prewarm propaga o modo (header ou parâmetro) a partir do `reason` do job.
7. `publishedAt` exposto no payload do summary; avança somente quando o espelho publicado muda (decisões `published_n1`/`merged`). Frontend usa `publishedAt` no badge e nas deps de reload (B7) — `lastScrapeAt` deixa de disparar refetch.
8. Auditoria de scrape em `extractionStats` permanece observabilidade (D1); a decisão de publicação vive na camada do espelho e não bloqueia o run.
9. Suite raiz verde + builds api/web verdes + hook ativo (DoD do projeto).

## Fora de escopo

- `group-simulation` (D2 — entrega posterior; aba continua leitura ao vivo).
- Tornar o upsert atômico ou alterar `upsert.service.ts`.
- `EventSyncState`/`EventSyncRun` — intocados (D4).
- Prewarm de 100% dos atletas (`readModelPrewarmAthleteLimit` = 120 permanece; atletas sem cache servem `_meta.building` durante run — B6).
- Latência HTTP/CDN de 20–45s no swap visível (`@PublicCacheTtl`) — expectativa aceita (R5).
- Diretório global de atletas, carreira, eficiência global (não são por evento).

---

## Impacto técnico

### Arquivos a criar
- `apps/api/src/user/read-model-mirror.ts` (ou módulo equivalente no mesmo diretório) — comparador puro por kind + tipos de decisão de publicação. Função pura, testável por unidade, sem Prisma. A detecção de placeholder reusa a semântica já existente em `isResolvedSchedulePlayer` (`user.service.ts:2216-2225` — `id === null` + `/^V\d+/` + `VENCEDOR `), extraída para função compartilhada em vez de duplicada.
- `apps/api/test/user-service.mirror-serving.test.ts` — T-U-01..04, T-I-01.
- `apps/api/test/read-model-mirror.comparator.test.ts` — T-U-08..13.
- `apps/api/test/user-service.snapshot-selectors.test.ts` — T-U-05..07.
- `apps/web/tests/event-published-at.test.tsx` — T-C-01..02.

### Arquivos a modificar
- `apps/api/src/user/user.service.ts`:
  - `resolveEventReadModelCache` (linha ~6191): injetar detecção de run ativo no escopo (eventos do `scope` com `scrapeLockedAt` dentro da janela `resolveScrapeLockStaleMsFromEnv` de `@cbtm/shared` — mesmo padrão de `admin-events.service.ts:50`). Run ativo: retorna cache (ignorando freshness e `sourceScrapeRunId`) ou shape building; nunca chama `compute`.
  - `persistReadModelCachePayload` (linha ~6300): passar pelo comparador antes do upsert; aceitar modo `replace|compare`.
  - `listAthletes` (1569), `listClubs` (1643), `listCategories` (1740), `listEventSchedule` (2131), `listClubAthletes` (3681): dividir em builder de snapshot (compute completo por evento, kinds `event-athletes-v1`, `event-clubs-v1`, `event-categories-v1`, `event-schedule-v1`) + selector em memória (search/paginação/filtro `categoryId`). `listClubAthletes` é servido do snapshot `event-clubs-v1`, que embute por clube as entradas de atleta com `{id, eventId, nameDisplay, nameNormalized, stateCode, region, categorias: [{id, nome mapeado com sufixo de filho}]}` — suficiente para contagem distinct por `nameNormalized`, filtro por `categoryId` e dedupe atual (`user.service.ts:3761-3790`). A semântica de `NotFoundException` (clube fora do evento/elegibilidade, categoria fora do evento) é preservada pelo selector.
  - `getEventSummary` (1495): incluir `publishedAt` no payload publicado.
- `apps/worker/src/main.ts` (~250-280): job de prewarm propaga modo de publicação derivado do `reason` do scrape de origem (`scrape-now-force*` → `replace`); stage-1 já pula prewarm — adicionar invalidação do espelho no fluxo de stage-1 (C6).
- `apps/worker/src/pipeline/read-model-prewarm.service.ts`: aquecer os novos kinds (athletes, clubs, categories, schedule) além dos atuais; enviar modo de publicação; garantir chave canônica quando `eventId` for filho.
- `apps/worker/src/pipeline/scrape.processor.ts`: (a) expor o `reason` ao prewarm; (b) stage-1-reset: `clearEventData` passa a deletar também as linhas de `read_model_caches` do evento — verificado na Rodada de spec que o worker hoje não toca `readModelCache` e o `onDelete: Cascade` do schema só dispara na deleção do próprio `Event`, que o stage-1 não faz.
- `apps/web/app/user/events/[id]/page.tsx`: badge (524) e deps de reload (276/287/298) passam de `lastScrapeAt` para `publishedAt`; tratamento visual de `_meta.building` no summary.
- `apps/web/lib/user-api.ts`: tipos `publishedAt`, `_meta.building`, `_meta.publishDecision`.

### Arquivos que NÃO devem ser tocados
- `apps/worker/src/pipeline/upsert.service.ts` — fora de escopo; risco sem ganho.
- `apps/worker/src/scraper/*` — captura inalterada.
- `prisma/schema.prisma` — sem DDL; `ReadModelCache` já suporta (payload Json + `sourceScrapeRunId`).
- `apps/api/src/user/user.controller.ts` — contratos de rota inalterados (somente payloads aditivos).
- Lógica do diretório global de atletas (`listAthleteDirectory`) — DEC-CBTM-004.

### DDL / Contrato / Dependências
- DDL: nenhuma. Contrato de API: aditivo (`publishedAt`, `_meta.*`). Dependências novas: nenhuma (Q7).

---

## Plano de testes

### Cobertura geral
- Camadas: unitário (comparador, serving, selectors) + integração (endpoints com Prisma mockado/in-memory no padrão dos testes existentes em `apps/api/test/`) + componente web.
- Arquivos: listados em "Arquivos a criar".
- Fixtures: snapshots N/N+1 sintéticos por kind; evento com lock ativo/vazado; payload com placeholders (`V1`, `VENCEDOR DE GRUPO A`, `V1 - Silva B` — reusar padrões do hotfix PR #10).
- Categorias não aplicáveis: Formulário/Upload/Auth [não aplicável — endpoints públicos read-only sem input persistido]; Integração externa coberta indiretamente (degradação simulada via candidato N+1 incompleto).

### T-U-01 — Serving com run ativo e espelho existente
DADO evento com `scrapeLockedAt` recente e cache com `sourceScrapeRunId` antigo e `updatedAt` expirado
QUANDO endpoint cacheado é chamado
ENTÃO retorna payload do cache; `compute` não executa (spy = 0 chamadas).

### T-U-02 — Serving com run ativo sem espelho
DADO evento com lock ativo e nenhuma linha de cache
QUANDO summary e uma lista são chamados
ENTÃO summary retorna `_meta.building: true` shape-compatible; lista retorna `[]`; `compute` não executa.

### T-U-03 — Lock vazado
DADO `scrapeLockedAt` além de `resolveScrapeLockStaleMsFromEnv`
QUANDO endpoint é chamado
ENTÃO segue fluxo atual (compute permitido). Dois inputs: lock 1ms dentro e 1ms fora da janela.

### T-U-04 — Sem run ativo, fluxo atual preservado
DADO evento sem lock e cache fresco com run vigente
QUANDO endpoint é chamado
ENTÃO retorna cache sem compute (regressão do comportamento existente — proteção do `event-summary-cache.test.ts` atual permanece verde).

### T-U-05 — Selector de atletas: paridade busca/paginação
DADO snapshot `event-athletes-v1` com ≥3 páginas e nomes acentuados
QUANDO `search`/`page`/`pageSize` variam (≥3 combinações, incluindo busca sem resultado e última página)
ENTÃO resultado idêntico ao da query ao vivo equivalente (ordenação `nameDisplay asc`, `routeId` estável).

### T-U-06 — Selector de clubes com filtro de categoria
DADO snapshot `event-clubs-v1` com atleta em 2 categorias
QUANDO filtra por `categoryId` e sem filtro
ENTÃO contagens distinct por `nameNormalized` corretas nos dois casos (atleta multi-categoria conta 1×).

### T-U-07 — Atletas do clube a partir do snapshot
DADO snapshot `event-clubs-v1`
QUANDO `listClubAthletes` com e sem `categoryId`, com clube inexistente no evento e com categoria de outro evento
ENTÃO paridade com a query ao vivo nos casos válidos e `NotFoundException` (404) preservada nos inválidos.

### T-U-08 — Comparador: progressão de placar
DADO N sem placar em `matchKey=X`, N+1 com placar
QUANDO compara
ENTÃO N+1 adotado para X; decisão `published_n1` (se sem outras divergências).

### T-U-09 — Comparador: partida sumiu
DADO N com partidas {X,Y,Z}, N+1 com {X,Y} (Z ausente) e placar novo em X
QUANDO compara
ENTÃO resultado contém {X com placar novo, Y, Z preservada com proveniência}; decisão `merged`.

### T-U-10 — Comparador: conteúdo regrediu dentro do item
DADO N com adversários definidos e placar em X; N+1 com placeholder (`V1`, `VENCEDOR DE GRUPO A`) e/ou sem placar em X
QUANDO compara
ENTÃO conteúdo de N prevalece em X. Inputs: placeholder de vitória, de grupo e composto (`V1 - Silva B`).

### T-U-11 — Comparador: all-or-nothing das listas
DADO snapshot de atletas N com 150 itens
QUANDO N+1 tem 90 (queda 0.6 < 0.7) e, em segundo caso, 140 (0.93)
ENTÃO primeiro caso mantém N (`kept_n`); segundo publica N+1.

### T-U-12 — Modo replace
DADO regressões em todos os kinds
QUANDO publica em modo `replace`
ENTÃO N+1 substitui integralmente; decisão registrada como replace.

### T-U-13 — publishedAt
DADO decisões `kept_n`, `published_n1` e `merged`
QUANDO publica
ENTÃO `publishedAt` avança somente em `published_n1` e `merged`.

### T-I-01 — Espelho íntegro durante mutação simulada
DADO espelho publicado N; tabelas-base então mutadas simulando meio-de-run (partidas deletadas) com lock ativo
QUANDO todos os endpoints migrados são chamados
ENTÃO respostas idênticas ao espelho N (deep-equal).

### T-I-02 — Ciclo publicação pós-run
DADO run finalizado e lock liberado
QUANDO prewarm executa
ENTÃO novos kinds materializados na chave canônica; decisão de publicação logada; chamada com eventId de filho aquece a chave do canonical (R2).

### T-I-03 — stage-1-reset invalida espelho
DADO evento com espelho publicado
QUANDO stage-1-reset executa
ENTÃO linhas do `ReadModelCache` do evento removidas; chamada seguinte retorna building (C6).

### T-C-01 — Badge e gatilho de reload por publishedAt
DADO summary com `publishedAt` fixo e `lastScrapeAt` mudando
QUANDO o componente re-renderiza
ENTÃO badge mostra `publishedAt` e o refetch das abas NÃO dispara; mudando `publishedAt`, dispara.

### T-C-02 — Estado building
DADO summary com `_meta.building: true`
QUANDO a página renderiza
ENTÃO exibe estado "preparando dados" e não os zeros/contadores como se fosse evento vazio.

### Cobertura de falhas silenciosas
- Publicação verifica estado persistido: T-I-02 lê `ReadModelCache` após publicar (não confia em HTTP 200 do prewarm).
- Serving verifica ausência de efeito: T-U-01/02 confirmam zero chamadas a `compute`/tabelas-base.
- UI verifica efeito real: T-C-01 assere o refetch (handler) e não apenas a renderização do badge.

### Comando para rodar a suite
```
npm test                      # raiz: parser + shared + api + worker
npm --prefix apps/web test    # web (tsx --test tests/**/*.test.tsx)
npm run build --workspace apps-api && npm run build --workspace apps-web
```

### Ordem de implementação (Red-Green-Refactor por T-*, commits separados)
Fase 1 (espelho estável): T-U-01 → T-U-02 → T-U-03 → T-U-04 → T-U-05 → T-U-06 → T-U-07 → T-I-01.
Fase 2 (publicação comparativa): T-U-08 → T-U-09 → T-U-10 → T-U-11 → T-U-12 → T-U-13 → T-I-02 → T-I-03.
Fase 3 (web): T-C-01 → T-C-02.
A Fase 1 já elimina o sintoma "zera e sobe"; a Fase 2 elimina a regressão por run instável. Corte de escopo em emergência = fechar Fase 1+3 e entregar Fase 2 em PR subsequente — somente com autorização explícita de Leo.
