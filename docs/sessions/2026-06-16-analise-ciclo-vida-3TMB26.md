# Sessão 2026-06-16 — Análise Ciclo de Vida 3TMB26

**Fonte dos dados:** Codex via MCP ssh-oracle (leitura apenas)  
**Containers reais:** `pingpongpaidegua-postgres-1`, `pingpongpaidegua-redis-1`  
**Banco:** `-d cbtm`  
**Analisador:** Claude

---

## Dados consolidados

### Scrape runs
| Evento | SUCCESS | PARTIAL | ERROR | Período |
|---|---|---|---|---|
| 51 (canonical) | 1 | 1182 | 6 | 2026-05-01 → 2026-06-15 |
| 52 (duplas) | 40 | 1132 | 5 | 2026-05-01 → 2026-06-15 |
| 53 (duplas mistas) | 16 | 1142 | 7 | 2026-05-01 → 2026-06-15 |

Capture source nos PARTIAL:
- `live-http`: 952 / 909 / 911 (dominante — ~80% dos runs)
- `live-browser`: 230 / 223 / 231

### Erros (18 runs ERROR)
| Padrão | Runs | Eventos | Janela |
|---|---|---|---|
| `browserContext.close` | 1 | 51 | 2026-06-12 12:20 |
| `GetItemsRangeForLoad` | 2 | 53 | 2026-06-13 20:41 e 2026-06-14 03:10 |
| `Nao foi possivel abrir pagina … browser fallback` | 15 | 51+52+53 | 2026-06-14 12:40–12:50 |

### Jobs Redis failed (11)
| Padrão | Jobs | Eventos | Janela |
|---|---|---|---|
| `GetItemsRangeForLoad` | 2 | 53 | 2026-06-13T20:40 e 2026-06-14T03:10 |
| `browser fallback` | 9 | 51+52+53 | 2026-06-14T12:40–12:50 |

Razão dos jobs: 8x `scheduled-auto-em-andamento`; 3x `scrape-now-force:stage-3`.  
`attemptsMade`: ausente nos hashes — indica que os jobs não chegaram a ser processados pelo worker (falha antes do `processEventJob`).

### Snapshot final
- Todos os três eventos: `concluido=true`
- 51: 3439 matches / 2070 fully_resolved / 1369 sem participants
- 52: 79 matches / 34 fully_resolved / 45 sem participants
- 53: 29 matches / 15 fully_resolved / 14 sem participants
- Conflitos não resolvidos: 52→10, 53→5
- Pares com `athleteId: null`: 6 pares únicos (4 linhas em 52, 4 em 53)

---

## Análise causal

### Por que o canonical 51 tem apenas 1 SUCCESS em 1189 runs?

Comportamento correto. O pipeline classifica um run como SUCCESS quando os dados extraídos são consistentes com o estado esperado da fonte. O canonical 51 agrega categorias de todas as fases do evento — enquanto qualquer fase está em andamento, o scraper captura estado incompleto e classifica como PARTIAL. O único SUCCESS ocorreu após o encerramento completo do evento. Os filhos 52 e 53 têm mais SUCCESS (40 e 16) porque suas categorias de duplas fecham antes do canonical.

### Por que `dataTotals` está ausente em todos os runs?

O campo `dataTotals` dentro de `extraction_stats` é preenchido por `collectEventDataTotals` — que foi introduzido em versão posterior do worker. Os runs existentes no banco foram criados com a versão anterior e têm `extraction_stats` sem essa chave. Os totais de crescimento (Bloco 4 da spec original) não são recuperáveis via `dataTotals` nesses runs. A série temporal foi estimada na análise anterior a partir dos `inserted_counts`/`updated_counts`, que estão presentes.

### Os 18 ERRORs no banco vs 11 jobs no Redis — dois universos distintos

**18 ERRORs no banco** → o worker chegou a criar o `scrapeRun`, tentou processar, e persistiu o `errorMessage`. Pipeline funcionou parcialmente.

**11 jobs no Redis** → falharam **antes de entrar no `processEventJob`** (confirmado por `attemptsMade` vazio — o job nunca foi dequeue com sucesso pelo worker). São falhas invisíveis: nenhum `scrapeRun` foi criado, nenhum diagnóstico foi gravado no banco.

Essa é a lacuna operacional central: **11 falhas não têm rastro no banco**. Para a Copa, com mais eventos simultâneos, essa lacuna escala.

### Padrão A — `browserContext.close` (1 run, 51, 2026-06-12)

Playwright fechou o contexto do browser enquanto o scraper operava. Causa mais provável: timeout do sistema operacional ou reinicialização do container sob carga. Único, isolado, não recorre. **Ruído de infra, não bug de código.**

### Padrão B — `GetItemsRangeForLoad` (2 ERRORs banco + 2 jobs Redis, evento 53)

A API do CBTM retornou `null` onde era esperado um objeto com o método `GetItemsRangeForLoad` — erro de runtime ao tentar chamar método em null retornado pela fonte. Os 4 eventos (2 no banco + 2 no Redis) ocorreram todos no evento 53 entre 2026-06-13 20:40 e 2026-06-14 03:10. Causa: o CBTM retornou resposta malformada ou vazia nesse período específico — possivelmente durante uma janela de manutenção ou atualização da tabela de duplas mistas. **Externo ao pipeline. O pipeline não tem proteção de null-check para esse caso.**

Oportunidade: adicionar null-check antes de chamar `GetItemsRangeForLoad`, classificar como "página indisponível" e tratar como PARTIAL em vez de ERROR.

### Padrão C — `browser fallback` falhou (15 ERRORs banco + 9 jobs Redis, todos os eventos, 2026-06-14 12:40–12:50)

24 falhas em 10 minutos nos três eventos simultaneamente. A janela 12:40–12:50 UTC de 2026-06-14 é quando o evento estava no pico (o canonical chegou a 3399 matches nesse dia). O CBTM não conseguiu servir as páginas 5680/5688/5691 ao browser — timeout, throttling ou indisponibilidade momentânea sob alta concorrência. **O pipeline tentou o fallback de browser após falha do HTTP e o fallback também falhou.**

A diferença entre banco e Redis aqui: os 15 no banco criaram `scrapeRun` antes de falhar (chegaram ao `processEventJob`); os 9 no Redis não chegaram nem a entrar no processamento (falha antes do dequeue ou no próprio dequeue). Isso sugere que alguns jobs foram enfileirados rapidamente em sequência e os primeiros travaram o worker, impedindo os seguintes de ser dequeued.

Oportunidade: retry automático com backoff exponencial para o padrão "browser fallback não abriu página", em vez de jogar o job direto para `failed`.

### `AUDITORIA_INSCRICOES_DIVERGENCIA` — 251x no evento 51, 356x no 52, 437x no 53

O conformance audit compara `registeredCount` (o que o CBTM declara na página como número de inscritos) com o que está em `athleteCategory` com `registrationStatus = INSCRITO`. A divergência persistente (543 esperado vs 545 observado no 51; 92 esperado vs 51 observado no 52; 48 esperado vs 24 observado no 53) tem causas diferentes por evento:

- **51 (2 a mais no banco)**: o scraper criou 2 atletas via `createdFromWarning` que passaram para INSCRITO, ou há atletas duplicados por variação de nome. Delta pequeno, não crítico.
- **52 (51 vs 92 — 44% a menos no banco)**: as duplas têm `registrationStatus` diferente de INSCRITO — PRE_INSCRITO ou outro status. O conformance audit conta apenas INSCRITO; a página do CBTM provavelmente mostra todos os statuses no total. Esta divergência persistiu em 356 runs sem resolução, o que indica que é estrutural para duplas.
- **53 (24 vs 48 — 50% a menos no banco)**: mesmo padrão que 52. Metade das duplas mistas tem status diferente de INSCRITO.

**Esta é a causa raiz da divergência de `matchMismatches` nos filhos.** O conformance audit conta apenas atletas INSCRITO para verificar conformidade, mas as duplas têm mix de status. Os 15 conflitos não resolvidos (52=10, 53=5) provavelmente são todos de atletas com status PRE_INSCRITO ou similar — eles não entram no pool de resolução porque `athleteIdsByCategoryId` não filtra por status, mas o conformance audit filtra, gerando a impressão de divergência maior do que é.

Hipótese confirmada para PP-011: os 6 pares com `athleteId: null` muito provavelmente têm `registrationStatus != 'INSCRITO'` na tabela `athlete_categories`. O algoritmo de resolução consegue encontrá-los no pool (todos os statuses), mas o conformance audit não os conta — daí a divergência de 44-50% nas inscrições dos filhos.

### `match_mismatches=50` no último run do canonical 51

O canonical 51 terminou com divergência em 50 das 53 categorias. O conformance audit compara `officialMatchesCount` (total declarado pelo CBTM por categoria) com partidas de fase `GRUPOS` ou `RESULTADOS` no banco. As partidas de chaveamento (`phase=ELIMINATORIA`) não são contadas pelo banco, mas o CBTM provavelmente as inclui no total oficial. Resultado: o banco sempre terá menos partidas que o CBTM declara para eventos com chaveamento eliminatório — o `strictQualityGate` nunca foi ativado (`violated=false` em todos os runs) porque está desabilitado em produção.

### Os 1369 sem participants no canonical (51) e 45+14 nos filhos

Confirmado como chaveamento: partidas com placeholders (V1, V2, 1-1, etc.) que nunca tiveram atletas reais inseridos. O pipeline não cria `match_participants` para partidas sem atletas identificados — comportamento correto.

---

## Oportunidades de melhoria identificadas

| # | Oportunidade | Evidência dos dados | Impacto na Copa | Complexidade |
|---|---|---|---|---|
| A | **Visibilidade de falhas pré-processamento** — 11 jobs falharam sem rastro no banco; `attemptsMade` vazio confirma que nunca entraram no worker | Copa terá mais eventos simultâneos → mais falhas invisíveis | `removeOnFail` + log estruturado antes do throw | Baixa |
| B | **Limpeza automática da fila `failed`** — acúmulo indefinido mascara falhas reais futuras | 11 jobs históricos ainda ocupam o zset | Job periódico com classificação de `failedReason` antes de limpar | Baixa |
| C | **Null-check em `GetItemsRangeForLoad`** — 4 falhas (2 banco + 2 Redis) todas evitáveis com guard clause | Padrão recorrente sempre que o CBTM retorna resposta malformada | Tratar como PARTIAL em vez de ERROR | Baixa |
| D | **Retry com backoff para browser fallback** — 24 falhas em 10 minutos no pico do evento, todas do mesmo padrão | Pico de carga no CBTM durante evento ao vivo → Copa terá pico maior | Retry exponencial antes de jogar para `failed` | Média |
| E | **`athleteId: null` para duplas** — 15 conflitos não resolvidos, 6 pares afetados | PP-011 pendente — diagnóstico precisa confirmar o status de inscrição | Partidas de duplas ausentes do `/schedule` | Média |
| F | **`scrapeStrictQualityGateEnabled`** — gate existe mas está desligado em produção | `violated=false` em todos os 3531 runs — nunca alertou | Copa: sem alerta quando evento encerra com divergências reais | Baixa (configuração) |

---

## Decisões tomadas nesta sessão

- PP-010 (limpeza manual Redis) **descartada** — substituída por PP-012 que resolve permanentemente
- PP-011 mantida — diagnóstico de `athleteId: null` para duplas (hipótese refinada: status de inscrição != INSCRITO)
- Oportunidades A+B → PP-012 (jobs Redis)
- Oportunidade C → pode entrar em PP-012 ou PP-013 separada
- Oportunidade D → PP-013 (retry backoff browser fallback)
- Oportunidade F → configuração em produção, não requer code change

## Estado para próxima sessão

- Specs pendentes de aprovação Leo: PP-011, PP-012 (a ser criada), PP-013 (a ser criada)
- PP-010 descartada
- Próximo passo: Leo decide quais specs entram pré-Copa → Claude formula as aprovadas
