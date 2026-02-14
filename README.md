# appcbtmeventos (monorepo)

Sistema full-stack para extração, normalização, persistência e consulta de eventos CBTM (URAL Base), com scraping de callbacks DevExpress (DX).

URL base CBTM:
`https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID={EVENT_ID}`

Referência real usada para parser e testes offline:
- `EVENT_ID=5246`
- categoria `ABSOLUTO E (MAS)`
- fixture real: `fixtures/results.txt`
- fixtures multi-categoria: `fixtures/golden/*.txt`

## Estrutura

```text
.
├─ apps
│  ├─ api        # NestJS + Prisma + JWT
│  ├─ worker     # BullMQ + Playwright + pipeline capture/parse/upsert
│  └─ web        # Next.js (Admin e Usuário)
├─ packages
│  ├─ parser     # parser DX offline (results.txt -> dataset)
│  └─ shared     # normalização, match_key, matching determinístico
├─ prisma
│  ├─ schema.prisma
│  └─ migrations
├─ fixtures
│  ├─ results.txt
│  └─ golden
│     ├─ ABSOLUTO_E_(MAS).txt
│     ├─ MASTER_30FEM.txt
│     └─ ROM.txt
├─ docs
│  ├─ matching-athletes.md
│  └─ parser-offline.md
├─ docker
│  ├─ api.Dockerfile
│  ├─ worker.Dockerfile
│  └─ web.Dockerfile
└─ docker-compose.yml
```

## Stack
- API: NestJS + Prisma + PostgreSQL
- Worker: Playwright + BullMQ + Redis
- Frontend: Next.js (Home publica para usuario + Login JWT apenas no Admin)
- Infra local: Docker Compose

## Arquitetura

Pipeline do worker:
1. `capture` (live via Playwright por padrão, ou `fixture`)
2. `persist raw` (`raw_captures`)
3. `parse` (`@cbtm/parser`)
4. `upsert` (`events`, `athletes`, `matches`, `scrape_runs`, conflitos)

O parser não roda embutido no scraping; ele opera desacoplado sobre os payloads/HTML retornados.

## Modelo de dados (pontos principais)
- `events`, `clubs`, `athletes`, `categories`
- `athlete_categories` (N:N)
- `matches`, `match_participants`
- `scrape_runs`, `raw_captures`
- `athlete_aliases`
- `athlete_match_conflicts`

Campos de atleta para matching:
- `name_display`, `name_normalized`
- `ranking_points`, `rating_points`
- `created_from_warning`

## Normalização
Implementada em `packages/shared/src/index.ts`:
- trim
- espaços únicos
- lowercase
- remoção de acentos

Aplicada em nomes de atleta/clube/categoria e aliases.

## match_key
`matches.match_key` é determinístico (SHA-1) e único, baseado em:
- `event_id`
- `category.normalized_name`
- `phase`
- `round` (ou placeholder)
- `table_number` (ou placeholder)
- `match_datetime` (ou placeholder)
- atletas normalizados em ordem alfabética

## Matching de atleta (nome completo x reduzido)

Implementado em `packages/shared/src/index.ts` e usado no upsert do worker.

Fases:
1. `alias-exato`: nome curto bate em alias já conhecido.
2. `forte-ranking-rating`: pontos iguais + compatibilidade de nome.
3. `heuristica`: com limiar alto e penalidade de ambiguidade.

Aceite:
- `score >= 80`
- diferença para segundo melhor `>= 15`

Sem aceite:
- gera conflito em `athlete_match_conflicts`
- cria placeholder (`SEM CLUBE`) para não perder o vínculo do jogo
- conflito pode ser resolvido no Admin API/UI.

## API

Auth:
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`

Admin:
- `GET /admin/events`
- `POST /admin/events`
- `PUT /admin/events/{id}`
- `DELETE /admin/events/{id}`
- `POST /admin/events/{id}/mark-completed`
- `POST /admin/events/{id}/scrape-now`
- `GET /admin/events/{id}/scrape-runs`
- `POST /admin/events/raw-captures/cleanup`
- `POST /admin/events/{id}/raw-captures/cleanup`
- `GET /admin/events/{id}/athlete-conflicts`
- `POST /admin/events/{id}/athlete-conflicts/{conflictId}/resolve`

User:
- `GET /events`
- `GET /events/{id}/athletes?search=`
- `GET /events/{id}/clubs?search=`
- `GET /events/{id}/clubs/{clubId}/athletes`
- `GET /events/{id}/athletes/{athleteId}/summary?orderBy=phase_hierarchy_datetime|category_phase_datetime`
- `GET /athletes/directory?search=`
- `GET /athletes/{athleteKey}/career`

Rotas de UI:
- Home usuario: `http://localhost:3000/`
- Login admin: `http://localhost:3000/admin/login`
- Painel admin: `http://localhost:3000/admin`
- Carreira do atleta: `http://localhost:3000/user/career/{athleteKey}`

## Como subir (Docker)

Pré-requisito: Docker Desktop em execução.

```bash
docker compose up --build -d
docker compose ps
```

Serviços:
- API: `http://localhost:4000`
- Web: `http://localhost:3000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

Credenciais padrão:
- admin: `mush1n-d0sh4 / Mur1l0@8#`

## Fluxo de uso
1. Abrir `http://localhost:3000`.
2. Navegar no modo usuario (publico) por evento/atleta/clube.
3. Para administrar, abrir `http://localhost:3000/admin/login` e fazer login.
4. Criar evento com `cbtmEventId=5246` (se ainda nao existir).
5. Acompanhar `scrape-runs` e conflitos.
6. Resolver conflitos de atleta quando houver.

## Compartilhamento social (User)
- Páginas com compartilhamento:
  - `user/career/{athleteKey}`
  - `user/events/{id}/group-simulator`
- Canais:
  - WhatsApp
  - Telegram
  - Instagram (feed/story/reels via download da arte gerada)

## Perfil de baixo custo (scrape a cada 2 horas)
- `SCRAPER_REFRESH_CRON_MS` padrao no worker: `7200000` (2 horas).
- Para rodar scrape sem worker 24/7, use:
  - `npm run scrape:once --workspace apps/worker`
- Workflow pronto para agendamento no GitHub Actions:
  - `.github/workflows/scrape-every-2h.yml`
  - Agenda automatica: a cada 2 horas (`0 */2 * * *`).
  - Execucao manual: `workflow_dispatch` com `event_ids` opcional.

## Publicacao online (producao)
1. Configure DNS do dominio para o servidor.
2. No servidor, instale Docker e Docker Compose plugin.
3. Ajuste variaveis sensiveis em `.env`:
   - `JWT_SECRET` forte
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH` (bcrypt)
   - `ADMIN_RESET_EMAIL` (default: `gemaqueflores@gmail.com`)
   - `ADMIN_MAX_LOGIN_ATTEMPTS` (default: `3`)
   - `ADMIN_LOCKOUT_MINUTES` (default: `15`)
   - `ADMIN_RESET_TOKEN_TTL_MINUTES` (default: `30`)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `RAW_CAPTURE_RETENTION_DAYS_SUCCESS` (default `14`)
   - `RAW_CAPTURE_RETENTION_DAYS_ERROR` (default `0`, preserva ERROR/PARTIAL sem limite de dias)
   - `RAW_CAPTURE_MAX_RUNS_PER_EVENT` (default `20`)
   - `RAW_CAPTURE_CLEANUP_ENABLED` (default `true` no worker)
   - `RAW_CAPTURE_CLEANUP_EVERY_MS` (default `86400000`)
   - gerar hash: `node -e "console.log(require('bcryptjs').hashSync('SuaSenhaForte', 12))"`
4. Suba os servicos:
   - `docker compose up --build -d`
5. Coloque um reverse proxy (Nginx/Traefik/Caddy) na frente do frontend e API.
6. Habilite HTTPS com certificado TLS (Let's Encrypt).
7. Para atualizar sem downtime longo:
   - `docker compose pull`
   - `docker compose up -d --build`

## Execução local sem Docker

```bash
npm install
npm run prisma:generate
npm run prisma:seed
npm run build
npm test
npm run smoke:fixture
```

## Testes
- Suite completa do monorepo:
  - `npm test`
- Parser offline (fixture real):
  - `packages/parser/test/parser.test.ts`
  - `packages/parser/test/golden-samples.test.ts`
  - `packages/parser/test/athlete-matching.test.ts`
- Matching determinístico:
  - `packages/shared/test/matching.test.ts`
  - `packages/shared/test/performance.test.ts`
- API e worker:
  - `npm run test --workspace apps-api`
  - `npm run test --workspace apps-worker`
- Smoke:
  - `npm run smoke:fixture`

Documentacao adicional:
- `docs/placares-aproveitamento-status.md`

## Migrations Prisma
- `prisma/migrations/20260209120000_init`
- `prisma/migrations/20260209121000_athlete_alias_and_conflicts`

## Sanitização
O repositório mantém somente os componentes ativos da stack (apps, packages, prisma, docker, fixtures e docs).
Artefatos temporários de execução (logs `tmp-api-*.log`) e acervo legado (`_archive`) não fazem parte da base ativa.

