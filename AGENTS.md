Projeto: appcbtmeventos

Objetivo
- Raspar informacoes de eventos CBTM por ID.
- Manter versoes separadas para Admin e Usuario.
- Garantir isolamento de dados entre eventos.

Arquitetura
- Backend: `backend/index.js` (Express + scraper).
- Frontend: `frontend/src/App.jsx` (React + Vite).
- Persistencia: `backend/tmp/event_{EVENT_ID}.json` e indice `backend/tmp/events.json`.

Fluxo Admin
- Define nome do evento e o ID para extracao.
- Chama `GET /api/event/persist?eventId=...&name=...`.
- Atualiza a lista em `GET /api/events`.

Fluxo Usuario
- Seleciona evento persistido por nome.
- Carrega atletas via `GET /api/event/athletes?eventId=...`.
- Consulta jogos por atleta via `GET /api/atleta?nome=...&eventId=...`.

Separacao de dados por evento
- Cada evento persiste em arquivo proprio (`event_{id}.json`).
- Frontend sempre envia `eventId` nas chamadas.
- Nao reutilizar cache ou resultados de outro evento.

Rotas de UI
- Usuario: `http://localhost:5173/#/user`
- Admin: `http://localhost:5173/#/admin`

Configuracao
- `backend/.env.example` contem variaveis (PORT, EVENT_URL, CACHE_TTL, SCRAPER_MODE, etc).
- Padrao de execucao: backend em `http://localhost:4000`.
- Flags HTTP relevantes: `HTTP_ACCEPT_ENCODING`, `RESULTADOS_FASE_MODE`, `FETCH_ATLETAS_COMBO`, `SANITIZE_OUTPUT`.
- Ajuste de pagina do CardView: `CARDVIEW_PAGE_INDEX`, `CARDVIEW_PAGE_SIZE`, `CARDVIEW_PAGE_ROWCOUNT`.
- Filtro de categorias HTTP: `HTTP_ONLY_CATEGORY_IDS` (ids separados por virgula).

Comandos de dev
- Backend: `cd backend && npm install && cp .env.example .env && npm run dev`
- Frontend: `cd frontend && npm install && npm run dev`

Boas praticas para agentes
- Evite editar `node_modules` ou arquivos gerados.
- Quando mexer em scraping, valide em `backend/scraper.js`.
- Preserve labels e textos em portugues.
- Se alterar API, alinhe `frontend/src/api.js`.

Testes
- Backend: `cd backend && npm test`
- Validacao de evento: `cd backend && npm run validate -- --eventId 5246`
