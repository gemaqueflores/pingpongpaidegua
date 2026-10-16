## Rascunho — PP-054 — jogo reagendado publica versões antigas no /schedule

**Fechamento do ciclo tripartite: ✅ aprovado por Leo em 2026-09-18.** Saneamento retroativo do evento 59
confirmado como Spec separada PP-055, dependente de autorização explícita para execução em produção,
executada logo após a PP-054 (código) estar mergeada. Draft abaixo vira Spec ativa em PP-054 e PP-055.

### Contexto / evidência
Bug reportado pelo usuário no evento 59: atleta ANDREZA MOTA aparecia com Mesa 17/18:30 e Mesa 19/19:30
no app, enquanto o site oficial CBTM já mostrava Mesa 17/11:30 e Mesa 19/13:30 (jogo reagendado). Investigação
read-only em produção (Codex via ssh-oracle, `docs/sessions/2026-09-18-investigacao-horarios-evento59.md`)
confirmou por evidência dinâmica:

- HTML bruto (`raw_captures`) mostra o mesmo "Jogo 002" mudando de mesa/hora entre capturas sucessivas
  (16/09: Mesa 17-18:30 → 17/09: Mesa 6-15:00 → 18/09: Mesa 17-11:30).
- O banco (`matches`) preservou as 3 versões como linhas distintas — nenhuma foi substituída.
- O read-model `event-schedule-v1|event:59` publica as 3 versões juntas; o app exibe as mais antigas por
  estarem antes na ordenação por horário/id.
- Nenhum warning `merge-warning: datetime divergente` foi emitido — confirma que a causa **não** é
  `match-merge.ts:564-579` (esse merge só atua dentro do mesmo lote de scraping).
- Duplicata adicional com chave textual `cat:id:77` persistida sob `category_id=70` é comportamento
  esperado (77 = `cbtmCategoryId` externo, 70 = PK interno) — **não é bug**, apenas nomenclatura de
  camadas diferentes; não entra no escopo de correção.

### Causa raiz técnica
1. `computeMatchKey()` (`packages/shared/src/index.ts:1025-1039`) inclui `tableNumber` e `matchDatetime`
   no hash de `matchKey`. Quando o CBTM reagenda um jogo, o hash muda inteiramente → o upsert do worker
   trata como jogo **novo**, não como atualização do jogo existente.
2. O único mecanismo que remove linhas de `matches` cujo `matchKey` não está mais no snapshot atual é o
   saneamento stage-3 (`shouldPruneStage3StaleMatches`, `apps/worker/src/pipeline/upsert.service.ts:1427`),
   que só roda quando `event.concluido = true` (`upsert.service.ts:1430`, `:1500-1502`).
3. `buildEventScheduleSnapshot` (`apps/api/src/user/user.service.ts:2610-2630`) faz `prisma.match.findMany`
   sem nenhum filtro de "versão vigente" e publica todas as linhas do evento — incluindo as órfãs deixadas
   pelo passo 1, durante todo o tempo em que o evento está em andamento (que é justamente quando o
   /schedule é mais consultado).
4. Já existe, dentro do worker, uma noção de identidade lógica de jogo **sem** mesa/hora:
   `buildIdentity()` (`apps/worker/src/pipeline/match-merge.ts:123-150`) usa
   `cbtm|eventId|categoria|cbtmMatchId` quando há `cbtmMatchId` (número do "Jogo N" do CBTM) — mas essa
   identidade só é usada para fundir duplicatas **dentro do mesmo lote de scraping**; não é persistida
   como chave estável entre execuções do worker (o banco persiste por `computeMatchKey`, que inclui
   mesa/hora).

### Ambiguidades

**O QUÊ** — [RESOLVIDO: abordagem (a), persistência, com preservação de `matchKey`]
Corrigir no worker: quando `parsedMatch.matchKey` não bate com nenhuma linha existente, mas há
`cbtmMatchId` presente, localizar a linha existente por `eventId + categoryId + cbtmMatchId` (normalizado
numericamente — ver COMO) e atualizá-la **preservando `id` e `matchKey` originais** — não adotar o
`matchKey` novo do jogo reagendado. Motivo da correção em relação ao rascunho original (achado do
contraponto Codex, verificado por leitura direta): `mergeScheduleMatches()` em
`apps/api/src/user/read-model-mirror.ts:219-249` casa partidas do read-model por `scheduleMatchKey()`
(`read-model-mirror.ts:274-284`, que usa `match.matchKey` quando presente) e qualquer chave do cache
anterior ausente no novo snapshot é mantida via `markPreserved()` (`read-model-mirror.ts:243-246`). Se a
correção trocasse o `matchKey` da linha, o mirror manteria a versão antiga como "preservada" e adicionaria
a nova — recriando o sintoma de duas versões publicadas mesmo com uma única linha no banco Postgres.
Confirmado também por leitura direta que o `update` existente em `upsert.service.ts:1769-1793` já **não**
grava `matchKey` no `data` (só o `create`, linha 1814) — preservar a chave se encaixa no padrão já
existente sem exigir mudança adicional nesse ponto.

**COMO** — [RESOLVIDO]
Seguir o padrão já existente do fallback `legacyMatchKey` (`upsert.service.ts:1615-1649`): antes do
`findUnique` por `matchKey` normal falhar em achar `existingMatch`, adicionar um segundo fallback:
1. Se `existingMatch` ainda não foi encontrado e `parsedMatch.cbtmMatchId` (ou equivalente extraído de
   `metadata.cbtmMatchId/matchId/gameId/jogo`) está presente, buscar com `findMany` (não `findFirst`
   silencioso — exigência do contraponto) por `eventId + categoryId + cbtmMatchId`, normalizando o
   `cbtmMatchId` com a mesma função de normalização numérica usada em `extractCbtmMatchId()`
   (`match-merge.ts:98-121`, que já resolve `"002"` e `"2"` para o mesmo valor via `String(Number(...))`)
   para garantir que o comparador do worker e o do parser usem a mesma normalização.
2. Se a busca retornar exatamente 1 linha: tratar como `existingMatch` (preservando `id`), cair no mesmo
   bloco de `update` já existente (que não sobrescreve `matchKey`).
3. Se retornar mais de 1 linha: **não escolher arbitrariamente** — registrar warning diagnóstico
   (`matches_cbtm_match_id_ambiguous` ou similar) e manter o comportamento atual (tratar como jogo novo)
   para essa captura, deixando o caso para investigação manual. `cbtmMatchId` tem apenas índice simples
   (`prisma/schema.prisma:228`, `@@index([cbtmMatchId])`), sem constraint única composta — o lock por
   evento mitiga concorrência mas não garante unicidade a nível de banco.
4. A identidade permanece sempre escoped por `eventId + categoryId` — nunca buscar só por `cbtmMatchId`
   isolado (mesmo número de jogo existe em categorias/eventos diferentes).

**ONDE** — [RESOLVIDO: escopo é "toda partida persistida com `cbtmMatchId` não nulo", não uma fase específica]
Achado do contraponto Codex, verificado por leitura direta (`packages/parser/src/index.ts:1766-1781`):
`ELIMINATORIA_ENABLED` gateia a captura da aba ELIMINATORIA — hoje hard-disabled, então na prática não há
payloads dessa aba sendo parseados. GRUPOS usa `parseGroupMatches` (matriz heurística), sem extração de
`cbtmMatchId`. Logo, o alcance real e verificável hoje é: partidas com `cbtmMatchId` presente, que na
prática corresponde aos cards de RESULTADOS via `parseCardBasedMatches`. A Spec não deve alegar cobertura
de ELIMINATORIA — a condição de escopo é sempre "cbtmMatchId != null", e o comportamento atual permanece
para jogos sem esse campo (GRUPOS hoje, ELIMINATORIA se/quando reativada sem extração de cbtmMatchId).

**Definição de pronto** — [RESOLVIDO]
- Duas capturas do mesmo `cbtmMatchId` (mesma categoria/evento), com mesa/horário diferentes, resultam no
  mesmo `matches.id` e no mesmo `matches.match_key` (chave da primeira captura preservada).
- Mesa e horário refletem os valores da segunda captura (mais recente).
- Continua existindo uma única linha em `matches` para essa identidade lógica.
- O schedule publicado (`event-schedule-v1`) contém uma única partida para esse jogo, sem entrada
  `preservedFromPublishedAt` remanescente da versão anterior.
- Mesmo número de "Jogo N" em categorias diferentes do mesmo evento permanece tratado como partidas
  independentes (chave inclui `categoryId`).
- Ausência de `cbtmMatchId` na partida mantém o comportamento atual (sem regressão).
- Duplicidade pré-existente para a mesma identidade (`cbtmMatchId` casando >1 linha) produz warning
  diagnóstico, nunca escolha silenciosa/arbitrária de qual linha atualizar.

### Proposta de abordagem técnica — confirmada
Corrigir na persistência do worker, preservando `matchKey` da linha original, resolve a causa raiz para
todos os consumidores do dado (schedule, athlete summary, career), evitando o problema adicional de
recriação do sintoma via `read-model-mirror` que uma troca de `matchKey` causaria.

Risco aceito e declarado: jogos sem `cbtmMatchId` (GRUPOS hoje; ELIMINATORIA se reativada sem extração do
campo) permanecem vulneráveis ao mesmo sintoma de duplicação por reagendamento — fora do escopo desta Spec,
registrar como pendência rastreável (padrão do contrato: lacuna conhecida vira backlog, não fica implícita).

### Hipótese de impacto técnico
- `apps/worker/src/pipeline/upsert.service.ts` — bloco de resolução de `existingMatch`
  (`:1598-1650`, mesmo padrão do fallback `legacyMatchKey`): adicionar fallback por
  `eventId + categoryId + cbtmMatchId` normalizado, com `findMany` + tratamento de ambiguidade (>1 linha).
- Não tocar `shouldPruneStage3StaleMatches` nem seu gate `eventConcluded` — permanece como proteção para
  jogos sem `cbtmMatchId` e para limpeza estrutural pós-evento.
- Não tocar `packages/shared/src/index.ts` `computeMatchKey()` — `matchKey` continua sendo calculado do
  mesmo jeito para capturas novas; a mudança é sobre encontrar a linha certa antes de decidir
  criar vs. atualizar, e sobre **não sobrescrever** o `matchKey` já persistido ao atualizar.
- Não tocar `apps/api/src/user/user.service.ts` `buildEventScheduleSnapshot` nem
  `apps/api/src/user/read-model-mirror.ts` nesta Spec — a leitura fica correta porque passa a existir
  apenas uma linha por jogo lógico com `matchKey` estável.

### Saneamento retroativo do evento 59 — [LEO DECIDE: confirmado necessário, ver abaixo]
A correção de upsert citada acima **não corrige dados já duplicados hoje** — e piora a busca por
`cbtmMatchId` daqui em diante para esse caso específico: como a versão mais recente do evento 59 já tem
exatamente o `matchKey` que a próxima captura vai gerar (mesma mesa/hora), o `findUnique` por `matchKey`
vai bater direto nela; as versões antigas (mesa/hora já superadas) nunca serão alcançadas pelo novo
fallback de `cbtmMatchId`, porque o fallback só roda quando a busca primária falha.

Corretamente apontado no contraponto: não faz sentido aguardar o saneamento stage-3 pós-conclusão, porque
o problema é mais relevante durante a realização do evento (é quando o /schedule é mais consultado).

**[LEO DECIDE]** — Confirmar: abrir uma Spec/tarefa separada de saneamento (não a mesma Spec de correção
de upsert), com:
- modo dry-run obrigatório por padrão;
- escopo explícito restrito ao evento 59 (parâmetro, não global);
- agrupamento por `event_id + category_id + cbtm_match_id`;
- retenção da versão mais recente por `fetchedAt`/`updatedAt`, validando participantes e placar antes de
  remover qualquer linha;
- remoção transacional (`matchParticipant` + `match` da(s) linha(s) obsoleta(s));
- invalidação/reconstrução do read-model cache do evento 59 após a limpeza;
- relatório antes/depois (contagem de linhas removidas por categoria);
- execução em produção só após autorização explícita de Leo, independente do dry-run já ter rodado.

Se Leo aprovar, esta Spec (PP-054) cobre **só** a correção de upsert; o saneamento vira uma segunda Spec
sequencial (ex. PP-055) que depende da aprovação separada de Leo para rodar em produção.
