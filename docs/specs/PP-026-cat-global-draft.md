# PP-026 (draft) — CAT global: segurança, performance, arquitetura, infraestrutura

## Status: Rodada 2 — achado crítico já resolvido via PP-027 (fora do fluxo formal deste CAT)

Entre a Rodada 1 e a retomada, um contraponto do Codex sobre este mesmo mapeamento levantou um achado
crítico **não listado na Rodada 1** (comprometimento ativo de autenticação administrativa em produção:
`NODE_ENV` ausente, `JWT_SECRET`/credencial admin = defaults públicos de desenvolvimento). Esse achado foi
tratado com prioridade P0, fora da sequência normal deste CAT, como **PP-027** — Spec emergencial, C1
(confirmação read-only) → C2+C3+C4 (contenção operacional) → implementação de código (Cenários 1-2,
homologada ✅) → PR #30 mergeado (`4943e8f`) → deploy em produção validado. Ver
`docs/specs/PP-027-contencao-emergencial-auth.md` para o histórico completo.

**Consequência para este draft:** os achados S1-S6 abaixo permanecem válidos como estavam (nenhum é o
mesmo problema resolvido por PP-027 — aquele era sobre configuração de ambiente/segredo, não sobre os
padrões de rate-limit/lockout/CSP/revogação de JWT listados aqui). PP-027 resolveu uma classe de problema
adjacente mas distinta, encontrada durante a mesma varredura.

## Escopo declarado

CAT sobre o projeto appcbtmeventos como um todo (não específico a um evento), pedido por Leo após o
encerramento do CAT PP-020 (Copa Belém). Não duplica achados já cobertos: backlog PP-SEC-001..004, H1-H9
do PP-020, causa raiz de H4/H5 (PP-021A), bug de diagnóstico (PP-022), observabilidade de fila (PP-023),
npm audit (PP-024). Foco em áreas ainda não mapeadas.

Rodado via leitura de código apenas (Glob/Read/Grep) — nenhuma operação Git nesta sessão, conforme decisão
registrada: autoridade Git é do Codex em projetos FloresTech.

---

## Achados por eixo (candidatos — nenhum verificado por execução, apenas leitura estática)

### Eixo 1 — Segurança

**S1 — Rate limit degrada silenciosamente para bucket local em falha de Redis**
`apps/api/src/common/simple-rate-limit.middleware.ts:53-67`: quando `incrementRedisBucket` lança
exceção (Redis indisponível), o `catch` cai para `incrementLocalBucket` — bucket em `Map` na memória do
processo. Em produção com múltiplas instâncias/réplicas da API, isso quebra silenciosamente a garantia de
rate limit global por IP: cada instância passaria a ter seu próprio limite independente durante a
indisponibilidade do Redis, sem log de alerta visível no momento da falha (só um `catch` vazio).
Gravidade: médio — degrada uma defesa, não expõe dado, mas o efeito é silencioso.

**S2 — Rate limit por IP depende de `TRUST_PROXY`/`RATE_LIMIT_TRUST_PROXY` corretos**
`simple-rate-limit.middleware.ts:145-159` (`extractIp`): se `trustProxyHeaders=false` (default) atrás de
um proxy reverso, todas as requisições podem cair no IP do proxy — rate limit vira um limite único
compartilhado por todos os usuários reais. O `docker-compose.yml` já configura `TRUST_PROXY=1` e
`RATE_LIMIT_TRUST_PROXY=true` para o serviço `api` (linhas 89-90) — comportamento correto **se** o valor
em produção (VM Oracle) espelhar essa config; não verificado nesta sessão (dado de infra, não de código).

**S3 — Estado de lockout de login em memória (`AuthService.attemptsByKey`)**
`apps/api/src/auth/auth.service.ts:22`: `Map` em memória de tentativas de login falhas. Restart do
processo (deploy, crash, health-monitor recovery) zera o contador de lockout — um atacante que já atingiu
o limite recupera tentativas após qualquer restart. Superfície pequena (single admin), mas é o mesmo
padrão de fragilidade do S1.

**S4 — `passwordResetToken.findFirst` sem filtro de `usedAt: null` na query**
`auth.service.ts:247-252`: busca o token mais recente por hash e só depois verifica `usedAt`/`expiresAt`
em JS. Funcionalmente correto (um hash é praticamente único por `randomBytes(32)`), mas menos defensivo
que filtrar no `where` — se por algum motivo dois tokens colidissem em hash (praticamente impossível, mas
não impedido pelo schema), o comportamento dependeria da ordem de `createdAt desc`.

**S5 — Sem Content-Security-Policy**
`apps/api/src/main.ts:81-91`: headers de segurança presentes (`X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS condicional) mas **sem CSP**. Para uma
API pura (não serve HTML diretamente) o risco é menor, mas endpoints que retornam dados renderizados
depois no frontend (Next.js) não têm essa camada adicional de defesa contra XSS caso alguma resposta seja
injetada incorretamente no DOM do lado do consumidor.

**S6 — Sem revogação de JWT**
`apps/api/src/auth/jwt.strategy.ts`: token válido até expirar (`JWT_EXPIRES_IN=8h`), sem blacklist/
mecanismo de logout ativo do lado servidor. Se um token vazar, não há como invalidá-lo antes da expiração.
Aceitável para escala atual (single admin), mas vale registrar como limitação conhecida.

### Eixo 2 — Performance

**P1 — Loop sequencial de `ensureClub`/`ensureCategory`/`ensureAthleteAlias` por registro de inscrição**
`apps/worker/src/pipeline/upsert.service.ts:1099` (`for (const registration of dataset.registrations)`):
para cada registro, chama `ensureClub` (linha 1123), `ensureCategory` (linha 1131),
`ensureAthleteAlias` (linhas 1158, 1174) sequencialmente — não em batch/transação única. Cache local
(`categoriesByNormalized`, `clubsByNormalized`) reduz hits repetidos dentro do mesmo run, mas o primeiro
hit de cada entidade nova ainda é uma query individual. Eventos com centenas de inscrições (confirmado:
Copa Belém teve 431 atletas no agregado, CAT PP-020) multiplicam isso por run. Já existe o N+1 mais grave
de `prisma.match.findUnique` por partida (linha 1598), coberto por PP-021A — este é um padrão irmão, não
coberto, de menor volume relativo (categorias/clubes são muito menos numerosos que partidas, mas atletas
podem ser centenas).

**P2 — `user.service.ts` com 7048 linhas, `upsert.service.ts` com 4683 linhas**
Ambos concentram lógica de múltiplos domínios (leitura pública, cache de read model, simulação de grupos,
eficiência, medalhistas, reconciliação de categoria, dedup, etc.) em um único arquivo/classe. Não é
achado de performance de runtime, mas afeta manutenibilidade e é fator de risco para regressão — qualquer
mudança pontual (como as Specs recentes PP-022/PP-025) precisa navegar um arquivo muito grande para
localizar o ponto certo, aumentando a chance de editar o lugar errado ou duplicar lógica já existente
(exatamente o padrão que gerou a v1→v2→v3 de PP-025).

**P3 — Cache de leitura (`ReadModelCache`) sem TTL explícito no schema**
`prisma/schema.prisma:269-284`: `ReadModelCache` tem `updatedAt` mas não um campo de expiração — o
"stale" é decidido em código (`resolveEventReadModelCache`, visto em sessões anteriores) por comparação
de tempo/`sourceScrapeRunId`, não por constraint de banco. Funcional, mas significa que qualquer bug de
lógica de staleness não tem rede de segurança no nível de dado (ex.: um cache nunca invalidado por
código continuaria sendo servido indefinidamente).

### Eixo 3 — Arquitetura

**A1 — Detecção de comportamento por convenção de nome/prefixo repetida em múltiplos lugares**
Já identificado e endereçado pontualmente em PP-025 (`isRatingCategoryName`/`resolveSortBasis`, prefixo
`R`), mas o padrão "detectar tipo/comportamento por regex sobre nome de categoria" aparece em outros
pontos do código (`isCompositePairName`, `isBracketReferenceToken`, `isNearToken` em
`packages/shared/src/index.ts`) — cada um resolvendo um problema específico, mas sem uma camada central de
"classificação de categoria/partida" que outros consumidores possam reaproveitar com garantia de
consistência. PP-025 resolve o caso pontual; o padrão sistêmico (detecção por string espalhada) permanece.

**A2 — Falta de camada de domínio entre Controller e Service gigante**
`UserController`/`UserService` seguem o padrão NestJS convencional, mas com `UserService` concentrando
tanto orquestração de leitura pública quanto lógica de negócio complexa (simulação, eficiência,
reconciliação de merge de eventos). Não há sub-serviços especializados nem camada de "query object"/
"read model builder" separada da orquestração HTTP.

### Eixo 4 — Infraestrutura

**I1 — `docker-compose.yml` com senha de Postgres hardcoded (`postgres`)**
Linha 23: `POSTGRES_PASSWORD: postgres`. Mitigado por bind a `127.0.0.1` (linha 32) — não exposto
externamente pelo compose em si — mas é o tipo de default que precisa ser confirmado como **não
reutilizado** no ambiente de produção real (VM Oracle). Não verificável por leitura de código; achado a
confirmar via inspeção de produção (fora do escopo desta sessão, que é só leitura de repo).

**I2 — Dockerfiles single-stage, root, `npm install` (não `npm ci`)** *(Rodada 2, confirmado)*
`docker/api.Dockerfile`, `docker/worker.Dockerfile`, `docker/web.Dockerfile`: todos single-stage
(`FROM node:20-alpine`/`playwright:v1.50.1-jammy` direto, sem estágio de build separado do runtime), sem
`USER` não-root definido, usando `npm install` (resolução flexível) em vez de `npm ci` (lockfile estrito).
`worker.Dockerfile` já confirmado no CAT anterior como causa dos processos Chromium zumbis (sem
`--init`/tini). Consequência de single-stage: imagem final maior, com ferramentas de build (`npm`,
compiladores) presentes em produção — não é vazamento de segredo, mas aumenta superfície de ataque se o
container for comprometido por outra via.

**I3 — Workflows GitHub Actions: TOFU SSH + action externa sem SHA pin** *(Rodada 2, confirmado)*
Os 3 workflows que fazem SSH para a VM Oracle (`deploy-backend.yml`, `scrape-every-2h.yml`,
`production-drift-check.yml`) usam consistentemente:
- `StrictHostKeyChecking=accept-new` (linha 55/74/56 conforme arquivo) — aceita a chave do host na
  primeira conexão sem verificação prévia (Trust On First Use); um MITM na primeira conexão de um runner
  novo não seria detectado.
- `uses: appleboy/ssh-action@v1.2.0` — tag mutável (não SHA de commit imutável); se a tag for
  re-publicada com código malicioso, o workflow passaria a executar código não revisado com acesso à
  chave SSH de produção.
- `deploy-backend.yml:244`: `DEPLOY_GITHUB_TOKEN` passado como argumento posicional (`$1`) ao script
  remoto — visível em listagem de processos (`ps`) na VM durante a janela de execução do script.
`post-commit-validation.yml` não usa SSH, só actions oficiais versionadas por tag major
(`actions/checkout@v4`, `actions/setup-node@v4`) — sem esse padrão de risco.

---

## Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

### A — Profundidade do CAT: mapear tudo ou aprofundar os achados acima?

O QUÊ: esta Rodada 1 já produziu 12 achados candidatos (S1-S6, P1-P3, A1-A2, I1) a partir de leitura
seletiva — não é uma varredura exaustiva de todo o código (que teria custo de tempo muito maior). Falta
decidir se o CAT continua ampliando cobertura (ler Dockerfiles, workflows, `apps/web` completo, todos os
demais arquivos de `apps/worker/src/scraper`) ou se já é suficiente para produzir Specs a partir do que
foi encontrado.
COMO/ONDE: decisão de escopo/tempo, não técnica.
Definição de pronto: Leo declara se quer mais rodadas de leitura ou se fecha com o que já foi levantado.

[RESOLVIDO: Leo optou por completar a leitura de infraestrutura antes de priorizar — feito na Rodada 2
(I2/I3 acima, Dockerfiles + 4 workflows lidos e confirmados por Claude). CAT fecha com 15 achados
candidatos (S1-S6, P1-P3, A1-A2, I1-I3) mais o achado crítico já resolvido via PP-027.]

### B — Quais achados viram Spec de correção, e com que prioridade?

O QUÊ: nem todo achado é bug — alguns são limitações conhecidas aceitáveis para a escala atual (S3, S6).
Outros têm mitigação parcial já em produção não confirmada por código (S2, I1). Precisa de triagem
explícita antes de qualquer Spec.
Definição de pronto: lista de achados com decisão explícita (vira Spec / registrado como aceito / precisa
mais investigação).

[RESOLVIDO: Leo autorizou 3 frentes de Spec nesta rodada:
1. **S1/S3** — defesas (rate-limit, lockout de login) que degradam silenciosamente para memória local em
   falha de Redis/restart. Prioridade alta — mesma classe de risco silencioso que PP-027 corrigiu.
2. **P1** — benchmark do loop sequencial `ensureClub`/`ensureCategory`/`ensureAthleteAlias` por
   inscrição, antes de decidir otimizar (é hipótese, não bug confirmado — instrumentar primeiro).
3. **S5/S6** — CSP no frontend (Next.js/Vercel, não na API) e mecanismo de revogação de JWT.
P2/A1/A2 (dívida arquitetural) e demais achados de infraestrutura (I2/I3) ficam registrados como backlog,
sem Spec nesta rodada.]

### C — Achados que dependem de dado de produção (S2 trust proxy real, I1 senha real) — como confirmar?

O QUÊ: alguns achados (S2, I1) só são confirmáveis com acesso a produção (variáveis de ambiente reais,
não o que está no `docker-compose.yml` de exemplo). Claude não tem acesso direto — precisa do mesmo
padrão já usado no CAT PP-020 (Claude formula, Codex executa via SSH).
COMO/ONDE: SSH Oracle, mesma estratégia já registrada no CLAUDE.md do projeto.
Definição de pronto: se Leo autorizar, formular os comandos read-only equivalentes (ex.: confirmar env
vars reais de `TRUST_PROXY`/`RATE_LIMIT_TRUST_PROXY` e se a senha de Postgres em produção diverge do
default do compose).

[RESOLVIDO: Leo autorizou. Comandos read-only abaixo, mesmo padrão de C1/PP-027 — Claude formula, Codex
executa via SSH/console administrativo, sem expor segredo em log/chat, só confirmação de igualdade/
divergência contra o esperado:

**S2 — confirmar trust proxy real:**
```bash
docker exec pingpongpaidegua-api-1 printenv TRUST_PROXY RATE_LIMIT_TRUST_PROXY
```
Esperado (se coerente com `docker-compose.yml`): `TRUST_PROXY=1`, `RATE_LIMIT_TRUST_PROXY=true`.

**I1 — confirmar senha do Postgres em produção diverge do default do compose:**
```bash
docker exec pingpongpaidegua-api-1 sh -c 'echo "${DATABASE_URL_WRITE#*://}" | cut -d@ -f1 | grep -q ":postgres$" && echo MATCHES_DEFAULT || echo DIFFERS_FROM_DEFAULT'
```
Não imprime a senha em si — só confirma se o sufixo da credencial embutida na connection string bate
literalmente com o default `postgres` do `docker-compose.yml` de exemplo. Resultado esperado:
`DIFFERS_FROM_DEFAULT` (produção deve ter senha própria, não o default de dev).]

## Rodada 3 — resultado das confirmações read-only (executadas pelo Codex em produção)

**S2 — CONFIRMADO SAUDÁVEL.** `TRUST_PROXY=1`, `RATE_LIMIT_TRUST_PROXY=true` em produção — coerente com
o `docker-compose.yml`. Rate limit por IP funciona como desenhado, sem o risco de "todos os usuários
compartilhando o limite do proxy". Achado fechado, sem Spec necessária.

**I1 — CONFIRMADO REAL, não mais hipótese.** Tanto a `DATABASE_URL` efetiva da API quanto o próprio
container PostgreSQL usam a senha default do compose (`postgres`) em produção. Banco operacional; único
fator mitigante hoje é a porta 5432 vinculada a `127.0.0.1` (sem exposição pública direta pelo compose
em si — mas qualquer processo que ganhe execução na própria VM, ou qualquer outro serviço na mesma rede
Docker, teria acesso trivial ao banco).

**Precisão de classe do achado:** I1 é a mesma classe de risco que originou PP-027 (credencial default
conhecida ativa em produção) — desta vez na camada de banco, não de autenticação da aplicação. A
correção (rotação de senha do Postgres) é mais simples que PP-027 (não precisa de mudança de código, só
de operação: gerar senha nova, atualizar `POSTGRES_PASSWORD`/`DATABASE_URL_WRITE`/`DATABASE_URL_READ` em
produção, reiniciar `postgres`+`api`+`worker`). Candidata a Spec de rotação — decisão de prioridade fica
com Leo (ver "Fora de escopo" e próxima seção de priorização).

## Rodada 4 — PP-028 executada (R1 concluída, R2 revelou 3 achados derivados), 3 Specs formuladas

R1 (rotação da senha do Postgres) relatada como concluída e validada pelo Codex — ver
`docs/specs/PP-028-rotacao-senha-postgres.md` v2 para o registro completo, incluindo nota de proveniência
(não verificado por Claude diretamente, sem acesso a produção).

R2 (confirmação read-only de topologia de rede) encontrou divergência real: 4 containers na mesma rede
(`api`, `worker`, `postgres`, `redis`), não os 3 esperados. Gerou 3 Specs separadas, priorizadas por Leo:

1. **PP-029 — Parametrização definitiva do compose** (Alta) — `docker-compose.yml` ainda contém defaults
   funcionais (`postgres`/`postgres`, hash admin, JWT secret) mesmo após PP-027/PP-028; hoje a segurança
   real depende de um override operacional não versionado em produção.
2. **PP-030 — Autenticação Redis** (Alta) — Redis roda sem `requirepass` na mesma rede do Postgres;
   inclui atualização dos 3 consumidores reais de `REDIS_URL` (`queue.service.ts`,
   `simple-rate-limit.middleware.ts`, `apps/worker/src/config.ts`).
3. **PP-031 — Segmentação de rede Docker** (Média) — condicionada a mapeamento de dependências reais
   antes de qualquer mudança de topologia; não bloqueia PP-029/PP-030.

Nenhuma das 3 foi implementada nesta sessão — Specs formuladas, aguardando aprovação de Leo e
contraponto de implementabilidade do Codex, mesmo fluxo já usado para PP-021 a PP-025.

## Rodada 5 — PP-029 FECHADA (código homologado + mergeado + aplicada em produção)

**PP-029 concluída de ponta a ponta.** Sequência completa:
1. Contraponto do Codex (v1→v2: variáveis de banco separadas por serviço, rollback correto, janela de
   deploy incluindo `postgres`, `.env.production.example` completo) — todas as citações verificadas por
   Claude antes de aceitar.
2. Implementação local pelo Codex, branch `feat/pp-029-parametrizacao-compose`.
3. **Homologação por Claude com evidência própria** (não apenas aceitar a declaração): suite completa
   reexecutada (35 parser + 49 shared + 183 API + 77 worker, 0 falhas — bate exato com o declarado);
   T-C-01 e T-C-02 rodados de verdade via `docker compose config` real nesta sessão (ambiente limpo →
   falha explícita citando as 7 variáveis; valores de teste 81/82/61/42 → pools resolvidos corretamente
   por serviço); `verify:security`/`verify:encoding` rodados — ✅ aprovado.
4. Commit `214d333`, PR #31, Vercel verde, `MERGED` em `main` (`9376e90`).
5. Janela de produção autorizada por Leo — Codex relatou: 7 variáveis materializadas, pools preservados
   (API 8/12, worker 6/4 — batendo com o que Claude confirmou no diff), equivalência comparada antes de
   remover o override, restart `postgres→api→worker`, dado preservado (23 eventos/25 tabelas), smoke
   `200`, override arquivado com backup de rollback armado (não exercitado, sem gate falho).

**Nota de proveniência (passo 5):** relatado pelo Codex, não verificado por Claude diretamente — sem
acesso a produção, mesma ressalva já aplicada a C1/PP-027 e R1/PP-028.

**Desvio operacional aceito:** servidor não autenticou diretamente no GitHub; commit transportado por
bundle Git incremental sem transportar token — solução razoável para o mesmo problema de credencial já
visto no início desta sessão (protocolo do contrato: nunca pedir token pelo chat).

**PP-030 liberada para iniciar** — pré-condição de sequenciamento satisfeita.

## Rodada 6 — PP-030, PP-032 e PP-031 FECHADAS. Sequência completa PP-029→030→031→032 encerrada.

**PP-030 (autenticação Redis) fechada de ponta a ponta.** Contraponto v1→v2 aceito (6 consumidores reais
confirmados incluindo 3 scripts operacionais; mecânica `$$REDIS_PASSWORD`/`REDISCLI_AUTH` corrigida).
Implementação incluiu correção de robustez não prevista na Spec (listener `on("error")` no `ioredis` do
rate limit, evitando crash do processo Node em falha assíncrona de autenticação). **Homologação com
evidência real:** harness `scripts/test-redis-auth.ts` reexecutado por Claude contra Redis efêmero de
verdade — T-I-01 a T-I-04 + T-I-02-worker, todos passando; `docker compose config` confirmou
`$$REDIS_PASSWORD` não resolvido pelo Compose (só dentro do container) e ausência de `-a` no healthcheck.
Commit `c51df1d`, PR #32, `MERGED` (`ee86b48`). Janela de produção relatada como concluída: Redis→API→worker
recriados, todos os fluxos autenticados, nenhum `NOAUTH`/`WRONGPASS`. Pendências derivadas, não
bloqueantes: bug em `autonomy-sanity-check.ts` (incompatibilidade `lazyConnect`/`enableOfflineQueue`, não
é erro de senha) e achado novo fora do escopo original — certificado TLS de
`api-pingpongpaidegua.duckdns.org` expirado.

**PP-032 (renovação TLS, achado emergente durante a janela de PP-030) fechada.** Segunda ocorrência do
mesmo incidente já registrado em `DEC-CBTM-001` (maio/2026) — desta vez investigado até a causa raiz real:
Certbot renovava corretamente, mas nunca havia `deploy_hook` para recarregar o Nginx, então o certificado
renovado nunca era servido. I1 (investigação read-only) confirmou por fingerprint/serial divergentes. I2
corrigiu: reload imediato + hook persistente instalado e testado (execução direta + `certbot renew
--dry-run`) + validação externa real de TLS (não apenas `curl` ignorando erro). `DEC-CBTM-001` atualizada
com a causa raiz e a correção, para não repetir pela terceira vez. Commit `bc41a2d`, PR #33, `MERGED`
(`0eb8e29`) — homologado por Claude (diff + scanners reexecutados).

**PP-031 (segmentação de rede Docker) fechada.** Contraponto v1→v2 aceito: topologia de 1 rede
(`data-tier`) não reduzia nada; corrigida para 3 redes (`postgres-tier`, `redis-tier`, `app-tier`), sem
`internal:true` (preservando egress de api/worker). **Homologação com evidência real e mais extensa desta
sequência:** Claude subiu os 4 serviços de verdade via `docker compose up` (postgres, redis, api,
frontend) e testou isolamento por resolução DNS real dentro dos containers — postgres↔redis bloqueado,
frontend→datastores bloqueado, api/worker abertos a tudo, smoke test real da API (`database: ok`,
`queue: ok`). Commit `11cfcd8`, PR #34, `MERGED` (`cf38a3d`). Janela de produção relatada como concluída:
`postgres→redis→api→worker` recriados, redes segmentadas confirmadas, rede default sem membros.
**Rollback exercitado de verdade** (não só armado): um falso negativo do harness de validação acionou
rollback completo para `ee86b48`, que restaurou produção corretamente; harness corrigido, aplicação
repetida com sucesso — prova prática de que o plano de rollback funciona, não apenas teoria.

**Desvio operacional registrado (não bloqueante):** bundle Git temporário
(`%TEMP%\pp031-264672a774804307a1ed239ede104126.bundle`) usado para transportar o commit sem autenticação
direta no GitHub não pôde ser removido da máquina do Codex por política do ambiente — contém apenas
objetos Git do intervalo implantado, sem segredos. Fica registrado como pendência de limpeza, não como
risco.

**PP-033 (fix autonomy-sanity-check.ts) fechada.** Causa raiz confirmada por leitura direta:
`lazyConnect: true` + `enableOfflineQueue: false` no cliente BullMQ rejeitam comandos enviados antes da
conexão lazy estar pronta — redundante com o `withTimeout()` já existente no script, e ausente nos outros
2 consumidores de `Queue("scrape-event", ...)` que já funcionam corretamente sem essas opções. Claude
chegou a aplicar a correção diretamente no arquivo por engano durante a investigação; revertida via `git
checkout` assim que identificado — escrever código de produção não é papel do Claude, só formular Spec.
Diff final do Codex idêntico ao que a investigação já havia produzido, confirmando a causa raiz.
**Homologação com evidência dupla:** harness `test-redis-auth.ts` (PP-030) reexecutado (5/5) + script
corrigido rodado diretamente por Claude 5 vezes contra Postgres+Redis reais locais, `queue`/
`event-freshness` em `pass` em todas as execuções. Commit `73b59e0`, PR #35, `MERGED` (`fff7c7c`).

**PP-034 (revogação de sessão administrativa) e PP-035 (CSP frontend) fechadas — S6 e S5 do CAT
original.** Ambas formuladas, implementadas e homologadas com evidência real:
- PP-034: campo `tokenVersion` em `AdminCredential`, reset de senha e novo endpoint
  `POST /auth/revoke-sessions` incrementam a versão, `JwtStrategy.validate()` reaproveita a query já
  existente desde PP-027 para comparar a versão (sem query nova), rejeitando tokens legados sem o campo.
  Homologação incluiu migration testada por Claude contra Postgres real efêmero do zero (26 migrations,
  coluna confirmada via `\d`). Commit `6323a0e`, PR #37, `MERGED` (`871f28f`).
- PP-035: CSP via `headers()` em `next.config.js`, `connect-src` com a origem real da API,
  `unsafe-inline` em `script-src`/`style-src` aceito como limitação conhecida do Next.js App Router sem
  nonce dedicado (sem uso de `dangerouslySetInnerHTML`/nonce manual confirmado no layout). Homologação
  incluiu build de produção real + `next start` com header CSP confirmado por `curl` em duas rotas.
  Commit `c45cb2d`, PR #36, `MERGED` (`ab40343`).

**Achado lateral no deploy de PP-034 (esclarecido, não é bug estrutural):** o Codex inicialmente reportou
que `deploy-backend.yml` "não executa `prisma migrate deploy`" e concluiu que o backend não fora
implantado. Claude verificou por leitura que `docker/api.Dockerfile:22` já roda `prisma:deploy` no `CMD`
do container, antes do `main.js` — o mecanismo existe, só não está no workflow YAML. Pedido de
confirmação read-only (via Codex) resolveu a divergência com evidência real: o container `api` só havia
sido reiniciado *antes* do merge da PP-034 (`15:38:27Z` vs. merge em `18:47:39Z`), então a migration
simplesmente ainda não tinha tido chance de rodar — não era falha do mecanismo. Deploy manual do serviço
`api` (`workflow run 33004866029`) aplicou a migration corretamente, confirmado por coluna existente,
login/rotas funcionando, e prova negativa (rota admin sem token → `401`).

**Estado final da sequência CAT PP-026/PP-028 R2:** PP-029 a PP-035 todas fechadas — código homologado
com evidência própria em cada uma, mergeado, e aplicado/validado em produção. Achados originais do CAT
ainda não convertidos em Spec: P2/A1/A2 (dívida arquitetural — `user.service.ts`/`upsert.service.ts`
monolíticos, detecção por regex espalhada). Pendência de higiene não bloqueante: bundle Git residual na
máquina do Codex (`%TEMP%\pp031-...bundle`); worktrees antigas `appcbtmeventos-pp012`/`appcbtmeventos-
pp015` identificadas nesta sessão como possivelmente obsoletas (branches já mergeadas?) — a confirmar
antes de qualquer remoção.

---

## Hipótese de impacto técnico

Nenhuma alteração de código nesta rodada — CAT é análise. Se Specs forem abertas a partir dos achados,
cada uma seguirá o fluxo padrão (draft → Spec formal → aprovação → Codex).

## Fora de escopo (proposto)

- Não duplicar PP-SEC-001..004, H1-H9 do PP-020, nem os achados já cobertos por PP-021 a PP-025.
- Não abrir Specs nesta rodada — CAT primeiro, priorização depois, Specs só após aprovação de Leo.
- Não auditar `apps/web` em profundidade nesta rodada (fora do tempo desta Rodada 1) — candidato a
  rodada adicional se item A resolver para "mais profundidade".
