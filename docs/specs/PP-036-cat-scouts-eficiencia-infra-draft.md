# PP-036 (draft) — CAT: scouts/pureza de aproveitamento + saúde e capacidade de infraestrutura

## Status: Rodada 2 — infra confirmada, achado de padrão correto encontrado (rota 2), pronto para Spec

## Frente 1, rota 2 — resultado da investigação (achado positivo, reduz escopo)

`GET /events/:id/athletes/:athleteId/summary` (`user.service.ts:4388`, chamada
`getAthleteSummary`) **já separa corretamente** individual de duplas — confirmado por leitura direta:
`analyticalMatches` (linha 4557-4558) filtra `!match.isProjectedParticipant`, e `performance`/
`performanceByCategory` derivam só desse conjunto filtrado. Partidas de duplas aparecem na lista visual
(`response.matches`) mas não contaminam aproveitamento/classificação. Teste real confirma:
`user-service.athlete-summary-cache.test.ts:420-429` — 2 partidas exibidas, apenas 1 considerada na
performance.

**Consequência para a Spec:** este é o padrão de referência a replicar nos 3 pontos que realmente têm o
bug (Frente 2 + rota 1 de scouts), não uma lógica a inventar do zero.

## Frentes 3-4 — resultado da investigação (Codex, read-only, confirmado)

| Métrica | Valor |
|---|---:|
| RAM total / disponível / usada | 11 GiB / 10 GiB / 831 MiB |
| Disco raiz (usado/livre/total) | 26 GiB / 20 GiB / 45 GiB (57%) |
| Uptime | 110 dias |
| Load average | 0,04 / 0,15 / 0,11 |
| Banco `cbtm` (tamanho lógico) | 2.038 MB |
| Volume Docker do Postgres | 2,246 GB |
| Eventos persistidos | 23 |
| `raw_captures` (maior tabela) | 1.938 MB (~95% do banco) |

**Saúde geral:** boa — CPU/memória com folga ampla, sem swap, load baixo, containers saudáveis há
18-22h (dentro da janela normal de restart pós-deploy das Specs recentes).

**Capacidade estimada (linear, conforme decidido):**
- Média por evento: `2.038 MB / 23` ≈ **88,6 MB/evento** (lógico) ou `2.246 MB / 23` ≈ **97,7 MB/evento**
  (volume físico, mais realista para projeção de disco).
- Com 20 GiB (~20.480 MB) livres: **~231 eventos** (base lógica) ou **~205 eventos** (base física) antes
  de esgotar o disco atual — sem margem operacional, sem considerar crescimento de imagem Docker/logs.
- `raw_captures` domina o tamanho (~95%) — é o candidato natural para qualquer política de retenção
  futura, se a capacidade se tornar preocupação antes do esperado (nota: retenção de `raw_captures` já
  existe, `RawCaptureRetentionService`, achado do CAT PP-026/I3 — não reavaliado nesta rodada).

**Conclusão da Frente 3-4:** sem urgência — ~200+ eventos de capacidade remanescente com a infraestrutura
atual, load/memória com folga ampla. Não gera Spec de ação imediata; registrado como referência para
replanejamento futuro.

## Escopo declarado

CAT com 4 frentes distintas, pedido por Leo após o fechamento da sequência PP-027 a PP-035 (segurança/
infraestrutura de containers). Rodado via leitura de código (Glob/Read/Grep) — nenhuma operação Git nesta
sessão. Frentes 3 e 4 (infra Oracle/capacidade) exigem investigação read-only via SSH — mesmo padrão já
usado nas sessões anteriores: Claude formula comandos, Codex executa.

---

## Frente 1 — "Rotas de scouts dos atletas"

[RESOLVIDO: Leo confirmou — "scouts" refere-se a duas rotas específicas já existentes:
1. `/career/{slug_atleta}` (frontend) → `GET /athletes/:athleteKey/career` (backend,
   `user.service.ts:4877-...`, chama `buildCareerMedalTable` na linha 5177).
2. `/events/{id_evento}/athletes/{id_atleta}` (resumo do atleta dentro de um evento específico).

**Confirmado por leitura adicional:** `getAthleteCareer` (rota 1) já é afetada pela mistura
individual/duplas identificada na Frente 2 — busca todos os registros de `Athlete` que casam com o nome
(incluindo o registro do atleta como parte de nome composto de dupla, `"A # B"`) e agrega via
`buildCareerMedalTable`, que não distingue modalidade. Rota 2 (resumo por evento) ainda não mapeada nesta
rodada — Codex confirma o handler exato e se tem o mesmo problema.]

---

## Frente 2 — Pureza de cálculo de aproveitamento (individual × duplas)

**Achado confirmado por leitura direta — mistura real, não hipotética:**

1. `computeEfficiencyRanking()` (`apps/api/src/user/user.service.ts:2980-3334`, ranking de eficiência por
   clube): `isEfficiencyEligibleCategoryName()` (linha 527-531) **sempre retorna `true`** — não distingue
   categoria individual de categoria de duplas/duplas mistas. `categoryIds` (linha 3117-3119) inclui todas
   as categorias do escopo. Medalhas de todas as categorias somam no mesmo `row[medalha] += 1` (linha
   3325) por clube — **sem separação entre individual e duplas na métrica final**.
2. Em outra função de eficiência por atleta (linhas ~3700-3739), existe `isDoublesCategoryName`/
   `isDoublesEventName` (já implementadas, usadas para gerar `dedupKey` que evita contar a mesma dupla
   duas vezes) — mas isso é deduplicação contra duplicidade de contagem da mesma dupla, **não** separação
   de individual vs. duplas no total agregado.
3. `career-medals.ts` (`buildCareerMedalTable`, linhas 41-63): agrega medalhas por `event.nivel`
   (ESTADUAL/COPA/NACIONAL/OPEN), iterando `performanceByCategory` sem checar se a categoria é individual
   ou duplas — mesmo problema, em outro consumidor.

**Conclusão da leitura:** o projeto já tem os meios de identificar duplas por nome
(`isDoublesCategoryName`, `isCompositePairName`, `isDoublesEventName` — usados em outros pontos do
código, ex. `user.service.ts:674-676,693`), mas esses filtros **não são aplicados** nos 3 pontos de
agregação de medalha/eficiência acima. A "poluição" é real: um atleta que ganha ouro individual e ouro
em duplas no mesmo evento soma 2 ouros no mesmo balde de estatística, sem forma de visualizar separado.

**Relação com achados arquiteturais do CAT anterior (P2/A1/A2):** confirmada. O padrão de "detecção de
tipo por regex/nome espalhada" (A1) é exatamente o que geraria a correção aqui — os mesmos helpers
(`isDoublesCategoryName` etc.) já existem, só não são usados consistentemente em todos os pontos de
agregação. `user.service.ts` com 7048 linhas (P2) é onde os 3 pontos de mistura identificados vivem,
tornando difícil garantir que todo novo ponto de agregação de medalha aplique o filtro correto — reforça
o achado de falta de camada de domínio centralizada (A2).

### Ambiguidades

**O QUÊ:** separar completamente as estatísticas (individual nunca soma com duplas), ou apenas expor a
possibilidade de visualizar separado (mantendo um total combinado como opção adicional)?
**COMO:** aplicar `isDoublesCategoryName`/`isDoublesEventName` como filtro nos 3 pontos identificados,
ou criar um campo estruturado na modelagem de dado (ex.: `Category.modalidade` enum) em vez de continuar
detectando por nome — mesmo tipo de decisão que PP-025 já tomou para o formato de disputa.
**ONDE:** os 3 pontos confirmados (`computeEfficiencyRanking`, eficiência por atleta, `career-medals.ts`)
mais qualquer outro ponto de agregação de medalha que Codex confirme existir e eu não tenha mapeado nesta
rodada.
**Definição de pronto:** Leo decide o modelo de separação antes de qualquer Spec.

[RESOLVIDO: separação total — individual e duplas nunca somam na mesma métrica, em nenhum dos 4 pontos
identificados (2 na Frente 2 + 2 rotas de "scouts" na Frente 1). Mecanismo: reaproveitar
`isDoublesCategoryName`/`isDoublesEventName`/`isCompositePairName`, já implementados e usados em outros
pontos do código — sem migration, sem campo estruturado novo.]

---

## Frente 3 — Saúde da infraestrutura Oracle Cloud/servidor

Não avaliável só por leitura de código — requer dado real de produção. Comandos read-only propostos
(Codex executa via SSH, mesmo padrão já usado em C1/PP-027, R1/PP-028, I1/PP-032):

```bash
# CPU/memória/disco da VM
free -h
df -h
uptime

# Containers: uso de recursos e status
docker stats --no-stream
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Size}}"

# Tamanho do banco e das maiores tabelas (dentro do container postgres)
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
  SELECT pg_size_pretty(pg_database_size('cbtm')) AS total_db_size;
"
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
  FROM pg_catalog.pg_statio_user_tables
  ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
"

# Volume Docker do Postgres
docker system df -v | grep -A1 postgres_data
```

[RESOLVIDO: Leo autorizou. Comandos prontos para transporte ao Codex.]

---

## Frente 4 — Capacidade de eventos persistíveis

Depende diretamente do resultado da Frente 3 (tamanho médio de dado por evento vs. espaço disponível).
Cálculo proposto: `tamanho_total_banco / número_de_eventos_já_persistidos` = tamanho médio por evento;
projeção = `espaço_livre_em_disco / tamanho_médio_por_evento`.

```bash
# Número de eventos já persistidos, para calcular a média
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
  SELECT COUNT(*) AS total_eventos FROM events;
"
```

[RESOLVIDO (assumido por ausência de objeção): estimativa linear simples nesta rodada. Se os números
reais (Frente 3) mostrarem variação grande de tamanho por tipo de evento, Claude sinaliza e propõe
refinamento por categoria (COPA vs. ESTADUAL) como ajuste na mesma análise, sem nova rodada de CAT.]

---

## Hipótese de impacto técnico (Frente 2, a confirmar após resolução dos PENDENTE)

- Arquivos candidatos: `apps/api/src/user/user.service.ts` (3 pontos identificados),
  `apps/api/src/user/career-medals.ts`.
- Se a decisão for "campo estruturado novo": `prisma/schema.prisma` (migration), mesmo padrão de PP-025
  (`Event.competitionFormat`).
- Nenhuma alteração nesta rodada — CAT é análise.

## Fora de escopo (proposto)

- Não duplicar achados já cobertos pelas Specs PP-021 a PP-035 (contaminação cross-category de partidas,
  formato de disputa de duplas, segurança/infraestrutura de containers).
- Não abrir Spec nesta rodada — CAT primeiro, priorização depois.
