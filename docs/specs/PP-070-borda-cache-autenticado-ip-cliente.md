# PP-070 — Borda nginx/API: cache de resposta autenticada e IP real do cliente

## SPEC ATIVA — PP-070 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-070 | Projeto: PingPong PaiD'egua | Branch: `fix/pp-070-borda-cache-ip-cliente`
Criada por: Claude | Data: 2026-09-27 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-09-27 | Escopo: fechar PP-SEC-005 (cache de resposta autenticada) e PP-SEC-006 (IP do cliente forjável) num único PR; fechamento do CAT aprovado por Leo em chat ("aprovado", 2026-09-27) após a Rodada 2 do Codex
Backlog: PP-SEC-005, PP-SEC-006

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — toca autenticação (lockout), rate limit e cache de borda em produção.
- e2e-playwright-agent: não — nenhuma mudança de UI.
- report-builder-agent: não — relatório padrão basta.

## Objetivo
Garantir que (a) nenhuma resposta de rota autenticada seja servida do microcache do nginx a outro cliente e
(b) o rate limit e o lockout de login usem o IP real do cliente, não um valor que o cliente possa forjar.

## Contexto
Rodada 2 (Codex, 2026-09-27) reproduziu os dois achados na configuração efetiva da VM (mesmo SHA-256 do
`scripts/vm/nginx-api-site.conf`) e confirmou `TRUST_PROXY=1` e `RATE_LIMIT_TRUST_PROXY=true` na API em produção.
API, Postgres e Redis escutam só em `127.0.0.1` — a API só é alcançável pelo nginx.

## Causa raiz
- Imediata A: `location /` cacheia GET 200 por 5s com chave sem `Authorization`; rotas admin não emitem `Cache-Control`.
- Imediata B: nginx anexa o XFF do cliente (`$proxy_add_x_forwarded_for`); `applyTrustProxy` converte `"1"` em
  `true` (confia em todos os saltos); `extractIp` lê o primeiro IP do XFF.
- Sistêmica: a borda foi desenhada para desempenho (microcache, confiança no proxy) sem teste de comportamento
  proibido — nenhum T-* verificava "anônimo não recebe corpo autenticado" nem "XFF forjado não muda a chave".
- Padrão: nenhuma classe E existente; sinal único.

## Cenários funcionais
- DADO um GET admin autenticado respondido 200, QUANDO outro cliente sem token pede a mesma URL na janela do
  microcache, ENTÃO recebe 401 da API (a resposta autenticada não foi cacheada).
- DADO GET público bem-sucedido, QUANDO respondido, ENTÃO continua `Cache-Control: public, s-maxage=<ttl>` e
  continua cacheável pelo nginx.
- DADO GET público cujo handler lança erro, QUANDO respondido, ENTÃO `Cache-Control: no-store`.
- DADO um cliente que troca o primeiro IP do `X-Forwarded-For` a cada requisição, QUANDO passa pelo nginx, ENTÃO
  cai sempre no mesmo balde de rate limit e na mesma chave de lockout.
- DADO dois clientes reais distintos, QUANDO chamam a API, ENTÃO têm baldes separados.

## Critérios de aceitação
1. Toda resposta da API sai com `Cache-Control: no-store`, exceto GET público bem-sucedido, que mantém o valor
   do `PublicReadCacheInterceptor`.
2. Os dois blocos `location` com `proxy_cache` em `scripts/vm/nginx-api-site.conf` têm
   `proxy_no_cache $http_authorization;` e `proxy_cache_bypass $http_authorization;`.
3. Nenhuma ocorrência de `$proxy_add_x_forwarded_for` em `scripts/vm/nginx-api-site.conf` nem em
   `docs/runbook-producao-oracle-vercel.md`; todas passam a `proxy_set_header X-Forwarded-For $remote_addr;`.
4. `TRUST_PROXY` numérico vira contagem de saltos (`"1"` → `1`, `"0"` → `0`); `"true"`/`"false"` continuam booleanos;
   lista continua lista; vazio não define.
5. `extractIp` usa `req.ip` (fallback `req.socket.remoteAddress`, depois `"unknown"`); `RATE_LIMIT_TRUST_PROXY`
   deixa de existir no código, no compose e no `.env.example`.

## Fora de escopo
PP-SEC-007 (dependências), PP-SEC-008 (token), PP-SEC-009 (bot), PP-SEC-010 (CORS Vercel/`FRONTEND_ALLOW_VERCEL_PREVIEWS`),
PP-SEC-011 (CSP), PP-SEC-012 (fechado: não reproduzido na VM). Não alterar `auth.service.ts`,
`public-read-cache.interceptor.ts`, CORS, frontend, worker. Aplicar o nginx na VM **não** faz parte do PR (ver Deploy).

## Impacto técnico
Produção:
- `apps/api/src/common/trust-proxy.ts` (novo) — `export function applyTrustProxy(app, raw = process.env.TRUST_PROXY)`
  com a regra do critério 4.
- `apps/api/src/common/default-no-store.middleware.ts` (novo) — middleware Express que define
  `Cache-Control: no-store` e chama `next()`.
- `apps/api/src/main.ts` — remover a função local `applyTrustProxy` (linhas 116-142) e importar a do módulo;
  registrar o middleware no-store junto do middleware de headers existente (antes do rate limit).
- `apps/api/src/common/simple-rate-limit.middleware.ts` — `extractIp` conforme critério 5; remover o campo
  `trustProxyHeaders`.
- `scripts/vm/nginx-api-site.conf` — critérios 2 e 3 nos blocos `location ~* ^/events/...` e `location /`.
- `docs/runbook-producao-oracle-vercel.md` — linhas 100 e 155 (critério 3).
- `docker-compose.yml` — remover `RATE_LIMIT_TRUST_PROXY: "true"` (linha 94). Manter `TRUST_PROXY: "1"`.
- `apps/api/.env.example` — remover `RATE_LIMIT_TRUST_PROXY=false` (linha 24).
Testes (novos): `apps/api/test/pp070-trust-proxy.test.ts`, `apps/api/test/pp070-rate-limit-ip.test.ts`,
`apps/api/test/pp070-cache-control.test.ts`, `apps/api/test/pp070-nginx-config.test.ts`; T-U-02 em
`apps/api/test/auth.controller.test.ts`.
Não tocar: ver Fora de escopo. Sem DDL. Sem mudança de contrato de rota. Dependência nova: nenhuma.

Ordem para RED real (sem ImportError): extrair `applyTrustProxy` e o middleware no-store **primeiro** num commit
`refactor(api): PP-070 extrai trust-proxy e no-store sem mudar comportamento` — `trust-proxy.ts` com a lógica
atual (bug incluído) e o middleware ainda **não registrado** em `main.ts`. Depois seguir RED→GREEN por T-*.

Deploy (fora do PR): após merge, aplicar o nginx primeiro (`scripts/vm/install-nginx-api-hardening.sh`, que roda
`nginx -t` antes do reload), depois recriar o container `api`. Executor: [LEO DECIDE — Leo ou Codex via
ssh-oracle com autorização explícita no momento]. Em seguida, T-VM-01.

## Plano de testes
### Cobertura geral
COBERTURA: regressão=4 corretude=6
- camadas: unitário + integração HTTP local (Express real em porta efêmera) + estrutural de config
- fixtures: `RATE_LIMIT_USE_REDIS=false` nos testes de rate limit; limite baixo via env no próprio teste
- comando: `npm --prefix apps/api test` e `npm run test:regression:critical`

### T-U-01 — `applyTrustProxy` interpreta a env [corretude]
DADO um app fake que registra `set(key, value)` | QUANDO `applyTrustProxy` recebe `"1"`, `"2"`, `"0"`, `"true"`,
`"false"`, `""`, `"10.0.0.1, 10.0.0.2"` | ENTÃO `trust proxy` = `1`, `2`, `0`, `true`, `false`, não chamado,
`["10.0.0.1","10.0.0.2"]` — valores escritos à mão no teste. (RED: `"1"` hoje vira `true`.)

### T-I-01 — XFF forjado não troca o balde [corretude]
DADO Express com `trust proxy = 1` + `SimpleRateLimitMiddleware` | QUANDO duas requisições HTTP com XFF
`"6.6.6.6, 203.0.113.9"` e `"7.7.7.7, 203.0.113.9"` | ENTÃO `X-RateLimit-Remaining` cai de N para N-2 (mesmo balde).

### T-I-02 — clientes reais distintos, baldes distintos [regressão]
Mesmo setup | XFF `"203.0.113.1"` e `"203.0.113.2"` | cada resposta traz `X-RateLimit-Remaining` = N-1.

### T-U-02 — login usa `request.ip` [regressão]
DADO `AuthController` com service fake | QUANDO `login` com request `{ ip: "203.0.113.9", headers: { "x-forwarded-for": "6.6.6.6" } }`
| ENTÃO o service recebe `"203.0.113.9"`. Nasce verde (comportamento já correto; protege contra regressão).

### T-I-03 — rota não pública responde no-store [corretude]
Express com o middleware no-store e rota sem interceptor | GET | `Cache-Control: no-store`.

### T-I-04 — rota pública mantém cache público [regressão]
Mesma app, rota Nest/handler com `PublicReadCacheInterceptor` (TTL conhecido) | GET 200 |
`Cache-Control: public, s-maxage=<ttl>, stale-while-revalidate=<ttl>`.

### T-I-05 — rota pública com erro fica no-store [corretude]
Mesma app, rota pública cujo handler lança | GET | status de erro com `Cache-Control: no-store`.

### T-S-01 — config nginx e runbook [corretude]
Lê `scripts/vm/nginx-api-site.conf` e `docs/runbook-producao-oracle-vercel.md` | todo bloco com `proxy_cache`
tem `proxy_no_cache $http_authorization` e `proxy_cache_bypass $http_authorization`; zero
`$proxy_add_x_forwarded_for` nos dois arquivos; `X-Forwarded-For $remote_addr` presente no conf.

### T-S-02 — env removida [corretude]
Lê `docker-compose.yml`, `apps/api/.env.example` e `apps/api/src/**` | zero `RATE_LIMIT_TRUST_PROXY`.

### T-R-01 — suites existentes [regressão]
`npm --prefix apps/api test` e `npm run test:regression:critical` verdes; `npm run build --workspace apps-api` verde.

### T-VM-01 — pós-deploy (fora do PR; `ATESTADA_POR_LEO` ou execução autorizada)
`nginx -T` mostra as diretivas novas; `curl -s -D - https://api-pingpongpaidegua.duckdns.org/admin/events` sem
token → 401; resposta pública traz `X-Proxy-Cache`; 4 logins errados com XFF diferentes → lockout na 3ª.

### Cobertura por categoria
Autenticação/Autorização: T-U-02, T-VM-01 (401 anônimo) | Regra de negócio (rate limit/lockout): T-I-01/02 |
Formulário, Edição, Exclusão, Listagem, Upload, Integração externa, UI: não aplicável — sem rota, payload ou tela nova.

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-27) — Claude analista

#### Por que um único PP para dois achados
Os dois são a mesma fronteira de confiança (o que a API e o nginx assumem sobre a requisição que chega pela
borda) e tocam os mesmos blocos `location` de `scripts/vm/nginx-api-site.conf`. Separar em dois PRs geraria
conflito certo no mesmo arquivo e dois deploys de nginx em produção. [PENDENTE Leo: aceitar 1 PP/1 PR]

#### Fast track
Proibido: mais de um arquivo com dependência, superfície de auth/segurança em produção.

#### Achado A — PP-SEC-005: resposta autenticada servida do microcache
- `scripts/vm/nginx-api-site.conf`, `location /`: `proxy_cache api_microcache`, `proxy_cache_valid 200 5s`,
  chave `"$scheme$request_method$host$request_uri"` — sem `Authorization`, sem `proxy_no_cache`/`proxy_cache_bypass`.
- A API só emite `Cache-Control` nas rotas públicas (`common/public-read-cache.interceptor.ts`, aplicado a
  `user/user.controller.ts`). `admin/admin-events.controller.ts` (GETs `""`, `efficiency-config`, `merges`,
  `:id/scrape-runs`, `:id/audit`, `:id/audit-history`, `:id/athlete-conflicts`) não emite nada → nginx cacheia.
- `location ~* ^/events/[0-9]+/(efficiency|medalists)$` usa `proxy_ignore_headers Set-Cookie Cache-Control Expires`:
  só rotas públicas hoje, mas ignora qualquer `no-store` que a API venha a mandar.

Proposta (defesa em duas camadas — cada uma sozinha fecha o vazamento):
- A1 — API, padrão negar: middleware global em `apps/api/src/main.ts` (junto do middleware de headers existente)
  define `Cache-Control: no-store` em toda resposta; `PublicReadCacheInterceptor` continua sobrescrevendo com
  `public, s-maxage=…` nas rotas públicas (o `tap` roda depois do handler). [PENDENTE Codex: confirmar que o
  `setHeader` do interceptor sobrescreve o do middleware em todas as rotas públicas, inclusive respostas de erro]
- A2 — nginx: nos dois blocos com `proxy_cache`, `proxy_no_cache $http_authorization;` e
  `proxy_cache_bypass $http_authorization;`.

#### Achado B — PP-SEC-006: IP do cliente forjável por `X-Forwarded-For`
- nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` → anexa ao XFF que o cliente mandou.
- `docker-compose.yml` (api): `TRUST_PROXY: "1"`, `RATE_LIMIT_TRUST_PROXY: "true"`.
- `main.ts` `applyTrustProxy`: `"1"` cai no ramo `raw === "1" || "true"` → `trust proxy = true` (confia em todos
  os saltos) — `request.ip` passa a ser o primeiro IP do XFF, controlado pelo cliente.
- `common/simple-rate-limit.middleware.ts` `extractIp`: com `RATE_LIMIT_TRUST_PROXY=true` usa
  `forwarded.split(",")[0]` — também o valor do cliente.
- `apps/api/src/auth/auth.controller.ts:21` passa `request.ip` ao lockout de `auth.service.ts` (`buildAttemptKey`).
- Efeito: rate limit (inclusive `strict` em `/auth/*`) e lockout de 3 tentativas/15 min trocam de balde a cada XFF forjado.

Proposta:
- B1 — nginx: `proxy_set_header X-Forwarded-For $remote_addr;` nos dois blocos (sobrescreve; o cliente não
  injeta mais nada).
- B2 — `applyTrustProxy`: string numérica = contagem de saltos (`"1"` → `1`); `"true"` continua `true`; lista
  continua lista. Extrair para `apps/api/src/common/trust-proxy.ts` exportado, para ser testável.
- B3 — `extractIp`: usar só `req.ip` (resolvido pelo Express conforme `trust proxy`), removendo o parse manual
  do XFF e a leitura de `RATE_LIMIT_TRUST_PROXY`. [PENDENTE Codex: `RATE_LIMIT_TRUST_PROXY` é lido em outro
  lugar (worker, scripts, testes)? Se não, remover também do `docker-compose.yml` e dos `.env*.example`]

#### Impacto técnico (hipótese)
Produção: `apps/api/src/main.ts`, `apps/api/src/common/trust-proxy.ts` (novo),
`apps/api/src/common/simple-rate-limit.middleware.ts`, `scripts/vm/nginx-api-site.conf`, `docker-compose.yml`
(só se B3 remover a env). Testes: `apps/api/test/pp070-*.test.ts` (novos).
Não tocar: `auth.service.ts` (o lockout se corrige sozinho via `request.ip`), `public-read-cache.interceptor.ts`,
CORS (PP-SEC-010), frontend, worker. Sem DDL, sem mudança de contrato de rota.
Deploy: nginx só muda após `scripts/vm/install-nginx-api-hardening.sh` na VM — executor e janela a definir.
[LEO DECIDE: quem aplica o nginx na VM após o merge (Leo ou Codex via ssh-oracle) e se antes ou depois do deploy da API — cada camada fecha sozinha, então a ordem não abre janela nova]

#### Plano de testes preliminar
COBERTURA: regressão=3 corretude=5
- T-U-01 [corretude] `applyTrustProxy`, parametrizado: `"1"`→`1`, `"2"`→`2`, `"true"`→`true`, `"false"`→`false`,
  `""`→não define, `"10.0.0.1, 10.0.0.2"`→lista. Esperado escrito à mão no teste.
- T-I-01 [corretude] app Express real (`trust proxy` = 1) + `SimpleRateLimitMiddleware` (`RATE_LIMIT_USE_REDIS=false`),
  requisições HTTP reais em porta local: duas chamadas com XFF `"6.6.6.6, 127.0.0.1"` e `"7.7.7.7, 127.0.0.1"`
  (mesmo último salto) caem no **mesmo** balde — `X-RateLimit-Remaining` cai de N para N-2.
- T-I-02 [regressão] mesmo setup: últimos saltos diferentes (`"203.0.113.1"` vs `"203.0.113.2"`) → baldes separados.
- T-U-02 [corretude] `AuthController.login` com request fake `{ ip: "203.0.113.9", headers: { "x-forwarded-for": "6.6.6.6" } }`
  → service recebe `"203.0.113.9"`.
- T-I-03 [corretude] app Express com o middleware no-store do `main.ts`: rota sem interceptor → `Cache-Control: no-store`.
- T-I-04 [regressão] mesma app, rota com `PublicReadCacheInterceptor` → `public, s-maxage=<ttl>` (não `no-store`).
- T-S-01 [corretude] estrutural sobre `scripts/vm/nginx-api-site.conf`: todo bloco com `proxy_cache` contém
  `proxy_no_cache $http_authorization` e `proxy_cache_bypass $http_authorization`; nenhum
  `$proxy_add_x_forwarded_for`; `X-Forwarded-For $remote_addr` presente.
- T-R-01 [regressão] `npm run test --workspace apps-api` + `npm run test:regression:critical` verdes.
- T-VM-01 (pós-deploy, `ATESTADA_POR_LEO` ou execução Codex read-only): `nginx -T` mostra as diretivas;
  `curl` anônimo em `/admin/events` → 401 com `X-Proxy-Cache` ≠ `HIT`; login com XFF forjado 4× → lockout na 3ª.
Categorias: Auth (401 anônimo em admin coberto por guard existente + T-VM-01); Rate limit (T-I-01/02);
Formulário/Upload/Exclusão/Listagem: não aplicável — sem mudança de rota ou payload.

#### Verificação na VM pedida ao Codex na Rodada 2 (somente leitura, via ssh-oracle)
1. `sudo nginx -T 2>/dev/null | grep -nE "server_name|location|proxy_cache |proxy_cache_key|proxy_no_cache|proxy_cache_bypass|X-Forwarded-For"`
   → a VM roda a mesma config do repositório?
2. `ss -ltnp | grep -E ':(3000|4000|5432|6379)\b'` → portas escutando em `0.0.0.0` (PP-SEC-012).
3. `cd ~/pingpongpaidegua && docker compose exec -T api printenv TRUST_PROXY RATE_LIMIT_TRUST_PROXY FRONTEND_ALLOW_VERCEL_PREVIEWS`
   (variáveis não secretas).
4. `git -C ~/pingpongpaidegua log --oneline -1` → commit implantado.
Nenhum comando de escrita, reload ou teste de exploração contra produção nesta rodada.

#### Fora de escopo
PP-SEC-007 (dependências), PP-SEC-008 (token), PP-SEC-009 (bot), PP-SEC-010 (CORS Vercel), PP-SEC-011 (CSP),
PP-SEC-012 (porta 3000 — só verificação, sem correção).

### CAT — Rodada 2 (2026-09-27) — contraponto técnico Codex

Análise estática local e verificação somente leitura na VM. Nenhum código de produção, configuração ou estado
remoto foi alterado nesta rodada.

#### Respostas aos pendentes técnicos

1. **A1 confirmada, com distinção sucesso/erro.** O middleware Express executado antes dos controllers pode
   definir `Cache-Control: no-store`; em GET público concluído com sucesso, o `tap` do
   `PublicReadCacheInterceptor` (`public-read-cache.interceptor.ts:38-46`) executa depois do handler e o
   `response.setHeader` sobrescreve o valor anterior. Se o handler lançar erro antes de emitir resposta, o callback
   de `tap` não executa e `no-store` permanece — comportamento seguro desejado para 4xx/5xx. O teste deve cobrir
   explicitamente os dois caminhos; não basta testar apenas sucesso público.
2. **B2 confirmada.** Em `main.ts:122-124`, `TRUST_PROXY="1"` é convertido em booleano `true`. No Express
   instalado, booleano `true` confia em todos os endereços, enquanto número `1` compila para confiança somente no
   salto de índice `< 1`. Logo a extração proposta para `common/trust-proxy.ts`, preservando `"true"` como booleano
   e convertendo toda string numérica para número, corrige a semântica sem mudar o contrato da env.
3. **B3 confirmada.** Fora de documentação/histórico, `RATE_LIMIT_TRUST_PROXY` ocorre somente em
   `docker-compose.yml`, `apps/api/.env.example` e `simple-rate-limit.middleware.ts`. Nenhum worker, script ou
   outro serviço lê a variável. Ela deve ser removida desses três pontos; `TRUST_PROXY` permanece como a única
   autoridade de confiança e `extractIp` passa a usar `req.ip` (com fallback apenas defensivo para `"unknown"`, se
   exigido pelo tipo).
4. **T-I-01/T-I-02 modelam corretamente `trust proxy = 1`.** Com socket nginx como salto 0, o Express escolhe o
   valor mais à direita do XFF como cliente. Alterar apenas o primeiro valor forjado mantém o mesmo balde; alterar
   o último salto separa os baldes. A premissa também depende de a API não estar exposta diretamente, confirmada
   na VM abaixo.

#### Correções materiais ao impacto e aos testes

- Incluir `docs/runbook-producao-oracle-vercel.md` no impacto. O runbook ativo repete
  `X-Forwarded-For $proxy_add_x_forwarded_for` em dois exemplos (`:100` e `:155`); deixá-los intactos permitiria
  reintroduzir a vulnerabilidade numa reinstalação manual. Ambos devem usar `$remote_addr`.
- Para tornar T-I-03/T-I-04/T-I-05 verificáveis sem importar `main.ts` (que chama `bootstrap()` imediatamente),
  extrair o middleware padrão para um módulo pequeno em `apps/api/src/common/` e apenas registrá-lo em `main.ts`.
  Isso acrescenta um arquivo de produção ao impacto preliminar.
- Acrescentar **T-I-05 [corretude]**: rota pública cujo handler lança erro mantém
  `Cache-Control: no-store`; não recebe a diretiva pública do interceptor.
- Em **T-U-01**, acrescentar `"0" → 0` para fixar a regra “toda string numérica é contagem de saltos”.
- Reclassificar **T-U-02 como regressão**: `AuthController.login` já usa `request.ip` e ignora XFF diretamente;
  portanto esse teste deve nascer verde e não é evidência RED da correção. O RED real de B fica em T-U-01 e
  T-I-01.
- Ampliar **T-S-01** para rejeitar `$proxy_add_x_forwarded_for` também no runbook ativo, além da configuração
  instalada pelo script.

#### Evidência somente leitura da VM (2026-09-27)

- `nginx -T`: os dois blocos com `proxy_cache` ainda usam `$proxy_add_x_forwarded_for` e não possuem
  `proxy_no_cache`/`proxy_cache_bypass` por `Authorization` — achados A e B reproduzidos na configuração efetiva.
- Configuração instalada `/etc/nginx/sites-enabled/api-pingpongpaidegua`, checkout da VM e arquivo local
  `scripts/vm/nginx-api-site.conf`: mesmo SHA-256
  `d79fe91df180cb79ff2070c51dde4a1fe617824947ac4f779eb3a82f765c0030`.
- Portas: `4000` (API), `5432` (Postgres) e `6379` (Redis) escutam somente em `127.0.0.1`; porta `3000` não
  apareceu. Para o recorte observado, PP-SEC-012 não está reproduzido na VM.
- Env efetiva da API: `TRUST_PROXY=1`, `RATE_LIMIT_TRUST_PROXY=true`,
  `FRONTEND_ALLOW_VERCEL_PREVIEWS=true` (esta última permanece fora do PP-070).
- Commit implantado: `eb1c127` (`Merge pull request #60 ... PP-062`).

#### Recomendação de fechamento do CAT

Manter um único PP/PR: as duas correções pertencem à mesma fronteira de confiança, compartilham configuração e
teste de integração, e separar aumentaria risco de drift. Para o deploy, aplicar o nginx primeiro reduz
imediatamente a superfície na borda; a API depois acrescenta a defesa padrão `no-store`. Executor e janela
continuam decisão de Leo. Com as correções de escopo/teste acima, o desenho é implementável sem DDL, sem mudança
de contrato de rota e sem tocar worker/frontend.

### CAT — Rodada 3 (2026-09-27) — Claude analista

Resolução dos pendentes (lida a Rodada 2 no arquivo; conferida contra `main.ts:116-142`,
`docker-compose.yml:94`, `apps/api/.env.example:24`, `docs/runbook-producao-oracle-vercel.md:100,155`):
- [RESOLVIDO: 1 PP/1 PR] — recomendação do Codex e "aprovado" de Leo (chat 2026-09-27).
- [RESOLVIDO: A1] — middleware no-store antes dos controllers; interceptor público sobrescreve só em sucesso;
  erro fica no-store (T-I-05 adicionado).
- [RESOLVIDO: B3] — remover `RATE_LIMIT_TRUST_PROXY` de middleware, compose e `.env.example` (T-S-02 adicionado).
- Incorporadas as 5 correções do Codex: runbook no escopo; middleware no-store extraído para módulo testável;
  T-I-05; `"0" → 0` em T-U-01; T-U-02 reclassificado como regressão; T-S-01 cobre o runbook.
- Acrescentado pelo analista: commit `refactor` de extração antes do primeiro RED, para o RED falhar por
  asserção e não por ImportError.
- PP-SEC-012 fechado: porta 3000 não escuta na VM e o serviço `frontend` só sobe com o profile `local-ui`.
- [LEO DECIDE: executor do deploy do nginx] — não bloqueia a implementação; ordem nginx → API adotada.
CAT encerrado → `## SPEC ATIVA` v1 gravada no topo deste arquivo.
