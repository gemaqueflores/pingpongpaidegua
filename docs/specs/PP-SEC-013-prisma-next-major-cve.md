# PP-SEC-013 — CVEs de produção: deepmerge-ts/effect (patch) + Next 16 major (postcss)

<!-- Spec unificada v7. ## SPEC ATIVA é a única seção de instrução; ## HISTÓRICO é consulta. -->

## SPEC ATIVA — PP-SEC-013 — v1
ID: PP-SEC-013 | Projeto: PingPong PaiD'egua | Branch: fix/pp-sec-013-next-16-major
Criada por: Claude | Data: 2026-10-17 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-10-17 | Escopo: migração Next 15.5.27 → 16.4.2 em apps/web; middleware CSP permanece em Edge; Turbopack como bundler padrão (fallback --webpack se necessário); parte Prisma/deepmerge-ts/effect removida do escopo (ver novo item de backlog PP-SEC-017)

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — migração toca `apps/web/middleware.ts` (CSP/nonce da PP-059), rota
  `apps/web/app/api/pix-qrcode/route.ts` e runtime de produção
- e2e-playwright-agent: sim — já instalado desde PP-059; obrigatório validar CSP/nonce/QRCode/login sob
  Next 16 real (SameSite, hidratação, bundler) que testes unitários não comprovam
- report-builder-agent: não — relatório padrão de entrega cobre o escopo

## Objetivo
Eliminar a vulnerabilidade moderada/alta de `postcss` (XSS via `</style>` não escapado, leitura arbitrária
de source map) migrando `next` de 15.5.27 para 16.4.2 em `apps/web`, sem regressão na CSP com nonce
implementada pela PP-059 (mergeada ontem) nem no comportamento das demais rotas/páginas.

## Contexto
PP-SEC-013 originalmente agrupava 5 altas + 1 moderada como "bloqueadas pela cadeia Prisma". Esta Spec
(CAT Rodadas 1-3) corrigiu essa premissa: `deepmerge-ts`/`effect` (as 2 dependências transitivas por trás
de 4 das 5 altas via `@prisma/config`/`prisma`) não têm correção segura disponível hoje — ficam como novo
item de backlog separado (PP-SEC-017), sem Spec de implementação até o Prisma liberar uma versão
compatível. Esta Spec cobre exclusivamente a parte com plano de execução claro: `next`→`postcss`.

## Causa raiz
- Causa imediata: `postcss` < versão corrigida (herdada do `next@15.x`) tem XSS via `</style>` não
  escapado e permite leitura de arquivo `.map` arbitrário via `sourceMappingURL` manipulado.
- Causa sistêmica: a correção de `postcss` só está disponível na major seguinte do Next (16.x); o projeto
  não tinha processo recorrente de acompanhar quando uma correção de segurança exige major de framework —
  mesmo padrão já visto em PP-SEC-014 (Vitest major) e PEND-CBTM-006 (dependências `apps/web`).
- Padrão: 3ª ocorrência de "CVE de dependência só resolvido por major de framework/ferramenta" no projeto
  (PP-SEC-014, PEND-CBTM-006, agora PP-SEC-013) — candidato a registrar em `EPISODIC_MEMORY.md` se
  recorrer uma 4ª vez, não nesta Spec.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Build e dependências atualizadas**
DADO `apps/web/package.json` com `next: "^15.1.6"`
QUANDO a migração é aplicada
ENTÃO `next` passa a `16.4.2` (ou patch mais recente da 16.x no momento da implementação), `postcss`
resolvido deixa de aparecer em `npm audit --omit=dev` como alto/moderado, e `npm run build --workspace apps-web`
conclui com sucesso.

**Cenário 2 — CSP com nonce continua funcionando (Edge, sem migrar para proxy)**
DADO `apps/web/middleware.ts` como está hoje (runtime Edge)
QUANDO a aplicação roda sob Next 16
ENTÃO a CSP com nonce por request continua sendo emitida exatamente como antes (mesma política, nonce
único por request), sem precisar migrar para `proxy.ts`/runtime Node — decisão confirmada por Leo.

**Cenário 3 — Bundler Turbopack funciona sem ajuste adicional**
DADO o build de produção (`next build`) sob Next 16 com Turbopack (padrão)
QUANDO o build é executado
ENTÃO conclui sem erro, `@next/bundle-analyzer` (`^16.3.5`, já compatível) continua funcional quando
`ANALYZE=true`. Se Turbopack falhar por incompatibilidade real e comprovada, cair para `--webpack`
(documentar a decisão e o motivo no relatório de entrega, não decidir silenciosamente).

**Cenário 4 — E2E de produção cobre CSP, login admin e QRCode**
DADO o app rodando sob Next 16 (build de produção, não dev server)
QUANDO os testes E2E de `apps/web/e2e/csp-nonce.spec.ts` (estendidos) são executados
ENTÃO: nonce diferente por request (já existia, confirmar sem regressão); `/api/pix-qrcode` sem header
CSP (já existia, confirmar sem regressão) E retornando QRCode válido para payload válido e erro tratado
para payload inválido (novo, hoje só testava ausência de CSP); `/admin/login` carrega, hidrata sem erro de
console, e o nonce dos scripts inline corresponde à política emitida.

## Critérios de aceitação
- `npm audit --omit=dev` não lista mais `next`/`postcss` como alto/moderado após a migração.
- `npm run build --workspace apps-web` conclui com sucesso sob Next 16.
- `apps/web/middleware.ts` permanece em Edge, sem arquivo `proxy.ts` novo — decisão explícita registrada
  no relatório de entrega.
- Testes unitários existentes de `apps/web` (67 atuais) continuam verdes, incluindo
  `apps/web/tests/csp-nonce.test.tsx` sem necessidade de mudar o import de `../middleware` (import não
  muda porque middleware não migrou para proxy).
- `apps/web/e2e/csp-nonce.spec.ts` estendido com T-E-03 (QRCode válido/inválido) e T-E-04 (`/admin/login`
  hidrata com nonce correto), além dos T-E-01/02 existentes continuando verdes.
- Decisão de bundler (Turbopack ou `--webpack`) documentada explicitamente no relatório de entrega, com
  motivo se precisar cair para `--webpack`.

## Fora de escopo
- Migração de `middleware.ts` para `proxy.ts`/runtime Node — decisão de Leo: manter Edge.
- Qualquer correção para `@prisma/config`/`deepmerge-ts`/`effect` — vira item de backlog próprio
  (PP-SEC-017), sem Spec até existir correção upstream segura.
- Mudança de contrato de API pública da API NestJS (`apps/api/**`) — esta Spec só toca `apps/web`.
- Mudança na imagem/versão Docker de produção — Claude não confirmou referência a `node:20-alpine` neste
  repositório; se o Codex encontrar algo relevante durante a implementação, declarar como desvio, não
  assumir mudança silenciosa.
- PP-SEC-015/016 (gates de CI, Node × Vitest) — itens próprios do backlog, não tocados aqui.

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/package.json` — `next` 15.5.27 → 16.4.2 (ou patch mais recente disponível no momento),
    demais devDependencies atreladas conforme `npm install next@16` resolver.
  - `apps/web/next.config.js` — ajustar apenas se o guia oficial de upgrade do Next 16 exigir (confirmar
    durante implementação; config atual é simples: `output: "standalone"`, `redirects`, bundle analyzer).
  - `apps/web/app/api/pix-qrcode/route.ts` — revisar uso de APIs de request síncronas descontinuadas no
    Next 16 (conforme guia oficial); sem mudança de contrato da rota.
  - `apps/web/e2e/csp-nonce.spec.ts` — adicionar T-E-03/T-E-04.
  - `docs/backlog-seguranca-qualidade.md` — PP-SEC-013 fechado com escopo reduzido (só Next 16); novo
    item PP-SEC-017 para a parte Prisma/deepmerge-ts/effect.
- Arquivos que NÃO devem ser tocados: `apps/api/src/**` (nenhuma mudança de API), `apps/web/middleware.ts`
  não deve ser renomeado/movido para `proxy.ts`, `apps/web/tests/csp-nonce.test.tsx` não deve precisar
  mudar o caminho de import (se precisar, é sinal de que algo mudou fora do escopo — declarar desvio).
- DDL / migração: não aplicável.
- Contrato de API alterado: não aplicável.
- Dependências novas: `next@16.4.2` é bump de versão existente, não dependência nova — não é Q7. Nenhuma
  biblioteca nova sendo introduzida (bundle-analyzer já existe na versão compatível).

## Plano de testes

### Cobertura geral
- camadas obrigatórias: build, unitário (regressão), e2e
- arquivos de teste a criar/ajustar: `apps/web/e2e/csp-nonce.spec.ts` (estender)
- fixtures/mocks: reaproveitar `apps/web/e2e/fixtures/csp-inline.html` já existente

COBERTURA: regressão=3 corretude=2

### T-U-04 — suite unitária completa continua verde sob Next 16 (regressão)
Camada: build/integração
DADO `apps/web` migrado para Next 16
QUANDO `npm --prefix apps/web test` é executado
ENTÃO os 67 testes existentes (incluindo T-U-01/02/03 da PP-SEC-011 e os testes de CSP da PP-059) passam
sem alteração de comportamento — confirma que a migração não introduziu regressão [regressão]

### T-B-01 — build de produção conclui sob Next 16 com Turbopack (corretude)
Camada: build
DADO `apps/web` com `next@16.4.2`
QUANDO `npm run build --workspace apps-web` é executado
ENTÃO o build conclui com exit code 0 e gera `.next/standalone` (consistente com `output: "standalone"`
já configurado) — valor esperado (exit code, diretório gerado) verificado fora da própria execução do
build, por inspeção do sistema de arquivos após [corretude]

### T-E-03 — QRCode válido e inválido via /api/pix-qrcode (corretude)
Camada: e2e (Playwright)
DADO a aplicação rodando em build de produção sob Next 16
QUANDO `GET /api/pix-qrcode` é chamado com payload válido e, em outro caso, payload inválido
ENTÃO payload válido retorna um QRCode (conteúdo/formato verificado por decodificação independente da
resposta, não pela mesma lógica que gera o QR) e payload inválido retorna erro tratado (status e corpo
coerentes com o contrato já existente da rota) [corretude]

### T-E-04 — /admin/login hidrata com nonce correto sob Next 16 (regressão)
Camada: e2e (Playwright)
DADO a aplicação rodando em build de produção sob Next 16
QUANDO `/admin/login` é carregada
ENTÃO a página hidrata sem erro de console, o nonce dos scripts inline corresponde à política CSP emitida
no header da resposta — mesmo comportamento que T-E-01 já valida para `/`, estendido para a rota de login
[regressão]

### Cobertura de falhas silenciosas
- Build: falha de build não é silenciosa (exit code não-zero quebra o DoD); nenhuma ação adicional
  necessária.
- `[não aplicável — Spec não introduz formulário/cadastro/exclusão novo]` para as demais categorias.

### Comando para rodar a suite
`npm --prefix apps/web test && npm run build --workspace apps-web && npx playwright test apps/web/e2e/csp-nonce.spec.ts`

## Skills Codex a ativar — justificativa
- `security-review-agent`: obrigatória — migração de major toca middleware de segurança (CSP/nonce) e
  rota de API key (QRCode PIX).
- `e2e-playwright-agent`: obrigatória — só E2E real sob build de produção comprova que SameSite, bundler
  e runtime da CSP continuam corretos; unitário não cobre isso.

---

## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-10-17)

**Origem do item:** `docs/backlog-seguranca-qualidade.md` PP-SEC-013 — Alto, 0 crítica/5 altas/1 moderada
na auditoria de produção pós-PP-072 (revalidada 2026-10-08).

#### Estado atual (confirmado por execução real, não só pelo texto do backlog)

`npm audit --omit=dev` reexecutado nesta sessão (2026-10-17): **idêntico ao registrado** — 0 crítica,
5 altas, 1 moderada.

- `@prisma/config` (via `prisma`, instalado 6.19.2) — alto — depende de `deepmerge-ts`/`effect` vulneráveis.
- `deepmerge-ts` <8.0.0 — alto — stack exhaustion em merge de grafos recursivos.
- `effect` <3.20.0 — alto — `AsyncLocalStorage` contaminado entre fibers sob carga concorrente com RPC.
- `next` (moderada) e `postcss` (alto, 4 advisories agregados) — XSS/leitura de source map.

**Achado que muda o escopo do item original do backlog:** `npm audit fix --omit=dev --dry-run` mostra que
`deepmerge-ts` e `effect` têm fix **direto, sem major** (`fixAvailable: true`, sem `isSemVerMajor`) — a
correção desses dois, por transitividade, já resolve o alerta de `@prisma/config`/`prisma` sem precisar
atualizar o Prisma para a major 7/8. O texto original do backlog ("corrigíveis pelo audit apenas junto da
cadeia Prisma") estava impreciso — a causa real está em duas dependências transitivas pequenas, não no
próprio Prisma. Confirmado por `npm audit fix --dry-run` (sem alterar nada).

Só `next`→`postcss` exige major: `npm audit fix --force` indica `next@16.4.2` (`next` atual: `15.5.27`
em `apps/web/package.json` como `^15.1.6`). `isSemVerMajor: true` confirmado via `npm audit --json`.

#### Pré-requisitos já satisfeitos
- Node instalado: v24.13.0 — satisfaz `next@16.4.2` `engines.node: ">=20.9.0"`. Sem bloqueio de engine
  (distinto de PP-SEC-015, que é Node × Vitest, não Node × Next).

#### Superfície de risco da migração Next 16
- `apps/web/middleware.ts` — criado pela PP-059 (mergeada ontem, PR #67), implementa CSP com nonce por
  request. Middleware é API historicamente sensível a breaking changes entre majors do Next — qualquer
  regressão aqui reabriria a lacuna de CSP que a PP-059 fechou.
- `apps/web/next.config.js` — config simples (`output: "standalone"`, `redirects`, bundle analyzer) —
  baixo risco aparente, mas precisa confirmar compatibilidade de `@next/bundle-analyzer` com Next 16.
- `apps/web/app/api/pix-qrcode/route.ts` — route handler, usa `next/server` (mesmo padrão do middleware).
- Sem uso de `next/legacy`, `getInitialProps`, `_document` — reduz risco de breaking change de Pages
  Router (projeto é 100% App Router, confirmado por Grep sem matches).

#### O que fazer — ambiguidades identificadas

1. **[PENDENTE: dividir em 2 entregas (patch Prisma-transitivo + major Next) ou uma só?]**
   - A parte `deepmerge-ts`/`effect` é trivial, sem major, baixo risco, poderia ser feita isoladamente e
     rápido. A parte Next 16 é maior, toca middleware de segurança, exige validação mais extensa.
   - Precedente: PP-072 e PP-SEC-014 já trataram "parte simples agora, major complexo depois" como
     entregas separadas.

2. **[PENDENTE: timing da migração Next 16 — antes ou depois de outras entregas no mesmo app?]**
   - Nenhuma Spec concorrente tocando `apps/web` identificada nesta sessão. Sem bloqueio de timing
     conhecido, mas Leo pode ter contexto de calendário de evento/deploy que Claude não tem.

3. **[PENDENTE: profundidade de teste manual/E2E exigida antes do merge da major?]**
   - O projeto já tem `@playwright/test` instalado (ratificado na PP-059, Q7). Migração de framework
     merece pelo menos 1 smoke E2E cobrindo: página pública principal, `/admin/login` (CSP/nonce
     funcionando), e a rota `pix-qrcode`. Spec deve declarar isso como T-E obrigatório, não opcional.

4. **[PENDENTE: o que fazer com `@next/bundle-analyzer` e outras devDependencies atreladas à versão do Next?]**
   - Verificar se `@next/bundle-analyzer` tem versão compatível com Next 16 antes de travar a versão final.

#### Hipótese de impacto técnico (preliminar)

- **Parte 1 (patch, sem major):** `package-lock.json` (via `npm audit fix` sem force) — sem código tocado,
  sem DDL, sem mudança de contrato. Baixo risco.
- **Parte 2 (major Next 16):** `apps/web/package.json` (`next` e devDependencies atreladas), possíveis
  ajustes em `apps/web/next.config.js`, `apps/web/middleware.ts`, `apps/web/app/api/pix-qrcode/route.ts`
  conforme guia de migração oficial do Next 16 (a consultar na Rodada 2/3 — Claude ainda não leu o guia
  oficial de upgrade). Sem DDL. Sem mudança de contrato de API pública do projeto (é troca de framework
  interno do frontend, não do contrato HTTP exposto pela API NestJS).

### CAT — Rodada 2 (Codex) — 2026-10-17

Resposta transportada por Leo, verificada por Claude via Grep no histórico local do Codex (match em
`~/.codex/sessions/2026/10/17/rollout-2026-10-17T00-12-25-...jsonl`) — proveniência confirmada.

**Correção factual importante ao rascunho da Rodada 1:** o Codex reexecutou `npm audit`/dry-run e
confirmou que a leitura de Claude estava **errada** — `deepmerge-ts`/`effect` NÃO têm fix trivial sem
major. `@prisma/config@6.19.2` exige exatamente `deepmerge-ts@7.1.5` e `effect@3.18.4` como dependências
fixas (não um range flexível) — **confirmado por Claude** via `npm view @prisma/config@6.19.2 dependencies
--json`. Atualizar essas duas sub-dependências isoladamente exigiria um override cruzando major
(`deepmerge-ts` precisa ir a 8.x, `effect` a 3.20+) sem o próprio Prisma declarar suporte, o que não está
demonstrado como seguro. `npm audit --omit=dev` confirmado inalterado após o dry-run: 0/5/1 (crítica/
alta/moderada), idêntico ao estado antes de qualquer tentativa.

Posição por item:

1. **[RESOLVIDO] Separar entregas: sim, recomendado.** A parte Prisma (`deepmerge-ts`/`effect`) ainda não
   tem solução demonstrada como segura — não é "patch trivial" como o rascunho da Rodada 1 sugeria. Fica
   como item de pesquisa/acompanhamento (aguardar nova versão do Prisma que fixe essas sub-dependências),
   não como implementação imediata nesta Spec. A parte Next 16 é a única com plano de execução claro.

2. **[RESOLVIDO] Timing: depende da janela de Leo.** Tecnicamente as duas frentes são independentes.
   Migração do Next deve partir de uma base que já contenha a PP-059 (confirmado: `main` já tem o
   middleware CSP desde `e093de3`).

3. **[RESOLVIDO] E2E obrigatório.** Reaproveitar `apps/web/e2e/csp-nonce.spec.ts` (confirmado por Claude —
   já cobre nonce diferente entre requests e ausência de CSP em `/api/pix-qrcode`) e acrescentar: smoke de
   `/admin/login` sob Next 16, verificação de QRCode válido/inválido (hoje só testa ausência de CSP na
   rota, não o conteúdo do QR), e confirmação de hidratação sem erro de console.

4. **[RESOLVIDO] `@next/bundle-analyzer` já em `^16.3.5`** — confirmado por Claude em
   `apps/web/package.json:19`, compatível com Next 16. Decisão de bundler (Turbopack default vs. Webpack)
   precisa ser explícita na Spec — Next 16 usa Turbopack por padrão; se algum plugin depende de config
   Webpack, pode exigir `--webpack` ou ajuste.

**Pontos adicionais do Codex, verificados por Claude onde possível:**
- Migração `middleware` → `proxy` (muda runtime de Edge para Node.js) é uma decisão explícita do guia
  oficial do Next 16, não automática — precisa decisão na Spec: manter `middleware.ts` em Edge (opção
  ainda suportada) ou migrar para `proxy` em Node.js. Afeta os testes que importam `../middleware`
  diretamente (`apps/web/tests/csp-nonce.test.tsx`, confirmado por Claude que existe).
- Citação do Codex sobre `node:20-alpine` no Docker: **não confirmada por Claude** — busca em todo o
  repositório (`Dockerfile*`, `docker-compose.yml`, `scripts/`) não encontrou nenhuma referência a
  `node:20-alpine` nem a qualquer `Dockerfile`. Pode ser informação de outro projeto FloresTech ou
  desatualizada. Tratar como "verificar durante a Rodada 3/implementação", não como fato assumido.
- Inventariar acessos síncronos a APIs de request removidas no Next 16 — ainda não verificado por Claude
  nesta rodada; fica como item do impacto técnico da Spec final, a confirmar durante implementação.
- Ordem sugerida pelo Codex (baseline → resolução comprovada das dependências → migração → testes/build →
  E2E de produção → auditoria final) — adotada na Spec final, com a parte "dependências Prisma" removida
  do caminho crítico (ver item 1).

### CAT — Rodada 3 (Claude) — 2026-10-17

Resolução consolidada:

- Escopo desta Spec passa a ser **só a migração Next 16** (postcss/moderada + a alta de `postcss`
  propriamente). A parte `@prisma/config`/`deepmerge-ts`/`effect` (4 das 5 altas restantes) **não entra
  nesta Spec** — fica registrada no backlog como item de acompanhamento até o Prisma liberar uma versão
  que não force essas sub-dependências vulneráveis, sem mitigação segura disponível hoje.
- Sem DDL. Sem mudança de contrato de API pública (é troca de framework do frontend). Toca
  `apps/web/middleware.ts` (decisão explícita Edge-middleware vs. Node-proxy necessária), `apps/web/app/api/pix-qrcode/route.ts`,
  `apps/web/next.config.js`, `apps/web/package.json`.
- E2E obrigatório: estender `apps/web/e2e/csp-nonce.spec.ts` + novo smoke `/admin/login` + QRCode
  válido/inválido.
- Verificação de Docker/Node runtime de produção: a confirmar durante implementação (Codex), já que
  Claude não encontrou a referência citada neste repositório.

#### Itens [LEO DECIDE] — bloco consolidado

- **Separar em 2 itens de backlog:** confirmar — PP-SEC-013 vira só "migração Next 16 major"; renomear ou
  abrir um novo item (ex. PP-SEC-017) para "Prisma: aguardar correção upstream de deepmerge-ts/effect",
  sem Spec de implementação até existir solução segura?
- **Middleware CSP: manter em Edge (`middleware.ts`) ou migrar para `proxy` em Node.js** conforme o guia
  oficial do Next 16? Afeta runtime e os testes que importam `../middleware` diretamente.
- **Bundler: aceitar Turbopack (default do Next 16) ou forçar `--webpack`?** Depende de testar se
  `@next/bundle-analyzer` e o build atual funcionam sob Turbopack sem ajuste.
- **Timing:** executar já ou aguardar alguma janela específica de Leo (evento, deploy)?

#### Hipótese de impacto técnico final

- `apps/web/package.json` — `next` 15.5.27 → 16.4.2, devDependencies relacionadas.
- `apps/web/middleware.ts` ou novo `apps/web/proxy.ts` (conforme decisão Edge/Node) — ajuste de runtime,
  sem mudar a política CSP em si.
- `apps/web/next.config.js` — confirmar compatibilidade com Turbopack/Webpack conforme decisão de bundler.
- `apps/web/app/api/pix-qrcode/route.ts` — revisar uso de APIs de request síncronas descontinuadas.
- `apps/web/tests/csp-nonce.test.tsx` — ajustar import se middleware migrar para proxy.
- `apps/web/e2e/csp-nonce.spec.ts` — estender com novos cenários (login, QRCode).
- `docs/backlog-seguranca-qualidade.md` — PP-SEC-013 atualizado para refletir escopo reduzido; novo item
  para a parte Prisma pendente de upstream.

**Decisão de Leo (2026-10-17):**
- Dividir em 2 itens de backlog: PP-SEC-013 fica só "migração Next 16 major"; novo item para a parte
  Prisma (deepmerge-ts/effect), sem Spec até existir correção upstream segura.
- Middleware CSP permanece em Edge (`apps/web/middleware.ts`) — não migrar para `proxy`/Node.js nesta
  Spec.
- Bundler: tentar Turbopack (padrão do Next 16) primeiro; só cair para `--webpack` se houver
  incompatibilidade real confirmada durante a implementação.

### CAT — Fechamento (2026-10-17)

Rascunho aprovado por Leo (✅). Ciclo tripartite completo (3 rodadas), conforme exigido por mudança de
major de framework tocando middleware de segurança. Spec formal segue abaixo.

### Parecer — Rodada 1 (2026-10-17) — ✅ aprovado

PR #71, branch `fix/pp-sec-013-next-16-major`, commit topo `9ddaa78`, base `215acdd`.
Homologação independente por Claude em worktree isolada: `npm install`, `npm audit --omit=dev`
(0 crítica/4 altas/0 moderada, `next`/`postcss` saíram da lista), suite unitária 67/67, build verde com
`.next/standalone`, servidor de produção real (`.next/standalone` com assets estáticos copiados) e
suite E2E completa (T-E-01 a T-E-04, 4/4 passando, incluindo decodificador QR independente).

**Score:** ✅ 11 | ⚠️ 0 | ❌ 0 | Cobertura diff: 13/13 arquivos auditados.

**Confirmado fisicamente por Claude:** `apps/web/middleware.ts` permanece em Edge, `proxy.ts` não existe;
Turbopack é o bundler padrão do build, `--webpack` usado só para análise de bundle.

**Conclusão:** aprovado para merge.

### Merge confirmado (2026-10-17)

PR #71 mergeado em `main`, commit de merge `41d9c6d`. PP-SEC-013 fechada no escopo reduzido
(migração Next 16 major); parte Prisma permanece separada em PP-SEC-017. Não representa deploy de produção.
