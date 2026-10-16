## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-22)

## Rascunho — PP-063 — Auditoria de dados: Troféu Eficiência FTMPA vs. sistema, 4ª etapa (evento 4TMB26 / id oficial 6054)

### Contexto recebido de Leo
- Imagem 1: "COLOCAÇÃO ATUALIZADA — TROFÉU EFICIÊNCIA" (documento oficial FTMPA), classificação consolidada
  por **clube**, colunas "3ª ETAPA", "4ª ETAPA (×3)", "TOTAL" — 13 clubes listados, ex.: 1º BEL.TT/CAMINHO DO
  BEM-PA com 37.050 + 10.470 = 47.520.
- Imagem 2: tela interna do sistema da federação para o evento "6054 - TMB Estadual - 4ª Etapa do
  Campeonato Paraense 2026 (19-20/09/2026) - Olímpico - Ranking - Rating", botão "Calcular os Pontos",
  tabela por clube com colunas 1º/2º/3º e Pontos, segmentadas em "Geral", "Rating" e "Ranking" — 13 clubes,
  ex.: 1º ASSOCIAÇÃO PARAENSE DE TÊNIS DE MESA-APTM com 3920 pontos Geral.
- Escopo desta rodada: **apenas a 4ª etapa (evento 4TMB26, id oficial FTMPA 6054)**. 1TMB26/2TMB26/3TMB26
  ficam para rodadas seguintes.
- Papéis: Claude aponta divergências + investiga causa provável; Codex faz exploração técnica (queries,
  leitura de código de scraping/cálculo).

### Achado já confirmado por leitura de código (Rodada 1, sem Codex)
O sistema **já tem** uma feature de ranking por clube: `computeEfficiencyRankingByModality`
(`apps/api/src/user/user.service.ts:3037`), exposta em `listEventEfficiency` (linha 2226) e na página
`/eficiencia` (`apps/web/app/eficiencia/`, `apps/web/app/user/eficiencia/`). Ela:
- agrega medalhas (ouro/prata/bronze) por clube, filtrando atletas elegíveis ao circuito estadual
  (`getStateCircuitEligibleClubIds`);
- pontua por `medalha × pesoMedalha × pesoTipoEvento`, onde `pesoTipoEvento` vem de
  `resolveEfficiencyCompetitionTypeWeight`/`resolveEfficiencyEventWeight` (linha 6803/6818) — pesos fixos
  por **tipo** de evento (ESTADUAL/NACIONAL/OPEN/COPA), vindos de `CBTM_RULES_CONFIG.ratingEventWeights`.

Isso já indica uma divergência estrutural de fórmula, não necessariamente um bug:
- Nosso cálculo pondera por **tipo de evento**, fixo.
- A imagem 1 da federação mostra multiplicador **×3 aplicado especificamente na 4ª etapa** somado à 3ª
  etapa sem peso — sugere um esquema de pontuação **por etapa dentro do circuito estadual** (peso
  crescente/pontual por etapa), não por tipo de evento.
- A imagem 2 é rotulada "Rating"/"Ranking"/"Geral" com pontos por colocação (1º/2º/3º) — não claramente
  "medalhas" no mesmo sentido do nosso `ouro/prata/bronze`. Pode ser um sistema de pontos por posição
  (tipo Fórmula 1) diferente de contagem de medalhas.

**Hipótese de trabalho**: a imagem 1 (Troféu Eficiência oficial) e a imagem 2 (tela "Calcular os Pontos" do
evento 6054) podem não ser o mesmo artefato que nosso `/eficiencia` — podem ser uma métrica paralela da
federação (talvez até calculada fora do sistema deles, ou em uma tela administrativa diferente da que
nosso scraper cobre). **Isso precisa ser resolvido antes de declarar qualquer divergência como bug nosso.**

### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**[PENDENTE-1] O QUE: a imagem 1 (Troféu Eficiência por clube, 3ª+4ª etapa×3) corresponde à nossa feature
`/eficiencia` (por clube) ou é uma métrica distinta da federação sem equivalente no nosso sistema hoje?**
- Se for a mesma métrica: nossa fórmula de peso por tipo de evento não bate com "×3 só na 4ª etapa" — a
  causa seria fórmula errada/desatualizada, não dado perdido.
  - Nossa Config de pesos (`EfficiencyConfig`/`EfficiencyConfigVersion`, schema.prisma:422/433) — precisa
    checar se há suporte a peso *por etapa dentro do mesmo circuito estadual* ou só por tipo de evento.
- Se for métrica distinta: talvez não haja nada a corrigir nesta rodada — só documentar que não temos
  paridade com essa tela específica da federação, e desenhar se vale a pena replicar.

**[PENDENTE-2] O QUE: a imagem 2 ("Calcular os Pontos" — Rating/Ranking, evento 6054) é o dado-fonte que a
federação usa para produzir a imagem 1 (Troféu Eficiência), ou é uma tela totalmente separada (rating CBTM
tradicional por colocação, não relacionado ao Troféu Eficiência)?**
- Preciso entender a relação entre as duas imagens antes de montar qualquer comparação numérica.

**[PENDENTE-3] ONDE: qual é o id do evento 6054/"4TMB26" no nosso banco (`Event.id` interno vs.
`cbtmEventId`/id externo da federação)?**
- Não encontrei ainda a tabela/coluna que armazena o id externo do evento na FTMPA. Preciso confirmar
  nome do campo em `Event` (schema.prisma:67) e se 6054 é esse id externo.

**[PENDENTE-4] COMO: temos captura bruta (raw HTML/JSON) do scraping desse evento 6054 na 4ª etapa,
suficiente para reconstruir manualmente a tabela "Rating/Ranking" da imagem 2 e comparar posição a posição
com o que persistimos?**
- Ver `apps/worker/src/scraper/capture.service.ts`, `raw-capture-retention.service.ts` — política de
  retenção pode já ter descartado a captura bruta dessa etapa.

**[PENDENTE-5] DEFINIÇÃO DE PRONTO: o que conta como "auditoria concluída" nesta rodada?**
Proposta (a confirmar com Leo/Codex):
1. Confirmar correspondência evento 6054 ↔ nosso `Event.id`.
2. Esclarecer PENDENTE-1/2 (natureza das duas imagens vs. nossa feature).
3. Se aplicável, reconstruir a tabela por clube (imagem 1 e/ou 2) a partir dos nossos dados e comparar
   linha a linha (posição, pontos, clube) — divergências completas documentadas com hipótese de causa
   (parser perdeu resultado / duplicação de clube residual pós-PP-062 / fórmula de peso diferente / erro
   da própria federação).
4. Entregar relatório de achados a Leo — **sem** implementar correção nesta rodada (é investigação; Spec
   de correção, se necessária, vem depois, ciclo separado).

### Proposta de abordagem técnica por item

1. Codex identifica o `Event.id` interno correspondente a "6054 - TMB Estadual - 4ª Etapa do Campeonato
   Paraense 2026" via query (`SELECT id, nome, "cbtmEventId" FROM "Event" WHERE ...` — nome exato do campo
   de id externo a confirmar).
2. Codex verifica se existe captura bruta retida (raw HTML/JSON) do scraping desse evento, útil para
   reconstruir a tela "Calcular os Pontos" (imagem 2) — `raw-capture-retention.service.ts`.
3. Codex roda `listEventEfficiency(eventId)` (ou equivalente via API/script local) para esse evento e
   retorna o output bruto (ranking por clube, pontuação, pesos aplicados).
4. Claude compara o output do passo 3 com a imagem 1 e/ou 2 (conforme resposta a PENDENTE-1/2), aponta
   divergências linha a linha e investiga causa (código de agregação, duplicação de clube, dados
   ausentes).
5. Se a causa for técnica auditável só por código (não por dado faltante), Claude lê os arquivos
   pertinentes (`user.service.ts` seções de eficiência, `EfficiencyConfig`/`EfficiencyConfigVersion`) e
   documenta a causa raiz — imediata e sistêmica.

### Hipótese de impacto técnico (arquivos / contratos / DDL)
- Leitura apenas nesta rodada — nenhuma alteração de código prevista.
- Arquivos candidatos a leitura adicional: `apps/api/src/user/user.service.ts` (blocos de eficiência
  completos, ~3031-4100 e 6658-6832), `prisma/schema.prisma` (models `Event`, `Club`, `Match`,
  `EfficiencyConfig`, `EfficiencyConfigVersion`), `apps/worker/src/pipeline/score-parser.ts`,
  `apps/worker/src/pipeline/match-merge.ts`, `apps/worker/src/scraper/capture.service.ts`.
- Sem DDL, sem mudança de contrato de API nesta rodada (é investigação).
- Domínio relacionado: clubes/duplicação (PEND recorrente, ver PP-053/057/058/060/062) — atenção elevada
  se a divergência aparecer como clube "faltando" ou "duplicado" na comparação.

### CAT — Rodada 2 (2026-09-22) — resposta Codex

Proveniência verificada por Grep em `~/.codex/sessions/2026/09/22/rollout-2026-09-22T12-47-48-...jsonl`
(match textual da frase "9.630 pontos para BEL.TT") — tratado como saída real de sessão Codex paralela.
Consultas somente leitura em produção, nenhum arquivo alterado.

1. **PENDENTE-1** — Paridade parcial, não confirmada. `/eficiencia` pondera por *tipo* de evento
   (`ESTADUAL` = ×3 fixo), sem campo de peso por etapa em `EfficiencyConfig`/`EfficiencyConfigVersion`. A
   fórmula "3ª etapa + 4ª etapa×3" da imagem 1 não corresponde à configuração atual da página. Isso sozinho
   não prova bug — pode ser fórmula/escopo diferente por design da federação.
2. **PENDENTE-2** — Indício, não prova. Imagem 2: 3.920 pontos para APTM. Nossa API: 11.610 para esse
   clube no evento; ÷3 (peso ESTADUAL) = 3.870 — 50 pontos de diferença da imagem 2. Números próximos mas
   não idênticos; não demonstra que "Calcular os Pontos" é a fonte da imagem 1. Sem captura dessa tela
   específica entre as abas coletadas pelo worker.
3. **PENDENTE-3 — RESOLVIDO.** `Event.id = 59`, `Event.cbtmEventId = 6054`, `nome = "4TMB26"`,
   `nivel = "ESTADUAL"` (schema.prisma:67).
4. **PENDENTE-4 — RESOLVIDO (parcial).** Captura bruta existe (evento 59: 58.169 `INSCRICOES`, 11.373
   `GRUPOS`, 23.121 `RESULTADOS`), mas `htmlBody` vazio em todas e 22.880 capturas de `RESULTADOS`
   truncadas (95 truncadas no último run) — worker limita corpo bruto a 25.000 caracteres por padrão
   (`capture.service.ts:59`, `scrape.processor.ts:686`) e **não captura a tela "Calcular os Pontos"**.
   Reconstrução direta da imagem 2 a partir da captura bruta: **não viável** com o que está retido.
5. **PENDENTE-5** — Critério proposto pelo Codex, compatível com a proposta original: registrar
   correspondência de IDs, preservar resultados da API, comparar as duas imagens com os dados do evento
   separando diferenças de fórmula/escopo/dados. Comparação linha a linha ainda depende dos valores
   completos das imagens (Leo já forneceu ambas as tabelas completas nas imagens do pedido original).

**Ponto concreto trazido pelo Codex, ainda não resolvido:** `GET /events/59/efficiency` (id de **produção**,
não usar como id local presumido — ver Rodada 4) retornou 13 clubes, pesos **130/80/50 ×3**, e **9.630
pontos para BEL.TT** na 4ª etapa — contra **10.470** na coluna "4ª ETAPA (×3)" da imagem 1. Diferença de
**840 pontos**. Nota de checagem corrigida na Rodada 4: 3.210 = 12×130 + 10×80 + 17×50 exatamente — é uma
combinação inteira redonda de 1º/2º/3º lugares, então **não** reforça por si suspeita de duplicação ou
resultado perdido. A causa dos 840 pontos de diferença permanece em aberto e exige comparação linha a
linha, não inferência aritmética.

### CAT — Rodada 3 (2026-09-22) — resolução Claude

- **[PENDENTE-1] → [RESOLVIDO]**: tratar como **mesma família de métrica, fórmula divergente confirmada**.
  Nossa página pondera por tipo de evento (ESTADUAL ×3 fixo), a federação pondera por etapa dentro do
  circuito (3ª sem peso, 4ª ×3) — mecanismos diferentes que coincidem no fator ×3 desta etapa específica
  por acaso de calendário (4ª etapa = ESTADUAL). Isso não decide sozinho se há "bug"; o ponto concreto do
  Codex (840 pontos de diferença em BEL.TT mesmo após ajustar o peso) é que decide — indica divergência de
  **dado**, não só de fórmula, nesta etapa.
- **[PENDENTE-2] → [RESOLVIDO]**: tratar a imagem 2 ("Calcular os Pontos" — Rating/Ranking) como **fonte
  primária plausível mas não confirmada** da imagem 1 (Troféu Eficiência). Os 50 pontos de diferença em
  APTM (3.920 vs 3.870) são pequenos o bastante para não descartar a hipótese, mas grandes o bastante para
  não fechá-la sem investigar linha a linha.
- **[PENDENTE-3]**: já `[RESOLVIDO]` pelo Codex — `Event.id = 59` ↔ `cbtmEventId = 6054` ↔ "4TMB26".
- **[PENDENTE-4]**: já `[RESOLVIDO]` pelo Codex — captura bruta existe mas é inútil para reconstruir a
  tela "Calcular os Pontos" (corpo truncado/vazio, tela não coberta pelo scraper). Isso implica que a
  comparação linha a linha só pode ser feita contra os **dados computados** que já temos (matches,
  resultados, medalhas por atleta/clube no evento 59), não contra uma cópia bruta da tela da federação.
- **[PENDENTE-5] → [RESOLVIDO]**: critério de conclusão desta rodada —
  1. Reconstruir, a partir do nosso banco (evento 59), a contagem de medalhas/colocações por clube que
     alimenta `computeEfficiencyRankingByModality`.
  2. Comparar clube a clube contra a imagem 1 completa (13 linhas) e a imagem 2 completa (13 linhas) — Leo
     já forneceu as duas tabelas inteiras nas imagens do pedido original, não é necessário pedir de novo.
  3. Para cada clube com divergência: classificar causa como `[fórmula]` (peso por etapa vs. tipo),
     `[dado ausente/perdido]` (parser/scraper), `[duplicação residual]` (retomar suspeita PP-053/057/058/060/062)
     ou `[origem federação]` (dado da própria imagem inconsistente entre si).
  4. Entregar relatório de achados a Leo. Sem implementação de correção nesta rodada.

### [LEO DECIDE]
- Nenhum item ficou bloqueado em decisão exclusiva de Leo nesta rodada — os pendentes foram resolvidos por
  evidência (Codex) ou por leitura de código (Claude). Rascunho pronto para aprovação.

### Instrução adicional de Leo (2026-09-22) — rigor + ambiente Docker local

Leo instruiu, antes de aprovar o fechamento:
1. **Rigor**: só ajustar/corrigir aquilo que for **certeza** de problema. Divergência numérica sozinha
   (ex.: os 840 pontos em BEL.TT, os 50 em APTM) não é, por si, certeza — é gatilho de investigação. Toda
   conclusão de "isto está errado" nesta auditoria precisa de rastro até causa raiz identificada (linha de
   código, resultado de match específico, clube duplicado confirmado por id) — não apenas "os números não
   batem".
2. **Ambiente**: exploração de Claude e Codex nesta auditoria usa a **stack Docker local**
   (`appcbtmeventos-api-1`, `-worker-1`, `-postgres-1`, `-redis-1`, `-frontend-1` — confirmados `Up` nesta
   sessão), não produção. Isso é consistente com §Homologação — nunca aceitar como fonte de verdade dado
   de produção quando o objetivo é explorar/testar hipótese, e reduz risco de qualquer ação acidental em
   dado real de atleta/clube.
3. **Pré-requisito operacional**: o evento 59 (4TMB26/6054) precisa estar **atualizado na base local**
   antes de qualquer comparação — a base Docker local pode estar desatualizada frente ao estado mais
   recente do site da federação (a 4ª etapa terminou 20/09/2026, há 2 dias).

**Caminho descartado após checagem do Codex**: `Event.id = 59` é id de **produção**. Na base Docker local o
maior `Event.id` é 49 — o evento 6054/4TMB26 **não existe ainda** localmente. `SCRAPE_EVENT_IDS=59`
sozinho não funciona mesmo se o id existisse: `run-once.ts:88` (`if (!policy.autoSchedule) continue`) filtra
antes de `isForcedSelection` (linha 92) ser considerado, e o motivo usado nesse caminho é
`scheduled-auto-${policy.reason}` (linha 102) — que `scrape.processor.ts:328` não reconhece como
`scrape-now-force`, logo eventos concluídos continuam sendo ignorados por essa via. Citações verificadas
por leitura direta em 2026-09-22 — conferem exatamente com o código.

### CAT — Rodada 4 (2026-09-22) — validação técnica Codex + correção Claude

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T12-47-48-...jsonl` e
`...T12-54-50-...jsonl`) — tratada como saída real de sessão Codex. Codex não executou scrape nem alterou
o rascunho; apenas validação de leitura.

**Caminho correto de atualização (substitui o anterior):**
1. Cadastrar localmente o evento externo `cbtmEventId = 6054` na base Docker, com `concluido: true` —
   gera um `Event.id` local próprio (não será 59; id de produção não é reaproveitável).
2. `createEvent` já dispara automaticamente o scrape quando `concluido: true`
   (`admin-events.service.ts:193-194`, `if (event.concluido) { await this.queue.enqueueScrapeNow(event.id); }`)
   usando motivo `scrape-now-force` (`queue.service.ts:117`) — o mesmo motivo que
   `scrape.processor.ts:328` reconhece para processar evento concluído. **Não repetir o disparo
   imediatamente após o cadastro.**
3. Confirmar o `Event.id` local atribuído e aguardar essa primeira execução automática terminar.
4. `POST /admin/events/{idLocal}/scrape-now` (`admin-events.controller.ts:80`) fica reservado como
   **tentativa de repetição** — só usar se a primeira execução (passo 2) não produzir dados utilizáveis
   (falhar, ficar incompleta, ou não gerar `ScrapeRun` finalizado). Disparar de imediato sem checar o
   resultado da primeira execução pode gerar duas execuções desnecessárias.
5. Critério de "atualizado": existe `ScrapeRun` para esse evento com `status` em `SUCCESS` ou `PARTIAL` e
   `finishedAt` preenchido — mesmo critério que `getLatestReliableScrapeRunIdForScope`
   (`user.service.ts:7235-7248`) usa para servir dado ao usuário final. Confirmar isso antes de qualquer
   leitura de comparação.
6. Após o run confirmado, conferir os dados capturados (contagem de matches/resultados) antes de comparar
   com as imagens — não assumir que "run SUCCESS" sozinho implica captura completa.

### Ajuste ao critério de conclusão (substitui a versão anterior)

1. Codex cadastra o evento externo 6054 na base Docker local com `concluido: true`, identifica o
   `Event.id` local resultante e aguarda a execução automática (`scrape-now-force` disparado pelo próprio
   `createEvent`) terminar — só usa `POST /admin/events/{idLocal}/scrape-now` manualmente como retry, se
   essa primeira execução não produzir `ScrapeRun` finalizado utilizável.
2. Codex confirma `ScrapeRun` `SUCCESS`/`PARTIAL` com `finishedAt` preenchido para esse evento antes de
   prosseguir, usando o **ID atribuído no banco local** (nunca presumir 59).
3. Codex reconstrói, a partir da base local pós-atualização, a contagem de medalhas/colocações por clube
   do evento (o que alimenta `computeEfficiencyRankingByModality`) e roda `GET /events/{idLocal}/efficiency`
   para obter o valor atualizado.
4. Claude compara clube a clube contra a imagem 1 completa e a imagem 2 completa (ambas já fornecidas por
   Leo no pedido original).
5. Para cada divergência restante após a atualização: só entra como "certeza de problema" (candidato a
   correção) se houver evidência rastreável — não estimativa nem coincidência aritmética (ver correção do
   caso 3.210 = 12×130+10×80+17×50 acima). Rótulos válidos por item:
   - `[CONFIRMADO — causa nossa]`: rastro concreto (ex. clube duplicado com dois ids ainda ativos, match
     ausente no banco que existe no site oficial, erro de fórmula comprovado no código).
   - `[CONFIRMADO — origem federação]`: as duas imagens da própria federação são inconsistentes entre si
     ou com o site público, verificável sem depender do nosso dado.
   - `[INCONCLUSIVO]`: divergência numérica persiste mas sem causa rastreável nesta rodada — registrado
     como pendência para investigação futura, **não** vira correção agora.
6. Nenhuma correção de código é aplicada nesta rodada de investigação — mesmo itens `[CONFIRMADO — causa
   nossa]` só viram Spec de correção em ciclo separado, após este relatório ser entregue e revisado por Leo.

### Validação técnica de Leo (2026-09-22) — ajuste ao caminho de atualização

Leo confirmou por leitura direta (`admin-events.service.ts:193-194`) que `createEvent` com
`concluido: true` já enfileira `scrape-now-force` automaticamente. Ajuste incorporado acima: o
`POST /admin/events/{idLocal}/scrape-now` deixa de ser o passo 3 padrão e passa a ser **tentativa de
repetição**, condicionada à primeira execução automática não produzir dados utilizáveis — evita duas
execuções desnecessárias. Codex deve usar o ID atribuído no banco local e conferir run finalizado + dados
capturados antes de qualquer comparação. Esta é validação técnica do caminho; o fechamento formal do CAT
segue exigindo aprovação de Leo e Claude.

### CAT — Rodada 5 (2026-09-22) — execução Codex: pré-requisito de atualização NÃO satisfeito

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T12-47-48-...jsonl`,
mesma sessão já confirmada) — mensagem sem prefixo explícito de atribuição, mas descreve execução real
(run id, contagens antes/depois) consistente com continuação do trabalho já rastreado nesta sessão.

**Correção de identificação do banco**: a stack Docker local (API + worker) usa `cbtm_homolog`, não
`cbtm` — o evento 59/6054/"4TMB26" **já existia** em `cbtm_homolog`. A conclusão da Rodada 4 de que o
evento "não existe localmente" (maior id 49) partiu de consulta ao banco errado (`cbtm`). Isso **não**
invalida a lógica do caminho de atualização (createEvent → scrape-now-force → scrape-now como retry) —
só o diagnóstico de que seria necessário cadastrar o evento do zero.

**Execução real**: scrape forçado disparado no worker local contra `cbtm_homolog`, evento 59. Run
**14846** terminou em **`ERROR`** — colisão na constraint única `(event_id, athlete_id)` de
`event_athlete_links`, o mesmo sintoma documentado em PP-056.

**Achado que exige registro cuidadoso — o fix da PP-056 está presente no código e mesmo assim o erro
recorreu.** Verificado por leitura direta (`apps/worker/src/pipeline/upsert.service.ts:2000-2040`): o
código atual já tem o padrão `findUnique` por `(eventId, athleteId)` seguido de `update` por id quando a
`athleteKey` mudou (exatamente a correção descrita na PP-056 v2, linhas 2010-2020), antes de cair no
`upsert` por `(eventId, athleteKey)` no bloco `else` (2021-2040). O run 14846 falhando com o mesmo tipo de
erro, com esse código já presente, é **um caso não coberto pelo fix original**, não uma ausência do fix —
requer investigação de causa raiz própria (candidato a PP-056 v3 ou nova Spec), fora do escopo desta
auditoria. Não concluir sozinho qual branch do código falhou sem tracing/log da execução 14846.

**Estado dos dados após o run com erro**: gravação parcial confirmada — `matches` passou de 1.715 para
1.972 antes da falha. O último run que satisfaz o critério de confiabilidade (`SUCCESS`/`PARTIAL` +
`finishedAt` preenchido — critério já fixado na Rodada 4, `user.service.ts:7235-7248`) continua sendo o
**run 14658, de 2026-09-18**. Portanto: **não há, nesta stack local, uma base pós-4ª-etapa confiável para
reconstrução da contagem por clube.** Comparação linha a linha permanece bloqueada.

Ação de infraestrutura registrada: estrutura vazia de `raw_captures` foi restaurada em `cbtm_homolog`
(necessária para o worker gravar a tentativa de captura) — agora contém 286 capturas. Nenhum código
alterado, nenhuma ação em produção.

### [LEO DECIDE] — bloqueio de escopo

O CAT não pode fechar com a comparação linha a linha como próximo passo imediato — falta base de dados
local atualizada e confiável. Duas rotas possíveis, ambas fora do escopo original desta auditoria (que
previa só leitura/comparação, sem correção de código):

1. **Investigar e corrigir o caso residual de `event_athlete_links`** (nova Spec, ex. PP-056 v3 ou
   PP-064) antes de conseguir atualizar o evento 59 localmente — só então a auditoria PP-063 poderia
   prosseguir com dado local confiável e atualizado.
2. **Aceitar o run 14658 (18/09) como base desta rodada da auditoria**, documentando explicitamente que
   os dados podem não refletir eventuais correções/ajustes que a federação tenha feito ao site entre
   18/09 e 20/09 (fim da 4ª etapa) — e registrar essa limitação no relatório final em vez de bloquear a
   auditoria integralmente.

Leo decide qual rota seguir. Claude não infere prioridade entre corrigir o bug de sincronização agora
versus prosseguir com dado potencialmente desatualizado.

### Decisão de Leo (2026-09-22)

**Rota 1 — investigar.** PP-063 (auditoria de dados) fica **pausada/bloqueada** até a causa raiz do caso
residual de `event_athlete_links` (falha do run 14846 apesar do fix da PP-056 já estar no código) ser
investigada. Essa investigação é tratada como item separado: **PP-067**
(`docs/specs/PP-067-investigacao-event-athlete-links-residual.md`) — PP-064/065/066 já estão em uso por
outros trabalhos em andamento, confirmado por Leo. Não como parte do escopo de auditoria de dados desta
Spec.

### Desbloqueio (2026-09-22) — PP-067 concluída

Causa raiz confirmada em PP-067: **não é bug de código, é imagem Docker do worker local desatualizada**
(buildada em 2026-09-18, antes do fix da PP-056 de 2026-09-19). O código-fonte já está correto; o binário
rodando no container não.

Ação necessária antes de retomar: `docker compose build worker && docker compose up -d worker`, seguido
de novo scrape-now (`createEvent`/`scrape-now`, caminho já validado nas Rodadas 4-5 desta Spec) para o
evento 59, confirmando `ScrapeRun` `SUCCESS`/`PARTIAL` com `finishedAt` preenchido antes de retomar a
comparação linha a linha. PP-063 volta ao estado "pronta para execução do caminho de atualização" assim
que isso for feito.

### CAT — Rodada 6 (2026-09-22) — rebuild concluído, novo bloqueio: auditoria interna de divergência

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T13-48-56-...jsonl`).

**Rebuild e scrape confirmados**: imagem worker reconstruída (22/09 13:51 -03), binário contém o
`findUnique` do fix da PP-056. Run **14848** para o evento 59: `status = PARTIAL`,
`finished_at = 2026-09-22 17:00:25.258`. Matches: 1.972 → 2.043. Matches com placar estruturado: 1.443 →
1.515. 273 capturas vinculadas ao run. Critério de "run finalizado" (Rodada 4: `SUCCESS`/`PARTIAL` +
`finishedAt` preenchido) **satisfeito**.

**Novo bloqueio, mais grave que o anterior**: o run emitiu 10 advertências, incluindo
`AUDITORIA_PARTIDAS_DIVERGENCIA` — 43 categorias com **847 partidas esperadas** (conforme
`officialMatchesCount`, extraído da página de categorias descobertas na própria fonte oficial durante o
scrape — `scrape.processor.ts:1387`) vs. **2.043 partidas observadas** (`COUNT(*)` real da tabela `Match`
para essas categorias, fases `GRUPOS`/`RESULTADOS` — `scrape.processor.ts:1456-1464`). Confirmado por
leitura direta do código de auditoria (`runScrapeConformanceAudit`, `scrape.processor.ts:1370-1660`): esta
NÃO é uma comparação com as imagens da federação (isso ainda não foi feito) — é uma auditoria interna do
próprio pipeline, comparando o que o site informa como total oficial de partidas por categoria contra o
que foi persistido no nosso banco. Um fator ~2,4x de partidas observadas sobre esperadas é consistente com
suspeita histórica de duplicação de `Match` (mesma classe de causa de PP-053/057/058/060/062).

**Rigor aplicado**: por instrução de Leo (§Instrução adicional, acima), esta divergência **não** é tratada
como certeza de problema sem rastro — é gatilho de investigação. A base local pós-run 14848, mesmo
"finalizada" no critério anterior, **não deve ser usada para a comparação por clube da PP-063 ainda**:
proceder agora arriscaria contaminar a comparação com matches duplicados, produzindo falsos positivos de
divergência contra as imagens da federação.

**Script de diagnóstico já existente e reutilizável** (não executado nesta rodada):
`scripts/pp-055-saneamento-matches-duplicados.ts` — mesmo padrão dry-run/execute usado em saneamentos
anteriores. Fora de escopo desta Spec decidir sozinho por rodá-lo; é ação de escrita em dado (mesmo que
local), portanto **[LEO DECIDE]**.

### [LEO DECIDE] — Rodada 6

PP-063 permanece pausada. Duas rotas possíveis para o novo bloqueio:
1. **Investigar antes de comparar** (mesmo padrão da Rodada 5): confirmar se as 2.043 partidas persistidas
   têm duplicatas reais (mesmo confronto gravado 2x+) usando `scripts/pp-055-saneamento-matches-duplicados.ts`
   em modo dry-run (somente leitura) contra `cbtm_homolog`, antes de qualquer saneamento.
2. **Prosseguir mesmo assim**, tratando a divergência de contagem como um achado a registrar no relatório
   final da PP-063 em vez de bloquear — mas isso arrisca contaminar a comparação por clube com dado
   duplicado, indo contra a instrução de rigor de Leo.

Claude recomenda a rota 1 (dry-run do script existente, somente leitura, sem nova Spec — é diagnóstico,
não correção) antes de qualquer comparação. Leo decide.

### CAT — Rodada 7 (2026-09-22) — resultado do dry-run: duplicação confirmada, mas não explica tudo

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T13-48-56-...jsonl`).
Dry-run confirmado somente-leitura: `beforeTotal = afterTotal = 2.043`, `removedMatchIds: 0`, `cache
invalidado: não`. Executado com `tsx` em vez de `ts-node` (falha de resolução de import) — mudança de
runtime de execução do script, não de comportamento; `--execute` não foi passado em nenhum momento.

**Resultado do dry-run** (`scripts/pp-055-saneamento-matches-duplicados.ts --event-id 59`):
- 477 grupos de duplicatas: 390 `eligible`, 87 `ambiguous`.
- 941 candidatos a remoção (só nos grupos `eligible`).
- Duplicatas presentes nas mesmas 43 categorias que a auditoria do run 14848 apontou como divergentes —
  **mas o relatório não expõe IDs por categoria, então não é possível confirmar (só é forte indício) que
  são exatamente a mesma população de partidas**, não apenas a mesma contagem de categorias.

**Achado central — a matemática não fecha, checagem feita pelo próprio Codex e verificada aqui:**
- Esperado (fonte oficial): 847. Observado atual: 2.043. Diferença: 1.196.
- Removendo só os 941 elegíveis: 2.043 − 941 = **1.102** — ainda **255 acima** do esperado.
- Removendo elegíveis + ambíguos (todas as 1.201 linhas excedentes, incluindo as 260 ambíguas com sinal de
  resultado persistido): 2.043 − 1.201 = **842** — **5 abaixo** do esperado.

**Conclusão de rigor: duplicação de `Match` é uma causa real e confirmada (941 grupos elegíveis, sem
ambiguidade), mas não é a causa completa/única da divergência de 1.196 partidas.** Nenhum cenário de
remoção (só elegíveis, ou elegíveis+ambíguos) bate exatamente com o total esperado pela fonte oficial —
sobra 255 a mais, ou falta 5. Isso indica pelo menos uma das hipóteses adicionais, não confirmadas:
1. O "esperado" (`officialMatchesCount`, extraído da página de categorias no momento do scrape) pode estar
   desatualizado ou ele mesmo ter uma imprecisão pequena (a diferença de "-5" no cenário mais agressivo é
   pequena o bastante para ser explicada por WO/ausência não contabilizada na própria fonte).
2. Pode haver uma segunda classe de match "extra" não capturada pelo critério de duplicata do script
   PP-055 (esse script provavelmente identifica duplicatas por `cbtmMatchId` repetido — um match
   verdadeiramente diferente, mas incorretamente gerado por outro bug, não apareceria como duplicata dele).
3. As 87 divergências `ambiguous` (260 linhas excedentes) podem conter uma mistura de "de fato duplicado,
   mas com sinal de resultado divergente entre as cópias" e "não duplicado, só parecido" — precisa
   inspeção manual de amostra, não decisão em massa.

**Login corrigido**: hash de `Mushin-dosha` ajustado em `cbtm_homolog` (dado de teste local, não produção)
para permitir novo login — usado só para a leitura, sem escrita destrutiva.

### [LEO DECIDE] — Rodada 7

Nenhuma remoção foi executada (`--execute` não usado). A divergência de 255/5 partidas não permite fechar
com certeza que "remover os 941 elegíveis resolve" — pela regra de rigor, isso não é ainda candidato a
`--execute`. Próximos passos possíveis, todos ainda de investigação (não correção):
1. Amostrar 3-5 grupos `ambiguous` manualmente (Codex traz os `cbtmMatchId`/dados de cada cópia) para
   entender por que têm sinal de resultado divergente — pode revelar se são duplicatas reais mal
   classificadas ou outra coisa.
2. Cruzar 1-2 categorias específicas (ex. "1994 ADULTO MAS": 201 partidas, 166 só em grupos ambíguos, zero
   elegíveis) diretamente contra a página oficial do evento, contagem manual, para calibrar se o
   "esperado" da fonte está correto.
3. Aceitar a lacuna de 255/5 como pendência a registrar no relatório final da PP-063 e prosseguir mesmo
   assim com a comparação por clube, documentando explicitamente que a base tem duplicação residual não
   sanada — risco: a comparação por clube pode ficar poluída nas categorias afetadas.

Claude não decide sozinho entre aprofundar (1-2) ou aceitar a lacuna documentada (3) — pede direção de
Leo.

### Decisão de Leo (2026-09-22) — auditoria completa com engenharia reversa

Leo escolheu rota de aprofundamento máximo, não a lacuna documentada: fazer engenharia reversa completa
do evento 59, identificando (a) rotas erradas no algoritmo do nosso pipeline e (b) possíveis erros nos
dados oficiais da própria federação — cada conclusão exigindo **justificativa sólida e incontestável**,
não inferência agregada. Isto eleva o padrão de evidência de "rótulo por item" (Rodada 4/6) para
"reconstrução verificável caso a caso" nas categorias problemáticas.

### CAT — Rodada 8 (2026-09-22) — plano de engenharia reversa

**Princípio**: nenhuma conclusão de causa entra como `[CONFIRMADO]` sem reconstrução verificável — ou o
`cbtmMatchId` específico existe duas vezes com o mesmo confronto (duplicata real, prova = os dois registros
lado a lado), ou o confronto no nosso banco não tem correspondência na fonte oficial (dado nosso incorreto,
prova = ausência confirmada na página oficial), ou a fonte oficial informa um total que não bate com a
contagem de confrontos que ela mesma lista (erro da federação, prova = a própria página oficial
inconsistente internamente, sem depender do nosso dado).

**Escopo**: as 43 categorias com divergência do evento 59 (4TMB26/6054), priorizando as de maior volume
(1994 ADULTO MAS: 201/166 ambíguo-only; 1952 ABSOLUTO G MAS: 162/100 elegível; 1963 ROM: 134/69; 1951
ABSOLUTO F MAS: 133/79).

**Etapa 1 — Codex: dump completo por categoria (leitura, sem alteração)**
Para cada uma das 43 categorias, extrair:
1. Todos os `Match` persistidos (id, `cbtmMatchId`, `categoryId`, `phase`, `p1Sets`/`p2Sets`, `scoreRaw`,
   `matchDatetime`, `tableNumber`, `fetchedAt`, `updatedAt`) — não só a contagem.
2. O `officialMatchesCount` exato que a fonte informou para essa categoria neste scrape (já capturado no
   momento do run 14848 — buscar no dado bruto/raw capture correspondente, não recalcular).
3. Se houver raw capture retida da fase `RESULTADOS`/`GRUPOS` dessa categoria (mesmo truncada), extrair os
   `cbtmMatchId` que aparecem nela, para cruzar contra o que foi persistido.

**Etapa 2 — Codex: classificação objetiva por grupo de duplicata**
Para os 477 grupos já identificados pelo script PP-055 (390 eligible + 87 ambiguous), trazer o detalhe
completo de cada grupo (não só a contagem): `cbtmMatchId`, todas as cópias com seus campos de resultado,
qual foi `kept` e quais `obsolete` pelo critério do script, e — para os `ambiguous` — o motivo específico
(`reason`) que o script atribuiu a cada um.

**Etapa 3 — Claude: reconstrução verificável, categoria a categoria**
Usando o dump da Etapa 1-2, para cada categoria com divergência:
1. Contar `cbtmMatchId` únicos persistidos vs. `officialMatchesCount` da própria fonte.
2. Se `cbtmMatchId` únicos == `officialMatchesCount`: a divergência bruta (`Match` rows > matches oficiais)
   é 100% duplicata de linha (mesmo confronto, múltiplas linhas) — `[CONFIRMADO — causa nossa]`, prova =
   contagem de `cbtmMatchId` distintos bate com o oficial.
3. Se `cbtmMatchId` únicos > `officialMatchesCount`: há confrontos no nosso banco que não deveriam existir
   segundo a fonte — investigar se são WO/byes não contados pela fonte (hipótese a testar, não assumir) ou
   dado nosso genuinamente incorreto (ex. de outra categoria, merge errado).
4. Se `cbtmMatchId` únicos < `officialMatchesCount`: dado nosso está faltando confronto que a fonte diz
   existir — possível falha de captura (score-parser, match-merge) nesta categoria específica.
5. Para grupos `ambiguous`: inspecionar cada `reason` do script — se o motivo for "sinal de resultado
   diferente entre cópias", verificar manualmente qual cópia bate com o placar real (se houver forma de
   confirmar) antes de classificar.

**Etapa 4 — Claude: checagem de consistência interna da fonte oficial**
Para as categorias onde a hipótese de erro da federação for levantada (Etapa 3, item 3): verificar se o
`officialMatchesCount` bate com o número de confrontos que a própria página lista quando enumerados (não
comparar contra nosso dado) — evidência de erro da federação precisa ser interna à fonte oficial, nunca
inferida a partir da nossa divergência.

**Critério de conclusão desta rodada**: relatório final com cada uma das 43 categorias rotulada
`[CONFIRMADO — causa nossa]`, `[CONFIRMADO — origem federação]` ou `[INCONCLUSIVO]`, com a prova específica
de cada rótulo (não just a contagem agregada). Só então a comparação por clube da PP-063 é retomada — com
os `Match` duplicados confirmados já identificados (não necessariamente removidos; remoção é ação de
escrita, exige nova autorização de Leo em rodada separada).

### Correção de hierarquia normativa (2026-09-22) — manual oficial CBTM 2026, não as duas fontes entre si

Leo corrigiu o enquadramento: nenhuma decisão desta auditoria é definida por comparação entre nosso
sistema e o site da federação isoladamente — ambos devem obedecer ao **Manual do Tênis de Mesa 2026** e ao
**Regimento Interno CBTM**, fornecidos por Leo em `docs/Manual_TM_2026(2).pdf` (155 páginas) e
`docs/regimento_interno_cbtm.pdf` (258 páginas). A autoridade normativa é o manual, não a maior/menor
verossimilhança entre as duas fontes de dado.

**Extração já realizada** (`pdftotext -layout`, cobertura de texto confirmada nas duas fontes, ferramenta
`poppler` instalada localmente via winget nesta sessão para viabilizar leitura — nenhuma renderização de
página específica ainda pendente, texto puro foi suficiente para as seções localizadas):

- **Manual TM 2026, item 1.9.1.8.1**: "Caso o W.O. ocorra na fase de grupos, seus resultados anteriores,
  caso haja, serão anulados." — confrontos jogados por um atleta que depois leva W.O. na fase de grupos
  podem ter seus resultados anulados. **Hipótese normativa a testar**: se a contagem "oficial" que a
  fonte da federação publica já reflete essa anulação (não conta partidas de um atleta W.O.), mas o nosso
  banco persiste o resultado original antes da anulação, isso geraria divergência "observado > esperado"
  **sem ser duplicata nem erro de captura** — seria comportamento correto do nosso lado frente a um dado
  que a própria federação trata como anulado. Precisa cruzar contra `Athlete`/`Match` com sinal de W.O. nas
  categorias afetadas.
- **Manual TM 2026, item 1.9.1.7 e tabela associada**: formato de grupos é confirmado como todos-contra-
  todos dentro de grupos de 3-4 atletas (a partir de 65 inscritos) ou eliminatória simples direta (a partir
  de 129 inscritos) — confrontos por grupo de N atletas = N×(N-1)/2. Serve de base para calcular o
  "esperado" teórico por categoria a partir do número de inscritos, como checagem cruzada independente do
  `officialMatchesCount` da fonte.
- **Manual TM 2026, item 1.9.2.10 e 1.9.2.10.1**: formato "até 3 jogos por confronto" (Duplas, A vs X, B vs
  Y) existe, mas é exclusivo de **competição por equipes** (Seleções Estaduais/Equipes de Clubes) — item
  1.9.1.10 confirma que "Ranking Individual" é individual. As 43 categorias divergentes (ABSOLUTO, MASTER,
  SUB-XX, RXX de Ranking) são nomeadas como individuais — **hipótese de "múltiplos jogos por confronto
  legítimos" descartada para essas categorias**, salvo se alguma delas for identificada como categoria de
  equipe (a verificar, não presumido).
- **Manual TM 2026, item 1.9.1.9**: sets ímpares, melhor de N definido pela Circular do Evento (não fixo)
  — não achado ainda o valor específico usado no 4TMB26; não afeta contagem de confrontos, só de sets
  dentro de cada confronto.
- **Regimento Interno CBTM**: nenhuma menção a W.O./walkover encontrada na extração de texto (`grep -i`
  sem resultado) — regras operacionais de W.O. e formato de disputa estão concentradas no Manual TM 2026,
  não no Regimento Interno. Regimento não descartado como fonte para outras regras (estrutura de
  competição, órgãos, disciplina), mas não é relevante para esta auditoria específica de contagem de
  confrontos.

**Ainda não coberto**: as 155+258 páginas não foram lidas integralmente palavra por palavra — a extração
localizou as seções relevantes por busca textual direcionada (walkover, formato de grupos, melhor-de-N).
Se a reconstrução categoria a categoria (Etapa 3) revelar um padrão não explicado por essas regras, será
necessário buscar mais seções antes de declarar `[INCONCLUSIVO]` em vez de simplesmente não achar a regra.

### CAT — Rodada 9 (2026-09-22) — resultado da engenharia reversa: causa dominante confirmada

Proveniência verificada por Grep (`~/.codex/sessions/2026/09/22/rollout-2026-09-22T13-48-56-...jsonl`) e
arquivos de evidência lidos diretamente em `docs/evidence/PP-063/` (hashes SHA-256 conferidos no relatório
do Codex, não recalculados por Claude nesta rodada).

**Achado de proveniência decisivo**: `officialMatchesCount` **não é publicado pela federação**. É um valor
**calculado pelo nosso próprio worker** (`computeOfficialCategoryMatchesCount`,
`packages/shared/src/index.ts:322-371`, verificado por leitura direta — implementa fielmente a fórmula de
grupos do Manual item 1.9.1.7, já testada em `official-matches.test.ts`), a partir de `registeredCount`
extraído por regex do texto do seletor de categorias da página oficial no momento do scrape
(`apps/worker/src/scraper/capture.service.ts:894-929`, ex. "34 inscrito(s)"). O nome do campo é enganoso;
o relatório do Codex já renomeia para `computedExpectedMatchesCount`, mais preciso — usar esse nome daqui
em diante nesta Spec.

**Classificação por reconstrução verificável (`docs/evidence/PP-063/run-14848-category-summary.csv`,
calculado e conferido por Claude com Python, comparando `uniqueCbtmMatchIds` vs `computedExpectedMatches`
coluna a coluna)**:

- **1.978 linhas de `Match` persistidas nas 43 categorias, mas apenas 777 `cbtmMatchId` distintos.** As
  1.201 linhas excedentes são cópias redundantes do mesmo confronto (mesmo `cbtmMatchId`) — prova por
  identidade de chave, não inferência de contagem agregada.
- **777 IDs únicos vs. 782 esperados pela fórmula do Manual — diferença agregada de apenas 5 (0,6%).**
- **40 de 43 categorias têm `uniqueCbtmMatchIds == computedExpectedMatches` exatamente.**
- **3 exceções, todas pequenas**: ABSOLUTO F MAS (54 vs 57, -3), MASTER 45MAS (19 vs 22, -3), RLM (40 vs
  39, +1).

**`[CONFIRMADO — causa nossa, duplicação de linha]` para as 40 categorias que batem exato**: a divergência
bruta (`matchRows` >> `uniqueCbtmMatchIds`) nessas categorias é 100% explicada por múltiplas linhas de
`Match` para o mesmo `cbtmMatchId` — não há partida faltando nem sobrando frente à regra oficial do Manual
(item 1.9.1.7), só duplicação de persistência. Prova: contagem de `cbtmMatchId` distintos bate exatamente
com o valor calculado pela fórmula normativa a partir do número de inscritos observado no scrape.

**Achado adicional não resolvido, isolado nas 3 exceções**: nas 34 de 43 categorias (incluindo as 3
exceções) o `officialRegistered` (inscritos conforme o texto do seletor de categorias no momento do
scrape) diverge do `observedRegistered` (inscritos realmente persistidos no nosso banco com
`registrationStatus: INSCRITO`) — ex. ABSOLUTO F MAS: 34 vs. 45 (11 a mais no nosso banco).
`computedExpectedMatches` é calculado a partir do `officialRegistered` (o número menor, da tela de
categorias), não do `observedRegistered`. Isso significa que a checagem "confirmada" das 40 categorias
usa como referência um número de inscritos que pode já estar desatualizado frente ao estado real de
inscrição — **a concordância em 40/43 categorias é forte evidência de que a fórmula e a captura de
matches estão corretas, mas não decide sozinha se as 3 exceções são causa nossa ou inconsistência entre
diferentes telas do próprio site da federação** (seletor de categorias vs. lista de inscritos exibindo
contagens diferentes do mesmo evento, no mesmo momento).

**W.O.**: 86 das 98 linhas de W.O. do evento inteiro (`observedWalkoverMatchesTotal`) estão nas 43
categorias divergentes. A regra do Manual (1.9.1.8.1 — W.O. na fase de grupos anula resultados anteriores)
não foi ainda testada linha a linha contra os grupos de duplicata; como a explicação por duplicação de
linha já fecha a conta em 40/43 categorias sem precisar dessa regra, ela permanece hipótese não descartada
mas também não necessária para essas 40 — só relevante se as 3 exceções não se explicarem de outra forma.

**Fonte pública**: a página do evento (`https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=6054`)
respondeu HTTP 200 e confirmou os mesmos inscritos das 4 categorias prioritárias observados no run
(20/37/38/34 — batendo com `officialRegistered`). A aplicação dinâmica (grade de confrontos) não ficou
acessível por consulta web estruturada nesta rodada — nenhuma contagem de confrontos atual foi atribuída
ao run 14848 a partir dessa tentativa. Confirma que o `officialRegistered` capturado é fiel ao que a
página pública mostra agora, mas não resolve a divergência com `observedRegistered` do nosso banco.

### [LEO DECIDE] — Rodada 9

**40 de 43 categorias**: `[CONFIRMADO — causa nossa]` — duplicação de linha de `Match`, sem impacto na
contagem de confrontos distintos, que já bate com a regra oficial do Manual. Candidatas a saneamento
(`scripts/pp-055-saneamento-matches-duplicados.ts --execute`) **quando Leo autorizar** — ainda não
executado.

**3 categorias (ABSOLUTO F MAS, MASTER 45MAS, RLM)**: `[INCONCLUSIVO]` até decisão de Leo sobre como
prosseguir. Duas rotas:
1. Investigar diretamente essas 3 categorias — cruzar `officialRegistered` vs. `observedRegistered` contra
   a lista de inscritos real da página oficial (não só o seletor de categorias) para entender se o nosso
   banco tem atletas a mais que não deveriam estar lá, ou se o seletor da federação está desatualizado.
2. Aceitar como pendência residual pequena (±3 partidas em 2 categorias, +1 em outra — 0,6% do total
   agregado) e prosseguir para a comparação por clube da PP-063, documentando a lacuna no relatório final.

Claude recomenda a rota 2 dado o tamanho residual (7 partidas em 3 categorias, de um total de 2.043) —
mas não decide sozinho, por ser fora do escopo de "certeza" que Leo definiu como critério de rigor.

### Decisão de Leo (2026-09-22) — rota 2

Leo confirmou rota 2: aceitar as 3 categorias (ABSOLUTO F MAS, MASTER 45MAS, RLM) como pendência residual
documentada — 7 partidas de divergência não explicada sobre 2.043 (0,3% do total bruto), não bloqueante.
Registrado como `[INCONCLUSIVO — pendência residual pequena, não investigada a fundo]` no relatório final.
PP-063 segue para a comparação por clube.

## Estado da base local para comparação

A comparação por clube usa a base `cbtm_homolog` pós-run 14848, **com a duplicação de `Match` ainda
presente** (não sanada — `--execute` do script PP-055 não foi autorizado nesta Spec).

**Verificado por leitura de código** (`user.service.ts:3290-3334`): o cálculo de medalhista por categoria
(`computeCategoryPositionByAthleteId` + `resolveMedalFromPosition`) já desqualifica atletas eliminados por
W.O. antes de atribuir medalha (`woDisqualifiedAthleteIds = collectWalkoverLoserAthleteIds(...)`) — alinhado
com o Manual item 1.9.1.8. Não confirmado ainda: se a duplicação de linha de `Match` (mesmo `cbtmMatchId`
repetido, mesma fase de grupos) pode afetar `computeCategoryPositionByAthleteId` em critérios de desempate
que contam número de vitórias/partidas (Manual item 1.9.1.6, "Partidas Pró") — duplicar uma linha de
resultado idêntico poderia inflar essa contagem para o atleta envolvido, mesmo sem mudar quem venceu o
confronto individual.

**Ação de verificação antes de aceitar os números da comparação por clube como confiáveis**: pedir ao
Codex para comparar o ranking por clube calculado com a base atual (matches duplicados presentes) contra
uma simulação — aplicar o dry-run do PP-055 em memória/query auxiliar (sem `--execute` real no banco) e
recalcular localmente `computeCategoryPositionByAthleteId` só com os 777 `cbtmMatchId` únicos (mantendo
1 cópia por grupo), para ver se a posição/medalha de algum atleta muda. Se não mudar em nenhum caso, a
duplicação é confirmada como inofensiva para a comparação por clube (mesmo padrão de conclusão já visto em
PP-066 para outro tipo de duplicação) e a comparação pode prosseguir com segurança usando a base atual.

### CAT — Rodada 10 (2026-09-22) — verificação concluída: duplicação confirmada inofensiva

Proveniência verificada por Grep e arquivos lidos diretamente em
`docs/evidence/PP-063/run-14848-ranking-duplicate-impact.{md,json,csv}`.

**Resultado**: usando os componentes reais de produção (`computeCategoryPositionByAthleteId`,
`inferCategoryMedalExpectation`, `collectWalkoverLoserAthleteIds`, `normalizeCategoryMedalists`),
comparados 593 pares atleta/categoria (264 atletas únicos) entre Cenário A (1.978 linhas, com duplicatas)
e Cenário B (777 linhas, deduplicado em memória mantendo `keptMatchId` de cada grupo, incluindo os
`ambiguous`): **zero diferenças de posição, zero diferenças de medalha, em todas as 43 categorias**.
Controle de efeito colateral confirmado: PP-055 permaneceu em dry-run, `beforeTotal = afterTotal = 2043`,
nenhuma linha removida do banco.

**Base local liberada para a comparação por clube da PP-063** — a duplicação de `Match` não compromete o
ranking por clube, independentemente de ser sanada ou não. A decisão de sanar (`--execute`) fica como
ação futura separada, sem urgência para esta auditoria.

### CAT — Rodada 11 (2026-09-22) — comparação final por clube: 10/13 batem exato

Proveniência verificada por Grep; JSON lido diretamente de
`docs/evidence/PP-063/event-59-efficiency-run-14848.json` (`GET /events/59/efficiency`, run 14848,
`publishedAt: 2026-09-22T18:16:39.533Z`, `eventWeight: 3`, `weights: {ouro:130, prata:80, bronze:50}`).

**Achado prévio confirmado e explicado**: a resposta lista **16 entradas**, mas só 13 clubes distintos por
nome — 3 pares de `clubId` duplicados, todos com a segunda entrada zerada (`clubId 136` e `265` =
"Academia Ping Drive"; `170` e `266` = "Yoshida TT"; `171` e `267` = "Tênis de Mesa Salinas"). Como as
entradas duplicadas têm pontuação zero, **não afetam a soma nem a comparação por clube** — mas são um
indício de duplicação de clube residual (mesma classe de causa da PP-053/057/058/060/062), a registrar
como achado, não a investigar nesta rodada (fora do escopo de comparação de dados).

**Comparação clube a clube contra a imagem 1 (coluna "4ª ETAPA (×3)")**, usando `totalPontuacao` de cada
clube (que já é o valor pós-peso `eventWeight=3`, confirmado por bater exato com PAYSANDU: 4350=4350):

| Clube | Imagem 1 (4ª etapa ×3) | Nosso total | Diferença |
|---|---:|---:|---:|
| BEL.TT/CAMINHO DO BEM | 10.470 | 9.630 | **-840** |
| PARÁ CLUBE | 7.290 | 7.140 | **-150** |
| APTM | 11.760 | 11.610 | **-150** |
| PAYSANDU | 4.350 | 4.350 | 0 |
| ACADEMIA PING DRIVE | 3.330 | 3.330 | 0 |
| CABANA CLUBE | 1.770 | 1.770 | 0 |
| YOSHIDA TT | 2.610 | 2.610 | 0 |
| MARDEY TT/APABB | 1.770 | 1.770 | 0 |
| TENIS DE MESA SALINAS | 1.710 | 1.710 | 0 |
| ASSOC. MESATENISTAS MARABÁ | 930 | 930 | 0 |
| ASSEMBLÉIA PARAENSE | 630 | 630 | 0 |
| GRÊMIO LITERÁRIO PORTUGUÊS | 540 | 540 | 0 |
| ASSOC. MESATENISTAS PARAUAPEBAS | 0 | 0 | 0 |

**10 de 13 clubes batem exatamente, sem qualquer diferença.** Isso é evidência de rigor máximo de que o
pipeline de cálculo (pesos, fórmula, agregação por clube) está correto — a hipótese inicial de "fórmula
divergente" (Rodada 3) fica descartada como causa geral; o que resta são 3 divergências pontuais.

**Checagem aritmética das 3 diferenças** (Claude, cálculo próprio): com pesos ouro=390/prata=240/bronze=150
(já multiplicados por `eventWeight=3`):
- PARÁ CLUBE e APTM: diferença de exatamente **150 = 1× peso de bronze**. Padrão idêntico nos dois casos —
  **hipótese concreta: falta exatamente 1 medalha de bronze em cada um desses dois clubes**, frente à
  imagem 1.
- BEL.TT: diferença de **840**, decompõe em combinações inteiras (`1 ouro + 3 bronze` ou `1 prata + 4
  bronze`), mas não é unívoco — precisa de evidência direta, não dedução aritmética.

**Nenhuma dessas 3 diferenças é ainda `[CONFIRMADO]`** — é padrão aritmético sólido o bastante para
direcionar investigação, não prova de causa. Precisa: (a) identificar quais atletas desses 3 clubes têm
medalha de bronze/ouro/prata no nosso banco vs. o que a imagem 1/2 sugere, (b) verificar se alguma
categoria dessas envolve as 3 categorias já identificadas como `[INCONCLUSIVO]` (ABSOLUTO F MAS, MASTER
45MAS, RLM) — se sim, a pendência residual já aceita pode ser a própria explicação.

### CAT — Rodada 12 (2026-09-22) — investigação exaustiva: divergência permanece sem causa rastreável

Proveniência verificada por Grep; arquivos lidos diretamente em `docs/evidence/PP-063/`
(`run-14848-three-club-divergence-investigation.md` e anexos JSON/CSV).

**Investigação completa, com rigor de evidência nominal**:
- 115 medalhas locais dos 3 clubes (Pará 30, APTM 46, BEL.TT 39) listadas individualmente por atleta e
  categoria — todas chegam integralmente ao ranking por clube (zero perda por resolução de atleta/clube ou
  deduplicação).
- Nas 43 categorias divergentes: zero atletas em 1º/3º lugar sem a medalha correspondente no nosso banco.
- 25 casos de perdedor por W.O. desses 3 clubes examinados: nenhum teria posição de pódio antes do
  bloqueio por W.O. (regra do Manual 1.9.1.8 já aplicada corretamente).
- Das 52 categorias do evento, **33 têm chave publicada em `api/GameResult/6054/{cbtmCategoryId}`** —
  fonte oficial nominal, não inferida. Nessas 33, há **79 medalhas oficiais dos 3 clubes** (Pará 19, APTM
  35, BEL.TT 25) e **todas as 79 coincidem exatamente** com o nosso sistema em atleta, categoria e tipo de
  medalha — nenhuma medalha oficial adicional encontrada para nenhum dos 3 clubes nessas categorias.
- As 3 categorias `[INCONCLUSIVO]` da Rodada 9 (ABSOLUTO F MAS, RLM, MASTER 45MAS) foram cruzadas
  individualmente: as medalhas desses 3 clubes nessas categorias já estão contabilizadas corretamente —
  **não explicam nenhuma parcela dos déficits de 150/150/840**.

**Limite genuíno da evidência disponível**: as outras **19 categorias** não têm chave publicada em
`api/GameResult` (retorna vazio) nem o callback de grupos da página pública (retorna "Os grupos não estão
disponíveis"). Essas 19 categorias contêm 36 medalhas locais dos 3 clubes que não puderam ser confrontadas
nominalmente contra pódio oficial — não porque o dado nosso esteja em dúvida, mas porque **a fonte pública
não expõe informação suficiente nesta janela de consulta** para confirmar ou refutar uma medalha adicional.

**Conclusão de rigor**: os 1.140 pontos de diferença agregada (150 Pará Clube + 150 APTM + 840 BEL.TT)
**permanecem `[INCONCLUSIVO]`** — não são `[CONFIRMADO — causa nossa]` (79/115 medalhas já confirmadas
corretas nominalmente, nenhuma omissão local encontrada) nem `[CONFIRMADO — origem federação]` (não há
evidência de inconsistência interna na fonte oficial, só ausência de dado acessível). A causa pode estar
nas 19 categorias sem chave pública, mas isso é hipótese não testável com a fonte disponível agora — não
uma conclusão.

**Achado paralelo confirmado**: os 3 pares de `clubId` duplicados (Academia Ping Drive 136/265, Yoshida TT
170/266, Salinas 171/267) têm exatamente a mesma população de atletas vinculada aos dois IDs (interseção
100%, zero exclusivos) — confirma duplicação de registro de clube sem impacto na soma (a entrada zerada
não contribui pontos), mas é candidato a saneamento futuro, mesma classe da PP-053/057/058/060/062. Fora
do escopo desta auditoria de dados — não corrigir aqui.

### CAT — Rodada 13 (2026-09-22) — imagem 2 usada: divergência decomposta com precisão

Leo perguntou se a imagem 2 (tela "Calcular os Pontos" — 1º/2º/3º por clube, coluna "Geral") havia sido
usada na auditoria. **Não tinha sido** até esta rodada — toda a comparação das Rodadas 11-12 usou só a
imagem 1 (Troféu Eficiência, total agregado). A imagem 2 tem uma vantagem que a imagem 1 não tem: decompõe
por posição (1º/2º/3º), permitindo isolar exatamente onde está cada divergência, em vez de só o total.

**Comparação direta (Claude, cálculo próprio)** — coluna "Geral" da imagem 2 (1º/2º/3º) vs. nosso
`ouro/prata/bronze` (evento 59, run 14848, mesmo JSON da Rodada 11):

| Clube | Imagem 2 (1º/2º/3º) | Nosso (ouro/prata/bronze) | Diferença |
|---|---|---|---|
| APTM | (14, 15, **18**) | (14, 15, **17**) | **-1 bronze** |
| BEL.TT | (12, **11**, **21**) | (12, **10**, **17**) | **-1 prata, -4 bronze** |
| PARÁ CLUBE | (8, 8, **15**) | (8, 8, **14**) | **-1 bronze** |
| Outros 10 clubes | — | — | 0 (idêntico) |

**Checagem aritmética contra os pontos da Rodada 11**: 1 bronze (peso 50×eventWeight 3 = 150) explica
exatamente os -150 de Pará Clube e APTM. 1 prata (80×3=240) + 4 bronze (4×150=600) = 840, explica
exatamente o déficit de BEL.TT — **resolve a ambiguidade da Rodada 11** (que não conseguia decidir entre
"1 ouro+3 bronze" e "1 prata+4 bronze"; a imagem 2 confirma que é a segunda combinação).

**Estado da investigação após este achado**: a investigação exaustiva da Rodada 12 já tinha confirmado que
79/115 medalhas desses 3 clubes batem exatamente contra a fonte oficial nominal (`api/GameResult`), sem
encontrar omissão. A imagem 2 agora aponta precisamente **quantas** medalhas de cada tipo faltam (1
bronze/1 bronze/1 prata+4 bronze), mas **não decide se a causa é nossa ou da federação** — só torna a
busca mais direcionada: são exatamente 6 medalhas (1+1+1+4) faltando no total, concentradas em bronze.
Como a Rodada 12 já mostrou que as 19 categorias sem chave pública (`api/GameResult` vazio) contêm medalhas
não confrontáveis, a hipótese mais provável é que essas 6 medalhas estejam justamente nessas 19 categorias
não verificáveis — mas isso continua sendo hipótese, não confirmação.

### [LEO DECIDE] — Rodada 13

Com a decomposição exata (6 medalhas: 4 bronze APTM/Pará/BEL.TT + 1 prata BEL.TT + já contado acima),
ainda não há confirmação de causa. Duas rotas:
1. Nova rodada de investigação focada: usar a contagem exata (não mais "algum bronze") para buscar nas 19
   categorias sem chave pública — talvez via inspeção visual da página dinâmica do evento (não só a API
   `GameResult`), já que agora sabemos exatamente quantas medalhas de cada tipo procurar.
2. Encerrar a investigação aqui, aceitando `[INCONCLUSIVO — decomposição exata conhecida, causa não
   confirmável com as fontes acessíveis]` como resultado final da PP-063 para esses 3 clubes, e produzir o
   relatório final consolidado.

Claude não decide sozinho — a rota 1 tem retorno incerto (a Rodada 12 já mostrou que a página dinâmica não
respondeu à consulta estruturada), mas pode valer a pena com o alvo agora mais preciso.

### Decisão de Leo (2026-09-22) — tentar rota 1, com fallback para notificar a federação

Leo escolheu tentar a rota 1 com o alvo agora preciso (6 medalhas: 1 bronze Pará Clube, 1 bronze APTM, 1
prata + 4 bronze BEL.TT). Se não for possível confirmar, Leo notificará a federação diretamente com a
evidência já reunida — não é mais responsabilidade desta investigação técnica sozinha resolver.

**Candidatos identificados por Claude** (cruzamento do CSV `run-14848-three-club-medals-local.csv` contra
as 19 `categoryId` sem chave pública — `run-14848-official-source-coverage.json`,
`categoriesWithoutPublishedBracketOrGroups`), filtrados pelo tipo de medalha exato que falta por clube:

| Clube | Medalha buscada | Candidatos (atleta / categoria) |
|---|---|---|
| Pará Clube | bronze (1 falta) | Glauciane Caldas Mendes / MASTER 30FEM; Wellingtton Augusto Andrade Fernandes / MASTER 35MAS; José Guilherme Souza da Silva / MASTER 55MAS; Mateus Martins de Sousa / RDM; Ana Luiza Silva de Souza / RIF |
| APTM | bronze (1 falta) | Paulo Sérgio Cavalcante da Silva / MASTER 70MAS; Alehandro Lobo Lobato Torres / SUB-19 MAS |
| BEL.TT | prata (1 falta) | Andreza da Silva Mota / MASTER 30FEM; Pietra Chagas da Silveira Gavinho / SUB-07 FEM; Otavio Sanches de Loureiro / SUB-09 MAS |
| BEL.TT | bronze (4 faltam) | Alana Stella Oliveira Borges / RHF; Alice Daniely Lobato de Souza / SUB-09 FEM; Pietra Chagas da Silveira Gavinho / SUB-09 FEM; Maria Luiza de Souza Carvalho / SUB-21 FEM |

**Importante**: esta lista é candidatura por eliminação (medalha do tipo certo, na categoria sem fonte
verificável), não confirmação — cada nome precisa ser checado individualmente contra alguma fonte que a
`api/GameResult` não ofereceu (grade visual da página dinâmica, outra rota da API do site, ou até
contagem de inscritos vs. resultados da própria categoria).

### Correção metodológica em andamento (2026-09-22) — viés na lista de 14 candidatos

Prévia de trabalho do Codex (proveniência verificada, mesma sessão rollout já confirmada) identificou um
viés na lista de 14 candidatos que Claude montou: ela só incluía atletas que **já têm** localmente uma
medalha do tipo procurado — mas o problema real pode ser o oposto: um atleta que a fonte oficial classifica
em posição de pódio e o nosso sistema **não** atribuiu medalha nenhuma (ou atribuiu a outro atleta). A
lista de 14 é insuficiente para cobrir esse caso. Correção em andamento pelo Codex: abrir a página dinâmica
real (Chromium), ler as abas públicas GRUPOS/RESULTADOS/FASE ELIMINATÓRIA das 12 categorias envolvidas
(grupos pequenos, 3-5 inscritos — por isso `GameResult`, que é só a chave eliminatória, vem vazio) e
comparar a classificação final publicada contra os 3 clubes, não só contra a lista de 14 nomes.

**Já confirmado nesta correção**: 3 dos 14 candidatos da lista original **não são medalhistas** na fonte
oficial (Wellingtton Augusto Andrade Fernandes — 4º lugar; Mateus Martins de Sousa — 4º lugar; Alice
Daniely Lobato de Souza — 4ª colocada) — descartados como explicação dos bronzes faltantes de Pará
Clube/BEL.TT.

### CAT — Rodada 14 (2026-09-22) — CAUSA RAIZ CONFIRMADA: 7 atletas ausentes do nosso sistema

Proveniência verificada por Grep (mesma sessão rollout já confirmada, frase distintiva "Francis
Pamplona"). Codex abriu a página dinâmica real do evento em Chromium, capturou os callbacks `POST` que
carregam as abas públicas GRUPOS/RESULTADOS (não expostos pela API `GameResult`, que só cobre chave
eliminatória) — GRUPOS publica a coluna `#` com a classificação final, RESULTADOS confirma via confrontos.

**Os 14 candidatos da lista original de Claude eram uma pista falsa** — todos os 14 são medalhistas
locais **corretos** e coincidem exatamente com a posição oficial (14/14 confirmados, 0 divergências). A
lista estava enviesada (só buscava atletas que já tinham medalha local do tipo certo — viés identificado
corretamente pelo Codex antes de aprofundar).

**Causa real, confirmada nominalmente**: 7 atletas que a fonte oficial classifica em posição de pódio
**não existem no nosso sistema para essas categorias** (ausência confirmada no payload local da Rodada 12):

| Clube | Categoria | Atleta (fonte oficial) | Posição | Medalha ausente |
|---|---|---|---:|---|
| Pará Clube | MASTER 30FEM (246) | Francis Pamplona | 4ª | bronze |
| APTM | SUB-21 FEM (69) | Emanuela Ruivo | 4ª | bronze |
| BEL.TT | SUB-07 FEM (267) | Perola Morais | 3ª | bronze |
| BEL.TT | SUB-07 MAS (266) | José Cruz | 2º | prata |
| BEL.TT | SUB-07 MAS (266) | Benjamin Souza | 3º | bronze |
| BEL.TT | SUB-09 MAS (52) | José Cruz | 3º | bronze |
| BEL.TT | SUB-09 MAS (52) | Benjamin Souza | 4º | bronze |

**Reconciliação aritmética exata**: Pará 1×bronze(150)=150; APTM 1×bronze(150)=150; BEL.TT
1×prata(240)+4×bronze(600)=840. Soma = 1.140, idêntica à soma das 3 divergências da Rodada 11 (150+150+840).
Fecha sem resíduo.

**Rotas de fonte verificadas**: só existem os callbacks públicos `POST` da página do evento (GRUPOS/
RESULTADOS) e `GET /api/GameResult/6054/{categoryId}` (vazio nessas categorias por não terem fase
eliminatória). Nenhuma outra API pública de classificação encontrada.

**Classificação final — `[CONFIRMADO — causa nossa]` para as 3 divergências de clube**: os 7 atletas estão
ausentes do nosso banco/persistência para essas categorias específicas (todas de "grupo único", 3-5
inscritos — confirma parcialmente a hipótese que Leo levantou sobre tratamento de grupo único, mas a causa
raiz exata — se é falha de captura do scraper, falha de resolução de atleta, ou outra causa dentro do
pipeline de grupo único — ainda não foi isolada; isso é o próximo passo, não mais desta auditoria de
dados, e sim de uma Spec de correção).

## Encerramento — PP-063 (2026-09-22)

**Objetivo atingido**: a auditoria encontrou a causa raiz das 3 divergências por clube frente aos dados
oficiais da FTMPA (evento 4TMB26/6054). Leo decidiu encerrar a auditoria de dados aqui — a investigação
técnica de causa raiz continuou em Spec própria, **PP-068**
(`docs/specs/PP-068-fix-atletas-ausentes-grupo-unico.md`).

### CORREÇÃO (2026-09-22, pós-encerramento) — Resumo final abaixo estava incorreto na causa raiz

**A Rodada 14 abaixo (e o resumo original desta seção) concluíram erroneamente que os 7 atletas estavam
"ausentes do sistema" e que isso era um bug nosso.** Investigação de continuação na PP-068 corrigiu: os 7
atletas **estão** no sistema, mas corretamente desqualificados da premiação por W.O. genuíno (regra 1.9.1.8
do Manual CBTM) — o padrão de placar `11-0/11-0/11-0` (ou `0-0` duplo/triplo) que pareceu "jogo real
disputado com diferença de nível" durante a Rodada 14 é, na verdade, **sempre** a codificação de W.O. no
sistema CBTM, nunca um jogo genuinamente disputado (confirmado por Leo com certeza absoluta — não existe
placar real com um lado zerado em todos os sets de um jogo de tênis de mesa realmente jogado).

**Conclusão real**: nosso sistema está correto. A divergência de 1.140 pontos (Pará -150, APTM -150,
BEL.TT -840) é causada pela **fonte de comparação externa (imagem do Troféu Eficiência da FTMPA) ter
contabilizado medalhas para atletas que a própria regra da federação desqualifica**. Ver
`docs/specs/PP-068-fix-atletas-ausentes-grupo-unico.md`, seção "ENCERRAMENTO", para a reconstrução completa
jogo a jogo dos 7 casos. Nenhuma correção de código é necessária.

### Resumo final para registro (texto original da Rodada 14 — mantido como histórico, causa raiz corrigida acima)

- **10 de 13 clubes**: ranking calculado bate exato com os dados oficiais (imagem 1 e imagem 2). Pipeline
  de cálculo de pontuação/pesos confirmado correto.
- **3 de 13 clubes** (Pará Clube, APTM, BEL.TT): divergência de 150/150/840 pontos — texto original abaixo
  dizia "7 atletas ausentes do sistema"; **corrigido acima**: os atletas existem e estão corretamente
  desqualificados por W.O., a divergência é da fonte externa, não nossa.
- **Achado colateral confirmado, não corrigido nesta auditoria**: duplicação de `Match` por `cbtmMatchId`
  repetido em 40/43 categorias do evento (script de saneamento PP-055 já existe, dry-run confirmou 941
  candidatos elegíveis — inofensivo ao ranking, mas pendente de saneamento formal).
- **Achado colateral confirmado, não corrigido nesta auditoria**: 3 pares de `clubId` duplicados (Academia
  Ping Drive, Yoshida TT, Tênis de Mesa Salinas) com população de atletas idêntica nos dois IDs — mesma
  classe de causa da PP-053/057/058/060/062.
- **Pendência registrada para tratamento em sequência (fora do escopo desta Spec)**: badges do resumo do
  evento (`/events/59`) divergem entre ambiente local (pós-scrape desta sessão, 22/09) e produção
  (20/09) — Atletas iguais (229), mas Inscrições (640 local / 514 prod), Partidas Previstas (2043/848),
  Partidas (1943/754) e WO (100/88) diferentes. Consistente com o estado já conhecido: local foi
  resincronizado nesta sessão com o fix da PP-056 aplicado; produção não recebeu esse scrape/fix ainda.
  Não investigado a fundo — Leo decidirá quando tratar.

### Referência de fonte oficial (2026-09-22)

Leo confirmou: a URL oficial do evento 4TMB26 é `https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=6054`.
Em produção, `EVE_Evento_ID=6054` corresponde a `Event.id=59`; na base local (`cbtm_homolog`) o mesmo id
interno `59` é usado, mas com totalizadores diferentes dos de produção (esperado — a base local foi
resincronizada nesta sessão em estado próprio, não é espelho fiel de produção neste momento). Útil para o
Codex conferir visualmente na fonte oficial, quando a captura bruta local for insuficiente/truncada para
esclarecer uma categoria específica (ex. confirmar W.O. marcado, contagem de confrontos exibida).

