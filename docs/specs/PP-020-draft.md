# PP-020 (draft) — CAT: Health check global do projeto + saúde do evento Copa Brasil Prata Belém 2026

## Status: CAT encerrado analiticamente (Rodada 4 — errata técnica aplicada e aceita)

Documento de trabalho do ciclo tripartite — não é Spec formal, não é registro final autoritativo por si só.
Relatório final consolidado: artifact publicado (ver sessão), incorporando as correções desta rodada.
Nenhuma implementação, commit ou Spec de correção foi autorizada nesta rodada. Próxima autoridade: Leo —
decide a regra de negócio de H6 e quais achados (se algum) viram Spec de correção futura.

## Nota de proveniência (obrigatória — protocolo de contrato)

Uma mensagem atribuída a "Codex:" foi recebida colada no chat nesta sessão, sem elo técnico verificável
(não veio de tool call rastreado nesta sessão Claude). Conforme protocolo do contrato global
(`~/.claude/CLAUDE.md` § Proveniência de mensagem atribuída a outro agente), isso é classificado como
**"proveniência não verificada"**, não como "não é real". Os achados e IDs citados nessa mensagem foram
tratados pelo mérito e cruzados contra evidência própria sempre que possível:
- IDs CBTM 5826/5827/5828/5829 **confirmados** por leitura direta de
  [docs/specs/PP-016-cadastro-evento-copa-belem.md:9,43-46](PP-016-cadastro-evento-copa-belem.md) — já
  estavam registrados no repo antes desta sessão, então essa parte é verificável independentemente da
  proveniência da mensagem.
- IDs internos (55/56/57/58), contagens de categorias, duplicação de partidas, endpoint `/clubs` vs.
  medalhistas, pódio `SUB-17 MAS - DUPLAS` — **não verificados por Claude nesta sessão** (exigem acesso a
  banco/API de produção que Claude não tem diretamente). Tratados como **hipóteses de achado a confirmar**
  via as queries read-only formuladas abaixo, não como fato estabelecido.
- Ausência da circular PDF oficial no checkout — **confirmado** por busca própria (`find` por "circular"/
  "belem" no repo, sem match de arquivo PDF).

Este CAT segue como **Tipo B** (dado o volume/gravidade dos achados hipotéticos) e **estritamente
read-only** — nenhuma Spec de correção nesta rodada, nenhum commit adicional além do que já estava staged.

## Contexto levantado (Read/Grep executados)

- `Event.cbtmEventId` é único; um "evento lógico" (ex.: Copa Brasil Prata Belém 2026) pode ser composto por
  múltiplos `Event` locais ligados via `EventMerge` (`primaryEventId` canônico + N `secondaryEventId`, cada
  um com `categorySuffix`) — [prisma/schema.prisma:62-114](../../../prisma/schema.prisma).
- `UserService.resolveEventScope(eventId)` resolve o `canonicalEventId` e todos os `allEventIds` (primário +
  secundários) via `loadEventMerges()` / `buildEventMergeScopeIndex()` —
  [apps/api/src/user/user.service.ts:6385-6420](../../../apps/api/src/user/user.service.ts#L6385-L6420).
  Esse é o mecanismo que já existe para tratar "4 IDs = 1 evento".
- `IGNORED_CATEGORY_IDS` (`88888888` TÉCNICOS, `99999999` Totalizador Geral) são excluídos das listagens de
  categoria em praticamente todo o `user.service.ts` — confirmado por DEC-CBTM-005.
- DEC-CBTM-006 já resolve uma divergência esperada entre "card Atletas" (resumo) e aba "Atletas" (só
  `INSCRITO`) — relevante se a auditoria dos 4 IDs encontrar esse padrão e for tentador tratar como bug.
- Backlog de segurança (`docs/backlog-seguranca-qualidade.md`, arquivo untracked no git status atual — ver
  nota abaixo) lista PP-SEC-001 a 004, todos "Médio/Baixo", nenhum com Spec de correção aberta.
- `DOMAIN_MATURITY.md` marca "Security review — execução real vs. declaração" como **Em refinamento** para
  PP, com "review de código completo ainda pendente".

**Nota de estado do repo:** `docs/backlog-seguranca-qualidade.md` aparece como *untracked* no `git status`
apesar de já ter conteúdo estruturado (PP-SEC-001..004). Isso é um achado de saúde do projeto por si só —
ver item de ambiguidade E abaixo.

---

## Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

### A — Os 4 IDs do evento já estão ligados via `EventMerge` no banco?

O QUÊ: confirmar se os 4 `cbtmEventId` (individual olímpico = canônico, duplas, duplas mistas, paralímpico)
já têm registros em `event_merges` linkando os 3 secundários ao primário, ou se ainda estão como 4 eventos
soltos sem merge.
COMO: query direta `SELECT * FROM event_merges WHERE primary_event_id IN (...)` ou via
`resolveEventScope()` a partir do ID canônico.
ONDE: banco de produção (Oracle VM) — não há como confirmar isso por leitura de código, é dado.
Definição de pronto: os 4 IDs confirmados (canônico + 3 secundários) e confirmação se o merge existe.

[RESOLVIDO: CBTM 5826 = canônico/individual olímpico, 5827 = paralímpico, 5828 = duplas, 5829 = duplas
mistas — confirmado por leitura de PP-016. IDs internos reportados (não verificados por Claude): 55
(canônico), 56, 57, 58. Merge reportado como funcional: GET nos 4 IDs internos resolve para o canônico
55/CBTM 5826 — a confirmar via query em `event_merges` (ver seção Queries read-only).]

### B — "Saúde do projeto a nível global" — quais eixos entram no CAT?

O QUÊ: a frase é ampla. Read do código sugere pelo menos estes eixos candidatos, cada um com fonte de
verificação diferente:
1. **Segurança** — PP-SEC-001..004 do backlog, todas pendentes; DOMAIN_MATURITY marca review completo como
   não executado.
2. **TDD/Red-Green** — DOMAIN_MATURITY marca esse domínio como **Instável** para PP (rebaixado em PP-006,
   1 entrega limpa desde então, faltam 2 para promoção).
3. **Estado do deploy/produção** — certificado TLS (DEC-CBTM-001), CORS (DEC-CBTM-002), containers rodando
   na VM Oracle.
4. **Consistência de dados do domínio evento/scraping** — cache de read model, `scrapeLockedAt` travado,
   `AthleteMatchConflict` não resolvidos.
5. **Estado do próprio Git/repo** — arquivo untracked achado acima é um sintoma desse eixo.

COMO: cada eixo tem evidência e comando de verificação diferentes (grep no código, query no banco, SSH na
VM, `git status`).
ONDE: eixos 1-2 são leitura de repo; eixo 3-4 exigem SSH/Postgres real (MCP `ssh-oracle`, Codex executa);
eixo 5 é leitura de repo.
Definição de pronto: lista fechada de eixos que compõem o CAT, com fonte de evidência declarada por eixo.

[RESOLVIDO: manter os 5 eixos, conforme pacote transportado por Leo — segurança; testes/TDD e qualidade;
deploy/infra/observabilidade; pipeline/persistência/consistência de dados; saúde Git/documental.]

### C — "Saúde das informações do evento" — o que conta como problema reportável?

O QUÊ: para um evento **concluído**, quais inconsistências são bugs vs. comportamento esperado? Precedente
DEC-CBTM-006 mostra que divergências numéricas podem ser intencionais (resumo vs. aba Atletas). Candidatos
a checagem, com base no código lido:
1. Contagem de atletas/inscrições por `registrationStatus` consistente entre os 4 IDs mesclados.
2. Categorias com `cbtmCategoryId` fora de `IGNORED_CATEGORY_IDS` sem nenhum atleta/match (categoria órfã).
3. `AthleteMatchConflict` não resolvidos no evento (linhas conflitantes de scraping).
4. `scrapeLockedAt` preso (lock não liberado) ou `lastScrapeAt` desatualizado apesar de `concluido = true`.
5. Grupos/confrontos: fase declarada "GRUPOS"/"RESULTADOS" mas sem matches publicados
   (`readEventPublicationFlags`).
6. Duplas: nomes com padrão `"A # B"` corretamente preservados nas listagens de evento (DEC-CBTM-004) —
   checar se o filtro de `#` vazou incorretamente para algum endpoint de evento.
7. Consistência do `categorySuffix` nos 3 IDs secundários (ex.: duplas mistas vs. paralímpico não colidirem
   em sufixo).

COMO: queries diretas no Postgres (produção ou espelho) + leitura de endpoints via `user.service.ts`.
ONDE: banco (SSH Oracle / MCP ssh-oracle, Codex executa) — Claude formula query, Codex roda, Claude analisa
(conforme protocolo já registrado no CLAUDE.md do projeto).
Definição de pronto: lista fechada de checks (1-7 acima, editável por Leo) com critério objetivo de
"passou/falhou" por check.

[RESOLVIDO: manter os 7 checks propostos, ampliados pelos achados hipotéticos reportados — ver seção
"Achados hipotéticos a confirmar" e "Queries read-only" abaixo, que substituem/detalham os checks 1-7 em
termos de SQL executável.]

### D — Este CAT vira uma Spec de "correção" ou um relatório de auditoria (CAT/doc, sem código)?

O QUÊ: um health check pode terminar em (i) relatório read-only entregue no chat/artifact, sem Spec nem
código, ou (ii) relatório + Spec(s) de correção para os achados relevantes (crítico/alto vira bloqueio por
regra de segurança do orquestrador).
COMO/ONDE: decisão de processo, não técnica.
Definição de pronto: Leo declara qual dos dois modos aplica.

[RESOLVIDO: modo (i) — apenas relatório de auditoria nesta rodada. Specs de correção são propostas
separadamente, sujeitas a decisão de Leo, somente após o relatório estar concluído e os achados
confirmados por query real (não pelos números hipotéticos reportados no pacote).]

### E — Arquivo `docs/backlog-seguranca-qualidade.md` untracked — commitar agora?

O QUÊ: o arquivo já existe com conteúdo (PP-SEC-001..004) mas nunca foi commitado. Regra do orquestrador diz
que lacunas de segurança devem estar "registradas no backlog do produto" — hoje isso só existe localmente,
não persistido no histórico do projeto.
COMO: `git add docs/backlog-seguranca-qualidade.md && git commit` (branch dedicada, seguindo convenção
`docs:`).
ONDE: repo local → GitHub (`gemaqueflores/appcbtmeventos`).
Definição de pronto: arquivo commitado e no PR, ou decisão explícita de não commitar agora.

[RESOLVIDO por Leo: commitar. Execução: `git add` feito por Claude; pre-commit hook bloqueou por
`node_modules` ausente (ambiente sem deps instaladas) — Claude rodou `npm install` + `npm run build`
em `packages/shared` e `packages/parser` para destravar o hook sem usar `--no-verify`. Commit ainda **não
concluído** no momento em que o pacote Codex chegou pedindo modo read-only estrito nesta rodada — arquivo
permanece `staged`, não commitado, para não fazer nova operação de escrita até Leo confirmar se prossegue.
Achado lateral para o relatório: ambiente local sem `node_modules`/build de workspace packages é sintoma de
saúde de projeto (eixo 5), registrado abaixo.]

---

## Achados hipotéticos a confirmar (origem: pacote não verificado — ver Nota de proveniência)

Nenhum destes é tratado como fato. Cada linha vira uma query read-only na seção seguinte.

| # | Achado reportado | Gravidade se confirmado | Query que confirma/refuta |
|---|---|---|---|
| H1 | Merge dos 4 IDs internos (55/56/57/58) resolve para canônico 55/CBTM 5826 | Informativo (esperado) | Q1 |
| H2 | Categorias por evento interno: 55=40, 56=2, 57=11, 58=4 | Informativo | Q2 |
| H3 | Resumo público: 5.360 partidas publicadas vs. agenda pública: 7.381 registros | Alto — divergência de ~2.021 registros entre dois endpoints do mesmo evento | Q3, Q4 |
| H4 | Apenas 1.224 hashes de partida distintos entre 7.381 registros de agenda; repetição máxima 12× | Crítico — se real, é duplicação massiva de dados de partida | Q5 |
| H5 | Registros duplicados com mesmo hash, atletas/posições, horário, mesa, rodada, placar, IDs de banco diferentes, prefixos `cat:id` distintos | Crítico — sugere problema na chave de idempotência do parser/scraper | Q6 |
| H6 | `/clubs` retorna 11 clubes; medalhistas citam 41; 30 ausentes da listagem | Alto — quebra de consistência entre endpoint de listagem e endpoint de medalhistas | Q7 |
| H7 | `SUB-17 MAS - DUPLAS`: `expectedMedalists=3`, `medalists=2`, `diagnostics.status="ok"` | Alto — diagnóstico de saúde reportando "ok" para caso divergente é falha do próprio mecanismo de diagnóstico, não só do dado | Q8 |
| H8 | Fila BullMQ: 14 jobs failed, 2 delayed | Médio — depende de idade/causa dos failed antes de classificar severidade | Q9 (via SSH, fora do Postgres) |
| H9 | `AthleteMatchConflict` pendentes no evento | A confirmar | Q10 |

## Queries read-only propostas para o Codex executar via SSH Oracle / Postgres

Todas as queries abaixo são `SELECT` puro — nenhum `UPDATE`/`DELETE`/`INSERT`. Codex executa e retorna
resultado bruto a Claude para análise; Claude não executa diretamente (sem acesso MCP `ssh-oracle` direto,
conforme estratégia já registrada no CLAUDE.md do projeto).

```sql
-- Q1: confirmar merge dos 4 IDs internos para o canônico
SELECT e.id AS internal_id, e.cbtm_event_id, e.nome, e.concluido,
       em.primary_event_id, em.category_suffix
FROM events e
LEFT JOIN event_merges em ON em.secondary_event_id = e.id
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
ORDER BY e.cbtm_event_id;

-- Q2: contagem de categorias por evento interno (fora de IGNORED_CATEGORY_IDS)
SELECT c."eventId", COUNT(*) AS total_categorias
FROM categories c
JOIN events e ON e.id = c."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
  AND (c."cbtmCategoryId" IS NULL OR c."cbtmCategoryId" NOT IN ('88888888','99999999'))
GROUP BY c."eventId"
ORDER BY c."eventId";

-- Q3: total de matches por evento interno e por fase (GRUPOS/RESULTADOS/etc.)
SELECT m."eventId", m.phase, COUNT(*) AS total
FROM matches m
JOIN events e ON e.id = m."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
GROUP BY m."eventId", m.phase
ORDER BY m."eventId", m.phase;

-- Q4: matches publicados vs. total por evento (para reconciliar resumo x agenda)
SELECT m."eventId",
       COUNT(*) AS total_matches,
       COUNT(*) FILTER (WHERE m."winnerId" IS NOT NULL) AS jogadas,
       COUNT(*) FILTER (WHERE m."isWalkover" = true) AS wos
FROM matches m
JOIN events e ON e.id = m."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
GROUP BY m."eventId";
-- nota: nomes de coluna (winnerId/isWalkover) são hipótese com base no domínio lido;
-- Codex deve confirmar contra \d matches antes de rodar, e ajustar se divergir do schema real.

-- Q5: duplicação de partidas por matchKey/hash — grupos com mais de 1 ocorrência
SELECT "matchKey", COUNT(*) AS ocorrencias
FROM matches m
JOIN events e ON e.id = m."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
GROUP BY "matchKey"
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 50;
-- nota: confirmar nome real da coluna de hash/chave de partida (pode ser diferente de "matchKey")
-- via \d matches antes de rodar.

-- Q6: detalhe de um grupo de hash duplicado (amostra) para inspecionar IDs/prefixos cat:id divergentes
SELECT id, "eventId", "categoryId", phase, round, "matchKey", "scorePlayers", "createdAt"
FROM matches m
WHERE "matchKey" IN (
  SELECT "matchKey" FROM matches m2
  JOIN events e2 ON e2.id = m2."eventId"
  WHERE e2.cbtm_event_id IN (5826, 5827, 5828, 5829)
  GROUP BY "matchKey" HAVING COUNT(*) > 5
)
ORDER BY "matchKey", id
LIMIT 100;

-- Q7: clubes distintos referenciados por atletas do evento vs. clubes retornados por listagem de clubes
-- (reconciliar contra a lógica real de listClubs/medalists em user.service.ts — Codex compara resultado
-- desta query com a resposta HTTP de /clubs e do endpoint de medalhistas para os mesmos 4 IDs)
SELECT DISTINCT a.clube
FROM athletes a
JOIN "EventAthleteLink" eal ON eal."athleteId" = a.id  -- nome de tabela/coluna é hipótese, confirmar schema
JOIN events e ON e.id = eal."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
  AND a."registrationStatus" = 'INSCRITO'
ORDER BY a.clube;

-- Q8: categorias com contagem de medalhistas divergente do esperado (proxy para achar casos como
-- "SUB-17 MAS - DUPLAS")
SELECT c.id, c.nome, c."cbtmCategoryId"
FROM categories c
JOIN events e ON e.id = c."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829)
  AND (c."cbtmCategoryId" IS NULL OR c."cbtmCategoryId" NOT IN ('88888888','99999999'));
-- Q8 é ponto de partida — a comparação real "expectedMedalists vs. medalists" acontece em
-- código (user.service.ts, lógica de medalhistas), não é campo direto de tabela; Codex deve
-- chamar o endpoint HTTP de medalhistas para cada categoria retornada aqui e comparar com a
-- lista de matches da fase RESULTADOS dessa categoria.

-- Q9: fila BullMQ (Redis, não Postgres) — Codex usa comando BullMQ/redis-cli via SSH, não SQL:
-- BLPOP / redis-cli para inspecionar jobs failed com idade e stacktrace, não listado aqui como SQL.

-- Q10: AthleteMatchConflict pendentes no evento
SELECT *
FROM "AthleteMatchConflict" ac
JOIN events e ON e.id = ac."eventId"
WHERE e.cbtm_event_id IN (5826, 5827, 5828, 5829);
```

**Aviso explícito ao Codex:** os nomes de coluna/tabela acima (`matchKey`, `winnerId`, `isWalkover`,
`EventAthleteLink`, `scorePlayers` como coluna direta) são **hipóteses formuladas a partir da leitura do
`user.service.ts` e não foram confirmadas contra `schema.prisma` completo nem contra `\d <tabela>` real**.
Antes de rodar Q4-Q7, Codex deve confirmar o schema real (`\d matches`, `\d athletes`, `\d
"EventAthleteLink"` ou equivalente) e ajustar nomes de coluna se divergirem — reportar a Claude qualquer
ajuste feito, para registrar no relatório final.

---

## Proposta de abordagem técnica (atualizada — Rodada 3)

1. ~~Fixar os 4 `cbtmEventId` reais com Leo~~ — RESOLVIDO (item A).
2. Leo transporta a este pacote + as queries acima ao Codex, que:
   a. confirma schema real das tabelas envolvidas;
   b. executa Q1-Q10 (Q9 via redis-cli/BullMQ, não SQL) estritamente read-only via MCP `ssh-oracle`;
   c. retorna os resultados brutos a Claude, sem interpretação prévia.
3. Claude analisa os resultados brutos, confirma ou refuta H1-H9, e cruza contra os checks 1-7 originais
   do item C (registrationStatus, categorias órfãs, `scrapeLockedAt`, fases sem match, filtro `#`,
   `categorySuffix`).
4. Rodar checklist OWASP A01-A10 sobre a superfície do backlog (eixo 1) — reaproveitando PP-SEC-001..004
   como ponto de partida, não do zero.
5. Confrontar os números consolidados (após confirmação por query) com INSCRICOES/GRUPOS/RESULTADOS da
   CBTM para os 4 IDs — bloqueado enquanto a circular/fonte oficial não estiver disponível no checkout
   (ver item E e nota de proveniência); registrar como limitação do relatório se a fonte não chegar a
   tempo.
6. Consolidar relatório único cobrindo os 5 eixos (projeto global) + achados do evento (H1-H9 confirmados/
   refutados), sem propor Specs de correção nesta rodada (item D).

## Hipótese de impacto técnico

- Nenhum arquivo de produção deve ser alterado nesta rodada (é CAT de auditoria, não implementação).
- `docs/backlog-seguranca-qualidade.md` permanece `staged`, não commitado — decisão de completar o commit
  fica suspensa até Leo confirmar, já que o pacote pediu explicitamente "não alterar nem commitar backlog
  ou PP-020 nesta rodada" (a edição deste próprio draft é a exceção prevista pelo próprio pacote, item 1).
- `npm install` + `npm run build` em `packages/shared`/`packages/parser` já foram executados nesta sessão
  para destravar o pre-commit hook — não são operações destrutivas nem alteram código versionado, apenas
  geram artefatos locais (`node_modules/`, `dist/`), já ignorados por `.gitignore`. Achado lateral: `npm
  audit` reportou 27 vulnerabilidades (1 crítica, 19 altas, 5 médias, 2 baixas) — entra no relatório do
  eixo 1 (segurança), não é uma ação de correção desta rodada.
- Todas as queries da seção anterior são `SELECT` — nenhuma escrita em produção.

## Errata técnica — Rodada 4 (contraponto recebido, citações verificadas)

Nova mensagem "Codex:" recebida com contraponto técnico ao relatório final. Mesma nota de proveniência
das rodadas anteriores aplica (não verificável via elo técnico direto nesta sessão). Diferente das rodadas
anteriores, aqui **todas as citações de arquivo:linha foram verificadas por `Read` direto** antes de aceitar
qualquer correção, conforme protocolo:

- `apps/worker/src/pipeline/upsert.service.ts:327` — confirmado: `extractCrossCategoryHash()` existe e
  remove o prefixo `cat:...|` do `matchKey` para agrupamento.
- `apps/worker/src/pipeline/upsert.service.ts:886` (`deduplicateCrossCategoryHashMatches`) — confirmado por
  leitura adicional (não citado no pacote, localizado via Grep para verificar a alegação): existe lógica
  explícita de deduplicação cross-category com scoring por pool de atletas compatíveis
  (`scoreMatchForCategoryPool`), não apenas geração de hash com prefixo.
- `apps/api/src/user/user.service.ts:6881` — confirmado: `getStateCircuitEligibleClubIds()` existe,
  filtra clubes por eventos `nivel: { in: ["ESTADUAL", "OPEN"] }`.
- `apps/api/src/user/user.service.ts:2435-2473` — já verificado na Rodada 3 (H7).

**Correções aceitas e aplicadas ao relatório final:**

1. **C1 (H4/H5):** rebaixado de "causa raiz identificada" para "contaminação confirmada, causa raiz aberta".
   Existe deduplicação cross-category dedicada (`deduplicateCrossCategoryHashMatches`); o achado real é que
   essa dedup não está cobrindo 100% dos casos observados em produção — não que o prefixo por si só cause
   duplicação. Necessário para fechar: warnings de reconciliação, telemetria da dedup, snapshots dos runs
   afetados (13674, 13676).
2. **C2 (H6):** reclassificado de "refutado como bug" para "comportamento explicado pela implementação
   atual; correção funcional pendente de decisão de produto". A pergunta de negócio (COPA nacional deveria
   mostrar todos os clubes participantes ou só os elegíveis ao circuito estadual?) fica para Leo decidir,
   não é uma conclusão técnica de "não é bug".
3. **C3:** limitação de fonte externa desmembrada — ausência da circular (valida datas/regulamento) é
   diferente de ausência de capturas operacionais INSCRICOES/GRUPOS/RESULTADOS (validariam os totais). Ambas
   ausentes, mas são lacunas distintas.
4. **C4 (H8):** adicionado que o gatilho ser externo (DevExpress/CBTM) não isenta de avaliar se o worker
   tem retry/degradação/registro adequados para esse tipo de falha — ponto em aberto, não avaliado nesta
   rodada.
5. **C5 (npm audit):** conclusão de severidade condicionada a análise de alcançabilidade em runtime —
   27 vulnerabilidades reportadas são sinal de backlog, não risco explorável confirmado sem análise adicional.
6. **H7 (observação):** mantido como bug confirmado do contrato de diagnóstico, mas removida qualquer
   implicação de que o 3º medalhista necessariamente deveria existir — regras de WO/elegibilidade não foram
   avaliadas para esse caso específico.

Nenhuma Spec de correção é aberta nesta rodada — errata é só correção do relatório de auditoria, mantendo
modo read-only.

## Fora de escopo (proposto)

- Correção de qualquer achado nesta rodada — CAT produz relatório, não código.
- Eventos além dos 4 IDs da Copa Brasil Prata Belém 2026.
- Infra fora do que já está documentado (não abrir novas frentes de deploy/CI).
- Completar o commit do backlog `docs/backlog-seguranca-qualidade.md` — permanece `staged` até Leo decidir.
- Qualquer `INSERT`/`UPDATE`/`DELETE` no banco de produção.
- `npm audit fix` ou qualquer correção de dependências — apenas registrar no relatório.
