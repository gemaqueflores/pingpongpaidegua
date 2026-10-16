## SPEC ATIVA — PP-054 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-054 | Projeto: PingPong PaiD'egua | Branch: fix/pp-054-versao-vigente-jogo-reagendado
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: não — mudança é lógica de resolução de linha existente em upsert já autenticado
  internamente (worker), sem novo input externo, sem query SQL nova fora do padrão Prisma já usado no
  arquivo, sem exposição de dado novo. Superfície de segurança não tocada.
- e2e-playwright-agent: não — mudança é de backend/worker, sem fluxo de UI ponta a ponta novo.
- report-builder-agent: não — não há relatório estruturado de evidências exigido por esta entrega.

## Objetivo
Quando o CBTM reagenda um jogo (muda mesa e/ou horário) enquanto o evento ainda está em andamento, o
worker deve atualizar a partida já existente em vez de criar uma linha nova — para que o `/schedule`
público (e qualquer outro consumidor de `matches`) sempre reflita apenas a versão vigente do jogo, sem
publicar simultaneamente a versão antiga e a nova.

## Contexto
Bug reportado por usuário no evento 59: atleta ANDREZA MOTA aparecia no app com Mesa 17/18:30 e Mesa
19/19:30, enquanto o site oficial CBTM já mostrava Mesa 17/11:30 e Mesa 19/13:30 (jogo reagendado).
Investigação read-only em produção (evidência dinâmica, `docs/sessions/2026-09-18-investigacao-horarios-evento59.md`)
confirmou: o HTML bruto do "Jogo 002" mudou de mesa/hora entre capturas sucessivas do worker, e cada
mudança gerou uma linha nova em `matches` — nenhuma substituiu a anterior. As três versões coexistem no
banco e são publicadas juntas pelo read-model `event-schedule-v1`.

Ciclo tripartite (CAT) concluído e aprovado por Leo em 2026-09-18 — draft completo com evidências e
raciocínio de resolução de cada ambiguidade em
`docs/specs/PP-054-versao-vigente-jogo-reagendado-draft.md`. Ver também `## HISTÓRICO` abaixo.

## Causa raiz
- **Causa imediata:** `computeMatchKey()` (`packages/shared/src/index.ts:1025-1039`) inclui
  `tableNumber` e `matchDatetime` no hash que vira `matches.match_key` (chave única). Quando o CBTM muda
  mesa/hora de um jogo, o hash muda inteiramente, e o `findUnique({ where: { matchKey } })` em
  `apps/worker/src/pipeline/upsert.service.ts:1598-1599` não encontra a linha existente — o worker então
  cria uma linha nova (`prisma.match.create`, `upsert.service.ts:1794-1815`).
- **Causa sistêmica:** o único mecanismo que remove linhas de `matches` cujo `matchKey` ficou obsoleto é o
  saneamento stage-3 (`shouldPruneStage3StaleMatches`, `upsert.service.ts:1427-1504`), que só roda quando
  `event.concluido = true`. Durante o evento — justamente quando o `/schedule` é mais consultado — não
  existe nenhum mecanismo de substituição por reagendamento.
- **Padrão já visto antes:** a Spec PP-006 (`docs/specs/PP-006-espelho-snapshot-leitura.md`, item CB-2)
  já identificou e corrigiu um sintoma da mesma classe de causa (upsert que recria `id`/`matchKey` de uma
  mesma partida lógica) no lado do read-model mirror, fazendo-o usar `matches.match_key` estável em vez
  de recompor a chave. Esta Spec resolve a origem do problema (o worker cria uma chave nova em vez de
  localizar a linha lógica existente) para o caso específico de reagendamento com `cbtmMatchId` conhecido.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### C1 — Reagendamento de jogo com cbtmMatchId conhecido
DADO um jogo já persistido em `matches` com `cbtmMatchId="2"`, `tableNumber="17"`,
`matchDatetime="2026-09-16T18:30:00-03:00"`, `eventId=59`, `categoryId=X`
QUANDO o worker processa uma nova captura do mesmo `cbtmMatchId="2"` (ou `"002"`) com
`tableNumber="17"` e `matchDatetime="2026-09-18T11:30:00-03:00"` (mesmo evento/categoria)
ENTÃO a linha existente é atualizada (mesmo `id`, mesmo `matchKey` original) com a nova mesa/horário — não
é criada uma segunda linha.

### C2 — Jogo sem cbtmMatchId não é afetado (preservação)
DADO um jogo persistido sem `cbtmMatchId` (ex. fallback por nome/participantes, típico de GRUPOS)
QUANDO uma nova captura do mesmo jogo lógico chega com mesa/hora diferente e ainda sem `cbtmMatchId`
ENTÃO o comportamento atual é preservado (cria linha nova via `matchKey`, como hoje) — sem regressão.

### C3 — Ambiguidade: mais de uma linha casa com o mesmo cbtmMatchId
DADO duas linhas já existentes em `matches` para o mesmo `eventId + categoryId + cbtmMatchId` (estado de
dados pré-existente/corrompido)
QUANDO o worker processa uma nova captura desse `cbtmMatchId`
ENTÃO nenhuma linha é escolhida arbitrariamente para atualizar; o worker registra warning diagnóstico e
mantém o comportamento atual (cria uma linha nova por `matchKey`) para essa captura.

### C4 — Mesmo número de jogo em categorias diferentes permanece independente
DADO "Jogo 2" existente na categoria A e "Jogo 2" existente na categoria B do mesmo evento
QUANDO o worker processa uma atualização de mesa/hora para "Jogo 2" da categoria A
ENTÃO apenas a linha da categoria A é afetada; a linha da categoria B permanece intacta.

### C5 — Normalização numérica do cbtmMatchId
DADO um jogo persistido com `cbtmMatchId="2"`
QUANDO a nova captura traz o mesmo jogo com `cbtmMatchId` textual `"002"` (zero-padded, como o HTML bruto
do CBTM frequentemente expõe)
ENTÃO o worker reconhece como o mesmo `cbtmMatchId` (mesma normalização usada por `extractCbtmMatchId()`
em `apps/worker/src/pipeline/match-merge.ts:98-121`) e atualiza a linha existente.

## Critérios de aceitação
- Reagendamento de jogo com `cbtmMatchId` presente nunca resulta em 2 linhas simultâneas em `matches`
  para a mesma identidade lógica (`eventId + categoryId + cbtmMatchId`).
- O `id` e o `matchKey` da linha original são preservados após a atualização por reagendamento — apenas
  os campos de conteúdo (mesa, horário, round, placar, participantes, etc.) mudam.
- Jogos sem `cbtmMatchId` continuam se comportando exatamente como hoje (sem regressão).
- Ambiguidade (>1 linha candidata) nunca escolhe arbitrariamente — sempre gera warning e preserva o
  comportamento atual para aquela captura.
- A busca de linha existente por `cbtmMatchId` é sempre escopada por `eventId + categoryId` — nunca busca
  global só por `cbtmMatchId`.

## Fora de escopo
- Saneamento retroativo dos dados já duplicados hoje no evento 59 (ou qualquer outro evento) — Spec
  separada PP-055, dependente de autorização explícita de Leo para execução em produção, a rodar depois
  desta Spec estar mergeada.
- Cobertura de GRUPOS e ELIMINATORIA: GRUPOS usa matriz heurística sem `cbtmMatchId`; ELIMINATORIA está
  hard-disabled hoje (`ELIMINATORIA_ENABLED=false`, `packages/parser/src/index.ts:1766-1781`) e, mesmo se
  reativada, seu parser não extrai `cbtmMatchId` no estado atual do código. Ambos permanecem vulneráveis
  ao mesmo sintoma de duplicação por reagendamento — risco conhecido, registrado como pendência
  rastreável (ver seção Pendências), não coberto nesta Spec.
- Qualquer mudança em `computeMatchKey()`, `shouldPruneStage3StaleMatches()`, `buildEventScheduleSnapshot()`
  ou `apps/api/src/user/read-model-mirror.ts` — nenhum desses arquivos é tocado por esta Spec.
- Qualquer mudança de contrato de API pública.

## Impacto técnico

### Arquivos a criar/modificar
- `apps/worker/src/pipeline/upsert.service.ts` — bloco de resolução de `existingMatch`
  (hoje linhas `1598-1650`, mesmo padrão do fallback `legacyMatchKey` já existente ali): adicionar um
  segundo fallback, executado apenas se `existingMatch` continuar `null` após o fallback de
  `legacyMatchKey` já existente:
  1. Extrair o `cbtmMatchId` normalizado da captura atual (reaproveitar/expor a mesma lógica de
     normalização numérica de `extractCbtmMatchId()` em `apps/worker/src/pipeline/match-merge.ts:98-121`
     — não duplicar a regex, importar/exportar a função ou extrair helper compartilhado).
  2. Se houver `cbtmMatchId` normalizado, buscar com `prisma.match.findMany({ where: { eventId,
     categoryId: category.id, cbtmMatchId } })` (usar `findMany`, nunca `findFirst`).
  3. Se resultado tiver exatamente 1 linha: usar como `existingMatch` (preservando `id`), seguir para o
     mesmo bloco de `prisma.match.update` já existente (`upsert.service.ts:1769-1793`), que **já não
     grava `matchKey`** no `data` — não alterar esse comportamento.
  4. Se resultado tiver mais de 1 linha: push de warning diagnóstico (ex.:
     `` `Ambiguidade de cbtmMatchId=${cbtmMatchId} no evento ${eventId}/categoria ${category.id}: ${count} linhas candidatas — mantendo comportamento atual (matchKey).` ``)
     e não usar nenhuma delas como `existingMatch` — segue o fluxo atual sem esse fallback.
  5. Se resultado vazio: segue o fluxo atual (cria linha nova via `matchKey`, como hoje).
- `apps/worker/src/pipeline/match-merge.ts` — se a normalização de `cbtmMatchId` não estiver exportada,
  exportar a função existente (ou extrair um helper puro reaproveitável) para uso em `upsert.service.ts`
  sem duplicar a regex/lógica.

### Arquivos que NÃO devem ser tocados
- `packages/shared/src/index.ts` (`computeMatchKey`, `parseBrazilianDateTime`) — motivo: chave e conversão
  de fuso já corretas; não fazem parte da causa raiz desta Spec.
- `apps/worker/src/pipeline/upsert.service.ts` — `shouldPruneStage3StaleMatches()` e seu gate
  `eventConcluded` — motivo: proteção deliberada para jogos sem `cbtmMatchId` e para limpeza estrutural
  pós-evento; fora de escopo.
- `apps/api/src/user/user.service.ts` (`buildEventScheduleSnapshot`) — motivo: leitura fica correta como
  efeito colateral de só existir uma linha por jogo lógico; não precisa de filtro adicional.
- `apps/api/src/user/read-model-mirror.ts` (`mergeScheduleMatches`, `scheduleMatchKey`, `markPreserved`) —
  motivo: já funciona corretamente desde que `matchKey` seja preservado pelo upsert — é exatamente por
  isso que esta Spec exige preservar `matchKey` na atualização, em vez de tocar o mirror.
- `apps/worker/src/pipeline/upsert.service.ts` — bloco de `prisma.match.create` (linhas `1794-1815`) —
  motivo: caminho de criação de linha nova não muda; a Spec só adiciona uma forma adicional de encontrar
  `existingMatch` antes de decidir entre update/create.

### DDL / migração
Nenhuma. `cbtmMatchId` já existe na tabela `matches` com índice simples (`prisma/schema.prisma:228`,
`@@index([cbtmMatchId])`) — suficiente para a busca por `findMany` proposta (filtrada adicionalmente por
`eventId`/`categoryId`, ambos já indexados). Não é necessário adicionar constraint única composta nesta
Spec — a ambiguidade é tratada em runtime (C3), não em nível de banco.

### Contrato de API alterado
Nenhum.

### Dependências novas
Nenhuma.

### Pendências rastreáveis (backlog de robustez — registrar, não implementar aqui)
- GRUPOS e ELIMINATORIA permanecem vulneráveis ao mesmo sintoma de duplicação por reagendamento, por não
  extraírem `cbtmMatchId`. Registrar em `docs/knowledge/claude.md` ao encerrar a sessão como candidato a
  nova Spec futura, caso o padrão se repita para essas fases.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (função de normalização/extração) + integração (via `UpsertService.upsert`
  contra Postgres de teste, seguindo o padrão já usado em `apps/worker/test/upsert-dedup.test.ts`)
- arquivos de teste a criar/editar: `apps/worker/test/upsert-match-reschedule.test.ts` (novo)
- fixtures/mocks: nenhum mock de Prisma — usar banco de teste real, seguindo o padrão dos testes de
  integração já existentes no mesmo diretório (`upsert-dedup.test.ts`)
- COBERTURA: regressão=2 corretude=4 (C2 e a asserção de `matchKey`/`id` preservados em C1 cobrem
  regressão do comportamento existente; C1, C3, C4, C5 cobrem corretude do comportamento novo com valor
  calculado fora da função sob teste — leitura direta da linha persistida no Postgres após o upsert)

### T-U-01 — extração/normalização de cbtmMatchId casa "2" e "002"
Camada: função (`extractCbtmMatchId` ou helper extraído de `match-merge.ts`)
DADO: dois `ParsedMatch` com `metadata.jogo` (ou campo equivalente) valendo `"2"` e `"002"` respectivamente
QUANDO: a função de extração/normalização é chamada para cada um
ENTÃO: ambos retornam o mesmo valor normalizado (`"2"`)

### T-I-01 — reagendamento atualiza a linha existente preservando id e matchKey [regressão + corretude]
Camada: integração (`UpsertService.upsert`)
DADO: banco de teste com um evento e uma categoria criados; primeira chamada de `upsert()` com um
`ParsedMatch` tendo `cbtmMatchId`/`metadata.jogo="2"`, `tableNumber="17"`, `matchDatetime` do dia 16;
capturar `id` e `matchKey` gerados por leitura direta em `prisma.match.findFirst`
QUANDO: segunda chamada de `upsert()` no mesmo evento/categoria com o mesmo `cbtmMatchId="2"`,
`tableNumber="17"`, `matchDatetime` do dia 18 (mesa igual, horário e dia diferentes — cenário real do
evento 59)
ENTÃO: `prisma.match.count({ where: { eventId, categoryId } })` para esse jogo lógico é 1; a linha lida
tem o mesmo `id` e o mesmo `matchKey` capturados na primeira chamada; `matchDatetime` reflete o valor da
segunda chamada (dia 18)

### T-I-02 — jogo sem cbtmMatchId não é afetado (sem regressão) [regressão]
Camada: integração
DADO: primeira chamada de `upsert()` com um `ParsedMatch` sem `cbtmMatchId`/`metadata.jogo`, mesa X
QUANDO: segunda chamada de `upsert()` com o mesmo jogo lógico (mesmos participantes/categoria/round) mas
mesa Y e sem `cbtmMatchId`
ENTÃO: comportamento idêntico ao atual antes desta Spec — duas linhas distintas em `matches` (mesmo
sintoma de hoje, fora do escopo desta Spec); teste documenta e trava esse comportamento como intencional

### T-I-03 — ambiguidade gera warning e não escolhe arbitrariamente [corretude]
Camada: integração
DADO: banco de teste com duas linhas já existentes para o mesmo `eventId + categoryId + cbtmMatchId="2"`
(inseridas diretamente via `prisma.match.create` no setup do teste, simulando dado pré-existente
ambíguo)
QUANDO: `upsert()` processa uma nova captura desse `cbtmMatchId="2"`
ENTÃO: `warnings` retornado por `upsert()` contém uma mensagem citando "Ambiguidade" e o `cbtmMatchId`;
`prisma.match.count(...)` para esse `eventId+categoryId+cbtmMatchId` aumenta para 3 (comportamento atual
preservado: nova linha criada, nenhuma das duas antigas foi escolhida/sobrescrita)

### T-I-04 — mesmo cbtmMatchId em categorias diferentes permanece independente [corretude]
Camada: integração
DADO: duas categorias do mesmo evento, cada uma com um jogo `cbtmMatchId="2"` já persistido (ids e
matchKeys distintos)
QUANDO: `upsert()` processa reagendamento do "Jogo 2" apenas da categoria A
ENTÃO: a linha da categoria A é atualizada (mesmo `id`/`matchKey`, mesa/hora novos); a linha da
categoria B permanece com `updatedAt` e conteúdo inalterados

### Cobertura de falhas silenciosas
- Não aplicável a UI (mudança é backend puro).
- Persistência: T-I-01 e T-I-04 leem o estado pós-operação diretamente do Postgres (não confiam em valor
  de retorno da função) — confirmam efeito real, não só ausência de erro.

### Categorias de cobertura mínima não aplicáveis
- Formulário/Cadastro, Edição por usuário final, Exclusão, Listagem/Busca, Autenticação/Autorização,
  Upload/Arquivo — [não aplicável — mudança é lógica interna de resolução de linha em pipeline de worker,
  sem input de usuário final, sem endpoint HTTP novo, sem UI].
- Integração externa — [não aplicável — esta Spec não altera a captura/scraping do CBTM, apenas a
  persistência de dados já parseados].
- Regra de negócio — coberta: C1-C5 e T-U-01/T-I-01..04 cobrem a regra "reagendamento atualiza jogo
  existente por cbtmMatchId, preservando matchKey".

### Comando para rodar a suite
`npm --prefix apps/worker test`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-18)
Rascunho inicial produzido por Claude após investigação read-only em produção via Codex/ssh-oracle
(evidência dinâmica anexada em `docs/sessions/2026-09-18-investigacao-horarios-evento59.md`). Conteúdo
completo preservado em `docs/specs/PP-054-versao-vigente-jogo-reagendado-draft.md`.

### CAT — Rodada 2 — contraponto Codex (2026-09-18)
Codex apontou 3 correções materiais ao rascunho, todas verificadas por leitura direta antes de aceitar:
1. Preservar `matchKey` na atualização (não adotar o `matchKey` novo) — motivo: `read-model-mirror.ts`
   casa partidas do schedule por `matchKey` e preserva no cache qualquer chave ausente do novo snapshot
   (`markPreserved`); trocar a chave recriaria o sintoma mesmo com uma única linha no Postgres. Confirmado
   que o `update` existente já não grava `matchKey` (`upsert.service.ts:1769-1793`).
2. ELIMINATORIA não é coberta na prática hoje (`ELIMINATORIA_ENABLED` hard-disabled; parser de
   ELIMINATORIA e GRUPOS não extraem `cbtmMatchId`) — escopo correto é "cbtmMatchId presente", não uma
   fase específica.
3. Saneamento retroativo do evento 59 é necessário e não pode esperar o fim do evento — recomendação de
   Spec separada com dry-run, escopo restrito, validação antes de remover, transação, invalidação de
   cache e relatório antes/depois.
Riscos adicionais apontados e incorporados: `cbtmMatchId` sem constraint única composta (índice simples
apenas) → tratar ambiguidade (>1 linha) com diagnóstico, nunca escolha arbitrária; busca deve usar
`findMany`, não `findFirst` silencioso; normalização numérica do `cbtmMatchId` deve casar `"002"`/`"2"`;
identidade sempre escopada por evento+categoria, nunca só `cbtmMatchId` global.

### CAT — Rodada 3 (2026-09-18)
Claude resolveu todos os `[PENDENTE]` incorporando as 3 correções do Codex, verificadas por leitura direta
de `read-model-mirror.ts`, `upsert.service.ts:1769-1793`, `packages/parser/src/index.ts:1766-1781` e
`prisma/schema.prisma:228`. Draft fechado.

### Fechamento do ciclo — aprovação Leo (2026-09-18)
✅ Leo aprovou o draft e confirmou: saneamento retroativo do evento 59 vira Spec separada PP-055,
dependente de autorização explícita para execução em produção, a rodar logo após PP-054 estar mergeada.

### Aprovação da Spec formal (2026-09-18)
✅ Leo aprovou a Spec PP-054 v1 explicitamente ("54 e 55 aprovadas"). Liberada para implementação.

### Parecer — Rodada 1 (2026-09-18) — ✅ aprovado

#### Pré-parecer
- [x] Glob/`git diff --stat` executado — 3 arquivos identificados no PR/branch (bate com o declarado)
- [x] `Read`/`git diff` de cada arquivo modificado (via `git diff main..1093519...` e `Read` direto)
- [x] TodoWrite não necessário (3 arquivos, abaixo do limiar de complexidade que exigiria rastreamento)
- [ ] `confere-citacoes.py` — script não localizado no projeto nesta sessão; verificação de citações
      feita manualmente por `Read`/`Grep`/`git show` direto em cada arquivo e linha citados
- [x] Nenhum item foi avaliado de memória ou por declaração do Codex sem verificação — suite reexecutada
      de forma independente (ver Verificações determinísticas)

#### Score
✅ 10 itens | ⚠️ 0 itens | ❌ 0 itens | Cobertura diff: 3/3 arquivos auditados

#### Verificações determinísticas
- Encoding/BOM/CRLF (blob do commit via `git show`, não working tree): `match-merge.ts` OK-sem-BOM/OK-LF;
  `upsert.service.ts` OK-sem-BOM/OK-LF; `upsert-match-reschedule.test.ts` OK-sem-BOM/OK-LF — rótulo `EXECUTADA`.
- Suite do worker reexecutada de forma independente, banco Postgres 16 descartável isolado (`docker run`,
  removido ao final): `88 pass / 0 fail / 0 skipped`, incluindo T-U-01, T-I-01, T-I-02, T-I-03, T-I-04 —
  rótulo `EXECUTADA` (não aceita a declaração do Codex sem reexecução).
- Build do worker (`npm run build --workspace apps-worker` = `tsc`) — sem erros — rótulo `EXECUTADA`.
- Red-Green verificável no Git: `080f40d`(red)→`4c40437`(green) T-U-01; `81e8991`(red)→`dc5946f`(green)
  T-I-01; `5fc63ab`(red)→`f5c4f8d`(green) T-I-04; `d39a2ba`(red)→`0873783`(green) T-I-03 — rótulo
  `ESTÁTICA` (histórico Git lido, hashes conferem).
- T-I-02 sem commit RED separado: verificado por `git show b210070 --stat` que esse commit só adiciona
  teste (0 mudanças em `upsert.service.ts`) — consistente com a declaração do Codex de que o comportamento
  de preservação (jogo sem `cbtmMatchId` cria linha nova) já existia no baseline antes da Spec, sem bug a
  corrigir nesse cenário específico. Não é violação de Q12: não há Red-Green fabricado a fabricar quando
  não há mudança de comportamento a induzir — rótulo `ESTÁTICA`, aceito.

#### Verificação código × Spec (item por item)
- C1 (reagendamento atualiza linha preservando `id`/`matchKey`): implementado em
  `upsert.service.ts:1652-1684` (fallback por `eventId+categoryId+cbtmMatchId`, `findMany`, nunca
  `findFirst`); `update` em `:1803-1827` confirmado sem `matchKey` no `data` — preservação real, não só
  declarada. Coberto por T-I-01, reexecutado e verde. `EXECUTADA`.
- C2 (jogo sem `cbtmMatchId` não afetado): bloco só executa `if (normalizedCbtmMatchId)` — ausência do
  campo pula o fallback inteiro, comportamento idêntico ao pré-existente. Coberto por T-I-02, reexecutado
  e verde. `EXECUTADA`.
- C3 (ambiguidade gera warning, não escolhe arbitrariamente): `cbtmMatchCandidates.length > 1` → warning
  push, `existingMatch` permanece `null`, segue fluxo de criação normal — nenhuma das linhas candidatas é
  tocada. Coberto por T-I-03, reexecutado e verde (warning contém "Ambiguidade" e "cbtmMatchId=2";
  contagem final = 3 linhas, nenhuma das 2 antigas alterada). `EXECUTADA`.
- C4 (categorias diferentes independentes): filtro inclui `categoryId: category.id` sempre. Coberto por
  T-I-04, reexecutado e verde — teste inclusive verifica `updatedAt` da linha da categoria B inalterado
  (mais rigoroso que o exigido pela Spec). `EXECUTADA`.
- C5 (normalização "2"/"002"): reaproveita `extractCbtmMatchId` já existente (apenas exportada, não
  duplicada) — mesma normalização usada no merge intra-lote. Coberto por T-U-01, reexecutado e verde.
  `EXECUTADA`.
- Preservação do `read-model-mirror.ts` (motivo original de preservar `matchKey`, achado do CAT): arquivo
  não tocado no diff (`git diff --stat` confirma) — consistente com a Spec, que exigia não tocar esse
  arquivo justamente porque a correção de upsert já elimina a causa. `ESTÁTICA`.
- "Arquivos que NÃO devem ser tocados" da Spec (`packages/shared/src/index.ts`,
  `shouldPruneStage3StaleMatches`, `buildEventScheduleSnapshot`, `read-model-mirror.ts`, bloco de
  `prisma.match.create`): nenhum aparece no diff de 3 arquivos — confirmado por `git diff --stat`.
  `ESTÁTICA`.
- Escopo (Q3): nenhuma funcionalidade além do pedido na Spec — diff é estritamente o fallback descrito +
  export da função + teste. Sem feature extra. `ESTÁTICA`.

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
Nenhum.

#### Cobertura de testes (T-* da Spec)
- T-U-01 — rótulo `EXECUTADA`: coberto ✅
- T-I-01 — rótulo `EXECUTADA`: coberto ✅
- T-I-02 — rótulo `EXECUTADA`: coberto ✅
- T-I-03 — rótulo `EXECUTADA`: coberto ✅
- T-I-04 — rótulo `EXECUTADA`: coberto ✅
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum — os 5 T-* cobrem os 5 cenários
  funcionais (C1-C5) da Spec de forma completa e com evidência real (leitura pós-operação do Postgres).

#### Security review
Executado — varredura manual A01-A10 (skill `/security-review` não invocada nesta rodada porque a Spec já
declarou não-aplicável com motivo, e a mudança é lógica interna de resolução de linha sem input externo
novo, sem query concatenada — Prisma parametriza `findMany`, sem endpoint HTTP novo, sem mudança de
autenticação/autorização, sem exposição de dado novo). Sem achados.

#### Conclusão
Implementação fiel à Spec PP-054 v1, sem desvio de escopo, com testes de integração reais (leitura
pós-operação do Postgres, não apenas valor de retorno) cobrindo os 5 cenários funcionais. Suite completa
reexecutada de forma independente (88/88) contra banco descartável isolado, não aceita por declaração.
✅ Aprovado. Liberado para merge.
