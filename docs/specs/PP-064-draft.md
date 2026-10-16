## Rascunho — PP-064
### Contexto do pedido (Leo)
Item 2 de 3 features relacionadas. Sistema de cadastro de usuários com sinalização de atleta(s)
preferido(s), para receber notificações push quando:
(a) atleta favoritado é inscrito (status `INSCRITO`, não `PRE_INSCRITO`) em um evento
(b) grupo do atleta é definido na categoria
(c) aviso pré-jogo do atleta
(d) resultado de jogo do atleta é publicado

Itens 1 (campeão matematicamente definido) e 3 (notificações de quadro de eficiência) dependem desta
infraestrutura de push, mas ficam fora deste ciclo — serão CATs separados.

Pesquisa de skills: não há skill oficial Anthropic (`anthropics/skills`, 17 skills) nem OpenAI
(`openai/skills`, 38 skills) para push notifications ou cadastro de usuários — confirma que é
implementação de domínio, sem atalho de skill pronta.

### Estado atual do código (lido nesta sessão)
- `prisma/schema.prisma`: **não existe nenhum modelo de usuário público.** Único modelo de credencial é
  `AdminCredential` (single-admin, sem multi-tenant, sem `role` real — ver PEND-CBTM-004).
- `apps/api/src/auth/auth.service.ts`: login por username/senha fixo (bootstrap), JWT com `sub`/`username`/
  `tokenVersion`. Não há OAuth social, não há verificação de e-mail, não há sessão multi-usuário.
- `apps/web/`: é Next.js **web** (App Router). Não encontrei app mobile nativo (Expo/React Native) neste
  projeto — diferente do SyncPointTT (`appsyncpointtt/`), que é Expo. Isso é decisivo para a tecnologia de
  push: sem app nativo, push real (com o navegador fechado) só é viável via **Web Push API** (Service
  Worker + VAPID keys), sujeito às limitações de iOS Safari (suporte a Web Push só a partir de iOS 16.4,
  exige "Add to Home Screen"/PWA instalado — push em Safari comum sem instalar o PWA não funciona).
- `apps/worker/src/main.ts`: BullMQ já orquestra `scrape-event` → `refresh-read-model-cache`. É o ponto
  natural para detectar transições de estado (scrape novo vs. scrape anterior) e enfileirar notificações,
  mas hoje não existe nenhum job de "diff" entre scrape runs nem tabela de estado anterior para comparar.
- `AthleteCategory.registrationStatus` (enum `INSCRITO | PRE_INSCRITO | OUTRO`) já modela o gatilho (a).
- `Category` existe, mas não há campo/tabela que marque "grupo definido" — grupos são inferidos a partir de
  `Match.phase = GRUPOS` existir para a categoria; não há evento discreto "grupo foi publicado agora".
- Não há qualquer noção de "aviso pré-jogo" (agendamento antecipado de notificação relativa a
  `Match.matchDatetime`) nem de agendador de jobs futuros por data (BullMQ suporta delayed jobs, mas não
  há uso disso hoje).
- `Match.updatedAt` existe e pode servir de sinal para "resultado publicado", mas hoje nada dispara em cima
  dessa mudança.

### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**O QUE**

[PENDENTE: Cadastro de usuário é conta própria do site (email+senha) ou pode ser subscrição anônima
(sem conta, apenas token de dispositivo/browser vinculado a lista de atletas favoritos)? Isso muda
drasticamente o escopo — cadastro completo de usuário é feature grande (verificação de e-mail, gestão de
sessão, LGPD/dados pessoais) vs. "favoritar sem login" é mais simples e é o padrão comum em apps de
resultado esportivo (ex: sofascore favorita sem exigir conta).]

[PENDENTE: Quantos atletas um usuário pode favoritar? Sem limite, ou algum teto razoável (ex: 20) para
não permitir abuso/spam de fan-out de notificação?]

[PENDENTE: "Resultado de jogo publicado" dispara para qualquer jogo do atleta favoritado, ou só para os
jogos em que ele jogou (óbvio) — inclui jogos de fase eliminatória e grupo igualmente?]

**COMO**

[PENDENTE: Tecnologia de push — dado que não há app mobile neste projeto, a Spec segue com **Web Push API**
(Service Worker + VAPID)? Isso implica: (1) PWA/manifest no `apps/web`; (2) limitação conhecida em iOS
Safari sem instalação; (3) sem custo de terceiro (FCM é grátis, mas exige biblioteca). Alternativa seria
usar Firebase Cloud Messaging (FCM) para abstrair Web Push + preparar terreno para app nativo futuro — mas
adiciona dependência externa nova (Q7 exige aprovação de Leo).]

[PENDENTE: Detecção de transição de estado — o worker roda scrape incremental periodicamente
(`config.refreshMs`). Para notificar "só quando muda", preciso comparar snapshot anterior vs. novo em:
`AthleteCategory.registrationStatus`, existência de `Match` com `phase=GRUPOS` nova para a categoria do
atleta, e `Match` novo/atualizado com `winnerIndex` preenchido (resultado publicado) envolvendo o atleta.
Isso exige um novo job/serviço de "diff pós-scrape" no worker, disparado depois do
`refresh-read-model-cache` atual. Confirma que este é o desenho, ou há preferência por outra abordagem
(ex: trigger a nível de banco / outbox pattern)?]

[PENDENTE: "Aviso pré-jogo" — quanto tempo antes de `Match.matchDatetime`? É um valor fixo (ex: 30min/1h)
configurável por evento/global, ou o usuário escolhe? Requer BullMQ delayed job agendado no momento em que
`matchDatetime` é conhecido/atualizado (e cancelado/reagendado se o horário mudar, que é frequente neste
domínio — ver DEC-CBTM histórico de reagendamento de jogos).]

**ONDE**

[PENDENTE: Cadastro/gestão de favoritos fica em `apps/web/app/user/**` (área pública já existente) como
nova seção, ex: `/user/favoritos` ou dentro do perfil do atleta (`/user/career/[athleteKey]`) com botão
"favoritar"? Provável ambos os pontos de entrada, mas confirmar.]

Hipótese de impacto técnico (arquivos/contratos/DDL) — preliminar, sujeita a resolução dos PENDENTEs acima:
- **DDL novo**: tabela de usuário/dispositivo (`User` ou `PushSubscriber`), tabela de favoritos
  (`AthleteFollow` N:N usuário↔atleta), tabela de subscription push (endpoint+chaves VAPID por dispositivo,
  N:1 com usuário/subscriber), e possivelmente tabela de "notification log" para idempotência (evitar
  reenvio se o worker rodar diff duas vezes sobre o mesmo estado).
- **apps/api**: novo módulo (`apps/api/src/user-account/` ou `favorites/`) com endpoints de
  cadastro/login (se aplicável), CRUD de favoritos, endpoint de registro de push subscription.
  Dependência nova: biblioteca `web-push` (Node) para assinar/enviar — requer aprovação Q7.
  Dependência nova: geração de par de chaves VAPID (variável de ambiente nova).
- **apps/worker**: novo serviço de detecção de transição pós-scrape + enfileiramento de jobs de
  notificação (`send-push-notification`), separado do pipeline de scrape para não acoplar falha de envio
  de push a falha de scrape.
- **apps/web**: Service Worker novo (`public/sw.js` ou via `next-pwa`/manifest), UI de favoritar atleta,
  UI de opt-in de permissão de notificação do navegador (fluxo nativo do browser, não pode ser
  "empurrado" sem gesto do usuário).
- **Superfície de segurança nova**: cadastro de usuário (se houver conta) = auth pública nova, distinta do
  admin único atual — precisa de rate limit, verificação de e-mail (evitar spam de cadastro), e não pode
  reusar o padrão single-admin do `AuthService` atual sem adaptação. Dados pessoais (e-mail) entram em
  escopo LGPD.

### Definição de pronto (preliminar — depende dos PENDENTEs)
- Usuário consegue favoritar/desfavoritar atleta(s) via UI.
- Usuário consegue conceder permissão de push e ficar registrado como subscriber.
- Para cada um dos 4 gatilhos (inscrição INSCRITO, grupo definido, pré-jogo, resultado publicado), existe
  um caminho detectável a partir do estado já persistido, e uma notificação é enviada uma única vez por
  transição (sem duplicata em reprocessamento).

---
## CAT — Rodada 2 (2026-09-22) — resposta do Codex

Transportada por Leo, texto simples, sem reformulação:

1. **Cadastro:** recomenda conta pública própria do site (não anônima), separada de `AdminCredential`.
   Favoritos anônimos perdem sincronização entre dispositivos/recuperação. Levanta ambiguidade adicional:
   `Athlete.id` é por evento — "atleta favorito" precisa decidir se acompanha a pessoa entre eventos via
   `EventAthleteLink.athleteKey` ou fica por `Athlete.id` (escopo de um evento só).
2. **Push:** recomenda Web Push padrão (Service Worker + VAPID), não FCM — FCM web usa a mesma Push API/
   Service Worker/VAPID por baixo, não elimina a limitação de iOS, e adiciona dependência externa sem
   benefício demonstrado neste ciclo. Confirma que a limitação de iOS deve aparecer no fluxo de adesão
   (copy explicando "adicionar à tela de início" para push funcionar).
3. **Transições:** alerta técnico importante — **consultar o banco só depois do scrape não recupera o
   estado anterior**, porque o upsert já sobrescreveu. Recomenda persistir um "estado de publicação" por
   entidade/gatilho (snapshot explícito, não inferência pós-hoc) e gerar eventos de notificação com chave
   única. Envio em job separado do scrape. Garantia realista é "uma tentativa lógica por chave persistida
   com reenvio controlado" — não "exatamente uma vez", porque entrega no navegador não é comprovável.
4. **Quatro gatilhos, riscos específicos:**
   - Inscrição: cobrir também `PRE_INSCRITO → INSCRITO` (não só ausente → INSCRITO).
   - Grupo definido: `Match.phase=GRUPOS` existir não basta — precisa confirmar que o atleta está de fato
     no grupo oficial e definir o que conta como "mudança"/republicação do grupo.
   - Resultado: `winnerIndex` sozinho não basta — precisa checar contra WO, bye, dados parciais.
   - **Cita PP-054 diretamente**: reagendamento ainda pode duplicar jogos de GRUPOS/ELIMINATORIA sem
     `cbtmMatchId` (confirmado por leitura de PP-054 §C2 nesta sessão — PP-054 só resolve o caso com
     `cbtmMatchId` conhecido). Isso afeta tanto lembrete de pré-jogo quanto notificação de resultado: a
     linha `Match` que dispara a notificação pode não ser a versão vigente do jogo.
5. **Pré-jogo:** sugere antecedência configurável por evento (não por usuário neste primeiro ciclo), valor
   inicial a decidir por Leo. Ao mudar/remover `matchDatetime`, invalidar agendamento anterior; reler
   horário/participantes/resultado no momento do envio para descartar lembrete obsoleto. Decisão de produto
   pendente: se o novo horário já está dentro da janela após reagendamento, envia imediatamente ou omite.

**Correção ao desenho do rascunho:** não basta encadear o diff após `refresh-read-model-cache` — o prewarm
registra falhas parciais e segue, sem sinal único de "tudo publicado". A Spec precisa escolher explicitamente
entre gatilhos seguindo o estado persistido do scrape vs. o estado efetivamente publicado ao usuário, com um
marco verificável para essa escolha.

Nota de proveniência: análise estática do Codex — sem testes executados, sem arquivo alterado.

### CAT — Rodada 3 (2026-09-22) — resolução

[RESOLVIDO: Cadastro] Conta pública própria do site, separada de `AdminCredential`. "Atleta favorito"
acompanha a **pessoa entre eventos** — vínculo por identidade de atleta estável, não por `Athlete.id`
(que é por evento). O candidato mais próximo hoje é `EventAthleteLink.athleteKey`, mas isso ainda é
por-evento (`@@unique([eventId, athleteKey])`) — não existe hoje nenhuma tabela de identidade de atleta
cross-evento no schema. [LEO DECIDE: aceitar favoritar por identidade textual normalizada (nome+clube,
best-effort, sujeito a falsos positivos/negativos como o resto do sistema de resolução de atletas já é),
ou restringir o favorito ao escopo de um evento por vez (usuário refavorita a cada evento nôvo em que o
atleta aparece) para o primeiro ciclo, adiando identidade cross-evento estável para uma Spec futura de
"perfil canônico de atleta"?]

[RESOLVIDO: Push] Web Push API padrão (Service Worker + VAPID), sem FCM. Fluxo de adesão explica a
limitação de iOS (instalar à tela de início antes de conceder permissão).

[RESOLVIDO: Transições] Desenho corrigido — não é diff pós-scrape lido do estado atual. É um snapshot de
estado de publicação persistido por entidade/gatilho (nova tabela, ex. `NotificationTrigger` ou
equivalente), atualizado dentro da mesma transação/etapa que grava o novo estado, gerando eventos de
notificação com chave única (idempotente) no momento da transição, não por inferência posterior. Envio em
job separado (BullMQ) consumindo esses eventos.

[RESOLVIDO: Gatilho inscrição] Dispara em qualquer transição para `INSCRITO` a partir de um estado anterior
diferente (ausente ou `PRE_INSCRITO`), usando o snapshot de estado por atleta+categoria.

[LEO DECIDE: Gatilho grupo definido] Definir "grupo oficial confirmado" — critério mínimo proposto:
existência de `Match.phase=GRUPOS` com o atleta como `MatchParticipant` E round/tableNumber preenchidos
(indício de grade publicada, não só placeholder). Falta decisão de Leo sobre o que conta como
"mudança"/republicação que dispara notificação de novo (ex: grupo reconfigurado após impugnação).

[LEO DECIDE: Gatilho resultado] Critério mínimo proposto: `Match` com `winnerIndex` preenchido E o jogo
identificado como a **versão vigente** daquela partida lógica — o que hoje só é garantido para jogos com
`cbtmMatchId` conhecido (pós PP-054). Para jogos sem `cbtmMatchId` (comum em GRUPOS), risco confirmado de
notificar em cima de uma linha que será substituída por reagendamento duplicado. [LEO DECIDE: aceitar esse
risco residual para o primeiro ciclo (mesma limitação que PP-054 já aceitou para C2), restringindo
notificação de resultado a jogos com `cbtmMatchId` conhecido no primeiro ciclo — ou bloquear até existir
correção equivalente à PP-054 para o caso sem `cbtmMatchId`?]

[LEO DECIDE: Gatilho pré-jogo] Antecedência configurável por evento (não por usuário no primeiro ciclo) —
falta valor inicial (sugestão de partida: 30 minutos). Ao reagendar para dentro da janela de antecedência
já vencida, [LEO DECIDE: enviar imediatamente ou omitir o lembrete daquele jogo?]

[RESOLVIDO: Limite de favoritos] Adotar teto de 20 atletas por usuário como proteção anti-abuso inicial
(ajustável depois sem migração de schema, é validação de aplicação).

[RESOLVIDO: Escopo de "resultado publicado"] Dispara apenas para jogos em que o atleta favoritado
efetivamente jogou (como `MatchParticipant`), cobrindo tanto GRUPOS quanto ELIMINATORIA igualmente.

[RESOLVIDO: Onde] Ponto de entrada duplo: botão "favoritar" no perfil do atleta
(`/user/career/[athleteKey]` — ou equivalente de identidade escolhido acima) e uma seção nova
`/user/favoritos` para gestão centralizada.

### Impacto técnico — atualizado pós Rodada 2/3
- **DDL novo**: `User` (conta pública), `AthleteFollow` (usuário↔identidade de atleta, formato depende da
  decisão de identidade cross-evento), `PushSubscription` (endpoint+chaves VAPID por dispositivo, N:1 com
  `User`), `NotificationTrigger`/estado de publicação por entidade+gatilho (para snapshot idempotente, não
  diff pós-hoc), `NotificationLog` (histórico de envio, auditável).
- **apps/api**: módulo novo de conta de usuário (cadastro/login separado do `AuthService` admin atual —
  não reusar `AdminCredential`), CRUD de favoritos, endpoint de registro de `PushSubscription`.
  Dependência nova: `web-push` (Node) — requer aprovação Q7 de Leo.
  Variável de ambiente nova: par de chaves VAPID.
- **apps/worker**: o ponto de gravação do estado de publicação (snapshot idempotente) fica integrado ao
  pipeline de upsert existente (`apps/worker/src/pipeline/upsert.service.ts`), não como job solto pós-
  prewarm — para garantir que o gatilho é a transição real no momento em que ela é persistida, e não uma
  releitura potencialmente inconsistente com falhas parciais do prewarm. Novo job consumidor
  (`send-push-notification`) separado, para não acoplar falha de envio a falha de scrape/upsert.
- **apps/web**: Service Worker novo, manifest/PWA, UI de favoritar (perfil do atleta + `/user/favoritos`),
  fluxo de opt-in de permissão com copy explicando limitação iOS.
- **Segurança nova**: cadastro de usuário público = superfície de auth nova (rate limit, verificação de
  e-mail), dados pessoais (e-mail) em escopo LGPD — security review obrigatório (Q15).

### CAT — Rodada 3b (2026-09-22) — decisões de Leo

[LEO DECIDE #1 → RESOLVIDO] Identidade de atleta cross-evento **não** é resolvida dentro do PP-064.
Confirmado por leitura de schema nesta sessão: `Club.normalizedName` já é chave global estável
(`@unique` sem `eventId`) — clube não é frágil. `Athlete` é sempre por evento
(`@@unique([eventId, nameNormalized, clubId])`) — não existe hoje entidade "pessoa" cross-evento, então o
histórico de atleta É frágil para esse propósito. Leo decidiu abrir uma **Spec própria, anterior ao
PP-064**, para criar identidade canônica de atleta (nova tabela, ex. `AthleteIdentity`, com resolução
best-effort por nome+clube, mesmo padrão de heurística/conflito já usado em `AthleteAlias`/
`AthleteMatchConflict`). PP-064 passa a **depender** dessa Spec em vez de reinventar a solução dentro do
escopo de push. Nome de trabalho: **PP-065**.

[LEO DECIDE #2 → RESOLVIDO] Grupos: disparar notificação em duas situações — (a) transição de fase da
categoria para GRUPOS pela primeira vez, e (b) mudança detectada no grupo do próprio atleta depois disso
(reconfiguração/republicação). Critério de "mudança" a detalhar na Spec formal do PP-064 usando o mesmo
mecanismo de snapshot de estado por entidade já desenhado na Rodada 3.

[ACHADO NOVO — Leo, 2026-09-22] Durante o evento Open Bosque, confrontos de eliminatória apareceram
duplicados no site público. Investigação nesta sessão confirmou causa raiz: `computeMatchKey()`
(`packages/shared/src/index.ts:1025-1039`) inclui o nome normalizado dos dois atletas no hash da chave
(`matchKey`). Quando um placeholder de posição (`"1-2"`, reconhecido por `isBracketReferenceToken()` em
`packages/parser/src/index.ts:913-928`) é substituído pelo nome real do atleta classificado, o hash muda
inteiramente e o worker cria uma partida nova em vez de atualizar a existente — mesma família de bug da
PP-054 (chave sensível a campo que muda ao longo do evento), mas disparada por resolução de placeholder de
ELIMINATORIA, não por reagendamento de mesa/horário. PP-054 (`docs/specs/PP-054-versao-vigente-jogo-
reagendado.md`) não cobre este caso. Leo decidiu: **Spec de correção própria, anterior ao PP-064**, na
mesma família da PP-054. Nome de trabalho: **PP-066**.

[LEO DECIDE #3 → RESOLVIDO por dependência] Gatilho de resultado do PP-064 aguarda a correção do PP-066
para cobrir ELIMINATORIA com segurança — não faz sentido decidir "aceitar risco residual" antes de saber o
alcance real do bug. Ordem de execução: PP-066 (bug de duplicação) → PP-065 (identidade canônica) → PP-064
(favoritos + push), nessa sequência ou com PP-065/PP-066 em paralelo se não colidirem em arquivo.

[LEO DECIDE #4 → RESOLVIDO] Aviso pré-jogo: **dois envios por partida** — 30 minutos e 15 minutos antes de
`matchDatetime`, configurável por evento (valor default 30/15, ajustável). Motivação de Leo: reduzir risco
de WO por atleta não avisado a tempo. Cada envio é um evento de notificação distinto (chave única inclui
o offset, ex. `pre-jogo-30min` / `pre-jogo-15min`), ambos sujeitos à mesma regra de invalidação/reagendamento
já descrita na Rodada 2 (reler horário/participantes/resultado no momento do envio; se o reagendamento
colocar a partida dentro de uma janela já vencida — ex. restam 10 min e o aviso de 15min ainda não disparou
— **[LEO DECIDE PENDENTE]**: enviar imediatamente mesmo atrasado, ou omitir esse envio específico? Ainda
sem resposta de Leo — perguntar na Spec formal do PP-064 se não for respondido antes.

[RESOLVIDO — melhoria de UX registrada, fora do escopo de correção de bug] Leo sugeriu que, em vez de
exibir o placeholder cru do site oficial (`"1-2"`, `"V22"`), o app mostre um placeholder mais informativo
usando o nome reduzido dos atletas do confronto de origem (ex. "Vencedor: João vs Maria" em vez de "V22").
Esta é uma melhoria de apresentação, **independente da correção do bug PP-066** (que é sobre a chave de
persistência duplicar, não sobre o que é exibido). Registrar como candidato de escopo para uma Spec de UI
futura (possivelmente junto do PP-066 se Leo preferir resolver os dois juntos, já que ambos tocam o mesmo
código de resolução de placeholder) — decisão de agrupamento fica para quando o PP-066 for aberto.

### Sequenciamento de trabalho decidido nesta sessão
1. **PP-066** (nova, prioridade imediata) — corrigir duplicação de `Match` em ELIMINATORIA quando
   placeholder de posição é substituído por nome real. Mesma família de causa raiz da PP-054. Opcionalmente
   inclui a melhoria de UX de placeholder (Leo decide ao abrir).
2. **PP-065** (nova) — identidade canônica de atleta cross-evento (tabela nova + resolução best-effort).
   Fundamento de dado reaproveitável pelos itens 1 e 3 do pedido original de Leo (campeão matemático e
   notificações de eficiência também se beneficiam de identidade estável de atleta).
3. **PP-064** (este draft) — favoritos + push, retomado após PP-065/PP-066, com os `[LEO DECIDE]`
   remanescentes fechados (grupo, resultado, pré-jogo já resolvidos acima; falta só o comportamento de
   pré-jogo atrasado por reagendamento).

Este draft (PP-064) permanece **aberto** — não vai a `florestech-spec` ainda. Próximo passo: abrir CAT
para PP-066 (bug de duplicação) via `florestech-cat`.
