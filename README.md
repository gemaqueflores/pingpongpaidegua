# appcbtmeventos (PingPong Paid'egua)

Monorepo para captura, normalizacao, persistencia, auditoria e consulta publica de eventos CBTM.

O projeto cobre o ciclo completo de um evento:
- scraping de inscricoes, grupos e resultados
- parse e normalizacao de dados oficiais
- persistencia e reconciliacao no PostgreSQL
- read models publicos e administrativos
- frontend publico e painel administrativo

## Documentacao da Raiz
- `README.md`: visao funcional, arquitetura e operacao do repositorio.
- `AGENTS.md`: contexto permanente do projeto para agentes e assistentes.
- `PROMPTS.md`: catalogo de prompts operacionais reutilizaveis.

## Stack
- API: NestJS + Prisma + PostgreSQL
- Worker: BullMQ + Playwright + parser compartilhado
- Web: Next.js
- Shared: `packages/shared`
- Parser: `packages/parser`
- Cache e filas: Redis
- Infra local e producao: Docker Compose
- Infra alvo: Oracle Cloud Always Free

## Estrutura

```text
.
|- apps
|  |- api
|  |- worker
|  `- web
|- packages
|  |- parser
|  `- shared
|- prisma
|- fixtures
|- docs
|- scripts
|- docker
|- AGENTS.md
|- PROMPTS.md
|- README.md
`- docker-compose.yml
```

## Visao Arquitetural
O pipeline principal do worker segue esta ordem:
1. captura (`INSCRICOES`, `GRUPOS`, `RESULTADOS`)
2. persistencia de `raw_captures`
3. parse em `@cbtm/parser`
4. upsert e reconciliacao no banco
5. auditoria do scrape run
6. publicacao e aquecimento seletivo de read models

Observacoes importantes:
- `Fase Eliminatoria` nao e fonte primaria de scraping.
- Eventos podem ser simples ou agregados por configuracao administrativa.
- Redis nao substitui a verdade persistida no PostgreSQL.
- O projeto prioriza resiliencia e degradacao controlada para o Always Free.

## Dominio
Entidades centrais:
- `Event`
- `Category`
- `Athlete`
- `Match`
- `ScrapeRun`
- `ReadModelCache`

Regras de dominio relevantes no estado atual:
- fontes validas: `INSCRICOES`, `GRUPOS`, `RESULTADOS`
- `WO` e `WO duplo` nao contam como partida jogada
- `bye` avanca, mas nao conta como partida jogada
- podio padrao: `1 ouro`, `1 prata`, `ate 2 bronzes`
- excecoes de podio dependem de regra oficial ou configuracao validada
- quadro de medalhas/eficiencia do site contabiliza categorias `Rating (R*)`
- em duplas e duplas mistas, a unidade competitiva e a dupla, nao cada atleta separadamente

## Quadro de Medalhas e Eficiencia
Pesos atuais do site:
- ouro: `130`
- prata: `80`
- bronze: `50`

Pontuacao por evento:
- `pontuacao = quantidade x peso_da_medalha x peso_do_evento`

Desempate do ranking:
1. `pontuacao total`
2. `ouro`
3. `prata`
4. `bronze`

Pesos de evento atualmente usados no projeto:
- `BRASILEIRAO = 18`
- `SELETIVA_NACIONAL = 12`
- `COPA_BRASIL_OURO = 9`
- `COPA_BRASIL_PRATA = 6`
- `ESTADUAL = 3`
- `REGIONAL = 1`

Observacao:
- o quadro do site pode divergir do trofeu oficial da federacao quando a federacao usar outra regra administrativa ou excluir categorias `R*`.

## Duplas e Duplas Mistas
O site oficial publica dados de duplas de forma inconsistente entre abas.
Exemplos comuns:
- inscricoes: `ATLETA A # ATLETA B`
- grupos: apenas um integrante da dupla
- resultados: `ATLETA A - ATLETA B`

Por isso, o projeto normaliza pares e prioriza:
- unidade competitiva canonica
- reconciliacao por aliases
- deduplicacao por evento/categoria quando necessario
- preservacao do clube correto da dupla ou dupla mista

## API Principal
### Auth
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`

### Admin
- `GET /admin/events`
- `POST /admin/events`
- `PUT /admin/events/{id}`
- `DELETE /admin/events/{id}`
- `POST /admin/events/{id}/mark-completed`
- `POST /admin/events/{id}/scrape-now`
- `GET /admin/events/{id}/scrape-runs`
- `GET /admin/events/{id}/athlete-conflicts`
- `POST /admin/events/{id}/athlete-conflicts/{conflictId}/resolve`
- `POST /admin/events/raw-captures/cleanup`
- `POST /admin/events/{id}/raw-captures/cleanup`

### Publica
- `GET /events`
- `GET /events/{id}`
- `GET /events/{id}/athletes?search=`
- `GET /events/{id}/clubs?search=`
- `GET /events/{id}/clubs/{clubId}/athletes`
- `GET /events/{id}/athletes/{athleteId}/summary`
- `GET /events/{id}/efficiency`
- `GET /events/{id}/medalists`
- `GET /clubs/{clubId}/efficiency-career`
- `GET /athletes/directory?search=`
- `GET /athletes/{athleteKey}/career`

## Web
Rotas principais:
- home publica: `http://localhost:3000/`
- login admin: `http://localhost:3000/admin/login`
- painel admin: `http://localhost:3000/admin`
- carreira do atleta: `http://localhost:3000/user/career/{athleteKey}`
- eficiencia do clube: `http://localhost:3000/eficiencia/{clubId}`

Tambem existem paginas institucionais publicas:
- `/sobre`
- `/contato`
- `/privacidade`

## Ambiente Local
Pre-requisito: Docker Desktop ativo.

Subir infraestrutura + backend + worker:

```bash
docker compose up --build -d
docker compose ps
```

Subir tambem o frontend do monorepo via Docker:

```bash
docker compose --profile local-ui up --build -d
```

Servicos locais:
- API: `http://localhost:4000`
- Web: `http://localhost:3000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

Credenciais locais de desenvolvimento:
- usuario admin: `admin-local`
- senha local padrao: `admin-local-change-me`

Em producao, configure obrigatoriamente:
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`

## Variaveis e Operacao
Valores de conexao locais padrao nos `.env.example`:
- API write: `connection_limit=6`
- API read: `connection_limit=10`
- Worker write: `connection_limit=4`
- Worker read: `connection_limit=2`

Perfil atual de producao na Oracle A1 (`2 OCPU / 12 GB`):
- Postgres:
  - `max_connections=80`
  - `shared_buffers=512MB`
  - `max_wal_size=4GB`
- Redis:
  - `maxmemory=256MB`
- API:
  - `NODE_OPTIONS=--max-old-space-size=768`
  - write pool `8`
  - read pool `12`
- Worker:
  - `NODE_OPTIONS=--max-old-space-size=1536`
  - write pool `6`
  - read pool `4`
  - prewarm `100 atletas / concorrencia 3 / timeout 10s`

Esses limites seguem conservadores para Always Free, mas deixam de estrangular a VM A1 como acontecia na `E2.1.Micro`.

## Build e Testes
Comandos uteis:

```bash
npm install
npm run build --workspace apps-api
npm run build --workspace apps-worker
npm run build --workspace apps-web
npm run test --workspace apps-api
npm run test --workspace apps-worker
```

Testes importantes ja existentes cobrem, entre outros:
- read models e cache
- deduplicacao de duplas e duplas mistas
- regras de podio
- regras de WO e WO duplo
- sincronizacao de inscricoes
- integridade do worker antes do upsert

## Operacao em VM
A producao atual usa uma VM Oracle Cloud Always Free com Docker Compose.
Medidas operacionais importantes ja adotadas:
- housekeeping leve de Docker
- health check periodico da VM
- watchdog funcional de eventos criticos
- alertas opcionais por webhook para falhas operacionais
- limite conservador de conexoes Prisma/Postgres
- prewarm calibrado para a VM A1
- self-heal com baixo impacto
- workflow de scrape alinhado ao intervalo operacional de evento (`30 min`)
- hardening basico de SSH com `fail2ban` e `ufw`

Scripts relacionados:
- `scripts/vm/ppg-vm-health.sh`
- `scripts/vm/ppg-event-watch.sh`
- `scripts/vm/ppg-send-alert.sh`
- `scripts/vm/alerts.env.example`
- `scripts/vm/ppg-housekeeping.sh`
- `scripts/vm/install-vm-ops.sh`
- `scripts/vm/install-ssh-hardening.sh`

Monitoramento funcional de evento:
- roda na VM a cada `10 min`
- observa eventos em `GRADES_PUBLICADAS_PRE_JOGO`, `EM_ANDAMENTO` e `POS_EVENTO` recente
- audita inconsistencias entre resumo do evento e quadro de medalhistas
- pode disparar `post-scrape-reprocess` com cooldown quando encontrar inconsistencias de publicacao

Alertas operacionais:
- `ppg-vm-health`, `ppg-event-watch` e `ppg-recover` suportam alertas por `Discord`, `Telegram` e `WhatsApp`
- cooldown configuravel via `PPG_ALERT_COOLDOWN_SECONDS`
- roteamento por tipo do alerta:
  - `PPG_ALERT_ROUTES_DEFAULT`
  - `PPG_ALERT_ROUTES_WARN`
  - `PPG_ALERT_ROUTES_FAIL`
  - `PPG_ALERT_ROUTES_{ALERT_KEY}`
- cada rota aceita uma lista separada por virgula no formato:
  - `discord`
  - `telegram`
  - `whatsapp`
  - ou com perfil:
    - `discord:ops`
    - `telegram:diretoria`
    - `whatsapp:critico`
- exemplos:
  - `PPG_ALERT_ROUTES_WARN=discord:ops,telegram:ops`
  - `PPG_ALERT_ROUTES_FAIL=discord:ops,telegram:ops,whatsapp:critico`
  - `PPG_ALERT_ROUTES_RECOVER_FAILED=discord:ops,telegram:ops,whatsapp:critico`

Credenciais por canal:
- Discord:
  - padrao: `PPG_DISCORD_WEBHOOK_URL`
  - por perfil: `PPG_DISCORD_WEBHOOK_URL_OPS`
- Telegram:
  - padrao: `PPG_TELEGRAM_BOT_TOKEN`, `PPG_TELEGRAM_CHAT_ID`
  - por perfil: `PPG_TELEGRAM_BOT_TOKEN_OPS`, `PPG_TELEGRAM_CHAT_ID_OPS`
- WhatsApp Cloud API:
  - padrao:
    - `PPG_WHATSAPP_TOKEN`
    - `PPG_WHATSAPP_PHONE_NUMBER_ID`
    - `PPG_WHATSAPP_TO`
    - `PPG_WHATSAPP_MESSAGE_TYPE`
    - `PPG_WHATSAPP_TEMPLATE_NAME`
    - `PPG_WHATSAPP_TEMPLATE_LANG`
  - por perfil:
    - `PPG_WHATSAPP_TOKEN_CRITICO`
    - `PPG_WHATSAPP_PHONE_NUMBER_ID_CRITICO`
    - `PPG_WHATSAPP_TO_CRITICO`
    - `PPG_WHATSAPP_MESSAGE_TYPE_CRITICO`
    - `PPG_WHATSAPP_TEMPLATE_NAME_CRITICO`
    - `PPG_WHATSAPP_TEMPLATE_LANG_CRITICO`

## Fluxo de Trabalho Recomendado
1. Auditar a implementacao atual.
2. Identificar a camada do problema.
3. Aplicar a menor correcao auditavel.
4. Ajustar testes.
5. Validar build e testes do workspace afetado.
6. So depois subir para producao.

## Referencias de Fixture
Fixtures usadas para parser e testes offline:
- `fixtures/results.txt`
- `fixtures/golden/*.txt`

## Notas Finais
- O projeto privilegia evidencia e rastreabilidade sobre heuristica solta.
- Divergencias com federacao ou site oficial devem ser explicadas com base em captura persistida, regra validada ou configuracao explicita.
- Quando houver diferenca entre visao analitica do site e trofeu oficial, a diferenca deve ser documentada, nao mascarada.
