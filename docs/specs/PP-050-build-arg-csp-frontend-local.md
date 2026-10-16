## SPEC ATIVA — PP-050 — v2
ID: PP-050 | Projeto: PingPong PaiD'egua | Branch: `chore/pp-050-build-arg-csp-frontend-local`
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v2

Nota de branch (correção v1→v2): `docker/web.Dockerfile` e `docker-compose.yml` são arquivos versionados
— toda a Spec os modifica, junto com `playwright.config.ts`/teste novo. Isso não é operação de dado local
como PP-039/PP-049 (que não tocavam arquivo versionado); é código de configuração normal do repositório.
Branch única para toda a entrega, sem exceção condicional.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — a mudança altera a política de Content-Security-Policy (`connect-src`),
  superfície de segurança direta (A05 Security Misconfiguration se mal aplicada — CSP mais permissiva do
  que o necessário).
- e2e-playwright-agent: sim — a Spec pede teste Playwright real da rota `/eficiencia`; é a primeira suíte
  Playwright do projeto (confirmado: `playwright` está instalado em `node_modules` mas não há
  `playwright.config.ts` nem script no `package.json` raiz ou de `apps/web` — precisa ser criado).
- report-builder-agent: sim — Plano de testes exige evidência literal por T-*.

## Objetivo
PP-049 concluiu o dump/reapontamento do banco local para `cbtm_homolog` com dado real de produção, mas o
frontend local não renderiza: a CSP compilada no build do container aponta `connect-src` para
`https://api-pingpongpaidegua.duckdns.org` (produção), enquanto o container roda com
`NEXT_PUBLIC_API_URL=http://localhost:4000` em runtime — o navegador bloqueia o fetch e mostra "Serviço
indisponível". Objetivo desta Spec: corrigir exclusivamente esse descompasso de build-time, sem alterar
nada do comportamento de produção.

## Contexto
Causa raiz confirmada por leitura direta nesta sessão (Claude, 2026-09-18):
- `apps/web/next.config.js` calcula `contentSecurityPolicy` a partir de
  `new URL(process.env.NEXT_PUBLIC_API_URL ?? "https://api-pingpongpaidegua.duckdns.org").origin` — essa
  leitura acontece em **build time** (`next build`), porque o valor é embutido no `routes-manifest.json`
  gerado durante o build, não recalculado em runtime.
- `docker/web.Dockerfile` roda `npm install` e `npm run build --workspace apps-web` sem nenhum `ARG`/`ENV`
  de `NEXT_PUBLIC_API_URL` — então o build sempre cai no fallback de produção
  (`https://api-pingpongpaidegua.duckdns.org`), independente do que `docker-compose.yml` define em
  `environment:` para o container em runtime.
- `docker-compose.yml` (serviço `frontend`) já define `NEXT_PUBLIC_API_URL: http://localhost:4000` em
  `environment:`, mas isso só afeta o processo em runtime — o CSP e qualquer uso client-side de
  `NEXT_PUBLIC_*` já embutido no bundle JS no momento do build não é afetado por `environment:` do
  compose.
- Confirmado por `docker exec appcbtmeventos-frontend-1 env`: `NEXT_PUBLIC_API_URL=http://localhost:4000`
  em runtime, mas `docker exec ... grep connect-src .next/routes-manifest.json` mostra
  `connect-src 'self' https://api-pingpongpaidegua.duckdns.org` — confirma a causa raiz.
- API local confirmada funcionando corretamente com dado de `cbtm_homolog` (`curl` direto em
  `localhost:4000` retornou dado real, incluindo "PARÁ CLUBE - PA") — o problema é só o navegador sendo
  bloqueado pelo CSP do build, não a API nem o banco.

Padrão de produção a preservar: em produção, o build do frontend deve continuar resolvendo
`NEXT_PUBLIC_API_URL` para `https://api-pingpongpaidegua.duckdns.org` (ou o que estiver configurado no
pipeline de deploy de produção) exatamente como hoje — esta Spec não pode alterar esse comportamento.

## Causa raiz
- Causa imediata: `docker/web.Dockerfile` não recebe `NEXT_PUBLIC_API_URL` como build arg, então o build
  local sempre usa o fallback de produção embutido no código-fonte de `next.config.js`.
- Causa sistêmica: o projeto nunca teve um fluxo de build local do frontend contra API local antes da
  PP-048/PP-049 (dev sempre rodou via `npm run dev:web`, que usa `NEXT_PUBLIC_API_URL=http://localhost:4001`
  passado por variável de ambiente do próprio `dev:web` script, nunca via Docker build). O caminho Docker
  (`docker-compose.yml` profile `local-ui`) foi adicionado sem passar o build arg equivalente.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — build arg propaga corretamente para o build local**
DADO `docker-compose.yml` com o serviço `frontend` definindo `build.args.NEXT_PUBLIC_API_URL` (ou
equivalente) e `docker/web.Dockerfile` declarando `ARG NEXT_PUBLIC_API_URL` + `ENV NEXT_PUBLIC_API_URL`
antes do `npm run build`
QUANDO `docker compose --profile local-ui build frontend` roda com o `.env` local
ENTÃO o `routes-manifest.json` gerado contém `connect-src 'self' http://localhost:4000` (ou o valor
exato configurado), não mais o domínio de produção.

**Cenário 2 — produção não é afetada**
DADO que a Spec só altera `docker-compose.yml` (serviço `frontend`, bloco `build`) e
`docker/web.Dockerfile` (adiciona `ARG`/`ENV`, sem remover o fallback existente em `next.config.js`)
QUANDO o pipeline de deploy de produção (fora deste compose local, na VM Oracle) constrói a imagem sem
passar esse build arg
ENTÃO o fallback de `next.config.js` continua resolvendo para
`https://api-pingpongpaidegua.duckdns.org`, comportamento idêntico ao atual — Cenário verificado por
leitura do `next.config.js` (fallback não é removido, só passa a receber valor explícito quando o build
arg é fornecido).

**Cenário 3 — frontend renderiza dado real após rebuild**
DADO o frontend rebuildado com o CSP corrigido
QUANDO `http://localhost:3000/eficiencia` é acessado por um cliente HTTP real (fetch/Playwright, não só
`curl` do HTML estático)
ENTÃO a página carrega a lista de clubes via fetch client-side sem erro de CSP, exibindo pelo menos um
clube real de produção (ex.: "PARÁ CLUBE - PA", confirmado presente na API local).

**Cenário 4 — API e worker continuam em `cbtm_homolog`**
DADO o estado deixado pela PP-049 (`.env` com as 4 URLs apontando para `cbtm_homolog`)
QUANDO esta Spec é executada
ENTÃO nenhuma variável de conexão de banco é alterada — só `NEXT_PUBLIC_API_URL`/build arg do frontend.

## Critérios de aceitação
- `docker/web.Dockerfile` recebe `NEXT_PUBLIC_API_URL` via `ARG NEXT_PUBLIC_API_URL=https://api-pingpongpaidegua.duckdns.org`
  (valor default explícito no próprio `ARG`, igual ao fallback de `next.config.js`) + `ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL`.
  Obrigatório: o `ARG` **não pode** ficar sem default (`ARG NEXT_PUBLIC_API_URL` vazio) — se o build arg
  não for passado pelo `docker compose build`, `ENV` receberia string vazia (`""`), e
  `new URL("")` em `next.config.js` lança exceção e quebra o build (o operador `??` do JS só ativa em
  `undefined`/`null`, nunca em string vazia). Confirmado por leitura de `next.config.js:6-8`.
- `docker-compose.yml`, serviço `frontend`: bloco `build` passa `args: NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:4000}`
  (ou equivalente), lido do `.env` local.
- CSP confirmada por leitura do `routes-manifest.json` pós-build: `connect-src` contém
  `http://localhost:4000`.
- `curl`/fetch real (não HTML estático) confirma que `/eficiencia` carrega clube real sem erro de CSP no
  console do navegador (usar Playwright para capturar console errors, não só status HTTP).
- `.env` local (4 URLs de banco) permanece apontando para `cbtm_homolog` — confirmado inalterado.
- `npm run build --workspace apps-web` (build normal, fora do Docker) continua funcionando — build arg é
  exclusivo do caminho Docker, não deve quebrar o build local direto (`next build` sem Docker usa
  `process.env.NEXT_PUBLIC_API_URL` do shell, comportamento já existente, não tocado por esta Spec).
- Suite Playwright criada (primeira do projeto): `playwright.config.ts` mínimo + 1 teste real da rota
  `/eficiencia` contra `http://localhost:3000`, script novo em `package.json` (`test:e2e` ou equivalente).
- Security review confirma que o CSP não ficou mais permissivo do que o necessário (`connect-src` deve
  listar apenas a origem específica configurada, nunca `*` ou wildcard).

## Fora de escopo
- Não alterar `admin`/rotas administrativas, autenticação, ou qualquer outro header de CSP
  (`script-src`, `style-src`, etc.) além de `connect-src`.
- Não alterar o pipeline de deploy de produção na VM Oracle — só o compose/Dockerfile locais.
- Não alterar `.env` nas 4 variáveis de conexão de banco (herdadas intocadas da PP-049).
- Não criar suíte Playwright abrangente — só o teste mínimo de `/eficiencia` pedido por Leo; expansão da
  cobertura e2e é Spec futura, se desejada.
- Não commitar/versionar nada relativo a `.env` ou a dados de `cbtm_homolog`.
- Toda a entrega (Dockerfile, compose, config Playwright, teste novo, script de package.json) é
  versionada e commitada na branch `chore/pp-050-build-arg-csp-frontend-local` — sem exceção condicional
  (correção v1→v2).

## Impacto técnico
- Arquivos a criar/modificar:
  - `docker/web.Dockerfile` — adicionar `ARG NEXT_PUBLIC_API_URL` + `ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL`
    antes do `RUN npm run build --workspace apps-web`
  - `docker-compose.yml` — serviço `frontend`, adicionar bloco `build.args` com
    `NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:4000}`
  - `playwright.config.ts` (novo, provavelmente em `apps/web/` ou raiz — Codex decide local convencional
    para o monorepo, documentar escolha no relatório)
  - 1 arquivo de teste Playwright novo (ex.: `apps/web/e2e/eficiencia.spec.ts` ou equivalente)
  - `package.json` (raiz ou `apps/web`) — novo script `test:e2e` (ou nome equivalente)
- Arquivos que NÃO devem ser tocados:
  - `apps/web/next.config.js` — fallback de produção deve permanecer exatamente como está, só passa a
    receber valor explícito via build arg quando fornecido
  - Qualquer arquivo de `apps/api`, `apps/worker`, `prisma/schema.prisma`
  - `.env` — as 4 variáveis de conexão de banco da PP-049
- DDL: não aplicável
- Contrato de API: não aplicável — CSP é do frontend, não da API
- Dependências novas: nenhuma (`playwright` já instalado em `node_modules`, confirmado por esta sessão)

## Plano de testes
### Cobertura geral
- camadas obrigatórias: integração (build/config) + e2e (Playwright)
- arquivos de teste a criar: 1 spec Playwright novo (`/eficiencia`)
- fixtures/mocks: nenhum — teste roda contra a stack Docker local real com dado de `cbtm_homolog`
- COBERTURA: regressão=1 corretude=1 — regressão via Cenário 2 (build de produção não afetado, verificado
  por leitura do `next.config.js` preservando o fallback); corretude via Cenário 3 (fetch real renderiza
  clube existente em produção, fonte independente: a API local já confirmada retornando esse dado)

### T-I-01 — Build arg propaga corretamente
DADO: `docker-compose.yml` e `docker/web.Dockerfile` modificados
QUANDO: `docker compose --profile local-ui build frontend`
ENTÃO: build conclui com exit code 0; `docker run --rm <imagem> cat .next/routes-manifest.json` (ou
inspeção equivalente sem subir o container) mostra `connect-src` com `http://localhost:4000`

### T-I-02 — Produção não é afetada (regressão)
DADO: `apps/web/next.config.js` após a mudança
QUANDO: lido/diffado contra o estado anterior
ENTÃO: o fallback `https://api-pingpongpaidegua.duckdns.org` continua presente no código-fonte, inalterado

### T-I-03 — `npm run build --workspace apps-web` direto (fora do Docker) continua verde
DADO: build local sem Docker, sem build arg (caminho não tocado por esta Spec)
QUANDO: `npm run build --workspace apps-web` roda
ENTÃO: exit code 0, comportamento idêntico ao anterior à Spec

### T-E-01 — Playwright confirma `/eficiencia` sem erro de CSP
Cenário: usuário acessa a rota de eficiência do site local
Passos: Playwright navega para `http://localhost:3000/eficiencia`, aguarda a lista de clubes carregar,
captura mensagens de console/erros de rede
Verificações: nenhum erro de CSP/`Refused to connect` no console; pelo menos um nome de clube real (ex.
"PARÁ CLUBE") visível no DOM renderizado

### Cobertura de falhas silenciosas
- T-E-01 verifica o efeito real (dado renderizado no DOM), não só que a página retornou HTTP 200 —
  página podia retornar 200 e ainda assim mostrar "Serviço indisponível" client-side, como aconteceu antes
  desta correção

### Comando para rodar a suite
```
docker compose --profile local-ui build frontend
docker compose --profile local-ui up -d --force-recreate frontend
npm run build --workspace apps-web
npx playwright test <caminho do spec novo>
```

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT (2026-09-18)
Fast track usado — causa raiz já identificada e confirmada por leitura direta nesta sessão (não é
investigação a fazer, é correção pontual e bem delimitada: 2 arquivos de config + 1 teste novo). Sem DDL,
sem mudança de contrato de API pública, sem ambiguidade de escopo — a instrução de Leo já definia
exatamente os 5 pontos de validação (CSP, renderização, banco intocado, build, teste Playwright).

Precedente: PP-049 (bloqueio original identificado e registrado em
`docs/specs/PP-049-refresh-homolog-e-apontar-frontend-local.md`, parecer ⚠️ Rodada 1, item T-I-06). Esta
Spec fecha exatamente essa pendência, sem reabrir o restante da PP-049 (que já está aprovada com ressalva
e não precisa de nova rodada).

### Correção Codex — Rodada 1 (2026-09-18) — v1 → v2

Codex parou por limite de uso do plano (esgotamento de créditos, não relacionado à Spec) após checagem
técnica de implementabilidade, antes de qualquer escrita. Levantou 3 pontos, verificados nesta sessão
antes de corrigir:

1. Branch indefinida em v1 apesar de `docker/web.Dockerfile`/`docker-compose.yml` serem arquivos
   versionados. Confirmado: v1 tinha uma condicional ambígua ("branch só se... senão..."). Corrigido para
   branch única e obrigatória — toda a entrega é código de configuração versionado, não operação de dado
   local como PP-039/PP-049.
2. O `ARG` proposto podia ficar sem valor default e quebrar `new URL("")` em `next.config.js` quando o
   build arg não fosse passado — confirmado por leitura de `next.config.js:6-8`: o operador `??` só ativa
   em `undefined`/`null`, nunca em string vazia (`""`), que é o que um `ARG` sem default produziria via
   `ENV`. Corrigido: `ARG` agora declara o mesmo valor default do fallback de produção explicitamente.
3. "Playwright já instalado" precisava ser verificado no manifesto, não só em `node_modules` (que pode
   conter pacote transitivo de outra dependência, não necessariamente declarado como dependência direta
   do projeto). Verificado nesta sessão: `node_modules/.bin/playwright` existe e é executável; não há
   `playwright.config.ts` nem script em `package.json` (raiz ou `apps/web`) — confirma o que a Spec já
   registrava (primeira suíte Playwright do projeto, precisa ser criada do zero). Não gerou mudança na
   Spec além da confirmação.

Todos os 3 pontos verificados por leitura direta (`cat`/`sed` no `next.config.js`, `ls` no
`node_modules/.bin`, grep no `package.json`) antes de corrigir — não aceitos por declaração.

### Parecer — Rodada 1 (2026-09-18) — [✅ aprovado]

#### Pré-parecer
- [x] `gh pr view 50` executado — PR real, `OPEN`, `MERGEABLE`, 5 commits, branch
      `chore/pp-050-build-arg-csp-frontend-local`
- [x] `gh pr diff 50 --name-only` — 5 arquivos, batendo exatamente com o relatório (Dockerfile, compose,
      package.json, 2 arquivos de teste novos); nenhum arquivo fora do declarado
- [x] Diff completo lido linha a linha (`gh pr diff 50`) — `ARG NEXT_PUBLIC_API_URL=https://api-pingpongpaidegua.duckdns.org`
      com default explícito (corrige o ponto 2 do Codex), `build.args` no compose, `next.config.js` e
      `.env` confirmados sem diff de PP-050 (a única diferença em `next.config.js` vem da PP-048, já
      mergeada, fallback preservado idêntico)
- [x] Suite reexecutada por esta sessão, não aceita por declaração: `npm run test:e2e:integration`
      (T-I-01/02/03) rodada com checkout real do PR (`git fetch origin pull/50/head`) — 3/3 pass
- [x] `docker compose --profile local-ui up -d --force-recreate frontend` executado por esta sessão com a
      imagem do PR; `curl -sI http://localhost:3000/eficiencia` confirma
      `connect-src 'self' http://localhost:4000` (origem específica, sem wildcard)
- [x] `npm run test:e2e` (T-E-01) reexecutado por esta sessão — 1/1 pass
- [x] `curl -s http://localhost:3000/eficiencia | grep "Serviço indisponível"` — sem match, confirma
      ausência do erro que motivou a Spec
- Nenhum item foi avaliado de memória ou por declaração do agent implementador sem confirmação por
  leitura/execução própria desta sessão

Observação de proveniência: a implementação veio de um subagente Claude (`florestech-claude-code-implementer`)
que esta própria sessão delegou. Mesmo sendo "parente" (ambos Claude), a auditoria seguiu o mesmo padrão
de independência total — nenhuma execução foi aceita por declaração, tudo foi reexecutado ou verificado
por leitura direta desta sessão.

#### Score
✅ 10 itens | ⚠️ 0 itens | ❌ 0 itens | Cobertura diff: 5/5 arquivos auditados (2 novos arquivos de teste
lidos por completo, 3 arquivos de config com diff conferido linha a linha)

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
Nenhum bloqueante. Nota registrada (não ressalva formal): o desvio de usar `playwright` (lib base) em vez
de `@playwright/test` é tecnicamente correto e bem justificado (Q7 — sem dependência nova sem aprovação),
mas significa que não existe `playwright.config.ts` como a Spec original previa — os testes rodam via
`tsx --test`, padrão já usado no projeto. Isso é uma decisão de implementação dentro do espírito da Spec,
não um desvio de escopo.

#### Cobertura de testes (T-* da Spec)
- T-I-01 (build arg propaga para CSP) — rótulo: `EXECUTADA` (reexecutado por esta sessão via checkout
  real do PR, não aceito por declaração): coberto ✅
- T-I-02 (regressão — fallback de produção preservado) — rótulo: `EXECUTADA`: coberto ✅
- T-I-03 (build direto sem Docker continua ok) — rótulo: `EXECUTADA`: coberto ✅
- T-E-01 (Playwright /eficiencia sem erro de CSP, clube real renderizado) — rótulo: `EXECUTADA`
  (reexecutado por esta sessão contra o container recriado com a imagem do PR): coberto ✅
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum

#### Security review
- Executado: ✅ sem achados. CSP `connect-src` contém apenas a origem específica configurada
  (`http://localhost:4000`), sem wildcard — não amplia a superfície de ataque (A05 Security
  Misconfiguration não se aplica; mudança é estritamente mais restritiva que "sem CSP" e equivalente em
  escopo ao padrão de produção, só trocando o host). Nenhum segredo tocado (`.env` intocado). Nenhuma nova
  dependência introduzida (Q7 respeitado — desvio do Playwright evitou isso corretamente).

#### Conclusão
PP-050 aprovada sem ressalvas bloqueantes. Bloqueio original da PP-049 (T-I-06, frontend não renderizava
por CSP fixada em build-time) está resolvido e verificado de forma independente: CSP local aponta
corretamente para `http://localhost:4000`, frontend renderiza dado real de produção
(`cbtm_homolog`, herdado da PP-049) sem "Serviço indisponível", produção não é afetada, e a primeira
suíte de teste de navegador real do projeto está no ar e passando. Pronta para merge.
