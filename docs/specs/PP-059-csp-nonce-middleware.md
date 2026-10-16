# PP-059 — CSP com nonce por request (remoção de unsafe-inline em script-src)

<!-- Arquivo unificado v7: ## SPEC ATIVA + ## HISTÓRICO (CAT, pareceres, correções). -->
<!-- Origem: PEND-CBTM-002 (apps/web/next.config.js), registrada em appcbtmeventos/CLAUDE.md. -->

## SPEC ATIVA — PP-059 — v1
ID: PP-059 | Projeto: PingPong PaiD'egua | Branch: fix/pp-059-csp-nonce-middleware
Criada por: Claude | Data: 2026-09-22 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-09-22 | Escopo: CSP com nonce por request via middleware, escopo script-src, matcher exclui /api/pix-qrcode

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — a mudança é a própria correção de uma lacuna de CSP (PEND-CBTM-002); exige
  verificação de que a política final não introduz nova brecha (ex.: nonce vazando, matcher incorreto).
- e2e-playwright-agent: sim — precisa confirmar via browser real (não só build) que a página carrega com
  o nonce aplicado e que scripts inline sem nonce são de fato bloqueados; smoke exigido em Vercel e
  Docker/standalone conforme decisão de Leo (item 3 do CAT).
- report-builder-agent: não — relatório padrão do orquestrador cobre a granularidade necessária.

## Objetivo
Fechar PEND-CBTM-002: substituir a CSP estática de `apps/web/next.config.js` (`script-src 'self'
'unsafe-inline'`) por uma CSP com nonce único por request, gerado em `apps/web/middleware.ts`, removendo
`'unsafe-inline'` de `script-src`. Isso restaura a proteção efetiva da CSP contra XSS via script inline
para qualquer entrega futura que renderize conteúdo externo/dinâmico sem sanitização.

## Contexto
Ciclo tripartite completo (Rodadas 1-3, `## HISTÓRICO` abaixo), fechado e aprovado por Leo em
2026-09-19. Timing estava condicionado à conclusão do evento 4TMB26 (19-20/09/2026) — confirmado
concluído nesta sessão (2026-09-22; há inclusive auditoria pós-evento em andamento em paralelo, PP-063).
Reverificação física nesta sessão (2026-09-22): `apps/web/next.config.js` inalterado desde o CAT (CSP
estática nas linhas 10-21, bloco `headers()` nas linhas 25-37); `apps/web/middleware.ts` ainda não
existe; `apps/web/app/layout.tsx` (56 linhas, lido integralmente) usa apenas `style={tokenVars}` inline
(não afetado por `script-src`) e não contém `<script>`, `next/script` nem `dangerouslySetInnerHTML`;
Grep por esses três padrões em `apps/web/app/**` não retornou nenhum arquivo — confirma ausência de uso
de script inline em todo o app, consistente com o CAT.

## Causa raiz
- Causa imediata: `next.config.js` define CSP com `'unsafe-inline'` em `script-src`, que permite
  qualquer `<script>` inline executar independentemente de origem — anula a defesa da CSP contra XSS
  via injeção de script.
- Causa sistêmica: CSP foi definida de forma estática (única política para todas as rotas, sem nonce)
  na criação do projeto, sem mecanismo de nonce por request — padrão comum quando não há ainda
  necessidade de script inline legítimo, mas que deixa a política inerentemente fraca contra o vetor de
  XSS mais comum (script). Não é um padrão recorrente em outras Specs deste projeto (achado único).

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — CSP com nonce aplicada em rota de página**
DADO um usuário acessando qualquer rota HTML servida por `apps/web` (ex.: `/`, `/events/[id]`)
QUANDO a resposta é inspecionada
ENTÃO o header `Content-Security-Policy` contém `script-src 'self' 'nonce-<valor-por-request>'` (sem
`'unsafe-inline'`), e o valor do nonce muda a cada request.

**Cenário 2 — CSP estática antiga removida**
DADO o deploy desta Spec
QUANDO `apps/web/next.config.js` é inspecionado
ENTÃO o bloco `headers()` que emitia CSP estática foi removido — não há duas políticas CSP coexistindo
(evita a política mais restrita mascarar erro de configuração da outra).

**Cenário 3 — Rota de API excluída do middleware**
DADO uma request a `/api/pix-qrcode`
QUANDO o middleware de CSP/nonce é avaliado
ENTÃO a rota não passa pelo middleware (matcher explicitamente exclui `/api/pix-qrcode`) — sem header de
CSP por nonce nela, sem alteração de comportamento da rota de API.

**Cenário 4 — Build/deploy standalone (Docker/VM Oracle) funcional**
DADO `next build` com `output: "standalone"` (config já existente, `next.config.js:24`)
QUANDO a aplicação é iniciada a partir do build standalone
ENTÃO o middleware executa normalmente e a CSP com nonce é aplicada — validado por smoke manual
(comando + evidência no relatório do Codex), não apenas pela ausência de erro de build.

**Cenário 5 — Deploy Vercel funcional**
DADO o deploy em ambiente Vercel (Preview ou produção)
QUANDO a aplicação é acessada
ENTÃO a CSP com nonce é aplicada da mesma forma que em standalone — validado por smoke manual em
Preview antes do merge para produção.

## Critérios de aceitação
- `script-src` não contém `'unsafe-inline'` em nenhuma resposta HTML servida por `apps/web`.
- Nonce muda a cada request (duas requisições consecutivas à mesma rota têm valores de nonce distintos).
- `apps/web/next.config.js` não define mais CSP via `headers()` — única fonte de CSP é o middleware.
- `/api/pix-qrcode` não é interceptada pelo middleware (matcher explícito).
- Build `next build` com `output: standalone` continua verde.
- Smoke manual confirma renderização correta em Docker/standalone e em Vercel Preview.

## Fora de escopo
- `style-src 'unsafe-inline'` — permanece como está. Registrado separadamente como PEND-CBTM-002-B no
  CLAUDE.md do projeto (128 usos de `style={...}` inline em 24 arquivos, projeto maior, decisão de Leo
  no CAT).
- PP-052 (performance mobile/SSR de `/eficiencia`) — ordem já decidida no CAT: PP-059 primeiro; PP-052
  deve se adaptar ao cenário de renderização dinâmica introduzido por este middleware quando retomada.
- Qualquer página ou componente novo — esta Spec não adiciona funcionalidade, só substitui o mecanismo
  de emissão de CSP.

## Impacto técnico
- Modificar: `apps/web/next.config.js` — remover o bloco `headers()` (linhas 25-37) que emite a CSP
  estática; manter `contentSecurityPolicy`/`apiOrigin` só se ainda forem reaproveitados pelo middleware,
  caso contrário remover também.
- Criar: `apps/web/middleware.ts` — gera nonce por request (ex.: via `crypto.randomUUID()` ou
  equivalente), propaga `x-nonce` no request interno (para Server Components que precisem referenciar o
  nonce em algum script futuro) e emite `Content-Security-Policy` com nonce na resposta; `matcher`
  exclui explicitamente `/api/pix-qrcode`.
- Não tocar: `apps/web/app/**` — nenhuma página ou componente precisa mudar, dado que não há
  `<script>`/`next/script`/`dangerouslySetInnerHTML` hoje (confirmado por Grep nesta sessão). Se o
  Codex, durante a implementação, encontrar necessidade de tocar algum componente, deve declarar o
  desvio explicitamente — não é esperado pela Spec.
- Sem DDL, sem mudança de contrato de API pública (rotas de API do Next.js, se houver, não mudam
  contrato — só deixam de receber CSP por nonce quando no matcher de exclusão).

## Plano de testes

### Cobertura geral
COBERTURA: regressão=2 corretude=3
- camadas obrigatórias: unitário (middleware) + e2e (Playwright)
- arquivos de teste a criar: `apps/web/middleware.test.ts` (ou equivalente conforme convenção do
  projeto), `apps/web/e2e/csp-nonce.spec.ts` (ou dentro da suite Playwright já existente da PP-050)
- fixtures/mocks: `NextRequest`/`NextResponse` mockados para o teste unitário do middleware

### T-U-01 — Nonce gerado é único por request
Camada: middleware (função pura de geração/aplicação de nonce)
DADO: duas chamadas independentes ao middleware simulando dois requests distintos
QUANDO: o nonce de cada resposta é extraído do header `Content-Security-Policy`
ENTÃO: os dois valores de nonce são diferentes entre si (corretude — valor calculado comparado por
desigualdade, não por igualdade com mock fixo)

### T-U-02 — CSP não contém 'unsafe-inline' em script-src
Camada: middleware
DADO: uma chamada ao middleware para uma rota de página (ex.: `/`)
QUANDO: o header `Content-Security-Policy` da resposta é inspecionado
ENTÃO: a diretiva `script-src` contém `'self'` e `'nonce-<valor>'`, e não contém `'unsafe-inline'`
(corretude — string literal esperada calculada fora da função testada, hardcoded no teste)

### T-U-03 — Matcher exclui /api/pix-qrcode
Camada: middleware (config de matcher)
DADO: uma request para `/api/pix-qrcode`
QUANDO: o middleware é avaliado (ou a config de `matcher` é inspecionada diretamente)
ENTÃO: a rota não recebe o header `Content-Security-Policy` por nonce (regressão — comportamento da
rota de API permanece o mesmo de antes desta Spec, sem CSP por nonce)

### T-E-01 — Página renderiza corretamente com CSP por nonce (Playwright)
Cenário: usuário acessa `/` em ambiente com o middleware ativo
Passos: navegar até a home; aguardar carregamento completo
Verificações: página renderiza sem erros de console relacionados a CSP; nenhum script bloqueado
inesperadamente (não há script inline no app hoje, então nenhum bloqueio é esperado); header CSP
presente na resposta com nonce (regressão — página continua funcional como antes)

### T-E-02 — Script inline sem nonce é bloqueado (prova de efetividade da CSP)
Cenário: injetar via teste um `<script>` inline sem nonce numa página de teste isolada (fixture, não
página de produção) servida sob o mesmo middleware
Passos: navegar até a fixture; verificar console do browser
Verificações: o script inline sem nonce é bloqueado pela CSP (mensagem de violação no console) —
corretude: prova que `'unsafe-inline'` de fato não está mais presente, não apenas que a string não
aparece no header

### Cobertura de falhas silenciosas
- CSP mal configurada não gera erro de build nem de request — por isso T-U-02 e T-E-02 verificam o
  efeito real (bloqueio de script), não apenas a ausência da string `unsafe-inline` no header.
- Regressão de rota de API: T-U-03 confirma que `/api/pix-qrcode` não muda de comportamento.

### Smoke manual (fora do Red-Green automatizado, exigido antes do merge)
- Build `next build` com `output: standalone`, iniciar localmente, confirmar CSP com nonce em resposta
  real (`curl -I` ou DevTools).
- Deploy em Vercel Preview, confirmar CSP com nonce em resposta real do ambiente Vercel.
- Registrar ambos os smokes no relatório de entrega do Codex (comando + saída), rótulo `EXECUTADA`.

### Comando para rodar a suite
`npm --prefix apps/web test` (unitário) + `npm --prefix apps/web run test:e2e` (ou comando Playwright
equivalente já configurado no projeto pela PP-050 — confirmar nome exato do script antes de implementar)

---

## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-19, Claude)

**Contexto herdado (PEND-CBTM-002, `appcbtmeventos/CLAUDE.md`):**
`apps/web/next.config.js:10-21` define CSP estática com `script-src 'self' 'unsafe-inline'`. Isso anula a
proteção da CSP contra XSS via script inline. Não explorável hoje (sem `dangerouslySetInnerHTML`/`innerHTML`
no frontend, confirmado por leitura direta em 2026-08-28 e reconfirmado nesta sessão), mas é lacuna
defensiva latente: qualquer entrega futura que renderize conteúdo externo sem sanitização (dado CBTM
raspado, nome de atleta com HTML embutido) perde essa camada.

**Verificação física nesta sessão (2026-09-19):**
- Lido [next.config.js](apps/web/next.config.js) integralmente — confirma exatamente o texto acima, linha 12.
- Confirmado por Grep na sessão anterior (transportado): não há `<script>`, `next/script`,
  `dangerouslySetInnerHTML`, `middleware.ts` nem `proxy.ts` em `apps/web` hoje.

**Ambiguidades / O QUE / COMO / ONDE:**

- **[PENDENTE] Escopo do nonce** — remover `unsafe-inline` só de `script-src`, mantendo em `style-src`?
  128 usos de `style={...}` inline em 24 arquivos (contagem transportada da Rodada 2 técnica, não
  reexecutada fisicamente nesta sessão) tornam remoção de `style-src` um projeto muito maior. Proposta:
  escopo desta Spec é só `script-src` — `style-src` fica registrado como PEND-CBTM-002-B, fora de escopo.
- **[PENDENTE] Mecanismo** — gerar nonce por request via `middleware.ts` (Next 15 App Router), propagando
  `x-nonce` no request interno e emitindo a CSP com nonce na resposta, substituindo a CSP estática de
  `next.config.js`.
- **[PENDENTE] Impacto em renderização estática** — nonce por request exige que o layout raiz (e páginas que
  dependem dele) rendarizem dinamicamente. Isso remove otimização estática/ISR das páginas afetadas.
  Impacto de performance/latência ainda não medido neste projeto — relevante porque PP-052
  (`docs/specs/PP-052-performance-mobile-ssr.md`) já trata de performance mobile/SSR no mesmo `apps/web`.
  Risco de as duas Specs entrarem em rota de colisão (uma otimiza SSR, outra o torna obrigatório em mais
  páginas) precisa ser resolvido antes de implementar, não durante.
- **[PENDENTE] Compatibilidade com `output: standalone`** — a fonte técnica citada (documentação Next.js)
  afirma compatibilidade entre middleware e `output: standalone` para deploy Docker. Este projeto também
  publica em Vercel (produção documentada no repositório). Precisa de confirmação de que o comportamento é
  o mesmo nos dois ambientes de deploy antes de aprovar.
- **[PENDENTE] Rota `/api/pix-qrcode`** — precisa decisão explícita se o matcher do middleware inclui ou
  exclui essa rota da emissão de CSP por nonce.
- **[PENDENTE] Coexistência de CSP** — a CSP estática atual em `next.config.js` (`headers()`) precisa ser
  removida no mesmo commit que introduz a CSP por middleware, para não haver duas políticas conflitantes
  (o navegador aplica a mais restritiva das duas, o que pode mascarar erro de configuração em vez de
  expor).

**Hipótese de impacto técnico (preliminar, sujeita à Rodada 3):**
- Modificar: `apps/web/next.config.js` (remover bloco `headers()` de CSP), criar `apps/web/middleware.ts`.
- Não tocar: `apps/web/app/**` (nenhuma página deveria precisar de mudança se o nonce for injetado só via
  header/middleware — a confirmar na Rodada 2/3 se algum componente precisa ler `x-nonce` explicitamente
  para tags de script que hoje dependam de inline).
- Sem DDL, sem mudança de contrato de API pública.

### CAT — Rodada 2 (2026-09-19) — resposta técnica

<!-- Conteúdo recebido nesta sessão via texto colado, atribuído a rodada técnica anterior.
     Proveniência não verificada por Grep em sessão local nesta janela — tratado pelo mérito,
     confrontado com leitura direta do código, não aceito por alegação de autoria. -->

Constatações trazidas para esta rodada:

- CSP vulnerável confirmada em `next.config.js:10` (bate com Rodada 1).
- Ausência de `<script>`, `next/script`, `dangerouslySetInnerHTML`, nonce, `middleware.ts` ou `proxy.ts`
  hoje — confirma Rodada 1.
- 128 usos de `style={...}` em 24 arquivos — não reverificado fisicamente nesta sessão; tratar como
  estimativa a confirmar por Grep antes de decidir escopo de `style-src` (fora do escopo desta Spec,
  ver PENDENTE acima).
- Implementação sugerida: `apps/web/middleware.ts`, gerando nonce por request, propagando `x-nonce` e a
  CSP tanto no request interno quanto na resposta.
- Layout raiz precisa de renderização dinâmica — elimina otimização estática/ISR; referências à
  documentação oficial Next.js 15 (CSP/nonces) e `output: standalone` citadas como fonte, não verificadas
  nesta sessão por WebFetch.
- CSP estática de `next.config.js` não deve coexistir com CSP por request — concorda com Rodada 1.
- Matcher precisa decidir explicitamente sobre `/api/pix-qrcode`.
- Produção documentada como Vercel — próxima Spec deve exigir smoke de nonce em Preview e produção, não
  só build/standalone.
- Apontada colisão de numeração com PP-058 — corrigida nesta gravação (arquivo passa a ser PP-059).

**Itens que a Rodada 2 não resolveu (seguem [PENDENTE] para Rodada 3):**
Nenhum item foi de fato resolvido/decidido — a Rodada 2 trouxe constatações técnicas e uma sugestão de
implementação, mas não fechou os pontos de decisão de escopo (`style-src` fora/dentro, `/api/pix-qrcode`
dentro/fora do matcher, ordem de execução vs. PP-052, ambiente de smoke test).

---

## [LEO DECIDE] — resolvido em 2026-09-19

1. **Escopo `style-src`** — **[RESOLVIDO: fora desta Spec]**. PP-059 cobre só `script-src`.
   `PEND-CBTM-002-B` (style-src, 128 usos inline em 24 arquivos) fica registrada separadamente no
   CLAUDE.md do projeto como pendência futura, sem Spec própria ainda.
2. **Ordem vs. PP-052** — **[RESOLVIDO: PP-059 primeiro, depois PP-052]**. Resolve a lacuna de
   segurança antes; PP-052 (performance mobile/SSR) deve se adaptar ao cenário já dinâmico (páginas
   sob o middleware de nonce) quando for formulada/retomada.
3. **Ambientes de deploy** — **[RESOLVIDO: ambos]**. Spec formal exige validação em Vercel (produção)
   e Docker/standalone (VM Oracle) antes do merge — smoke de nonce nos dois ambientes.
4. **`/api/pix-qrcode`** — **[RESOLVIDO: excluído do matcher]**. Rota de API não serve HTML/script;
   nonce de CSP não se aplica, reduz superfície tocada pelo middleware.
5. **Timing** — **[RESOLVIDO: adiar para depois do 4tmb26]**. Mesmo racional do PEND-CBTM-006 —
   evitar mudança de infraestrutura de rendering perto de evento ao vivo.

### CAT — Rodada 3 (2026-09-19, Claude) — fechamento

Todos os itens `[LEO DECIDE]` resolvidos acima. Rascunho pronto para virar `## SPEC ATIVA` formal —
**mas a formalização e a implementação ficam paradas até o evento 4tmb26 concluir** (item 5). Não abrir
`## SPEC ATIVA` nem transportar ao Codex para implementação antes dessa liberação.

Hipótese de impacto técnico (Rodada 1) permanece válida e já reflete as decisões acima: modificar
`apps/web/next.config.js` (remover `headers()` de CSP) + criar `apps/web/middleware.ts`; matcher exclui
`/api/pix-qrcode`; escopo só `script-src`.

**Estado do ciclo:** CAT concluído e aprovado por Leo (2026-09-19). Aguardando sinal de "4tmb26
concluído" para abrir `## SPEC ATIVA` e seguir o fluxo normal (aprovação → Codex implementa).

---

## Estado desta sessão (2026-09-19)

- PEND-CBTM-006: decisão de Leo — adiar avaliação de migração Next 16 (residual `postcss` alto) para após
  o evento 4tmb26. Worktree `appcbtmeventos-worktrees/pend-cbtm-006-web-audit` mantida como está, sem
  commit, com `package-lock.json` modificado (correções sem major já aplicadas: `next@15.5.25`,
  `nanoid@3.3.19`, `sharp@0.35.4`). Nenhuma ação adicional nesta sessão.
- PEND-CBTM-002 / PP-059: CAT formalizado neste arquivo (Rodada 1 + Rodada 2). Aguarda [LEO DECIDE] acima
  antes de Rodada 3 (resolução) e fechamento do ciclo tripartite.
