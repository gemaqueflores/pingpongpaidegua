# Investigação — horários trocados no evento 59 (2026-09-18)

## Sintoma reportado por usuário
No evento 59 (6054 - TMB Estadual - 4º Etapa do Campeonato Paraense 2026), atleta ANDREZA MOTA:

| Fonte | Mesa | Horário |
|---|---|---|
| Site oficial CBTM | Mesa 17 | 11:30 |
| Site oficial CBTM | Mesa 19 | 13:30 |
| App PingPong Paid'egua | Mesa 19 | 19:30 |
| App PingPong Paid'egua | Mesa 17 | 18:30 |

Mesmas mesas, horários completamente diferentes do site oficial e aparentemente trocados entre si.

## Análise estática realizada (Claude, leitura de código)
- `packages/shared/src/index.ts:1104` `parseBrazilianDateTime()` monta o ISO com offset fixo `-03:00`
  (Belém, sem horário de verão) — lógica correta isoladamente.
- `packages/parser/src/index.ts:714` `extractMatchMeta()` extrai `mesa`, `hora`, `jogo` de uma única
  linha (`metaLine`) do próprio card DOM (`.dxcvBreakpointsCard_MaterialCompact`), via `toCardSnapshots`
  (`packages/parser/src/index.ts:440`), que itera `$(selector).each` — isolamento por elemento DOM parece
  correto, sem vazamento textual óbvio entre cards adjacentes.
- `apps/worker/src/pipeline/match-merge.ts:564-579` — lógica de merge quando duas capturas do mesmo
  `matchKey`/fallback têm `matchDatetime` divergente: prioriza a captura com horário explícito
  (`hasExplicitTime`) e, em empate, a de maior `sourcePriority` (RESULTADOS+ELIMINATORIA > RESULTADOS >
  ELIMINATORIA). Gera warning `merge-warning: datetime divergente...` mas **não há evidência de execução**
  de que esse caminho foi o disparador real — é apenas caminho presente por análise estática.

**Nenhuma causa raiz confirmada por leitura de código isolada.** É necessário evidência dinâmica (dados
reais em produção) antes de formular Spec de correção.

## Instrução para o Codex — investigação via ssh-oracle (read-only)

Objetivo: confirmar com dados reais se o problema está (a) na captura/parse do HTML de origem, (b) no
merge de múltiplas capturas, ou (c) em cache de read-model desatualizado no evento 59.

Executar via MCP `ssh-oracle` (`ssh_connect` host `129.213.86.180`, user `ubuntu`, chave
`.../ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`), depois rodar dentro do container postgres
(`docker exec -it appcbtmeventos-postgres-1 psql -U <user> -d <db>` — confirmar nome do serviço/usuário
via `docker compose ps` antes se necessário):

```sql
-- 1. Estado atual em matches para a atleta ANDREZA MOTA no evento 59
SELECT m.id, m.event_id, m.category_id, m.phase, m.round, m.table_number,
       m.match_datetime, m.cbtm_match_id, m.match_key, m.updated_at, m.source_flags
FROM matches m
JOIN match_participants mp ON mp.match_id = m.id
JOIN athletes a ON a.id = mp.athlete_id
WHERE m.event_id = 59
  AND a.full_name ILIKE '%ANDREZA%MOTA%'
ORDER BY m.table_number, m.match_datetime;

-- 2. Quantas linhas de matches existem para o mesmo match_key (duplicidade/merge)
SELECT match_key, count(*) FROM matches WHERE event_id = 59 GROUP BY match_key HAVING count(*) > 1;
```

Em paralelo, buscar no `raw_captures` o HTML bruto mais recente da categoria/aba RESULTADOS do evento 59
e extrair manualmente (grep no HTML) as linhas de "Jogo", "Mesa" e horário próximas ao nome "ANDREZA" e
"MOTA", para comparar contra o valor gravado em `matches.match_datetime`:

```sql
SELECT id, tab, category_id, captured_at, length(html_body) AS html_len
FROM raw_captures
WHERE event_id = 59
ORDER BY captured_at DESC
LIMIT 20;
```

Depois, para o `id` de captura relevante (aba RESULTADOS, categoria ABSOLUTO A FEM e MASTER 30FEM):

```sql
SELECT html_body FROM raw_captures WHERE id = <ID_ESCOLHIDO>;
```
(salvar em arquivo local via sftp/redirecionamento, não colar HTML gigante no chat — buscar apenas o
trecho relevante em torno de "ANDREZA" com grep -A/-B razoável).

## Não fazer nesta investigação
- Não escrever/alterar nenhuma linha em produção (somente SELECT).
- Não expor senha do usuário postgres nem qualquer segredo no chat/log.
- Não concluir causa raiz sem essa evidência — Claude retoma a análise após receber a saída bruta.
