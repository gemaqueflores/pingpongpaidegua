## SPEC ATIVA — PP-055 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-055 | Projeto: PingPong PaiD'egua | Branch: chore/pp-055-saneamento-matches-evento59
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

**Dependência: PP-054 mergeada antes desta Spec ser implementada.** Sem a correção de upsert da PP-054,
qualquer saneamento manual seria imediatamente reproduzido pela próxima captura do worker (o mesmo
reagendamento voltaria a criar uma linha nova).

**Execução em produção requer autorização explícita e separada de Leo, distinta da aprovação desta
Spec.** Aprovar esta Spec autoriza o Codex a implementar a ferramenta de saneamento (script + dry-run) e
rodá-la em dry-run; não autoriza a remoção real de linhas em produção. Ver seção "Autorização de execução".

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — o script opera remoção transacional de dados em produção (mesmo que sob
  autorização); revisar controle de acesso ao script (quem pode executá-lo), ausência de SQL
  injection/concatenação de input não sanitizado, e que o modo dry-run seja de fato o padrão sem flag
  explícita.
- e2e-playwright-agent: não — não há fluxo de UI.
- report-builder-agent: sim — critério de aceitação exige relatório antes/depois estruturado por
  categoria.

## Objetivo
Remover do evento 59 as versões obsoletas de jogos que foram reagendados (mesa/horário divergentes de uma
mesma partida lógica, mesmo `cbtmMatchId`) e que hoje coexistem como linhas distintas em `matches`,
publicadas simultaneamente no `/schedule` público — sem remover partidas legítimas de fases já concluídas
do mesmo evento (ex. GRUPOS) nem qualquer dado fora do escopo do saneamento.

## Contexto
A PP-054 corrige o comportamento do worker daqui em diante, mas não apaga as linhas já duplicadas hoje no
banco de produção para o evento 59 (confirmado por evidência real via SSH — ver
`docs/sessions/2026-09-18-investigacao-horarios-evento59.md`: jogos de mesa 17 e mesa 19 da categoria
ABSOLUTO A FEM/MASTER 30FEM com múltiplas versões de mesa/hora coexistindo). Pior: uma vez a PP-054
mergeada, o fallback por `cbtmMatchId` dela **não alcançará** essas duplicatas já existentes, porque a
versão mais recente de cada jogo já tem exatamente o `matchKey` que a próxima captura do worker vai gerar
— o `findUnique` por `matchKey` bate direto nela antes do fallback por `cbtmMatchId` ser considerado.
Portanto a limpeza dessas linhas específicas exige uma intervenção direta e única, fora do fluxo normal do
worker.

Decisão de Leo (fechamento do ciclo tripartite, 2026-09-18): não aguardar o encerramento natural do
evento 59 — o problema é mais relevante durante sua realização, quando o `/schedule` é mais consultado.

## Causa raiz
Não aplicável no formato "imediata/sistêmica" — esta Spec não corrige um bug de código (isso é a PP-054),
é uma intervenção pontual de limpeza de dado já corrompido por um bug já identificado e já corrigido em
outra Spec.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### C1 — Dry-run identifica duplicatas sem alterar nada
DADO o evento 59 com jogos duplicados por reagendamento (múltiplas linhas para o mesmo
`eventId + categoryId + cbtmMatchId`)
QUANDO o script é executado em modo dry-run (padrão, sem flag de execução real)
ENTÃO produz relatório listando cada grupo de duplicatas, qual linha seria retida (mais recente por
`fetchedAt`/`updatedAt`) e quais seriam removidas — nenhuma linha em `matches` ou `match_participants` é
alterada no banco.

### C2 — Execução real remove apenas linhas obsoletas do evento 59
DADO autorização explícita de Leo para execução real, escopo restrito a `eventId=59`
QUANDO o script roda em modo de execução (flag explícita, não o padrão)
ENTÃO para cada grupo de duplicatas por `eventId + categoryId + cbtmMatchId`, mantém a linha com maior
`fetchedAt`/`updatedAt` e remove transacionalmente as demais (`match_participants` primeiro, depois
`matches`) — apenas dentro do evento 59.

### C3 — Validação antes de remover impede perda de resultado já registrado
DADO um grupo de duplicatas onde uma das linhas "obsoletas" (mesa/hora antiga) tem `scoreRaw`/`setsJson`
preenchidos (jogo já disputado) e a linha "vigente" (mesa/hora nova) está sem placar
QUANDO o script avalia esse grupo
ENTÃO não remove automaticamente — reporta como caso ambíguo que exige decisão manual (não decide sozinho
qual versão é a correta quando há sinal de resultado real na versão que seria descartada).

### C4 — Read-model do evento 59 é invalidado após a limpeza
DADO a execução real concluída com remoções efetivas
QUANDO o script termina
ENTÃO invoca a invalidação do cache de read-model do evento 59 (reaproveitar
`clearEventReadModelCaches` / `prisma.readModelCache.deleteMany({ where: { eventId: 59 } })`, já existente
em `apps/worker/src/pipeline/scrape.processor.ts:2707-2711`) para que a próxima leitura do `/schedule`
recompute a partir do estado já limpo, e não sirva o espelho antigo com `preservedFromPublishedAt` das
linhas removidas.

### C4b — Vínculos de atletas da linha vigente não são recriados nem tocados
DADO um grupo de duplicatas onde a linha vigente (mais recente) já possui seus próprios
`match_participants` corretos (criados pelo worker no momento em que essa captura foi processada, via
`resolveMatchAthlete` + `matchParticipant.upsert` — `apps/worker/src/pipeline/upsert.service.ts:1828-1878`)
QUANDO o script remove as linhas obsoletas do grupo
ENTÃO os `match_participants` da linha vigente permanecem exatamente como estavam antes da execução — o
script não cria, atualiza nem revalida vínculos de atleta da linha que permanece, apenas remove os
`match_participants` das linhas obsoletas junto com elas.

### C5 — Relatório antes/depois
DADO qualquer execução (dry-run ou real)
QUANDO o script termina
ENTÃO produz relatório com contagem de linhas antes e depois por categoria, e a lista de `match.id`
removidos (ou que seriam removidos, em dry-run) com seus `cbtmMatchId`, mesa e horário.

## Critérios de aceitação
- Modo dry-run é o padrão; execução real exige flag explícita adicional.
- Escopo sempre restrito a um `eventId` passado explicitamente como parâmetro — nunca roda "todos os
  eventos" numa única invocação.
- Agrupamento de duplicatas por `eventId + categoryId + cbtmMatchId` — nunca por `cbtmMatchId` isolado.
- Nunca remove a única linha de um grupo (grupo com 1 linha não é "duplicata").
- Caso com sinal de resultado real (placar) na versão que seria descartada é reportado como ambíguo, não
  decidido automaticamente (C3).
- Remoção é transacional: `match_participants` das linhas removidas são apagados antes/junto de `matches`,
  sem deixar `match_participants` órfãos.
- Vínculos de atleta (`match_participants`) da linha vigente (a que permanece) não são recriados,
  atualizados nem revalidados pelo script — já estão corretos desde que o worker os criou (C4b).
- Read-model cache do evento é invalidado após remoções efetivas (C4).
- Relatório antes/depois é produzido em toda execução, dry-run ou real (C5).
- Nenhuma linha de outro evento é tocada.

## Fora de escopo
- Qualquer outro evento além do 59 nesta execução — se o padrão se repetir em outros eventos, é nova
  invocação do mesmo script com outro `eventId`, decisão de Leo caso a caso, não parte desta Spec.
- Mudança de comportamento do worker (já coberta pela PP-054).
- Automatizar o saneamento como rotina periódica — esta Spec é uma intervenção pontual sob autorização
  explícita, não um job agendado.

## Impacto técnico

### Arquivos a criar/modificar
- `scripts/pp-055-saneamento-matches-duplicados.ts` (novo) — script standalone, aceita `--event-id`
  (obrigatório), `--execute` (opcional; ausência = dry-run), conecta ao Prisma do projeto
  (reaproveitar `apps/worker/src/prisma` ou equivalente), implementa os cenários C1-C5.
- Reaproveitar (import, não duplicar lógica): normalização de `cbtmMatchId` já usada/extraída na PP-054
  (`apps/worker/src/pipeline/match-merge.ts`), e `clearEventReadModelCaches` /
  `prisma.readModelCache.deleteMany` conforme já existe em `apps/worker/src/pipeline/scrape.processor.ts:2707-2711`
  (extrair para função exportável se hoje for método privado da classe, evitando duplicar a query).

### Arquivos que NÃO devem ser tocados
- Qualquer arquivo de `apps/api` ou `apps/web` — motivo: saneamento é escrita direta via script, não
  passa pela API pública.
- `apps/worker/src/pipeline/upsert.service.ts` — motivo: já corrigido pela PP-054; esta Spec não altera
  lógica de captura/upsert, só limpa dado histórico já persistido.

### DDL / migração
Nenhuma.

### Autorização de execução
1. Implementação do script + testes: autorizada por esta Spec após aprovação de Leo, como qualquer outra
   entrega.
2. Execução em modo dry-run contra o banco de produção: permitida como parte da homologação (evidência
   read-only, sem mudança de estado).
3. Execução real (`--execute`) contra o banco de produção: **exige mensagem explícita e separada de Leo
   autorizando a execução**, após o parecer ✅ desta Spec. Codex não executa `--execute` em produção por
   conta própria mesmo com a Spec aprovada — autorização de implementação ≠ autorização de execução
   destrutiva, conforme o contrato do projeto (§Executando ações com cuidado).

## Plano de testes

### Cobertura geral
- camadas obrigatórias: integração (script contra Postgres de teste, populado com cenário de duplicata
  real reproduzindo o caso do evento 59)
- arquivos de teste a criar: `scripts/test/pp-055-saneamento-matches-duplicados.test.ts` (ou local
  equivalente ao padrão de testes de `scripts/` já existente no projeto, se houver — verificar
  `scripts/diagnose-stage3-conflicts.ts` como precedente de script de diagnóstico)
- fixtures/mocks: nenhum mock de Prisma — banco de teste real, populado via `prisma.match.create` direto
  no setup de cada teste
- COBERTURA: regressão=2 corretude=3 (T-I-02 confirma que grupo com 1 linha não é tocado — regressão de
  "não destruir dado saudável"; T-I-04 confirma isolamento entre eventos — regressão; T-I-01, T-I-03,
  T-I-05 cobrem corretude do comportamento novo de agrupamento/remoção/relatório)

### T-I-01 — dry-run identifica duplicatas sem alterar o banco [corretude]
Camada: integração
DADO: banco de teste com 3 linhas para o mesmo `eventId=59, categoryId=X, cbtmMatchId="2"` (mesas/horários
diferentes, `fetchedAt` crescente)
QUANDO: script roda sem `--execute`
ENTÃO: `prisma.match.count({ where: { eventId: 59 } })` antes e depois é idêntico; relatório de saída
identifica corretamente as 2 linhas mais antigas como "seriam removidas" e a de `fetchedAt` mais recente
como "seria mantida"

### T-I-02 — grupo com 1 linha não é tocado [regressão]
Camada: integração
DADO: banco de teste com exatamente 1 linha para um `cbtmMatchId` dentro do evento 59
QUANDO: script roda com `--execute`
ENTÃO: a linha permanece intacta (mesmo `id`, `updatedAt` inalterado)

### T-I-03 — execução real remove linhas obsoletas e preserva a mais recente [corretude]
Camada: integração
DADO: banco de teste com 3 linhas duplicadas (mesmo setup de T-I-01), nenhuma com placar preenchido
QUANDO: script roda com `--execute --event-id=59`
ENTÃO: `prisma.match.count(...)` para esse `cbtmMatchId` passa a ser 1; a linha remanescente é a de
`fetchedAt` mais recente; `match_participants` das linhas removidas não existem mais
(`prisma.matchParticipant.count({ where: { matchId: { in: [idsRemovidos] } } })` é 0)

### T-I-04 — isolamento entre eventos [regressão]
Camada: integração
DADO: banco de teste com duplicatas equivalentes no evento 59 e no evento 60
QUANDO: script roda com `--execute --event-id=59`
ENTÃO: duplicatas do evento 60 permanecem intactas (contagem antes = depois para `eventId=60`)

### T-I-05 — linha obsoleta com placar preenchido não é removida automaticamente [corretude]
Camada: integração
DADO: grupo de duplicatas onde a linha mais antiga tem `scoreRaw` preenchido e a mais recente não
QUANDO: script roda com `--execute`
ENTÃO: nenhuma linha do grupo é removida; relatório reporta o grupo como "ambíguo — requer decisão manual"

### Cobertura de falhas silenciosas
- Persistência: todos os T-I-* leem o estado pós-execução diretamente do Postgres (contagens e ids
  específicos), não confiam apenas no texto do relatório impresso pelo script.

### Categorias de cobertura mínima não aplicáveis
- Formulário/Cadastro, Edição por usuário final, Listagem/Busca, Autenticação/Autorização, Upload/Arquivo,
  Integração externa — [não aplicável — script standalone de manutenção de dados, sem input de usuário
  final, sem endpoint HTTP, sem UI, sem chamada a serviço externo].
- Exclusão — coberta: T-I-03 (remoção real) e T-I-05 (exclusão bloqueada por ambiguidade) cobrem os
  cenários de exclusão desta entrega.
- Regra de negócio — coberta: C1-C5 e T-I-01..05.

### Comando para rodar a suite
`npm --prefix apps/worker test` (ou local equivalente definido pela estrutura de `scripts/test/` do
projeto, a confirmar durante implementação) + execução manual documentada do dry-run como evidência de
homologação.

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### Origem
Spec derivada do fechamento do ciclo tripartite da PP-054 (`docs/specs/PP-054-versao-vigente-jogo-reagendado-draft.md`,
seção "Saneamento retroativo do evento 59"). Leo confirmou em 2026-09-18: PP-055 separada, autorização
própria para execução em produção, executada logo após PP-054 mergeada.

### Aprovação da Spec formal (2026-09-18)
✅ Leo aprovou a Spec PP-055 v1 explicitamente ("54 e 55 aprovadas"). Liberada para implementação —
**apenas** implementação e dry-run. Execução real (`--execute`) em produção continua exigindo mensagem
separada e explícita de Leo, conforme seção "Autorização de execução" acima. Esta aprovação não constitui
essa autorização.

### Parecer — Rodada 1 (2026-09-18) — ✅ aprovado

#### Pré-parecer
- [x] `git diff --stat origin/main..pp-055-review` executado — 5 arquivos identificados (isolando o diff
      real da PP-055, já que o worktree local ainda não tinha o merge do #53 sincronizado no início)
- [x] `Read`/`git diff`/`git show` de cada arquivo modificado, íntegro
- [x] TodoWrite não necessário (5 arquivos, revisão sequencial simples)
- [ ] `confere-citacoes.py` — script não localizado no projeto nesta sessão; verificação manual por
      `Read`/`git diff`/`git show` direto em cada arquivo e linha citados
- [x] Nenhum item avaliado de memória ou por declaração do Codex sem verificação — suite reexecutada de
      forma independente e comportamento do script testado manualmente além dos testes escritos pelo Codex

#### Score
✅ 9 itens | ⚠️ 0 itens | ❌ 0 itens | Cobertura diff: 5/5 arquivos auditados

#### Verificações determinísticas
- Encoding/BOM/CRLF (blob do commit `37f747a`, não working tree): 5/5 arquivos OK-sem-BOM/OK-LF —
  rótulo `EXECUTADA`.
- Suite completa do worker reexecutada de forma independente, Postgres 16 descartável isolado (`docker
  run`, removido ao final): `94 pass / 0 fail`, incluindo os 6 testes específicos da PP-055 (CLI +
  T-I-01/02/03/04/05) — rótulo `EXECUTADA`.
- Build do worker (`tsc`) — sem erros — rótulo `EXECUTADA`.
- **Verificação comportamental adicional, além dos testes escritos pelo Codex:** populei manualmente um
  evento de teste (`id=900001`) com 2 linhas duplicadas (`cbtmMatchId="3"`, mesmas categoria/evento, mesas
  17 e 19) diretamente via SQL no banco descartável, executei o script real via CLI
  (`npx tsx scripts/pp-055-saneamento-matches-duplicados.ts --event-id 900001`, sem `--execute`), e
  confirmei por `SELECT count(*)` direto no Postgres que as 2 linhas permaneceram intactas após o
  dry-run — não aceitei a garantia de "dry-run é o padrão" apenas pela leitura do código ou pelos testes
  do próprio autor. Rótulo `EXECUTADA`.
- Red-Green verificável no Git para os 5 T-I-*: `1630291`(red)→`6c2961e`(green) T-I-02;
  `0aa89a2`(red)→`7782b95`(green) T-I-04; `a3040e2`(red)→`9f53850`(green) T-I-01;
  `12588f4`(red)→`2062309`(green) T-I-05; `e41f10d`(red)→`c50c4df`(green) T-I-03 — rótulo `ESTÁTICA`,
  hashes conferem.
- Nenhum commit ou trecho de código referencia URL/host de produção (`grep` por `129.213`, `duckdns`,
  `oracle` nos arquivos alterados e em `prisma.ts`/`config.ts` — sem resultado); script depende de
  `DATABASE_WRITE_URL`/`DATABASE_READ_URL` via variável de ambiente, sem fallback hardcoded — rótulo
  `EXECUTADA`.

#### Verificação código × Spec (item por item)
- Reaproveitamento de `read-model-cache.ts`/`clearEventReadModelCaches`: extraído como função exportável
  a partir do método privado que já existia em `scrape.processor.ts`, sem duplicar a query — exatamente
  como a Spec pedia. `ESTÁTICA`.
- Reaproveitamento de `normalizeCbtmMatchId`: extraído de dentro de `extractCbtmMatchId` (que continua
  com o mesmo comportamento, coberto pelo T-U-01 da PP-054, também verde nesta reexecução) — não duplica
  a regex de normalização. `ESTÁTICA` + `EXECUTADA` (T-U-01 confirmado verde).
- C1 (dry-run identifica sem alterar): confirmado por T-I-01 e pela verificação comportamental manual
  acima. `EXECUTADA`.
- C2 (execução real remove apenas obsoletas do evento pedido): T-I-03 e T-I-04 confirmam, incluindo
  isolamento entre eventos (T-I-04: evento alvo vai de 2→1 linha, evento vizinho permanece com 2).
  `EXECUTADA`.
- C3 (placar em linha obsoleta bloqueia remoção automática): T-I-05 confirma — grupo marcado `ambiguous`,
  `removedMatchIds: []`, razão citando "decisao manual". `EXECUTADA`.
- C4 (invalidação do read-model após remoção real): T-I-03 confirma
  `readModelCache.count({ eventId }) == 0` após execução e `cacheInvalidated: true` no relatório.
  `EXECUTADA`.
- C4b (vínculos de atleta da linha vigente preservados, não recriados): T-I-03 compara
  `keeperParticipantsBefore` com o estado pós-execução via `assert.deepEqual` — confirma que os
  `match_participants` da linha mantida não são tocados. Ponto que eu havia levantado explicitamente
  antes da aprovação da Spec; a implementação e o teste cobrem isso corretamente. `EXECUTADA`.
- C5 (relatório antes/depois): `beforeTotal`/`afterTotal`/`categories` presentes em todo relatório,
  confirmado tanto nos testes quanto na execução manual. `EXECUTADA`.
- Nenhuma linha de `matchParticipant`/`match` de outro evento é tocada (T-I-04). `EXECUTADA`.
- `upsert.service.ts` não foi tocado (`git diff origin/main..pp-055-review -- upsert.service.ts` vazio) —
  confirma que a Spec PP-055 não reabriu a correção já homologada da PP-054. `ESTÁTICA`.
- Escopo (Q3): nenhuma funcionalidade além do pedido — diff restrito a saneamento + extração de helpers
  reutilizáveis já previstos na Spec. `ESTÁTICA`.

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
Nenhum.

#### Cobertura de testes (T-* da Spec)
- T-I-01 — rótulo `EXECUTADA`: coberto ✅
- T-I-02 — rótulo `EXECUTADA`: coberto ✅
- T-I-03 — rótulo `EXECUTADA`: coberto ✅
- T-I-04 — rótulo `EXECUTADA`: coberto ✅
- T-I-05 — rótulo `EXECUTADA`: coberto ✅
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum — os 5 T-I-* cobrem os 5
  cenários funcionais da Spec, mais um teste de CLI (`parseArgs`) não pedido explicitamente mas que
  reforça C1 (dry-run como padrão) e a validação de `--event-id`.

#### Security review
Executado — varredura manual (script não é endpoint HTTP, não tem input de usuário final; opera via
Prisma parametrizado, sem SQL cru concatenado; conexão de escrita depende de variável de ambiente
explícita, sem fallback para produção; dry-run confirmado como padrão real por execução, não apenas por
leitura do código). Sem achados.

#### Conclusão
Implementação fiel à Spec PP-055 v1. Script de saneamento com dry-run confirmado como padrão real
(verificado por execução manual independente, não apenas pelos testes do próprio autor), remoção
transacional com invalidação de cache, preservação de vínculos de atleta da linha vigente, e tratamento
correto de ambiguidade por sinal de resultado. Nenhum `--execute` foi rodado contra produção durante o
desenvolvimento ou nesta revisão.
✅ Aprovado. Liberado para merge — execução real em produção continua bloqueada até autorização explícita
e separada de Leo.

### Merge (2026-09-18)
Mergeado por Claude (autorização de operação autônoma de Leo até concluir pendências P0/P1/P2) — commit
`d6a4a70a689a772a9ebcfbac759fb18fcd9e3e67`, branch `chore/pp-055-saneamento-matches-evento59` deletada.
Único check pendente no momento do merge era o preview do Vercel (frontend, irrelevante ao escopo
worker/scripts desta entrega); repositório sem branch protection configurada (plano free do GitHub).
**Execução real (`--execute`) em produção permanece bloqueada — não realizada, aguarda autorização
explícita e separada de Leo.**
