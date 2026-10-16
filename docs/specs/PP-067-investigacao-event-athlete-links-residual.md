## HISTÓRICO — informações adicionais (consulta, não instrução)

### Análise — Rodada 1 (2026-09-22) — Claude

## Origem
Bloqueio encontrado durante a auditoria PP-063 (`docs/specs/PP-063-auditoria-eficiencia-4tmb26.md`, Rodada
5): scrape forçado no worker local (`cbtm_homolog`, evento 59) — run **14846** terminou em `ERROR` por
colisão na constraint única `(event_id, athlete_id)` de `event_athlete_links`, mesmo sintoma documentado em
PP-056. Leo decidiu (2026-09-22) investigar a causa raiz antes de retomar PP-063.

## Achado confirmado — o fix da PP-056 v2 está presente e mesmo assim o erro recorreu
Leitura direta de `apps/worker/src/pipeline/upsert.service.ts:1960-2042`
(`syncStableEventAthleteLinks`) e `prisma/schema.prisma:169-186` (`model EventAthleteLink`):

- Constraints: `@@unique([eventId, athleteKey])` **e** `@@unique([eventId, athleteId])` (schema.prisma:181-182)
  — duas constraints únicas independentes na mesma tabela, cada uma podendo ser violada por um caminho
  de código diferente.
- Fluxo atual (linhas 2000-2040), por atleta do evento:
  1. `findUnique` por `(eventId, athleteId)` (2000-2008) — busca se **esse athleteId** já tem link no evento.
  2. Se existe e a `athleteKey` mudou: `update` por `id` da linha existente (2014-2020) — **este é o fix
     da PP-056**, evita `create` duplicado quando `clubs.normalized_name` muda.
  3. Senão (não existe link para esse athleteId, **ou** a key não mudou): `upsert` por
     `(eventId, athleteKey)` (2022-2039).

## Hipótese de causa raiz (não confirmada — requer evidência dinâmica)
O fix da PP-056 cobre o caso "athleteId já tem link, key mudou". **Não cobre** o caso inverso: um
`athleteId` **sem** link ainda neste evento (passo 1 não encontra nada → `existingLinkForAthlete` é
`null`), mas a `athleteKey` calculada para ele **já está associada a outro `athleteId`** (ex.: dois
atletas diferentes normalizando para a mesma chave — o próprio código já detecta e loga esse caso como
`duplicateOwner`, linhas 1991-1996, mas só como *warning*, sem tratamento). Nesse cenário, o `upsert` do
passo 3 (`where: eventId_athleteKey`) cairia no branch `update`, tentando trocar o `athleteId` da linha
existente — o que pode colidir com `(eventId, athleteId)` se esse novo `athleteId` também já tiver uma
linha própria sob outra key.

**Esta é uma hipótese de leitura estática — não foi confirmada contra o erro real do run 14846.** Não
declarar como causa raiz até:
1. Ler `scrape_runs.error_message` do run 14846 (mensagem completa do Prisma, similar ao que a PP-056
   coletou para os runs anteriores — ver PP-056 linhas 50-55).
2. Identificar os `athleteId`/`athleteKey` envolvidos na colisão específica desse run.
3. Confirmar se o padrão bate com a hipótese acima (colisão de key entre dois atletas com link
   preexistente cruzado) ou é outra causa ainda não mapeada.

## Ambiguidades / próximos passos
**[PENDENTE-1]** Preciso do `error_message` completo do run 14846 (`scrape_runs` em `cbtm_homolog`) para
confirmar qual constraint foi violada de fato e com quais valores — Codex tem acesso à leitura desse dado
via ambiente Docker local, este chat não.

**[PENDENTE-2]** Se a hipótese acima se confirmar, a correção depende de decisão de produto/dados: quando
dois atletas colidem na mesma `athleteKey` (hoje só gera warning), qual dos dois deve "vencer" o link? Ou
o link deveria virar não-único por key nesse caso? Este é um `[LEO DECIDE]` em potencial, não uma decisão
técnica pura.

**[PENDENTE-3]** Escopo desta investigação: é sessão de análise (Claude entrega causa raiz + estratégia,
Codex não implementa ainda) — aguardando decisão de Leo sobre abrir Spec de correção após causa raiz
confirmada, seguindo o fluxo SDD+TDD padrão (não fast track, dado que já houve um fix anterior no mesmo
ponto que não cobriu o caso).

## Fora de escopo desta análise
- Retomar a auditoria PP-063 — está pausada até esta investigação concluir.
- Qualquer alteração de código nesta rodada — é investigação, não implementação.

## Relação com outras frentes abertas (verificada por leitura, 2026-09-22)

Leo perguntou se este achado se relaciona com quatro frentes já registradas: PEND-CBTM-002, PP-066, PP-065,
PP-064. Checagem por leitura direta:

- **PEND-CBTM-002 (CSP `unsafe-inline`)** — sem relação. Domínio frontend/segurança, não toca
  `event_athlete_links` nem pipeline do worker.
- **PP-066 (duplicação de `Match` em fase ELIMINATORIA, "Open Bosque")** — sem relação estrutural. Trata
  dado legado de `Match`/fase eliminatória; não toca `EventAthleteLink` nem a constraint
  `(eventId, athleteId)`. Domínios de tabela diferentes.
- **PP-065 (identidade canônica de atleta cross-evento)** — **relação conceitual, não estrutural.** Lido
  `docs/specs/PP-065-identidade-canonica-atleta.md`: PP-065 trata resolução de identidade de atleta
  **entre eventos diferentes** (mesmo `Athlete` humano aparecendo em dois `Event` distintos), propondo
  nova tabela (`AthleteIdentity`) com trilha de resolução auditável, no mesmo padrão de
  `AthleteMatchConflict`. O achado desta investigação (PP-067) é sobre colisão de `athleteKey` **dentro do
  mesmo evento**, na tabela `EventAthleteLink` já existente — quando dois atletas diferentes normalizam
  para a mesma chave, o código hoje só emite *warning* (`duplicateOwner`, `upsert.service.ts:1991-1996`),
  sem resolução nem trilha auditável. É o **mesmo tipo de lacuna arquitetural** (chave textual best-effort
  colidindo sem conflito auditável formal) que motivou PP-065, mas em escopo/tabela diferente
  (cross-evento vs. intra-evento). Não é a mesma Spec, mas é o mesmo padrão de risco já mapeado por Leo —
  vale citar PP-065 como precedente de solução (padrão `AthleteMatchConflict`) quando a causa raiz deste
  PP-067 for confirmada e uma Spec de correção for aberta.
- **PP-064 (favoritos + push, pausado aguardando PP-065/PP-066)** — sem relação direta com o bug de
  scrape; PP-064 está pausado por depender de PP-065 (identidade estável), não de PP-067.

**Conclusão**: nenhuma das quatro frentes bloqueia ou é bloqueada por PP-067. A única relação é de
padrão/precedente com PP-065 (mesma classe de problema: colisão de chave textual sem resolução auditável),
não de dependência de execução. Não altera a ordem nem o escopo definido para nenhuma das cinco frentes.

## Causa raiz confirmada (2026-09-22) — CAUSA REAL, não a hipótese original

**A hipótese de "caso residual não coberto pelo fix da PP-056" (seção acima) estava ERRADA.** Causa real:
**a imagem Docker `appcbtmeventos-worker` local está desatualizada** e nunca rebuildou após o commit do fix
da PP-056.

Evidência coletada e verificada por leitura própria nesta rodada:
1. Codex trouxe `scrape_runs.error_message` completo do run 14846: o stack trace aponta para
   `/workspace/apps/worker/dist/pipeline/upsert.service.js:1513:37`, chamando `eventAthleteLinks.upsert()`
   **diretamente**, sem o `findUnique`/`update` por `(eventId, athleteId)` que o código-fonte
   (`upsert.service.ts:2000-2020`) tem hoje.
2. Confirmado por `docker exec appcbtmeventos-worker-1` + leitura do arquivo `dist/pipeline/upsert.service.js`
   dentro do container: **não há `findUnique` antes da chamada `upsert` na linha 1513** — o binário rodando
   é uma versão anterior ao fix.
3. Confirmado por `docker images` + `git log`: a imagem `appcbtmeventos-worker:latest` foi buildada em
   **2026-09-18 12:26:07 -03**; o último commit tocando `apps/worker/src/pipeline/upsert.service.ts`
   (`74e8473`, o fix da PP-056/PP-062) é de **2026-09-19 01:06:52 -03** — **posterior ao build da imagem**.
   O `dist/upsert.service.js` no container tem timestamp de arquivo `Sep 18 15:26`, consistente.

**Conclusão**: o run 14846 nunca testou o fix da PP-056. Não há caso residual arquitetural confirmado — a
hipótese de "colisão de key entre dois atletas com link cruzado" (seção "Hipótese de causa raiz" acima)
permanece **não confirmada e não descartada**, mas não é mais a explicação necessária: a causa suficiente
e comprovada é a imagem desatualizada.

Achado adicional do Codex, também relevante: existem 60 atletas no evento 59 com `EventAthleteLink.athleteKey`
gravada divergente da chave calculada hoje (ex. `athleteId 6799`: gravada
`"danilo cardoso menezes|academia ping drive ltda - pa"` vs. calculada hoje
`"danilo cardoso menezes|academia ping drive ltda"` — sufixo "- pa" residual, mesma classe de causa da
PP-056: `clubs.normalized_name` mudou depois que o link foi criado). Nenhum desses 60 casos colide hoje com
outra `athleteKey` existente (verificado pelo Codex) — ou seja, são exatamente o cenário que o fix da
PP-056 resolve quando o binário atualizado rodar; não é o caso residual hipotético da seção anterior.

## Ação corretiva (não é código — é operacional)

Isto não requer nova Spec de correção de código. Requer **rebuild da imagem Docker local do worker** antes
de qualquer novo scrape-now:
```
docker compose build worker
docker compose up -d worker
```
Depois disso, repetir o scrape-now do evento 59 (retomando o passo pausado da PP-063) para confirmar que
os 60 casos de `athleteKey` desatualizada são corrigidos via `update` (branch do fix) em vez de colidir.

## Status desta investigação

**Encerrada — causa raiz identificada e não é um bug de código novo.** Retomar PP-063 após o rebuild da
imagem Docker local e confirmação de um `ScrapeRun` `SUCCESS`/`PARTIAL` para o evento 59 pós-rebuild.
