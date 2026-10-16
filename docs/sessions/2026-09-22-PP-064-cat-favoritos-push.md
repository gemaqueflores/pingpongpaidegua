# Sessão 2026-09-22 — PP-064 (CAT) — Favoritos de atleta + push, desmembramento em 3 frentes

## Estado atual
Branch: `fix/pp-062-backfill-normalizacao-clubes` (nenhum commit desta sessão — só análise/CAT, sem código).
Nenhum PR aberto por esta sessão. Draft gravado em `docs/specs/PP-064-draft.md` (Rodadas 1–3 do ciclo
tripartite concluídas, mas **Spec formal ainda não foi criada** — draft permanece pausado).

## Concluído nesta sessão
- Pedido original de Leo (3 itens: campeão matemático, favoritos+push, notificações de eficiência) —
  pesquisa confirmou que não há skill oficial Anthropic (`anthropics/skills`) nem OpenAI (`openai/skills`)
  para nenhum dos 3 itens. É implementação de domínio pura.
- CAT (ciclo tripartite) completo para o item 2 (favoritos + push), Rodadas 1–3, registrado em
  `docs/specs/PP-064-draft.md`.
- Investigação de código confirmou: `Club.normalizedName` já é chave global estável (`@unique` sem
  `eventId`); `Athlete` é sempre por evento (`@@unique([eventId, nameNormalized, clubId])`) — não existe
  identidade "pessoa" cross-evento hoje. Histórico de atleta é frágil para esse propósito; clube não é.
- Achado novo (Leo, relato do evento Open Bosque): confrontos de eliminatória duplicados no site público.
  Causa raiz confirmada por leitura: `computeMatchKey()` (`packages/shared/src/index.ts:1025-1039`) inclui
  nome normalizado dos dois atletas na chave; quando placeholder de posição (`"1-2"`, `isBracketReferenceToken()`
  em `packages/parser/src/index.ts:913-928`) vira nome real do classificado, o hash muda e o worker cria
  partida nova em vez de atualizar. Mesma família de causa raiz da PP-054 (já mergeada), mas caso não
  coberto por ela — PP-054 resolve só duplicação por mudança de mesa/horário via `cbtmMatchId`.
- Leo decidiu separar o trabalho em 3 frentes, cada uma em sessão própria, para preservar contexto:
  - **PEND-CBTM-002** (CSP `unsafe-inline`, já registrada no CLAUDE.md do projeto) — sessão própria.
  - **PP-066** (nova, prioridade imediata) — corrigir duplicação de `Match` em ELIMINATORIA por resolução
    de placeholder. Mesma família da PP-054.
  - **PP-065** (nova) — identidade canônica de atleta cross-evento (tabela nova + resolução best-effort,
    mesmo padrão de heurística/conflito já usado em `AthleteAlias`/`AthleteMatchConflict`). Fundamento de
    dado que também beneficia os itens 1 (campeão matemático) e 3 (notificações de eficiência) do pedido
    original de Leo.
  - **PP-064** (este draft) — favoritos + push, retomado depois de PP-065/PP-066 resolverem suas
    dependências.
- Dentro do draft PP-064, ficaram `[RESOLVIDO]`:
  - Cadastro: conta pública própria do site, separada de `AdminCredential`.
  - Push: Web Push API padrão (Service Worker + VAPID), sem FCM — decisão do Codex confirmada, sem
    dependência externa nova além de `web-push` (Node, requer aprovação Q7 quando a Spec for formada).
  - Limite de favoritos: 20 atletas por usuário (proteção anti-abuso inicial).
  - Escopo de "resultado publicado": só jogos em que o atleta favoritado jogou, GRUPOS e ELIMINATORIA
    igualmente.
  - Grupos: dispara em (a) transição de fase para GRUPOS e (b) mudança detectada no grupo do atleta depois.
  - Pré-jogo: dois avisos por partida — 30min e 15min antes de `matchDatetime` (decisão de Leo, motivada
    por reduzir risco de WO), configurável por evento, cada offset com chave de notificação própria.
  - Transições: desenho corrigido a partir do contraponto do Codex — snapshot de estado de publicação
    persistido por entidade+gatilho no momento da gravação (integrado ao upsert do worker), não diff
    pós-scrape lido depois (Codex alertou: consultar o banco só depois do scrape não recupera o estado
    anterior, pois o upsert já sobrescreveu).
  - UX de placeholder (sugestão de Leo: mostrar nome reduzido dos atletas do confronto de origem em vez
    do placeholder cru "1-2"/"V22") registrada como candidato de escopo futuro, possivelmente junto do
    PP-066 — decisão de agrupamento fica para quando PP-066 for aberto.

## Pendente
- Abrir CAT (`florestech-cat`) para **PEND-CBTM-002** em sessão nova — CSP `unsafe-inline`.
- Abrir CAT (`florestech-cat`) para **PP-066** em sessão nova — correção de duplicação de eliminatória.
- Abrir CAT (`florestech-cat`) para **PP-065** em sessão nova — identidade canônica de atleta.
- Retomar **PP-064** só depois de PP-065/PP-066 terem Spec aprovada ou merge — draft já tem quase todos os
  `[LEO DECIDE]` resolvidos, falta apenas:
  - Gatilho de resultado: critério final depende do alcance da correção do PP-066 (restringir a
    `cbtmMatchId` conhecido vs. cobertura completa pós-correção).
  - Pré-jogo atrasado por reagendamento: se a partida reagendar para dentro de uma janela de aviso já
    vencida (ex. restam 10min e o aviso de 15min ainda não disparou), enviar atrasado ou omitir? Ainda sem
    resposta de Leo.
- Draft completo em `docs/specs/PP-064-draft.md` — não apagar, é a base para retomar sem re-CAT.

## Decisões tomadas
- Separar PEND-CBTM-002, PP-065 e PP-066 em sessões próprias para preservar contexto — Leo, 2026-09-22 |
  motivo: evitar misturar 4 assuntos técnicos distintos numa única sessão longa | válida próxima sessão: S
- PP-066 e PP-065 são pré-requisitos de fundação de dado para PP-064, não escopo interno dele — motivo:
  identidade cross-evento e integridade de `matchKey` são problemas estruturais reaproveitáveis por outras
  specs (itens 1 e 3 do pedido original), não específicos de push | válida próxima sessão: S
- Push via Web Push API padrão, sem FCM — motivo (Codex): FCM web usa a mesma Push API/Service
  Worker/VAPID por baixo, não elimina limitação de iOS, adiciona dependência sem benefício demonstrado |
  válida próxima sessão: S

## Candidatos a nova regra de contrato
- Nenhum candidato de regra de contrato identificado nesta sessão — foi CAT de análise/planejamento, sem
  desvio de processo Codex/Claude a registrar em knowledge/claude.md.

## Padrões que funcionaram (reforço)
- Investigar o schema/código real antes de responder pergunta de arquitetura ("histórico é frágil?") em vez
  de responder de memória — confirmou com precisão que `Club` já tem chave estável e `Athlete` não, o que
  mudou a decisão de Leo (Spec própria em vez de resolver dentro do PP-064) | reforçar no contrato: já é
  regra existente (Spec sem Read é Spec defeituosa) — sem necessidade de nova regra, só reforço do hábito.
- Achado de bug trazido informalmente por Leo em meio à conversa (duplicação de eliminatória) foi
  investigado com Read/Grep antes de aceitar como fato, confirmando causa raiz exata com arquivo:linha
  antes de propor tratamento | reforçar no contrato: S — já é a postura esperada de revisor, sem gap novo.

## Dúvidas em aberto
- Pré-jogo atrasado por reagendamento (enviar vs. omitir) — Leo decide na retomada do PP-064.
- Se a melhoria de UX de placeholder (nome reduzido em vez de "1-2"/"V22") entra junto do PP-066 ou vira
  Spec própria — Leo decide ao abrir o CAT do PP-066.

## Arquivos relevantes
- `docs/specs/PP-064-draft.md` — draft completo do CAT (Rodadas 1–3), base para retomar PP-064.
- `prisma/schema.prisma:123-167` — modelos `Club` (chave global estável) e `Athlete` (por evento, frágil
  para identidade cross-evento).
- `packages/shared/src/index.ts:1025-1039` — `computeMatchKey()`, causa raiz do bug de duplicação
  (inclui nome de atleta no hash).
- `packages/parser/src/index.ts:913-928` — `isBracketReferenceToken()`, reconhece placeholders `"1-2"`/`"V22"`.
- `apps/worker/src/pipeline/upsert.service.ts:4574-4658` — `cleanupNonRealAthleteRecords()`, limpeza de
  `Athlete` placeholder (não resolve a duplicação de `Match`, só do registro de atleta temporário).
- `docs/specs/PP-054-versao-vigente-jogo-reagendado.md` — Spec já mergeada, mesma família de causa raiz
  (chave sensível a campo mutável), cobre só reagendamento de mesa/horário via `cbtmMatchId`, não cobre o
  caso de placeholder resolvido em ELIMINATORIA.
- `Documents/estudos/appcbtmeventos/CLAUDE.md` — `PEND-CBTM-002` (CSP `unsafe-inline`), pendência já
  registrada, será tratada em sessão própria.

## Score
Não aplicável — sessão foi CAT/análise, sem parecer de homologação emitido.
