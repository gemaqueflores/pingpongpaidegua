# PP-SEC-013 — logs executados

Suite unitária web, build Turbopack e E2E contra produção local. Saída capturada em 2026-10-17.
Build com NEXT_PUBLIC_API_URL=http://localhost:4000; E2E em http://127.0.0.1:3100.

```text
> apps-web@1.0.0 test
> tsx --test tests/**/*.test.tsx

✔ PP-025 T-U-08 admin carrega, exibe e envia competitionFormat (3.9639ms)
✔ PP-SEC-011 T-U-01 setAuthToken escreve somente em sessionStorage e remove legado (2.7578ms)
✔ PP-SEC-011 T-U-02 getAuthToken migra legado para sessionStorage (0.5926ms)
✔ PP-SEC-011 T-U-03 getHeaders preserva Authorization Bearer (40.1924ms)
✔ PP-009 T-U-01 aba Confrontos preserva invariantes de filtro e toggle (2.6193ms)
✔ PP-009 T-U-02 compareScheduleMatches ordena por datetime crescente (0.807ms)
✔ PP-009 T-U-03 compareScheduleMatches envia datetime null para o final (0.2583ms)
✔ PP-009 T-U-04 compareScheduleMatches desempata por tableNumber numerico (18.0235ms)
✔ PP-009 T-U-05 compareScheduleMatches desempata por id (0.3672ms)
✔ PP-009 T-U-06 renderScheduleMatch com categoryName exibe badge de categoria (31.6089ms)
✔ PP-009 T-U-07 renderScheduleMatch sem categoryName nao exibe badge de categoria (1.2638ms)
✔ PP-059 T-U-01 nonce novo por request e headers internos consistentes (19.8485ms)
✔ PP-059 T-U-03 matcher exclui pix-qrcode e assets, inclui paginas (4.0262ms)
✔ PP-059 T-U-02 script-src permite apenas self e nonce (1.8154ms)
✔ PP-007 T-U-01 generateMetadata usa nome retornado por /events/:id (54.4102ms)
✔ PP-007 T-U-02 generateMetadata preserva fallback para retorno nulo (4.615ms)
✔ PP-007 T-U-03 generateMetadata nunca chama listagem /events (5.1494ms)
✔ PP-016 T-U-04 badge de partidas previstas exibe indicador quando fonte e observada (11.1593ms)
✔ PP-016 T-U-05 badge de partidas previstas omite indicador quando fonte e estimada ou ausente (1.2542ms)
✔ T-U-01 evento concluido prioriza lastScrapeAt sobre publishedAt (1.795ms)
✔ T-U-02 evento nao concluido mantem prioridade publishedAt (0.3165ms)
✔ T-U-03 evento concluido sem publishedAt usa lastScrapeAt (0.2279ms)
✔ T-U-04 evento concluido sem timestamps retorna null (0.2352ms)
✔ T-U-05 concluido ausente mantem prioridade publishedAt (0.2222ms)
✔ T-U-06 evento null retorna null (0.1805ms)
✔ T-C-01 pagina de evento usa publishedAt no badge e deps de reload (0.3886ms)
✔ T-C-02 pagina de evento renderiza estado building real sem contadores zerados (16.8788ms)
✔ PP-003 T-U-01 resolveDisplayStatus retorna CONCLUIDO quando concluido=true (1.8778ms)
✔ PP-003 T-U-02 resolveDisplayStatus retorna GRUPOS_DIVULGADOS quando grades publicadas (0.3437ms)
✔ PP-003 T-U-03 inferEventType retorna BRASILEIRAO para nivel NACIONAL (0.4048ms)
✔ PP-003 T-U-04 inferEventType usa heuristica de nome quando nivel=null (0.291ms)
✔ PP-003 T-U-05 sortEventsByStatusAndDate ordena abertos antes de concluidos (0.382ms)
✔ PP-003 T-U-06 formatDate retorna '-' para null (0.2503ms)
✔ PP-061 T-U-01 ordena jogos futuros do mais proximo no modo "recent" (2.7787ms)
✔ PP-061 T-U-02 ordena jogos futuros do mais distante no modo "oldest" (0.3456ms)
✔ PP-061 T-U-03 preserva jogos passados do mais recente no modo "recent" (0.3162ms)
✔ PP-061 T-U-04 preserva jogos passados do mais antigo no modo "oldest" (0.2844ms)
✔ PP-061 T-U-05 prioriza futuros e preserva ordens internas no modo "recent" (0.3607ms)
✔ PP-061 T-U-06 prioriza passados e preserva ordens internas no modo "oldest" (0.2168ms)
✔ Hero snapshot (13.411ms)
✔ EventCard snapshot (3.1517ms)
✔ StatBlock snapshot (0.9219ms)
✔ MatchCard snapshot (0.9679ms)
✔ MedalMatrixTable snapshot (2.7445ms)
✔ AthleteSummaryCard snapshot (4.2637ms)
✔ Template export contract (31.427ms)
✔ ClubEfficiencyCareerPanel snapshot (38.249ms)
✔ PP-002 T-U-01 events/page exibe erro da API antes do filtro vazio (1.751ms)
✔ PP-002 T-U-02 events/page preserva estado vazio sem erro (1.1958ms)
✔ PP-002 T-U-03 atletas/page exibe erro da API (1.1689ms)
✔ PP-002 T-U-04 eficiencia/page exibe erro da API (1.2107ms)
✔ PP-015 T-C-01 admin/page nao inicializa pesos com hardcode numerico (1.1658ms)
✔ PP-015 T-C-02 eficiencia/page usa seletor de ano vindo da API (0.7607ms)
✔ PP-015 T-NR-01 eficiencia/[clubId] permanece sem filtro por ano (3.5414ms)
✔ PP-002 T-U-05 home exibe erro da API na secao de eventos (1.0908ms)
✔ PP-002 T-U-06 paginas limpam erro em chamada bem-sucedida (2.1013ms)
✔ PP-004 T-U-01 eficiencia/[clubId] renderiza EmptyState de servico indisponivel (0.5188ms)
✔ PP-004 T-U-02 eficiencia/[clubId] renderiza EmptyState de clube nao encontrado (0.3384ms)
✔ PP-004 T-U-03 eficiencia/[clubId] catch nao captura err.message (0.9484ms)
✔ PP-004 T-U-04 career/[athleteKey] renderiza EmptyState de atleta nao encontrado (0.8919ms)
✔ PP-004 T-U-05 career/[athleteKey] nao exibe error diretamente na UI (0.9146ms)
✔ PP-051 T-U-01 .container renderiza com classe unica, sem regressao de padding (0.2461ms)
✔ PP-051 T-U-02 numeros de destaque com tabular-nums (1.5626ms)
✔ PP-051 T-U-03 ClubEfficiencyCareerPanel e AthleteSummaryCard renderizam classes de barra de medalha (4.3652ms)
✔ PP-051 T-U-04 globals.css sem variaveis de token duplicadas (0.9887ms)
✔ PP-051 T-U-05 .classification-row-* com os mesmos valores RGB de .eff-row-* (0.6889ms)
✔ PP-051 T-U-06 CSS morto ausente (0.6071ms)
ℹ tests 67
ℹ suites 0
ℹ pass 67
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3801.2413

> apps-web@1.0.0 build
> next build

▲ Next.js 16.4.2 (Turbopack)
✓ Running next.config.js took 72ms

node.exe : ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (⚠ The "middlewa...proxy" instead.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError


  To migrate automatically, run:
  npx @next/codemod@canary middleware-to-proxy .

  Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
⚠ The Edge Runtime is deprecated. You can use the "nodejs" runtime instead. Learn more:
https://nextjs.org/docs/messages/edge-runtime-deprecated
  Creating an optimized production build ...
✓ Compiled successfully in 2.5s
  Running TypeScript ...
  Finished TypeScript in 3.7s ...
  Collecting page data using 15 workers ...
⚠ Using edge runtime on a page currently disables static generation for that page
  Generating static pages using 15 workers (0/2) ...
✓ Generating static pages using 15 workers (2/2) in 165ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /admin
├ ƒ /admin/login
├ ƒ /admin/reset-password
├ ƒ /api/pix-qrcode
├ ƒ /apoie
├ ƒ /athletes
├ ƒ /atletas
├ ƒ /career/[athleteKey]
├ ƒ /colabore
├ ƒ /contato
├ ƒ /eficiencia
├ ƒ /eficiencia/[clubId]
├ ƒ /events
├ ƒ /events/[id]
├ ƒ /events/[id]/athletes/[athleteId]
├ ƒ /events/[id]/group-simulator
├ ○ /icon.png
├ ƒ /opengraph-image
├ ƒ /privacidade
├ ƒ /reportar-problema
├ ƒ /reporte
├ ƒ /sobre
├ ƒ /user
├ ƒ /user/career/[athleteKey]
├ ƒ /user/colabore
├ ƒ /user/eficiencia
├ ƒ /user/eficiencia/[clubId]
├ ƒ /user/events/[id]
├ ƒ /user/events/[id]/athletes/[athleteId]
├ ƒ /user/events/[id]/group-simulator
└ ƒ /user/reportar-problema


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand


Running 4 tests using 1 worker

node.exe : (node:117976) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:117976) W... env being set.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

(Use `node --trace-warnings ...` to show where the warning was created)
(node:117976) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok 1 apps\web\e2e\csp-nonce.spec.ts:64:5 › PP-059 T-E-01 home renderiza e hidrata com nonce por request (1.7s)
  ok 2 apps\web\e2e\csp-nonce.spec.ts:101:5 › PP-059 T-E-02 bloqueia inline sem nonce e permite nonce correto (524ms)
  ok 3 apps\web\e2e\csp-nonce.spec.ts:126:5 › PP-SEC-013 T-E-03 QRCode decodifica payload e trata entradas invalidas (74ms)
  ok 4 apps\web\e2e\csp-nonce.spec.ts:143:5 › PP-SEC-013 T-E-04 login hidrata e preserva nonce dos scripts (643ms)

  4 passed (6.1s)
```
