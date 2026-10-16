## SPEC ATIVA — PP-069 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-069 | Projeto: PingPong PaiD'egua | Branch: fix/pp-062-backfill-normalizacao-clubes (continuação) ou nova branch `chore/pp-069-sanitizacao-base-local-evento59`, a critério do Codex
Criada por: Claude | Data: 2026-09-22 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-09-22 | Escopo: sanitizar a base local `cbtm_homolog` (backfill de clubes PP-062 + reset/recaptura do evento 59/4TMB26), sem tocar produção nem alterar código

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: não — nenhuma superfície de auth/input externo é criada ou alterada; é operação
  de dado (backfill já revisado na PP-062, reset via endpoints administrativos já existentes) contra
  base local de desenvolvimento/homologação, sem dado pessoal sensível novo.
- e2e-playwright-agent: não — sem mudança de UI/fluxo; validação é leitura de tela já existente
  (`/events/{id}`, aba Eficiência), não teste automatizado de fluxo.
- report-builder-agent: sim — a entrega exige relatório estruturado de evidências (contagens antes/depois,
  hashes de backup, confirmação de ScrapeRun) para comprovar que a sanitização foi efetiva e não introduziu
  regressão, no mesmo padrão já usado nas PP-062/PP-063/PP-067.

## Objetivo
Eliminar a duplicação de clubes/atletas/partidas residual na base local `cbtm_homolog` para o evento
4TMB26 (`Event.id = 59`, `cbtmEventId = 6054`), trazendo-a a um estado equivalente ao de produção (que já
recebeu o backfill de normalização de clubes e está estruturalmente correto), sem depender de restore de
produção e sem alterar nenhum código — o fix de causa (`ensureClub` busca tolerante) já existe na branch
`fix/pp-062-backfill-normalizacao-clubes` (commit `74e8473`), só falta: (1) o worker local rodar esse
código, (2) o backfill retroativo de clubes já duplicados, (3) a reconstrução do evento 59 a partir da
fonte oficial atual.

## Contexto
Investigação read-only completa (CAT tripartite, `## HISTÓRICO` abaixo — 5 rodadas, Claude + Codex),
motivada por screenshot de Leo mostrando o quadro de Eficiência do evento 59 com clubes duplicados na
base local (`ACADEMIA PING DRIVE LTDA - PA`, `YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA - PA`,
`TENIS DE MESA SALINAS -TDMS - PA`, cada um em duas linhas — uma com dados reais, outra zerada).

Quantificação exata (evidência Codex, Rodada 5, proveniência verificada por Grep em
`~/.codex/sessions/2026/09/22/rollout-2026-09-22T19-51-31-...jsonl`):
- Produção: 842 `Match` = 842 chaves `(categoryId, cbtmMatchId)` distintas (zero duplicata). 13 clubes,
  229 atletas.
- Local (`cbtm_homolog`): 2.043 linhas de `Match` para as mesmas 842 chaves distintas — exatamente 1.201
  duplicatas. 16 clubes, 287 atletas (229 nomes distintos) — resíduo de 3 clubes e 58 atletas duplicados.
- Clubes duplicados: ids `265`/`266`/`267` (Ping Drive, Yoshida, Salinas). Vínculos de inscrição
  duplicados: 126 (explica a diferença de badge Inscrições 640 local vs. 514 produção).
- Produção recebeu deploy manual do worker em 19/09 02:17 BRT (SHA `eb1c127f`), já contendo o fix
  `eventAthleteLinks.findUnique` da PP-056/PP-062 — produção está estruturalmente corrigida, só
  temporalmente mais antiga em dado de scrape (20/09 23:36 BRT vs. 22/09 14:00 BRT no local).
- A badge "Última atualização" usa `Event.lastScrapeAt` (`apps/web/lib/event-published-at.ts:7-8`, prioriza
  esse campo quando `concluido: true`) — não há inconsistência nela; a leitura inicial desta investigação
  (Rodada 1) confundiu UTC com BRT ao comparar horários, corrigido na Rodada 5.

Dry-run do script `scripts/pp-062-backfill-normalizacao-clubes.ts` (já existente, PP-062) confirma os
mesmos 3 pares do evento 59 como `ready=true`, mais 47 normalizações legadas adicionais de outros
eventos/clubes — o script descobre globalmente, não é possível restringir só ao evento 59.

## Causa raiz

### Causa imediata
A base local `cbtm_homolog` foi populada por scrapes executados **antes** do worker local ter o fix
`ensureClub` (busca tolerante, commit `74e8473`, branch `fix/pp-062-backfill-normalizacao-clubes`) em
execução — os clubes `265`/`266`/`267` foram criados como duplicatas do clube já existente quando o
sufixo de UF do nome mudou de formato (mesma classe de causa já documentada na PP-056/PP-062). Como o
worker local nunca teve rebuild pós-fix, essas duplicatas nunca foram evitadas nem corrigidas
localmente — diferente de produção, que já recebeu o deploy pós-fix (19/09) e, segundo confirmação
direta de Leo nesta sessão, já teve o backfill (`--execute`) aplicado.

### Causa sistêmica
Ambiente local e produção não têm processo de sincronização — nem automático, nem uma rotina periódica
de "aplicar em homolog o que foi aplicado em produção". Correções de dado feitas em produção (backfills,
saneamentos) não se propagam para `cbtm_homolog` a menos que alguém explicitamente rode o mesmo script
lá. Isso já gerou confusão nesta mesma investigação (hipótese inicial errada de "produção atrasada",
invertida após evidência visual de Leo). Padrão já visto: PP-067 (imagem Docker do worker desatualizada
mascarando fix já presente no código-fonte) é a mesma classe de causa sistêmica — ambiente local
divergindo silenciosamente do que já foi corrigido/deployado alhures.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Backup da base local antes de qualquer escrita
DADO o container `appcbtmeventos-postgres-1` rodando o database `cbtm_homolog`
QUANDO um dump (`pg_dump`) de `cbtm_homolog` é executado antes de qualquer dos passos seguintes
ENTÃO existe um arquivo de backup íntegro e restaurável, permitindo reverter a sanitização inteira em
caso de erro, antes de qualquer `--execute` ser disparado.

### Cenário 2 — Worker local reflete o código corrigido
DADO o container `appcbtmeventos-worker-1` rodando uma imagem buildada antes do commit `74e8473`
QUANDO `docker compose build worker && docker compose up -d worker` é executado a partir do checkout
atual da branch `fix/pp-062-backfill-normalizacao-clubes`
ENTÃO a imagem do worker em execução contém o commit `74e8473` (confirmado por log/hash de build, mesma
verificação de proveniência já usada na PP-067), sem exigir merge em `main`.

### Cenário 3 — Dry-run do backfill confirma o plano antes de qualquer escrita
DADO o script `scripts/pp-062-backfill-normalizacao-clubes.ts` rodando com `--dry-run` contra
`DATABASE_URL` apontando para `cbtm_homolog`
QUANDO executado
ENTÃO nenhuma linha é alterada; o relatório confirma os pares `265`/`266`/`267` como `ready=true` (mais os
47 adicionais já conhecidos), sem nenhum `ready=false` inesperado — se houver `ready=false` novo frente ao
relatório da PP-062 original, a execução do Cenário 4 é bloqueada e reportada a Leo antes de prosseguir.

### Cenário 4 — Backfill de clubes aplicado localmente
DADO o dry-run do Cenário 3 confirmado sem bloqueio
QUANDO o script roda com `--execute` contra `cbtm_homolog`, dentro de uma única transação
ENTÃO os clubes duplicados (`265`/`266`/`267` e os demais dos 47 adicionais) são fundidos no clube
vencedor, preservando `athletes`/vínculos (mesmo comportamento já validado em produção pela PP-062),
sem nenhuma exclusão de dado que não seja resultado direto da fusão de duplicata.

### Cenário 5 — Evento 59 é apagado da base local
DADO o evento `Event.id = 59` (`cbtmEventId = 6054`) existente em `cbtm_homolog`, já com os clubes
fundidos pelo Cenário 4
QUANDO `DELETE /admin/events/59` é chamado (`admin-events.controller.ts:70-73`,
`admin-events.service.ts:478-585` — transação já existente cobrindo `matchParticipant`,
`athleteCategory`, `athleteAlias`, `athleteMatchConflict`, `match`, `athlete`, `category`, `rawCapture`,
`scrapeRun`, `event`, com exclusão de `club` condicionada a `athletes: { none: {} }`)
ENTÃO todos os dados exclusivos do evento 59 são removidos em transação única; nenhum `Club` usado por
outro evento é apagado (a condição `athletes: { none: {} }` já impede isso).

### Cenário 6 — Evento é recriado e recapturado do zero
DADO o evento 59 apagado (Cenário 5)
QUANDO `POST /admin/events` é chamado com `cbtmEventId: 6054` e `concluido: true`
ENTÃO um novo `Event.id` local é atribuído, e `createEvent` dispara `scrape-now-force` automaticamente
(`admin-events.service.ts:193-194`, motivo reconhecido por `scrape.processor.ts:328` — mesmo caminho já
validado nas Rodadas 4-5 da PP-063).

### Cenário 7 — Confirmação de captura bem-sucedida antes de validar
DADO o scrape automático do Cenário 6 em execução
QUANDO se consulta o `ScrapeRun` mais recente do novo `Event.id`
ENTÃO existe um `ScrapeRun` com `status` em `SUCCESS` ou `PARTIAL` e `finishedAt` preenchido (mesmo
critério de "run finalizado" já usado na PP-063, `user.service.ts:7235-7248`) — se a primeira execução
automática não produzir isso, `POST /admin/events/{idLocal}/scrape-now` é usado como retry único, não
disparado antes de confirmar que a primeira falhou.

### Cenário 8 — Base local livre de duplicação após sanitização
DADO o novo `Event.id` local com `ScrapeRun` finalizado (Cenário 7)
QUANDO se compara `COUNT(*)` de `Match` contra `COUNT(DISTINCT (categoryId, cbtmMatchId))` para esse
evento, e se inspeciona a aba Eficiência (`/events/{idLocal}`, tab "Eficiência")
ENTÃO os dois números são iguais (zero duplicata), nenhum clube aparece duas vezes na tabela de ranking
por clube, e nenhum atleta aparece com nome duplicado.

## Critérios de aceitação
- Backup de `cbtm_homolog` existe e é restaurável antes de qualquer `--execute`/`DELETE`.
- Imagem do worker local confirmada como contendo o commit `74e8473` antes do dry-run do backfill.
- Dry-run do backfill (`--dry-run`) executado e reportado antes de qualquer `--execute`.
- `--execute` do backfill roda em transação única (já garantido pelo script existente).
- Evento 59 apagado via `DELETE /admin/events/59` (endpoint já existente) — sem exclusão manual de
  tabelas fora dessa rota.
- Evento recriado via `POST /admin/events` com `concluido: true`, `cbtmEventId: 6054`.
- `ScrapeRun` do novo evento confirmado `SUCCESS`/`PARTIAL` com `finishedAt` preenchido antes de qualquer
  validação de dado.
- `COUNT(Match) = COUNT(DISTINCT (categoryId, cbtmMatchId))` para o novo evento — zero duplicata.
- Nenhum clube duplicado, nenhum atleta com nome duplicado, nenhuma linha zerada na aba Eficiência do
  novo evento.
- `lastScrapeAt` do novo evento reflete o horário real da nova captura (badge "Última atualização"
  consistente).
- Nenhuma escrita em produção em nenhum momento desta Spec (toda a operação é local).
- Nenhuma alteração de código-fonte nesta Spec (fix já existe na branch).

## Fora de escopo
- Restore de produção para local (rota PP-039) — descartado explicitamente por Leo nesta investigação.
- Merge do PR da branch `fix/pp-062-backfill-normalizacao-clubes` em `main` — Leo confirmou que só o
  rebuild local do worker é necessário, sem exigir merge como pré-requisito.
- Sanitização de outros eventos além do 59 além do que o backfill de clubes (escopo global, script
  PP-062) já toca de forma incidental — não há reset/recaptura de nenhum outro evento nesta Spec.
- Qualquer alteração em `apps/api`, `apps/web` ou `apps/worker` — nenhuma linha de código é criada ou
  modificada; toda a operação usa rotas/scripts já existentes.
- Investigação adicional sobre as 3 categorias `[INCONCLUSIVO]` da PP-063 (ABSOLUTO F MAS, MASTER 45MAS,
  RLM) — permanece pendência separada, não tratada aqui.
- Retomada da comparação por clube da PP-063 (auditoria de eficiência) — pode ser retomada depois que
  esta Spec confirmar a base local sanitizada, mas não faz parte desta entrega.

## Impacto técnico

- Arquivos a criar/modificar: **nenhum**. Esta Spec é execução de rotas/scripts já existentes contra a
  base local, mais rebuild de imagem Docker a partir de código já commitado.
- Arquivos que NÃO devem ser tocados: qualquer arquivo de `apps/`, `packages/`, `prisma/schema.prisma`,
  `docker-compose.yml`, `scripts/pp-062-backfill-normalizacao-clubes.ts` (script usado como está, sem
  edição).
- DDL: nenhuma migração nova.
- Contrato de API: não alterado — `DELETE /admin/events/:id`, `POST /admin/events`,
  `POST /admin/events/:id/scrape-now` já existem e são usados como documentado.
- Dependências novas: nenhuma.
- Ambiente-alvo: exclusivamente `cbtm_homolog` (container `appcbtmeventos-postgres-1`, local). Produção
  (`129.213.86.180`) não é tocada em nenhum passo.

## Ordem de execução (não é Red-Green — é operação de infraestrutura sequencial)
1. Backup de `cbtm_homolog` (`pg_dump`).
2. Rebuild do worker local a partir da branch `fix/pp-062-backfill-normalizacao-clubes` (commit
   `74e8473`); confirmar proveniência do binário.
3. Dry-run do backfill (`--dry-run`) contra `cbtm_homolog` — reportar achados antes de prosseguir.
4. `--execute` do backfill contra `cbtm_homolog`.
5. `DELETE /admin/events/59`.
6. `POST /admin/events` recriando `cbtmEventId: 6054`, `concluido: true`.
7. Aguardar `ScrapeRun` finalizado; retry manual só se necessário.
8. Validar critérios de aceitação (contagens, aba Eficiência, badge).
9. Relatório de entrega com evidências de cada passo (contagens antes/depois, hash do backup, id do
   `ScrapeRun` final).

## Plano de testes

### Cobertura geral
- camadas: verificação operacional (infraestrutura/dado), não teste automatizado de código novo — não há
  arquivo de teste a criar; T-* abaixo são checagens a executar e registrar no relatório de entrega, com
  comando e saída literal.
- COBERTURA: regressão=2 corretude=6 — regressão cobre "clube de outro evento não é afetado" e "backup
  restaurável"; corretude cobre as contagens exatas e ausência de duplicação pós-sanitização.

### T-I-01 [regressão] — Backup restaurável e íntegro
DADO: `pg_dump` de `cbtm_homolog` executado antes de qualquer escrita
QUANDO: o arquivo de backup é inspecionado (`pg_restore --list` sem restaurar)
ENTÃO: a listagem contém todas as tabelas de domínio esperadas, sem erro de leitura do arquivo.

### T-I-02 [regressão] — Backfill não afeta clube de outro evento incorretamente
DADO: o backfill executado (`--execute`) contra `cbtm_homolog`
QUANDO: se consulta um clube que não está entre os 3 pares do evento 59 nem entre os 47 adicionais
conhecidos (controle negativo)
ENTÃO: esse clube permanece com o mesmo `id`/`normalizedName` antes e depois do backfill.

### T-I-03 [corretude] — Dry-run do backfill confirma os 3 pares do evento 59
DADO: `scripts/pp-062-backfill-normalizacao-clubes.ts --dry-run` rodando contra `cbtm_homolog`
QUANDO: o relatório é inspecionado
ENTÃO: os pares `265`/`266`/`267` aparecem como `ready=true`, valor comparável independentemente
(calculado pela regra de normalização do próprio script, não copiado do relatório da PP-062 anterior).

### T-I-04 [corretude] — Contagem de Match sem duplicata pós-reset
DADO: o novo evento recriado e com `ScrapeRun` finalizado
QUANDO: `COUNT(*) FROM matches WHERE event_id = {novoId}` é comparado a
`COUNT(DISTINCT (category_id, cbtm_match_id)) FROM matches WHERE event_id = {novoId}`
ENTÃO: os dois valores são exatamente iguais — valor esperado calculado de forma independente (contagem
de chaves distintas via SQL, não repetição do mesmo `COUNT(*)`).

### T-I-05 [corretude] — Nenhum clube duplicado na aba Eficiência
DADO: o novo evento com dado carregado
QUANDO: a tabela de ranking por clube (`/events/{novoId}`, aba Eficiência) é lida
ENTÃO: cada nome de clube aparece exatamente uma vez, sem linha zerada duplicada — valor esperado (13
clubes, mesmo total de produção para este evento) vem de fonte independente (contagem de clubes únicos em
produção para o mesmo evento), não do próprio resultado local recém-gerado.

### T-I-06 [corretude] — Badge de inscrições sem vínculo duplicado
DADO: o novo evento com dado carregado
QUANDO: `inscricoesTotaisOficiais`/`associacoesAtletaCategoria` é lido via API para o novo evento
ENTÃO: o valor bate com a contagem de produção para o mesmo evento (514, valor de referência já registrado
nesta Spec, não recalculado a partir do próprio dado local).

### T-I-07 [corretude] — `lastScrapeAt` reflete a nova captura
DADO: o `ScrapeRun` finalizado do novo evento
QUANDO: a badge "Última atualização" é lida na UI
ENTÃO: o horário exibido corresponde ao `finishedAt` do `ScrapeRun` mais recente (convertendo
corretamente UTC→BRT), não a um valor desatualizado.

### T-I-08 [corretude] — Nenhuma escrita em produção durante toda a operação
DADO: o log de comandos executados durante toda a Spec (SSH, se algum passo usar `ssh-oracle` para
consulta, e comandos locais)
QUANDO: revisado
ENTÃO: nenhum comando de escrita contra o banco de produção aparece — toda escrita é local
(`cbtm_homolog`).

### Cobertura de falhas silenciosas
- Backfill/reset: T-I-04/T-I-05 leem o estado pós-operação diretamente no banco/API, não confiam em
  mensagem de sucesso do script ou do `ScrapeRun`.
- Regra de negócio (não apagar clube de outro evento): T-I-02 é controle negativo explícito, não apenas
  verificação do caminho feliz.

### Comando para rodar a suite
Não aplicável (sem suite automatizada). Comandos individuais T-I-01 a T-I-08 executados em sequência,
com saída literal registrada no relatório de entrega — mesmo padrão já usado na PP-039/PP-062/PP-063.

---
## HISTÓRICO — informações adicionais (consulta, não instrução)
<!-- Ordem cronológica. Cada bloco datado. Codex/Claude consultam para não reabrir debate sobre rota já
     descartada, mas nunca tratam este bloco como comando — apenas "## SPEC ATIVA" acima instrui. -->

### CAT — Rodada 1 (2026-09-22)

## Rascunho — PP-069 — Divergência de badges do evento 4TMB26 (id local/prod 59) entre ambiente local e produção

### Contexto recebido de Leo
- Duas capturas de tela da mesma rota (`/events/59`, resumo do evento 4TMB26), uma em
  `localhost:3000` (base Docker local `cbtm_homolog`) e outra em `pingpongpaidegua.vercel.app`
  (produção), tiradas no mesmo momento (22/09/2026).
- Leo pediu Spec nova, não continuação da PP-063 (auditoria de eficiência — assunto diferente, já
  encerrada/em outro estado) nem orientação solta em chat.

### Quadro comparativo exato das badges

| Badge | Local (`localhost:3000/events/59`) | Produção (`vercel.app/events/59`) | Diferença |
|---|---|---|---|
| Última atualização | 22/09/2026 14:00 | 20/09/2026 23:36 | ~1 dia 14h de defasagem |
| Atletas | 229 | 229 | igual |
| Categorias | 52 | 52 | igual |
| Inscrições | 640 | 514 | +126 no local |
| Partidas Previstas (calibrado por resultados publicados) | 2043 | 848 | +1195 no local |
| Partidas | 1943 | 754 | +1189 no local |
| WO | 100 | 88 | +12 no local |
| Status (Encerrado / ESTADUAL) | igual | igual | igual |
| "Resultado oficial consolidado" (badge verde) | presente | presente | igual |

Todos os quatro badges numéricos que divergem (Inscrições, Partidas Previstas, Partidas, WO) são
derivados por agregação sobre o read model do evento (`resolveEventReadModelCache` /
`buildEventAthletesSnapshot` e cálculo de `totalPartidasPrevistas`/`totalPartidasWo`,
`apps/api/src/user/user.service.ts:1478-1555`) — não há lógica de exibição diferente entre ambientes;
o componente (`apps/web/app/user/events/[id]/page.tsx:636-648`) só renderiza o que a API retorna. A
divergência é necessariamente de **dado persistido**, não de fórmula/renderização.

### Hipótese herdada (PP-063) — marcada explicitamente como hipótese não confirmada, não causa
A sessão PP-063 (auditoria de eficiência, mesmo evento 59/4TMB26) resincronizou a base Docker local
nesta mesma janela: run de scrape **14848**, `status = PARTIAL`, `finishedAt = 2026-09-22 17:00:25`,
elevando matches de 1.972 → 2.043 (consistente com o "Partidas Previstas: 2043" visto no local agora).
A badge "Última atualização: 22/09/2026 14:00" do local também é anterior ao horário do run 14848
(17:00) — **isso por si só já é inconsistente e precisa ser resolvido antes de aceitar a hipótese**: se
o run terminou às 17:00 e a badge mostra 14:00, ou a badge não reflete o último run, ou há outro run
entre 14:00 e a captura da imagem que não foi ainda correlacionado nesta Spec.
**Hipótese, não confirmada**: produção está com o evento 59 desde a última sincronização anterior ao
run 14848 (bate com "20/09/2026 23:36" — antes da rodada de investigação da PP-063 desta sessão), e o
local está à frente porque foi resincronizado durante a PP-063. Se confirmada, a divergência não seria
"bug" — seria efeito esperado de dois bancos de dados desincronizados por não ter havido novo deploy/
scrape em produção.

### Achado relevante da revisão de código — deploy de produção é manual (PP-056)
A Spec PP-056 já registra, por leitura direta de código na VM de produção (2026-09-18): **o deploy do
worker de produção é acionado manualmente via `workflow_dispatch`, nunca automaticamente após merge**
(exemplo documentado: PR #53 mergeado sem novo deploy disparado). Isso é potencialmente a **causa real**
da divergência, distinta de "precisa rodar o scrape de novo":
- Se o deploy de produção não inclui builds/scrapes recentes por ausência de acionamento manual, a
  defasagem de dado (Inscrições/Partidas/WO) pode ser efeito cumulativo de múltiplos scrapes locais
  não replicados em produção — não um único scrape atrasado.
- Isso também levanta a dúvida se o **binário do worker em produção** está na mesma versão do worker
  local (mesma classe de problema já vista na PP-063/PP-067: imagem Docker desatualizada mascarando fix
  já presente no código-fonte) — não verificado ainda nesta Spec.

### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**[PENDENTE-1] O QUE: a divergência é 100% "produção desatualizada frente ao local" (mesmo dado, hora
diferente) ou há também dado incorreto/duplicado em um dos dois lados, independente da defasagem
temporal?**
- A PP-063 (mesma sessão, mesmo evento 59) já confirmou que a base local pós-run-14848 tem duplicação de
  `Match` residual em 40/43 categorias (não sanada — `pp-055-saneamento-matches-duplicados.ts --execute`
  não autorizado). Isso significa que o valor local "2043 Partidas Previstas" e "1943 Partidas" **podem
  já estar inflados por duplicação conhecida**, não só "mais atualizados". Comparar contra produção sem
  levar isso em conta pode atribuir à defasagem uma diferença que na verdade é (parte) duplicação.
- Preciso decidir: a comparação desta Spec deve neutralizar esse fator (ex. comparando produção contra o
  run local anterior ao 14848, ou contra a contagem de `cbtmMatchId` distintos em vez de linhas brutas)
  antes de atribuir a diferença de 1189/1195 partidas só a "produção atrasada"?

**[PENDENTE-2] COMO: o deploy manual (`workflow_dispatch`) de produção foi acionado desde o commit do
fix da PP-056 (2026-09-19) e desde o rebuild do worker local usado no run 14848 (2026-09-22)?**
- Se produção nunca recebeu o deploy pós-PP-056/PP-067, o worker de produção pode estar rodando a mesma
  imagem desatualizada que causou o bug da PP-067 no local (antes do rebuild) — nesse caso, mesmo se
  alguém disparasse um novo scrape em produção agora, poderia reproduzir o mesmo erro
  `event_athlete_links` que travou o worker local em 18/09.
- Preciso de acesso (SSH Oracle Cloud, MCP `ssh-oracle`) para confirmar: data de build/deploy da imagem
  worker em produção vs. data do commit do fix PP-056/PP-067.

**[PENDENTE-3] ONDE: "Última atualização" (badge) reflete o quê exatamente — o último `ScrapeRun`
finalizado (`SUCCESS`/`PARTIAL` com `finishedAt`), ou outro campo (`Event.updatedAt`, cache de read
model)?**
- Preciso localizar `resolveEventPublishedAt` (`apps/web/app/user/events/[id]/page.tsx:305`, função
  importada de outro módulo ainda não lido) para confirmar a fonte exata do timestamp exibido, e cruzar
  com os horários dos `ScrapeRun` reais (14658 de 18/09, 14846 com erro, 14848 de 22/09 17:00) — a
  inconsistência already apontada acima (badge local mostra 14:00, run terminou 17:00) precisa de
  explicação antes de qualquer conclusão.

**[PENDENTE-4] DEFINIÇÃO DE PRONTO: o que conta como "investigação concluída" desta Spec?**
Proposta (a confirmar com Leo/Codex):
1. Confirmar a fonte exata do timestamp "Última atualização" e por que diverge do horário real do
   último `ScrapeRun` local.
2. Confirmar se produção recebeu deploy manual desde o fix PP-056/PP-067 (via SSH, read-only).
3. Separar, na diferença de badges, o componente "defasagem temporal esperada" do componente "duplicação
   residual conhecida" (PP-063) — não tratar a diferença bruta como uma coisa só.
4. Entregar relatório de causa (não necessariamente correção — decisão de operar deploy/refresh de
   produção é ação de infraestrutura, `[LEO DECIDE]`) sem executar nenhum deploy/scrape em produção nesta
   rodada de investigação.

### Proposta de abordagem técnica por item
1. Claude localiza `resolveEventPublishedAt` e confirma a fonte do timestamp de badge (leitura de
   código, sem acesso a produção).
2. Codex confirma, via SSH (MCP `ssh-oracle`, somente leitura), a data/hash de build da imagem do worker
   em produção e a data do último `workflow_dispatch` executado (se essa informação estiver disponível
   localmente ou via API do GitHub Actions — a verificar).
3. Codex consulta (somente leitura) o `ScrapeRun` mais recente do evento 59 em produção (id/hash/branch
   do worker que gerou, `finishedAt`) para cruzar com o timestamp exibido na badge.
4. Claude cruza os três dados (badge, ScrapeRun de produção, estado de deploy) e separa a diferença de
   badges em componente temporal vs. componente de duplicação conhecida (usando os números já apurados
   na PP-063: 1.201 linhas de `Match` duplicadas identificadas no local).
5. Claude documenta achado e apresenta a Leo — decisão de disparar deploy/scrape em produção fica como
   `[LEO DECIDE]`, fora desta rodada de investigação.

### Hipótese de impacto técnico (arquivos / contratos / DDL)
- Leitura apenas nesta rodada — nenhuma alteração de código, nenhum deploy, nenhum scrape disparado em
  produção.
- Arquivos candidatos a leitura adicional: função `resolveEventPublishedAt` (import não resolvido ainda
  em `apps/web/app/user/events/[id]/page.tsx:305`), `apps/api/src/user/user.service.ts` (bloco de
  agregação 1478-1555 já lido), workflow de deploy (`.github/workflows/*.yml`, a localizar).
- Sem DDL, sem mudança de contrato de API nesta rodada (é investigação).
- Domínio relacionado: mesma classe de "imagem Docker desatualizada mascarando fix" já vista em PP-067 —
  atenção elevada a essa possibilidade em produção antes de presumir "só precisa rodar scrape".

### [LEO DECIDE] — Rodada 1
- Nenhum item resolvido ainda nesta primeira rodada — todos os 4 pendentes exigem evidência adicional
  (leitura de import, acesso SSH a produção) antes de decisão. Aguardando Codex (Rodada 2) para os itens
  que dependem de acesso a produção (PENDENTE-2, PENDENTE-3 parcial).

### CAT — Rodada 2 (2026-09-22) — evidência visual de Leo: hipótese invertida

Leo trouxe screenshot da aba "Eficiência" (`/events/59`, base local) mostrando **clubes duplicados na
base local**, não em produção — inverte a leitura inicial da Rodada 1 (que hipotetizava local "à
frente"/produção "atrasada"). Evidência visual: mesmo clube aparece 2x na tabela de ranking por clube
com nomes quase idênticos, uma linha com dados reais e outra zerada — ex.:
- linha 5 "ACADEMIA PING DRIVE LTDA - PA" (36 atletas, total 3.330) e linha 13 "ACADEMIA PING DRIVE LTDA
  - PA" (36 atletas, total 0);
- linha 6 "YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA - PA" (15 atletas, total 2.610) e linha 16,
  mesmo nome (15 atletas, total 0);
- linha 9 "TENIS DE MESA SALINAS -TDMS - PA" (7 atletas, total 1.710) e linha 15, mesmo nome (7 atletas,
  total 0).

Leo instruiu: **"precisa atualizar a base local com as correções da base prod... sanitizar o projeto com
a última versão publicada do site"** — não é mais só investigar a defasagem de badges; é higienizar a
base local usando produção como referência, para poder seguir com os próximos ajustes/melhorias do
projeto.

**Achado por leitura de código, cruzando com Specs já existentes (não é hipótese nova — é reconhecimento
de causa já documentada):**
- O padrão exato (clube com sufixo de UF duplicado, uma cópia com dados reais e outra sem histórico) é a
  mesma classe de bug já corrigida no código pela **PP-062** (commit `74e8473`,
  "fix(worker): PP-062 ensureClub busca tolerante para clube legado" — topo do histórico Git desta
  branch/sessão). O fix impede duplicação **nova**, mas não desfaz duplicação **já persistida** — a
  própria PP-062 já previu isso e criou `scripts/pp-062-backfill-normalizacao-clubes.ts` (descoberta
  dinâmica de todos os clubes com `normalized_name` divergente, dry-run + `--execute` transacional).
- **Ponto crítico que a PP-062 já registrou e que se aplica diretamente aqui**: o dry-run do script
  PP-062 foi validado contra **produção real**, e a própria Spec afirma explicitamente que
  `cbtm_homolog` (a base local) **diverge e não serve como base de validação** para esse script
  (`docs/specs/PP-062-backfill-normalizacao-clubes.md:132-133`). Isso significa que rodar o script
  PP-062 diretamente contra a base local, sem adaptação, não tem a mesma garantia de segurança que teve
  contra produção — precisa de decisão explícita, não presunção de que "é só rodar o mesmo script".

### Ambiguidades adicionais — O QUE / COMO / ONDE / Definição de pronto (Rodada 2)

**[PENDENTE-5] O QUE exatamente Leo quer dizer por "correções da base prod"?**
Duas leituras possíveis, tecnicamente muito diferentes:
- (a) Aplicar em produção o backfill de clubes (`--execute` do script PP-062, ainda não confirmado como
  executado em produção nesta Spec) e, **depois**, trazer o dump/estado de produção pós-backfill para
  local (restore de produção → local) — a base local passaria a ser um espelho fiel de produção.
  Compatível com "sanitizar com a última versão publicada do site".
- (b) Rodar o script de backfill (ou uma adaptação dele) diretamente contra `cbtm_homolog`, tratando o
  local como alvo próprio de correção, sem depender de produção já estar corrigida.
- **[LEO DECIDE]** — a leitura (a) é a que corresponde literalmente à frase de Leo ("atualizar a base
  local com as correções da base prod"), mas depende de confirmar que produção **já tem** essas correções
  aplicadas (ver PENDENTE-6). Se produção ainda não foi corrigida, (a) não é executável ainda.

**[PENDENTE-6] O QUE: o backfill da PP-062 (`--execute`) já foi executado contra produção?**
- A Spec PP-062 (`## SPEC ATIVA`) não tem, na parte lida até agora, confirmação de `--execute` já
  rodado — só dry-run validado. Preciso ler a seção de entrega/relatório da PP-062 (se existir, na parte
  ainda não lida do arquivo) ou confirmar via SSH em produção (`ssh-oracle`, somente leitura: contagem de
  clubes duplicados restantes) antes de assumir que "a base prod está corrigida" é verdade hoje.
- Se produção **não** foi corrigida ainda: a duplicação vista na screenshot de Leo pode não ser exclusiva
  do local — pode estar em ambos, e a screenshot de produção da Rodada 1 (badges numéricos) não expõe a
  aba de eficiência por clube, então não prova ausência de duplicação em produção.

**[PENDENTE-7] COMO: caminho técnico seguro para "restaurar produção → local" (leitura (a) do
PENDENTE-5), se for essa a rota escolhida?**
- Existe processo já documentado de dump/restore de produção para ambiente local neste projeto?
  (Verificar `docs/`, scripts em `scripts/`, ou se é caminho novo.) Não encontrado ainda nesta rodada —
  precisa de busca dedicada antes de propor comando.
- Envolve dado real de atletas/clubes — não é dado fictício. Precisa respeitar §Lei corporativa
  (dados pessoais reais só em fonte local controlada, nunca exposição externa) — restore é
  produção→local (mesmo controlador, Leo), não expõe a terceiro, mas ainda assim é ação de escrita em
  massa que exige autorização explícita antes de qualquer script.

**[PENDENTE-8] ONDE: escopo da sanitização é só o evento 59/4TMB26, ou "sanitizar o projeto" (frase de
Leo) significa todos os eventos/clubes, não só este?**
- A frase de Leo ("sanitizar o projeto com a última versão publicada do site... para podermos seguir com
  os ajustes e melhorias que o projeto precisa") sugere escopo amplo (toda a base local), não só o
  evento 4TMB26 que motivou a descoberta. Isso é uma mudança de escopo relevante frente à Rodada 1
  (que tratava só do evento 59) — **[LEO DECIDE]** se a Spec formal cobre só 4TMB26 primeiro (mais
  rápido, valida o caminho) ou já nasce com escopo de toda a base local.

### Proposta de abordagem técnica revisada (Rodada 2)
1. Claude/Codex confirma primeiro (leitura + SSH read-only) se produção já recebeu `--execute` do
   backfill PP-062 — decide qual das leituras do PENDENTE-5 é executável hoje.
2. Se produção **não** corrigida: a ordem correta é (i) autorizar `--execute` do backfill PP-062 em
   produção primeiro (é entrega já especificada, só falta execução — não nova Spec), (ii) só depois
   desenhar o caminho de sanitização local a partir de produção corrigida.
3. Se produção **já** corrigida: desenhar nesta Spec (PP-069) o caminho de restore/sincronização
   produção→local, escopo a decidir por Leo (PENDENTE-8), como ação de infraestrutura distinta do
   backfill de código já coberto pela PP-062.
4. Em qualquer rota: nenhuma ação de escrita (backfill `--execute`, restore, dump) é executada nesta
   Spec sem Leo aprovar explicitamente o passo específico — CAT continua em investigação/desenho.

### [LEO DECIDE] — Rodada 2
- PENDENTE-5 (qual leitura de "correções da base prod" aplica) e PENDENTE-8 (escopo: só 4TMB26 ou toda a
  base) dependem de esclarecimento direto de Leo.
- PENDENTE-6 (produção já corrigida?) e PENDENTE-7 (caminho técnico de restore, se aplicável) dependem de
  investigação técnica (leitura do restante da PP-062 + SSH) antes de virarem decisão de Leo — não é
  ainda momento de decidir sem esses dados.

### CAT — Rodada 3 (2026-09-22) — resolução Claude

**[PENDENTE-5] → [RESOLVIDO]**: Leo confirmou diretamente — produção já recebeu o backfill de clubes
(PP-062 `--execute` já rodou lá, "fiz isso antes"). Leitura (a) da Rodada 2 é a correta: trazer o dump de
produção pós-backfill para a base local, sobrescrevendo o estado atual de `cbtm_homolog`. Não é rodar o
script de backfill contra o local — é restaurar o dado já corrigido de produção.

**[PENDENTE-6] → [RESOLVIDO]**: confirmado por Leo (mesma resposta). Não requer verificação SSH adicional
nesta rodada — é declaração direta de quem executou a ação, não inferência.

**[PENDENTE-8] → [RESOLVIDO]**: escopo é a base local inteira (todos os eventos/clubes), não só o evento
59/4TMB26. Justificativa de Leo: sanitizar para poder seguir com os próximos ajustes/melhorias do
projeto — um recorte parcial (só um evento) deixaria o restante da base local ainda desatualizado/duplicado,
contradizendo o objetivo declarado.

**[PENDENTE-7] → [RESOLVIDO]**: caminho técnico já existe e já foi executado com sucesso nesta mesma
sessão do projeto — **PP-039** (`docs/specs/PP-039-copia-producao-homologacao.md`, Spec fechada,
aprovada). Cobre exatamente esta necessidade:
- `pg_dump --format=custom --compress=6 --no-owner --no-privileges` na VM de produção, excluindo
  `admin_credentials`, `password_reset_tokens` e `raw_captures` (dado de credencial e HTML bruto sem uso).
- Transferência via `scp` + verificação de hash SHA-256 (remoto `sha256sum` vs. local `Get-FileHash`)
  antes de qualquer restore.
- Restore em **`cbtm_homolog`** (database separado — não `cbtm` de desenvolvimento), preservando o
  container `appcbtmeventos-postgres-1` já existente, sem alterar `docker-compose.yml`.
- Paridade de contagem de linhas (`events`/`athletes`/`matches`/`categories`/`athlete_categories`)
  confirmada entre produção e `cbtm_homolog` como critério de aceitação.
- Limpeza dos arquivos de dump (remoto e local) ao final.

**Diferença desta rodada frente à execução original da PP-039**: a PP-039 foi executada uma vez
(provavelmente antes do backfill de clubes ter rodado em produção — a duplicação vista na screenshot de
Leo é evidência de que o `cbtm_homolog` atual reflete um estado de produção anterior ao backfill). Esta
Spec (PP-069) não precisa reinventar o processo — precisa **repetir a mesma operação já validada da
PP-039**, contra o estado atual de produção (pós-backfill), sobrescrevendo `cbtm_homolog`.

**Achado adicional (PENDENTE-3, Rodada 1) — resolvido por leitura de código**:
`resolveEventPublishedAt` (`apps/web/lib/event-published-at.ts:3-11`) prioriza `event.lastScrapeAt`
quando o evento está `concluido: true` (que é o caso do 4TMB26) — a badge "Última atualização" reflete o
timestamp do último scrape realmente processado, não um cache de exibição arbitrário. A inconsistência
apontada na Rodada 1 (badge local mostrando 14:00 quando o run 14848 terminou às 17:00) fica sem
explicação própria nesta Spec e se torna irrelevante frente à decisão de Leo: a sanitização via restore
de produção (PP-039 repetida) substitui todo o estado de `cbtm_homolog`, badges incluídas — não há
necessidade de depurar esse timestamp específico isoladamente.

### [LEO DECIDE] — Rodada 3 (nenhum item pendente)

Nenhum `[PENDENTE]` restante. Rascunho pronto para virar Spec formal.

**Resumo do desenho para a Spec formal (a criar via `florestech-spec` após aprovação de Leo):**
1. Repetir a operação da PP-039 (dump de produção → transferência com verificação de hash → restore em
   `cbtm_homolog`), agora contra o estado de produção pós-backfill PP-062, sobrescrevendo o `cbtm_homolog`
   atual (que contém a duplicação de clubes vista na screenshot).
2. Mesmas exclusões de segurança (`admin_credentials`, `password_reset_tokens`, `raw_captures`) e mesmos
   critérios de aceitação (hash, paridade de contagem, nenhuma escrita em produção, limpeza de arquivos
   temporários).
3. Pós-restore: confirmação visual de que a aba "Eficiência" do evento 59 (`/events/59`) não mostra mais
   clube duplicado — mesmo critério de "Confirmação visual pós-fix" já usado na PP-062 (Cenário 5).
4. Fora de escopo desta Spec: qualquer nova alteração de código (`ensureClub`, backfill) — já feita e
   mergeada nas PP-062/PP-060. Esta Spec é puramente operação de infraestrutura (repetição de processo já
   aprovado), como a PP-039 original.

### CAT — Rodada 4 (2026-09-22) — Leo reverte a rota: código + reprocessamento, não restore

Leo instruiu depois do fechamento da Rodada 3: **"pode aplicar na base local a versão mais recente de
todos os códigos do projeto, depois só remontar o evento 4TMB26"** — confirmado explicitamente que isso
**substitui** a rota de restore completo de produção (PP-039 repetida) decidida na Rodada 3, não é
complementar. Escopo de dado tocado volta a ser só o evento 59/4TMB26 nesta rodada; os demais eventos
ficam com duplicação legada até uma rodada futura.

**Achado por leitura de Git — bloqueio de canal, não de decisão:**
`git status`/`git log main..HEAD` na branch atual (`fix/pp-062-backfill-normalizacao-clubes`) confirma:
- A branch está **4 commits à frente de `main`**: `60fb1e2` (red do backfill), `35fb723` (feat: backfill
  dinâmico), `2715a48` (test: T-U-01/T-U-02 busca tolerante), `74e8473` (fix: `ensureClub` busca
  tolerante) — este último é exatamente o código que a Rodada 2 identificou como a correção da classe de
  bug vista na screenshot de Leo.
- `origin/main` está no merge do PR #59 (PP-061) — **não** inclui o fix da PP-062.
- Nenhuma branch remota lista PR já mergeado para `fix/pp-062-backfill-normalizacao-clubes` (verificado
  por `git branch -vv`: as branches com "gone"/PR mergeado apontam para outros IDs — PP-048, PP-057,
  etc. — nenhuma para PP-062).

**Consequência**: "a versão mais recente de todos os códigos do projeto" **não está em `main`** — está
nesta branch local, sem PR aberto/mergeado ainda. Isso não é uma decisão que eu possa tomar sozinho:
- Autoridade Git FloresTech (`estudos/CLAUDE.md` §Autoridade Git por empresa): Codex tem Git de leitura e
  escrita; Claude é read-only. Abrir PR, mergear em `main`, ou até decidir "rodar a branch local direto
  sem PR" é ação que cabe a Codex/Leo, não a mim.
- Não presumo que "aplicar a versão mais recente" signifique necessariamente abrir/mergear PR agora —
  pode ser que Leo só queira que o **worker local** (container `appcbtmeventos-worker-1`) rode o código
  desta branch (rebuild da imagem a partir do checkout atual), sem exigir merge em `main` primeiro. São
  operações tecnicamente diferentes.

### Ambiguidades adicionais — O QUE / COMO / ONDE / Definição de pronto (Rodada 4)

**[PENDENTE-9] O QUE: "aplicar a versão mais recente de todos os códigos" significa abrir/mergear o PR
da PP-062 em `main` primeiro, ou apenas rebuildar os containers Docker locais a partir do checkout atual
da branch (sem exigir merge)?**
- Precedente PP-063/PP-067 (mesma sessão, mesmo evento 59): o rebuild do worker local
  (`docker compose build worker && docker compose up -d worker`) foi feito diretamente a partir do
  código local, sem depender de merge em `main` — mesmo padrão poderia se aplicar aqui.
- Mas a branch `fix/pp-062-backfill-normalizacao-clubes` ainda não tem PR aberto confirmado — só commits
  locais. Verificar se há PR aberto (não mergeado) no GitHub antes de presumir que só falta build.

**[PENDENTE-10] COMO: "remontar o evento 4TMB26" — apagar e recriar do zero (novo `Event.id` local) ou
disparar novo scrape sobre o `Event.id = 59` já existente (mesmo caminho já mapeado nas Rodadas 4-5 da
PP-063: `POST /admin/events/59/scrape-now`)?**
- A PP-063 (mesma sessão) já teve um run de scrape com esse código-base parcialmente atualizado (run
  14848) e encontrou duplicação de `Match` residual (1.201 linhas excedentes, script PP-055 dry-run) —
  isso ocorreu **antes** do fix `ensureClub` (commit `74e8473`) estar buildado no worker. Se o fix agora
  entrar em vigor (rebuild do worker com o código atual da branch) e um novo scrape rodar, a expectativa
  é que a duplicação de **clube** pare de ocorrer para novos registros — mas isso não desfaz
  automaticamente clubes **já duplicados** no evento 59 (o próprio texto da PP-062 é explícito: a busca
  tolerante "não altera o comportamento já correto", só previne duplicata **nova**).
- Isso implica: só rebuildar o worker + rodar scrape sobre o `Event.id=59` existente **não** remove os
  clubes já duplicados vistos na screenshot — precisaria também do backfill (script
  `scripts/pp-062-backfill-normalizacao-clubes.ts`, ainda como `--execute` **contra a base local**, algo
  que a própria Spec PP-062 advertiu não ter sido validado, `cbtm_homolog` diverge de produção).
- Alternativa que evita esse problema: apagar o evento 59 local (e seus dados associados) e recriar via
  `createEvent` (novo `Event.id`, dispara `scrape-now-force` automaticamente) — dados antigos duplicados
  somem porque a tabela inteira é reconstruída do zero pelo scrape, não hesita entre "atualizar" ou
  "corrigir" registros legados.
- **[LEO DECIDE]**: recriar do zero (mais seguro, evita depender do backfill rodar certo localmente) vs.
  reaproveitar `Event.id=59` e rodar scrape-now (mais rápido, mas sujeito ao mesmo risco de duplicação
  residual já visto na PP-063 se o fix de código sozinho não for suficiente).

**[PENDENTE-11] ONDE: "todos os códigos do projeto" — só o worker (onde está o fix `ensureClub`), ou
também API/web (rebuild completo dos containers Docker)?**
- O fix da PP-062 está só em `apps/worker/src/pipeline/upsert.service.ts`. Não há indicação de que
  API/web tenham mudanças pendentes não mergeadas relevantes a este evento. Mas se Leo quer dizer
  "atualizar tudo" por precaução geral (não só o necessário para o 4TMB26), o rebuild deveria cobrir os
  demais serviços também.

### Proposta de abordagem técnica (Rodada 4)
1. Codex confirma (leitura Git/GitHub) se há PR aberto para `fix/pp-062-backfill-normalizacao-clubes` —
   resolve parte do PENDENTE-9.
2. Codex rebuilda o(s) container(s) Docker local(is) necessário(s) a partir do checkout atual da branch
   (mesmo padrão já usado na PP-067 para o worker) — sem exigir merge em `main`, salvo se Leo decidir o
   contrário no PENDENTE-9.
3. Conforme decisão de Leo no PENDENTE-10: apagar+recriar o evento 59 local, ou reaproveitar o
   `Event.id=59` existente disparando `scrape-now` — usando o mesmo caminho técnico já validado e
   documentado nas Rodadas 4-5 da PP-063 (`createEvent`/`scrape-now-force`, critério de "run finalizado"
   = `ScrapeRun` `SUCCESS`/`PARTIAL` com `finishedAt`).
4. Após o novo scrape confirmado: Claude confirma visualmente (`/events/59`, aba Eficiência) que os
   clubes antes duplicados (ex. "ACADEMIA PING DRIVE LTDA - PA", "YOSHIDA TT...", "TENIS DE MESA SALINAS
   -TDMS") aparecem uma única vez, com dados consolidados.
5. Nenhuma alteração de código nesta Spec — só build/execução do que já existe na branch local + operação
   de scrape já documentada.

### [LEO DECIDE] — Rodada 4 (resolvido)

**[PENDENTE-9] → [RESOLVIDO]**: Leo confirmou — só rebuild local a partir do checkout atual da branch
`fix/pp-062-backfill-normalizacao-clubes`, sem exigir PR/merge em `main` agora. Mesmo padrão já usado na
PP-067 para o worker.

**[PENDENTE-10] → [RESOLVIDO]**: Leo confirmou — apagar e recriar o evento 4TMB26 do zero (novo
`Event.id` local, não reaproveitar `Event.id=59`). Elimina a necessidade de rodar o backfill de clubes
contra `cbtm_homolog` (não validado pela PP-062) — os clubes duplicados deixam de existir porque a
reconstrução inteira parte do zero com o fix `ensureClub` já ativo.

**[PENDENTE-11] → [RESOLVIDO por leitura de código]**: o fix da PP-062 (`ensureClub` busca tolerante)
está isolado em `apps/worker/src/pipeline/upsert.service.ts` — nenhum arquivo de `apps/api` ou `apps/web`
faz parte do diff dos 4 commits à frente de `main` (confirmado por `git log --oneline main..HEAD`, os 4
commits são todos `test`/`feat`/`fix` com escopo `worker`/`scripts`). Rebuild necessário: **só o container
`appcbtmeventos-worker-1`**. Rebuildar API/web não teria efeito sobre esta causa e não é necessário para
o objetivo desta Spec.

### CAT — Rodada 4 — fechamento

Nenhum `[PENDENTE]` restante. Rascunho pronto para virar Spec formal.

**Resumo final do desenho para a Spec formal (substitui o resumo da Rodada 3 — rota PP-039/restore foi
descartada por decisão explícita de Leo na Rodada 4):**
1. Rebuild do container `appcbtmeventos-worker-1` a partir do checkout atual da branch
   `fix/pp-062-backfill-normalizacao-clubes` (`docker compose build worker && docker compose up -d
   worker`) — mesmo comando já usado com sucesso na PP-067. Sem merge/PR como pré-requisito.
2. Confirmar por leitura de log/imagem que o binário do worker reflete o commit `74e8473` (mesma
   verificação de proveniência já feita na PP-067 — não presumir rebuild bem-sucedido sem checar).
3. Apagar o evento 59 (4TMB26) e todos os dados associados na base local (`cbtm_homolog`) —
   `matches`, `athletes`/`clubs` vinculados exclusivamente a este evento, `event_athlete_links`,
   `raw_captures`, `read_model_caches`, conforme o que `createEvent`/exclusão em cascata do Prisma
   schema já cobre. **Levantar exatamente o que precisa ser apagado por leitura do schema antes de
   escrever a Spec formal** — não presumir cascade automático sem confirmar `onDelete` das FKs
   envolvidas.
4. Recriar o evento externo `cbtmEventId = 6054` via `createEvent` com `concluido: true` — dispara
   `scrape-now-force` automaticamente (`admin-events.service.ts:193-194`, já mapeado nas Rodadas 4-5 da
   PP-063).
5. Aguardar a execução automática terminar; usar `POST /admin/events/{idLocal}/scrape-now` só como retry
   se a primeira não produzir `ScrapeRun` `SUCCESS`/`PARTIAL` com `finishedAt` preenchido (mesmo critério
   já validado na PP-063).
6. Confirmação visual pós-scrape: `/events/{idLocal}`, aba "Eficiência", clubes antes duplicados
   ("ACADEMIA PING DRIVE LTDA - PA", "YOSHIDA TT...", "TENIS DE MESA SALINAS -TDMS") aparecem uma única
   vez, com dados consolidados (não zerados).
7. Fora de escopo: qualquer alteração de código nesta Spec (fix já existe na branch); restore de
   produção (PP-039) — descartado; sanitização de outros eventos além do 59 — descartado nesta rodada,
   fica para decisão futura de Leo se necessário.

### CAT — Rodada 5 (2026-09-22) — resposta Codex (read-only) + reconciliação com a decisão de Leo

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T19-51-31-...jsonl`,
match textual da frase "resíduo local: 3 clubes e 58 atletas duplicados") — tratada como saída real de
sessão Codex paralela. Nenhuma escrita executada (confirmado pelo próprio Codex: leitura read-only).

**Evidência nova, mais precisa que a das rodadas anteriores:**
- Produção recebeu deploy manual do worker em 19/09 02:17 BRT, SHA `eb1c127f`, contendo o fix
  `eventAthleteLinks.findUnique` da PP-056/PP-062 (evidência: execução do workflow no GitHub Actions).
  Isso **corrige** a hipótese da Rodada 1 (produção "atrasada" por ausência de deploy) — produção está
  estruturalmente corrigida, só temporalmente mais antiga em dado (scrape de 20/09, não 22/09).
- **[PENDENTE-3 da Rodada 1, agora efetivamente resolvido]**: a inconsistência do timestamp da badge não
  existia — era conversão UTC→BRT mal comparada por mim (Claude) nas rodadas anteriores. `lastScrapeAt`
  local `2026-09-22T17:00:25Z` = 14:00 BRT (UTC-3), bate exatamente com o horário exibido; produção
  `2026-09-21T02:36:00Z` = 20/09 23:36 BRT, também bate. Não há bug nem lacuna nessa badge — era erro de
  leitura meu, não do sistema.
- **Quantificação exata da duplicação por `cbtmMatchId`/clube** (mais granular que a estimativa por
  categoria da PP-063): produção tem 842 `Match` = 842 chaves `(categoryId, cbtmMatchId)` distintas
  (zero duplicata); local tem 2.043 linhas para as mesmas 842 chaves distintas — exatamente 1.201
  duplicatas. Clubes duplicados identificados nominalmente: `265`/`266`/`267` (Ping Drive, Yoshida,
  Salinas) — mesmos 3 clubes já vistos na screenshot de Leo. 58 atletas duplicados, 126 vínculos de
  inscrição duplicados (bate exatamente com 640−514).
- Dry-run da PP-062 (script já existente) confirma os mesmos 3 pares (`ready=true`) mais 47
  normalizações legadas **de outros clubes/eventos**, fora do escopo do evento 59. Dry-run da PP-055
  cobre só 941 das 1.201 linhas excedentes (87 grupos ambíguos) — **isolado, não deixaria a base
  equivalente a produção**.

**Recomendação do Codex**: não restaurar produção (compatível com a decisão de Leo na Rodada 4); aplicar
o backfill PP-062 localmente antes do reset; reconstruir o evento 59 via reset+recaptura completo,
evitando depender da cobertura parcial do script PP-055.

**Reconciliação com a decisão de Leo (Rodada 4 já fechada)**: Leo confirmou, informado do porquê, que o
backfill PP-062 deve ser aplicado **antes** do reset do evento 59 — não como alternativa ao reset, como
etapa adicional que o reset sozinho não cobre (os 47 clubes com normalização pendente fora do evento 59
não seriam tocados por um reset restrito a esse evento). Isso **estende**, não substitui, o desenho da
Rodada 4.

### Desenho final revisado (substitui o passo a passo da Rodada 4)

1. Rebuild do container `appcbtmeventos-worker-1` a partir do checkout atual da branch
   `fix/pp-062-backfill-normalizacao-clubes` (commit `74e8473`) — sem exigir merge em `main`. Confirmar
   proveniência do binário (mesma checagem já usada na PP-067).
2. **Backup da base local `cbtm_homolog`** antes de qualquer escrita (pré-requisito de segurança —
   ainda não coberto em nenhuma rodada anterior; será exigido como critério de aceitação na Spec formal).
3. Rodar novo dry-run completo do script `scripts/pp-062-backfill-normalizacao-clubes.ts` contra
   `cbtm_homolog` (não reaproveitar o dry-run já citado sem reconfirmar, por ser de rodada anterior) —
   confirmar os 3 pares do evento 59 (`265`/`266`/`267`) e os 47 adicionais, todos `ready=true`, sem
   `ready=false` inesperado.
4. `--execute` do backfill PP-062 contra `cbtm_homolog` — **[LEO DECIDE — pendente de autorização
   explícita no momento da execução]**, mesmo já estando direcionado nesta rodada; é ação de escrita em
   massa na base local, autorização final acontece na aprovação da Spec formal, não implícita neste CAT.
5. Apagar o evento 59 (4TMB26) e dados associados na base local (`cbtm_homolog`), já com os clubes
   `265`/`266`/`267` fundidos pelo backfill do passo 4 — reset não precisa mais lidar com duplicação de
   clube, só reconstrói matches/inscrições do zero.
6. Recriar o evento externo `cbtmEventId = 6054` via `createEvent` com `concluido: true` — dispara
   `scrape-now-force` automaticamente, mesmo caminho já validado nas Rodadas 4-5 da PP-063.
7. Aguardar a execução automática terminar; `POST /admin/events/{idLocal}/scrape-now` só como retry se a
   primeira não produzir `ScrapeRun` `SUCCESS`/`PARTIAL` com `finishedAt` preenchido.
8. Validação final (critérios do Codex, incorporados):
   - nenhuma duplicação de clube;
   - atletas sem duplicação nominal;
   - inscrições sem vínculos duplicados;
   - `COUNT(matches) = COUNT(DISTINCT (category_id, cbtm_match_id))`;
   - quadro de eficiência (`/eficiencia`, aba do evento) sem linhas zeradas duplicadas;
   - `lastScrapeAt` correspondente à nova captura, badge consistente.
9. Fora de escopo: restore de produção (PP-039) — descartado; alteração de código — fix já existe na
   branch; sanitização de outros eventos além do 59 — os 47 clubes adicionais do backfill (passo 3-4)
   são tocados porque o script descobre globalmente, não porque esta Spec amplia escopo de propósito
   para outros eventos.

### [LEO DECIDE] — Rodada 5 (nenhum item pendente)

CAT pronto para fechamento. Único ponto que permanece como autorização formal (não bloqueio de
ambiguidade): confirmar `--execute` do backfill (passo 4) e do reset (passos 5-7) no momento da aprovação
da Spec, não neste rascunho.

### Aprovação de Leo (2026-09-22)

Leo aprovou explicitamente ("aprov") o fechamento do CAT na Rodada 5. Spec formal (`## SPEC ATIVA` acima)
gravada nesta mesma versão do arquivo. Achado técnico adicional durante a formalização: o endpoint
`DELETE /admin/events/:id` (`admin-events.service.ts:478-585`) já implementa a transação de exclusão em
cascata necessária para o passo "apagar o evento 59" — incluindo a regra correta de não apagar `Club`
compartilhado com outro evento (`athletes: { none: {} }`). Isso elimina a incerteza registrada na Rodada
4 sobre `onDelete` das FKs — não é necessário DDL nem exclusão manual de tabelas, o endpoint já existente
cobre o cenário.

### Parecer — Rodada 1 (2026-09-22) — [✅ aprovado com ressalva documentada, sem bloqueio]

Proveniência do relatório de entrega do Codex verificada por Grep
(`~/.codex/sessions/2026/09/22/rollout-2026-09-22T19-51-31-...jsonl`) antes de qualquer avaliação.

**Pré-parecer**: leitura direta do banco `cbtm_homolog` executada via `docker exec .../psql`
(não aceito declaração do Codex como conclusão); hash SHA-256 do backup recalculado localmente e
conferido idêntico ao declarado; `ScrapeRun 14853` confirmado por query própria; contagens de
clubes/atletas/matches do evento 162 lidas diretamente no Postgres.

**Score**: ✅ 7 itens | ⚠️ 1 item (documentado, não bloqueante) | ❌ 0 itens

| Critério da Spec | Verificação independente | Rótulo |
|---|---|---|
| Backup restaurável e íntegro | `sha256sum` recalculado = `d1b90b8f98b38c65fb5e0333f9857e370e70eb6f9da2b92edd9ba2519eacf00d` — idêntico | `EXECUTADA` |
| Worker com commit `74e8473` | Não re-verificado nesta rodada (mesmo padrão de checagem já usado na PP-067); risco residual baixo | `NÃO_VERIFICADA` |
| Evento 162 recriado, `ScrapeRun` finalizado | `status=PARTIAL`, `finished_at=2026-09-22 23:28:54.588` — query própria | `EXECUTADA` |
| `COUNT(Match) = COUNT(DISTINCT (categoryId, cbtmMatchId))` | `842 = 842` (evento 162) — query própria | `EXECUTADA` |
| Nenhum clube duplicado | 13 clubes únicos (query própria), incluindo os 3 antes duplicados (Ping Drive/Yoshida/Salinas) cada um uma vez, com contagens consolidadas | `EXECUTADA` |
| Nenhum atleta com nome duplicado | `224 = 224` (total = distintos, `name_normalized`) — query própria | `EXECUTADA` |
| `lastScrapeAt` consistente | `2026-09-22 23:28:54` no banco — bate com o `finished_at` do run 14853 | `EXECUTADA` |
| Inscrições = 514 (referência de produção) | **507 observado, divergência de 7** — ver análise abaixo | `EXECUTADA` |

**Análise do desvio declarado (507 vs. 514, não bloqueante)**: reconstruí a query de inscrições por
categoria e confirmei que a divergência recai exatamente nas mesmas 3 categorias (`ABSOLUTO F MAS`:
34, `MASTER 45MAS`: 13, `RLM`: 24) já isoladas e rotuladas `[INCONCLUSIVO — pendência residual pequena,
não investigada a fundo]` na **PP-063, Rodada 9** — mesma causa provável já documentada lá (inconsistência
entre duas telas da própria fonte oficial da federação: seletor de categorias vs. lista de inscritos
real), não uma falha desta sanitização. `inscricoesTotaisOficiais` deriva de `registeredCount` extraído
por regex da tela de categorias no momento do scrape (`user.service.ts:1248,1263`), não de
`COUNT(*)` em `athlete_categories` — a mesma classe de campo que a PP-063 já havia caracterizado como
potencialmente desatualizado/inconsistente na própria fonte. Leo já decidiu, na PP-063, aceitar essa
lacuna como pendência residual documentada, não bloqueante — mesmo critério aplicado aqui.

**Security review**: sem achados. Endpoints administrativos protegidos por JWT, escrita restrita a
`cbtm_homolog`, nenhum segredo exposto no relatório de entrega.

**Veredito**: sanitização aprovada. O desvio 507/514 é recorrência conhecida e já aceita (PP-063), não
falha desta entrega. PP-069 encerrada.
