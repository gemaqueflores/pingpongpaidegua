# Banco: Retencao e Indices

## Objetivo
- Controlar crescimento de `raw_captures`.
- Reduzir custo de leitura em consultas frequentes (user/admin).
- Preservar idempotencia e isolamento por evento.

## Politica de retencao (`raw_captures`)
- Runs `SUCCESS`:
  - mantem por janela de dias (`RAW_CAPTURE_RETENTION_DAYS_SUCCESS`, default `14`);
  - mantem tambem os ultimos `N` runs por evento (`RAW_CAPTURE_MAX_RUNS_PER_EVENT`, default `20`).
- Runs `ERROR`/`PARTIAL`:
  - preserva sempre quando `RAW_CAPTURE_RETENTION_DAYS_ERROR=0` (default);
  - se `>0`, aplica janela de dias para erro/parcial.
- Cleanup automatico:
  - worker agenda job diario (`RAW_CAPTURE_CLEANUP_EVERY_MS`, default `86400000`).
- Cleanup manual:
  - `POST /admin/events/raw-captures/cleanup` (global)
  - `POST /admin/events/{id}/raw-captures/cleanup` (por evento)
  - body opcional: `{ "dryRun": true }`.

## Indices adicionados
- `raw_captures(event_id, scrape_run_id, captured_at)`
  - melhora delete/retencao e consultas por run/evento.
- `scrape_runs(event_id, started_at)`
  - acelera selecao de runs recentes por evento.
- `matches(event_id, category_id, match_datetime)`
  - melhora listagens e filtros por evento/categoria/periodo.
- `athletes(event_id, club_id)`
  - melhora listagem por clube no evento.
- `athletes(event_id, name_display)`
  - melhora ordenacao/filtros simples por nome no evento.
- `pg_trgm` + GIN:
  - `athletes.name_display`, `clubs.name`, `categories.name`
  - melhora `contains + insensitive`.

## Operacao recomendada
1. Monitorar tamanho de `raw_captures` semanalmente.
2. Rodar cleanup manual em `dryRun` antes de alterar thresholds.
3. Ajustar dias/runs conforme volume real de scrape por evento.
4. Para eventos concluidos:
   - nao auto-scrapar;
   - reprocessar apenas via `scrape-now` admin.

