# PP-SEC-011 — Token admin em Web Storage

<!-- Spec unificada v7. ## SPEC ATIVA é a única seção de instrução; ## HISTÓRICO é consulta. -->

## SPEC ATIVA — PP-SEC-011 — v1
ID: PP-SEC-011 | Projeto: PingPong PaiD'egua | Branch: fix/pp-sec-011-mitigacao-token-storage
Criada por: Claude | Data: 2026-10-16 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-10-16 | Escopo: mitigação documentada do token admin em sessionStorage (Opção B2 — sem migração para cookie httpOnly; cookie adiado até existir topologia same-site, ver PEND-CBTM-001)

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — toca fluxo de autenticação/sessão admin (`apps/web/lib/auth.ts`)
- e2e-playwright-agent: não — sem fluxo de UI ponta a ponta novo, só comportamento de storage já coberto por unitário
- report-builder-agent: não — relatório padrão de entrega já cobre o escopo

## Objetivo
Documentar explicitamente, no código e no backlog, que o armazenamento do token admin em `sessionStorage`
é mitigação residual (reduz persistência, não elimina risco de XSS) — e reforçar, no próprio módulo de
auth do frontend, a invariante que hoje só existe implicitamente: o token nunca deve ser promovido de volta
a `localStorage` nem exposto fora do fluxo de `currentStorage()`/`legacyStorage()` já existente.

## Contexto
PP-SEC-011 original (`docs/backlog-seguranca-qualidade.md`) descrevia "token admin em Web Storage" de forma
genérica; PP-059 já fechou a parte CSP (`script-src` sem `unsafe-inline`). Investigação desta Spec (CAT
Rodada 1-3) confirmou que o código já usa `sessionStorage`, não `localStorage` — a exposição real é mais
limitada do que o texto original do backlog sugeria. Migração para cookie httpOnly foi avaliada (Rodada 2,
Codex) e adiada por decisão de Leo: a topologia atual (frontend Vercel, API DuckDNS) é cross-site, e cookie
cross-site exigiria `SameSite=None; Secure` + CSRF obrigatório — escopo maior, sem topologia same-site
disponível hoje (PEND-CBTM-001 ainda aberto).

## Causa raiz
- Causa imediata: token de sessão admin é acessível via JavaScript (`sessionStorage`), portanto um XSS
  bem-sucedido no frontend pode lê-lo e agir como admin.
- Causa sistêmica: ausência de topologia same-site entre frontend e API (domínio compartilhado/proxy)
  impede hoje a mitigação estrutural (cookie httpOnly) sem assumir risco cross-site adicional (CSRF,
  bloqueio de cookies terceiros). Padrão já visto: PEND-CBTM-002 (CSP `unsafe-inline`) tinha a mesma raiz
  de "mitigação possível, eliminação estrutural bloqueada por decisão de infraestrutura pendente".
- Padrão: já fechado pela PP-059 para CSP; aqui se repete para Storage — ambos aguardam decisão de domínio
  próprio (PEND-CBTM-001) para a solução estrutural completa.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Comportamento de storage não muda, só é documentado**
DADO o módulo `apps/web/lib/auth.ts` como está hoje
QUANDO um login é realizado
ENTÃO o token continua sendo escrito exclusivamente em `sessionStorage` (`currentStorage()`), nunca em
`localStorage`, e o código passa a ter comentário explícito afirmando que isso é mitigação residual
(reduz janela de exposição ao fechar a aba, não elimina leitura via XSS).

**Cenário 2 — Migração de legado continua funcionando**
DADO um cliente antigo com `cbtm_token`/`cbtm_role` em `localStorage`
QUANDO `getAuthToken()`/`getUserRole()` são chamados
ENTÃO o valor é migrado para `sessionStorage` e removido do `localStorage`, exatamente como hoje (sem
regressão).

**Cenário 3 — Backlog reflete o estado real**
DADO o item PP-SEC-011 em `docs/backlog-seguranca-qualidade.md`
QUANDO este item for fechado
ENTÃO o backlog registra: Opção B2 adotada, cookie httpOnly adiado até domínio próprio/proxy same-site
(referenciar PEND-CBTM-001), e nenhuma mudança de contrato de API ocorreu nesta Spec.

## Critérios de aceitação
- `apps/web/lib/auth.ts`: comentário explícito acima de `currentStorage()`/`setAuthToken()` documentando
  que `sessionStorage` é mitigação residual, não eliminação do vetor de XSS, e referenciando PP-SEC-011.
- Nenhuma linha de código de comportamento muda (sem novo parâmetro, sem nova função, sem novo arquivo de
  produção) — é documentação em comentário + atualização do backlog.
- `docs/backlog-seguranca-qualidade.md`: PP-SEC-011 passa de "parcialmente fechada" para "fechada — decisão
  B2 registrada", com referência a este arquivo de Spec e a PEND-CBTM-001 como bloqueio da solução
  estrutural (cookie httpOnly cross-site).
- Teste unitário novo ou ajustado confirma que `setAuthToken`/`getAuthToken` nunca escrevem em
  `localStorage` (só leem para migração de legado e depois removem) — já implícito no comportamento atual,
  mas sem teste explícito hoje; este T-* fecha a lacuna de regressão.

## Fora de escopo
- Migração para cookie httpOnly (Opção B1) — explicitamente adiada, não implementar nesta Spec.
- Qualquer mudança em `apps/api/src/auth/**`, `apps/api/src/main.ts`, `scripts/vm/nginx-api-site.conf` —
  nenhum destes é tocado; a mitigação é 100% frontend/documentação.
- CSRF — só se aplicava à Opção B1, fora de escopo por consequência.
- `cookie-parser` ou qualquer dependência nova — não há dependência nova nesta Spec.
- Revisão de CORS/`cors-origin.ts` (PP-SEC-010, achado colateral do Codex) — item próprio do backlog, não
  desta Spec.
- PEND-CBTM-001 (domínio próprio) — decisão de infraestrutura separada, já registrada no CLAUDE.md do
  projeto; esta Spec não a resolve, só referencia como bloqueio.

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/lib/auth.ts` — comentário acima de `currentStorage()` (linha 14) e `setAuthToken()` (linha 51).
  - `docs/backlog-seguranca-qualidade.md` — linha do item PP-SEC-011 (fechamento).
  - Arquivo de teste novo ou existente de `apps/web` cobrindo `auth.ts` (Codex escolhe onde encaixar,
    seguindo o padrão de teste já usado no projeto para `lib/`).
- Arquivos que NÃO devem ser tocados: todo `apps/api/src/auth/**`, `apps/api/src/main.ts`,
  `scripts/vm/nginx-api-site.conf`, `apps/web/lib/admin-api.ts` (motivo: fora de escopo, ver acima — esta
  Spec não muda nenhum contrato de API nem comportamento de rede).
- DDL / migração: não aplicável.
- Contrato de API alterado: não aplicável — nenhum.
- Dependências novas: nenhuma (Q7 não se aplica).

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário
- arquivos de teste a criar/ajustar: teste de `apps/web/lib/auth.ts` (localizar suíte existente de `lib/`
  no workspace `apps/web`; se não houver, criar `apps/web/lib/auth.test.ts` seguindo o runner já configurado)
- fixtures/mocks: mock de `window.sessionStorage`/`window.localStorage` (já deve haver padrão similar no
  projeto para outros testes de `apps/web` — Codex reaproveita se existir)

COBERTURA: regressão=2 corretude=1

### T-U-01 — setAuthToken nunca escreve em localStorage
Camada: função (`apps/web/lib/auth.ts`)
DADO `localStorage` com um valor qualquer em `cbtm_token` (resíduo de versão legada) ou vazio
QUANDO `setAuthToken("abc123")` é chamado
ENTÃO `sessionStorage.getItem("cbtm_admin_token") === "abc123"` e `localStorage.getItem("cbtm_token") === null`
após a chamada — valor calculado fora da função (string literal fixada no teste, não reaproveitada da
implementação) [corretude]

### T-U-02 — migração de legado permanece idêntica (regressão)
Camada: função (`apps/web/lib/auth.ts`)
DADO `localStorage` com `cbtm_token = "legado-xyz"` e `sessionStorage` vazio
QUANDO `getAuthToken()` é chamado
ENTÃO retorna `"legado-xyz"`, `sessionStorage.getItem("cbtm_admin_token") === "legado-xyz"` e
`localStorage.getItem("cbtm_token") === null` — mesmo comportamento documentado antes desta Spec, prova
que o comentário adicionado não alterou a função [regressão]

### T-U-03 — getHeaders continua emitindo Authorization quando há token (regressão)
Camada: função (`apps/web/lib/auth.ts`)
DADO `sessionStorage` com `cbtm_admin_token = "tok-1"`
QUANDO `getHeaders()` é chamado
ENTÃO o header `Authorization` é `"Bearer tok-1"` — confirma que a documentação/comentário não afetou o
fluxo de requisição autenticada [regressão]

### Cobertura de falhas silenciosas
- Não aplicável a este escopo — não há UI nova, só storage e documentação. `[não aplicável — Spec não
  introduz UI/formulário/exclusão]`.

### Comando para rodar a suite
`npm --prefix apps/web test`

## Skills Codex a ativar — justificativa
- `security-review-agent`: ativar porque toca módulo de autenticação, mesmo sem mudança de comportamento —
  garante que o scanner confirme ausência de regressão introduzida pelo comentário/teste novo.

---

## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-10-16)

**Origem do item:** `docs/backlog-seguranca-qualidade.md` PP-SEC-011 (parcialmente fechado pela PP-059,
que cobriu só a parte CSP). Remanescente: "token admin em Web Storage" — `apps/web/lib/auth.ts:51-59`
(linhas hoje correspondem a `setAuthToken`).

#### Estado atual do código (lido integralmente antes desta análise)

- `apps/web/lib/auth.ts`: o token já está em **`sessionStorage`** (`currentStorage()` → `window.sessionStorage`),
  não em `localStorage` puro como o texto original do backlog sugeria. Existe uma rotina de migração
  (`legacyStorage()` → `window.localStorage`) que lê `cbtm_token`/`cbtm_role` legados em `localStorage`,
  migra para `sessionStorage` e remove do `localStorage` — isso é compatibilidade retroativa de uma versão
  anterior, não o padrão atual de escrita.
- Consumidores: `apps/web/app/admin/login/page.tsx` (seta token/role após login), `apps/web/app/admin/layout.tsx`
  (lê para guardar rota e limpa no logout), `apps/web/app/admin/page.tsx` (não lido ainda nesta rodada —
  mapear na Rodada 1 completa se necessário para a Spec final).
- Backend (`apps/api/src/auth/auth.service.ts:218-221`): `login()` retorna `{ accessToken, role }` no
  corpo JSON. Não há `Set-Cookie`, não há `cookie-parser` instalado, `app.enableCors({ credentials: true })`
  em `apps/api/src/main.ts:46-49` já está habilitado mas hoje não é usado para cookie de sessão — serve
  para CORS com `Authorization` header.
- `apps/api/src/auth/jwt.strategy.ts`: extrai o JWT exclusivamente de `Authorization: Bearer` via
  `ExtractJwt.fromAuthHeaderAsBearerToken()`. Migrar para cookie exigiria também alterar esta estratégia
  (extrator customizado lendo cookie) ou mantê-la em paralelo durante transição.

#### O que fazer — ambiguidades identificadas

1. **[PENDENTE: manter Web Storage com mitigação adicional, ou migrar para cookie httpOnly?]**
   - Opção A (mitigação, sem mudança de contrato): manter `sessionStorage`, garantir CSP já fechada
     (PP-059) reduz a superfície de XSS que exfiltraria o token. Sem DDL, sem mudança de API, mais barato.
   - Opção B (migração para cookie httpOnly + SameSite): elimina acesso via JS a qualquer token,
     mitigação estrutural contra XSS. Exige: `cookie-parser` no backend (dependência nova, Q7),
     `Set-Cookie` no login/refresh, extrator JWT customizado lendo cookie em vez de header, CORS já tem
     `credentials: true` (compatível), frontend parar de chamar `setAuthToken`/`getAuthToken` manualmente
     e depender do cookie automático do browser, CSRF a considerar (cookie com `SameSite=Strict` ou
     `Lax` + verificação de origem já existe via CORS).
   - Reflete decisão de risco vs. esforço: o único payload sensível carregado hoje é a sessão admin
     (não há dados pessoais de atletas no payload do JWT, conforme `jwt.strategy.ts`). Impacto de exposição
     é "admin indevido", não dado pessoal de terceiros.

2. **[PENDENTE: se Opção B, cookie `Secure`+`SameSite=Strict` quebra o fluxo em dev local (`http://localhost`)?]**
   - Hoje `API_BASE_PUBLIC`/`API_INTERNAL_URL` default para `http://localhost:4000`. Cookie `Secure`
     exige HTTPS; em dev isso bloquearia o cookie. Precisa de flag condicional por ambiente.

3. **[PENDENTE: o que fazer com o legado `cbtm_token`/`cbtm_role` em `localStorage` se migrar para cookie?]**
   - Hoje a função de migração já existe para erradicar leituras antigas em `localStorage`. Se migrar
     para cookie, a limpeza de `sessionStorage`/`localStorage` nos clientes antigos precisa continuar
     existindo por pelo menos um ciclo de deploy (sessões antigas ainda com token em Web Storage não devem
     quebrar sem um caminho de logout limpo).

4. **[PENDENTE: timing — faz sentido fazer isso antes ou depois de PP-SEC-013 (Prisma/Next major)?]**
   - Migração de auth é mudança estrutural; se for feita, prefere-se não coincidir com a migração major
     do Next (PP-SEC-013) para isolar causa raiz de qualquer regressão. Leo decide ordem.

#### Hipótese de impacto técnico (preliminar, por opção)

- **Opção A (mitigação, sem contrato novo):** só `apps/web/lib/auth.ts` (comentário/doc reforçando que
  é mitigação, não eliminação do vetor) + eventual hardening de CSP já cobertos. Sem DDL, sem API nova.
- **Opção B (cookie httpOnly):** `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`,
  `apps/api/src/auth/jwt.strategy.ts`, `apps/api/src/main.ts` (registrar `cookie-parser`), `apps/web/lib/auth.ts`
  (remover escrita manual de token, manter helpers para compatibilidade de leitura de role se necessário),
  `apps/web/app/admin/login/page.tsx`, `apps/web/app/admin/layout.tsx`. Dependência nova: `cookie-parser`
  (+ `@types/cookie-parser` dev). Sem DDL (token não é persistido em tabela, `tokenVersion` já existe para
  invalidação).

### CAT — Rodada 2 (Codex) — 2026-10-16

Resposta transportada por Leo, verificada por Claude via Grep no histórico local do Codex (match em
`~/.codex/sessions/2026/10/16/rollout-2026-10-16T23-26-39-...jsonl`) — proveniência confirmada, não é
proveniência não verificada.

Resumo técnico (texto completo do Codex preservado no arquivo de sessão da conversa; aqui a síntese que
resolve os `[PENDENTE]`):

1. Cookie httpOnly é viável tecnicamente, mas **depende da topologia real de produção**: frontend em
   `pingpongpaidegua.vercel.app` e API em `api-pingpongpaidegua.duckdns.org` são origens cross-site —
   `SameSite=Strict`/`Lax` inviabilizaria o cookie nessa topologia; só `SameSite=None; Secure` funcionaria,
   e fica sujeito a bloqueio de cookies terceiros pelo navegador. **Topologia same-site (mesmo domínio ou
   proxy) precisa ser decidida antes de qualquer migração de cookie.**
2. Corrigiu uma premissa errada do rascunho da Rodada 1: `Secure` não bloqueia `localhost` por si só
   (MDN documenta exceção); o problema real é cross-site de produção (item 1), não dev local.
3. CORS (`credentials: true`) não é proteção CSRF. Qualquer migração para cookie exige mecanismo CSRF
   explícito (validação de origem estrita + token/double-submit), não apenas o CORS já existente.
4. Confirmado por leitura própria do Codex (citações verificadas por Claude, ver abaixo): `cors-origin.ts`
   aceita wildcard e qualquer `https://*.vercel.app` quando `FRONTEND_ALLOW_VERCEL_PREVIEWS=true` — mesma
   superfície do PP-SEC-010, relevante porque qualquer preview Vercel teria origem aceita pelo CORS.
5. `scripts/vm/nginx-api-site.conf:45,79` tem `proxy_ignore_headers Set-Cookie` — se migrar para cookie,
   a rota de autenticação precisa ficar explicitamente fora do cache/proxy ignore, ou o cookie seria
   descartado pelo nginx antes de chegar ao cliente.
6. Transição de legado: limpar `sessionStorage`/`localStorage` e exigir novo login é mais simples que
   migração automática. Os guards de `admin/layout.tsx` e páginas dependentes de `getAuthToken()`
   precisariam passar a depender de uma consulta de sessão validada pela API, não de leitura local.
7. `clearAuth()` sozinho não basta mais — logout precisa expirar o cookie no servidor.
8. `tokenVersion` já permite revogação global (confirmado em `jwt.strategy.ts:38-45`), mas isso não
   resolve JWT copiado manualmente antes da revogação — ok como está, não é regressão da migração.
9. Sem dependência técnica entre PP-SEC-011 e PP-SEC-013 (Prisma/Next major) — Codex recomenda entregas
   separadas, resolver primeiro topologia/CSRF antes de migrar, e não combinar com a migração major do
   Next no mesmo deploy.
10. Sem refresh token hoje; JWT `expiresIn` default `8h` (`auth.module.ts:18`, confirmado por Claude).
    Criar refresh ampliaria o escopo — não incluir nesta Spec, salvo decisão em contrário de Leo.
11. `cookie-parser` é opção de implementação, não requisito do protocolo — Codex não travou nessa lib
    especificamente.

**Verificação própria de Claude das citações factuais do Codex (não aceitas por declaração):**
- `grep -n "proxy_ignore_headers\|Set-Cookie" scripts/vm/nginx-api-site.conf` → confirmado, linhas 45 e 79.
- `Read apps/api/src/common/cors-origin.ts` → confirmado: aceita wildcard (`includes("*")`) e qualquer
  `https://[a-z0-9-]+\.vercel\.app` quando a env está `"true"`.
- `Read apps/api/src/auth/auth.module.ts` → confirmado: `expiresIn: process.env.JWT_EXPIRES_IN ?? "8h"`.
- `Read apps/api/src/auth/jwt.strategy.ts` → confirmado: `tokenVersion` comparado contra o banco a cada
  request, revogação global funciona como descrito.

### CAT — Rodada 3 (Claude) — 2026-10-16

Resolução dos itens `[PENDENTE]`:

1. **[LEO DECIDE: topologia]** — Antes de decidir Opção A (manter sessionStorage, mitigação) ou Opção B
   (cookie httpOnly), é preciso decidir se a topologia cross-site (Vercel + DuckDNS) muda. Duas sub-opções
   de Leo:
   - **B1 — Cookie com `SameSite=None; Secure`** mesmo cross-site, aceitando risco residual de bloqueio por
     navegadores que restringem cookies de terceiros (Safari ITP, Chrome third-party deprecation em curso).
     Mitiga XSS lendo token via JS; não resolve CSRF sozinho (precisa de proteção adicional, ver item 3).
   - **B2 — Adiar cookie até existir topologia same-site** (domínio próprio + proxy no mesmo domínio do
     frontend, relacionado a PEND-CBTM-001 que já está pendente de domínio próprio). Nesse caso, Opção A
     (mitigação em sessionStorage) é a única viável agora.
   - Dado que PEND-CBTM-001 já registra que domínio próprio está fora do escopo até decisão futura de Leo,
     a leitura de Claude é que **B2 é o caminho mais consistente com o estado atual do projeto** — mas a
     decisão final é de Leo.

2. **[RESOLVIDO]** — `Secure` não bloqueia localhost; a Rodada 1 estava errada nesse ponto. Removido como
   bloqueio técnico. Dev local usa `http://localhost:3000`/`:4000`, mesma porta-diferente same-site, sem
   necessidade de `SameSite=None` em dev.

3. **[LEO DECIDE: escopo de CSRF]** — Se a decisão do item 1 for B1 (cookie cross-site), a Spec final
   precisa incluir proteção CSRF explícita (token double-submit ou verificação de origem estrita nas
   rotas mutáveis de auth) como critério de aceitação obrigatório, não opcional. Se for B2 (adiar cookie),
   este item fica fora de escopo nesta rodada.

4. **[RESOLVIDO]** — Sem dependência técnica entre PP-SEC-011 e PP-SEC-013; podem ser entregas separadas,
   em qualquer ordem. Recomendação de Claude (seguindo Codex): resolver PP-SEC-011 antes de combinar com
   a migração major do Next, para isolar causa raiz de eventual regressão.

#### Itens [LEO DECIDE] — bloco consolidado

- **Topologia (item 1):** manter cross-site Vercel+DuckDNS e aceitar cookie `SameSite=None; Secure` (B1,
  com CSRF obrigatório) **ou** adiar migração de cookie até domínio próprio/proxy same-site existir (B2,
  escopo desta Spec vira só mitigação em sessionStorage)?
- **Se B1: CSRF (item 3)** — token double-submit ou validação estrita de origem nas rotas de auth?
- **Escopo do legado:** ao migrar (se migrar), forçar logout de todas as sessões ativas (limpar Storage,
  exigir novo login) em vez de migração automática — Codex recomendou, Claude concorda; Leo confirma.

#### Hipótese de impacto técnico atualizada

- **Se B2 (mitigação, sem cookie):** só `apps/web/lib/auth.ts` (documentar que é mitigação residual, não
  eliminação) + nenhuma mudança de contrato de API. Sem DDL. Spec vira fast-track-compatível (um único
  componente, sem DDL, sem mudança de contrato).
- **Se B1 (cookie httpOnly cross-site):** mudança de contrato de API confirmada — exige CAT permanece
  como está (não cabe fast-track). Arquivos: `apps/api/src/auth/{auth.controller,auth.service,jwt.strategy}.ts`,
  `apps/api/src/main.ts` (`cookie-parser`), `apps/web/lib/auth.ts`, `apps/web/app/admin/{login/page,layout,page}.tsx`,
  `apps/web/lib/admin-api.ts`, `scripts/vm/nginx-api-site.conf` (excluir rota de auth do `proxy_ignore_headers`
  relevante). Dependência nova: `cookie-parser` + `@types/cookie-parser` (Q7). Sem DDL.

**Decisão de Leo (2026-10-16): Opção B2.** Adiar migração para cookie httpOnly até existir topologia
same-site (domínio próprio/proxy, hoje bloqueado por PEND-CBTM-001 em aberto). Escopo desta Spec passa a
ser só mitigação/documentação em `sessionStorage` — sem DDL, sem mudança de contrato de API, sem
dependência nova. CSRF (item 3) fica fora de escopo por consequência (só se aplicava à Opção B1).

### CAT — Fechamento (2026-10-16)

Rascunho aprovado por Leo (✅). Escopo reduzido a B2 elimina a condição que obrigava o ciclo completo
(sem DDL, sem mudança de contrato de API, componente único `apps/web/lib/auth.ts` + documentação) — Spec
formal segue como fast-track, conforme o próprio rascunho já previa para esse cenário.
