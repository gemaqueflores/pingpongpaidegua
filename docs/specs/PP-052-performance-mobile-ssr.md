## SPEC ATIVA — PP-052 — v1
ID: PP-052 | Projeto: PingPong PaiD'egua | Branch: chore/pp-052-ssr-eficiencia
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — sem auth, query nova, input renderizado sem sanitização ou segredo
  tocado; é reestruturação de onde um fetch já existente acontece.
- e2e-playwright-agent: sim — RSC assíncrono não é testável via `renderToStaticMarkup`/RTL padrão
  (sem precedente no projeto); Playwright (precedente já existe da PP-050) é necessário para confirmar
  o resultado renderizado e a interatividade pós-migração.
- report-builder-agent: não — relatório padrão do orquestrador já cobre a granularidade necessária.

## Objetivo
Reduzir o LCP mobile de `/eficiencia`, medido em 5.413,1ms pela PP-048 (Lighthouse mobile), migrando o
fetch de dado inicial de client-side (`useEffect`, dispara só após o JS carregar) para Server Component
(fetch no servidor, HTML já chega com o conteúdo principal renderizado). Primeira de uma série de Specs
que atacam a causa raiz identificada na análise de frontend desta sessão: 100% das páginas de conteúdo
são `"use client"` com fetch em `useEffect`, sem aproveitar SSR/RSC do Next.js App Router.

## Contexto
Ciclo tripartite completo executado (Rodadas 1-3, `## HISTÓRICO` abaixo), com contraponto técnico
independente via agent `florestech-claude-cat-counterpoint` (Codex não disponível/autorizado nesta
sessão — Leo confirmou uso exclusivo de agents Claude, inclusive implementação, mesmo padrão da
PP-051). Escopo restrito a `/eficiencia` (não `/events/[id]` nem `/`) por recomendação do contraponto:
página mais simples do conjunto medido pela PP-048, menor risco de regressão, serve como prova de
conceito do padrão híbrido Server+Client Component antes de aplicá-lo a páginas mais complexas.

`apps/web/app/eficiencia/page.tsx` (138 linhas) lido por completo nesta sessão. Estrutura visual
confirmada contra print de produção fornecido por Leo: grid de cards por clube, cada um com nome,
pontuação (`totalPontuacao`) e badge de medalhas (🥇/🥈/🥉 + total via `formatClubMedalBadge`), botão
"Ver detalhes" navegando para `/eficiencia/[clubId]`.

Implementação via agent `florestech-claude-code-implementer` (paridade de autoridade com o Codex,
incluindo Git de escrita, decisão de Leo em 2026-09-18) — não o Codex.

## Causa raiz
- Causa imediata: `apps/web/app/eficiencia/page.tsx` é `"use client"` inteira; o fetch de
  `apiGetGlobalEfficiency` só dispara em `useEffect`, que só roda após o React hidratar no browser —
  o HTML inicial enviado pelo servidor não contém o conteúdo principal, forçando o navegador a esperar
  JS carregar + executar + fetch completar antes de mostrar qualquer dado, o que é o padrão que gera LCP
  alto em mobile (rede mais lenta, CPU mais fraca).
- Causa sistêmica: já registrada na análise de frontend desta sessão — o projeto adotou 100% client-side
  rendering para todas as páginas de conteúdo, aparentemente por padrão herdado de SPA, sem aproveitar
  RSC/SSR do Next.js App Router. Esta Spec é a primeira correção pontual; a causa sistêmica mais ampla
  (todas as páginas) é tratada por Specs futuras, uma por vez.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — HTML inicial contém a grid de clubes sem depender de JS**
DADO um usuário (ou `curl`) acessando `/eficiencia` sem executar JavaScript
QUANDO a resposta HTML do servidor é inspecionada
ENTÃO ela contém o nome, pontuação e badge de medalhas de pelo menos um clube real (o dado do ano
padrão "todos os eventos"), não um estado de loading/skeleton vazio.

**Cenário 2 — Troca de ano continua funcionando (Client Component)**
DADO a página carregada com o Server Component renderizando o ano padrão
QUANDO o usuário seleciona um ano específico no `<select>`
ENTÃO a lista de clubes é atualizada via fetch client-side normal (`apiGetGlobalEfficiency(year)`),
comportamento idêntico ao atual — sem regressão.

**Cenário 3 — Busca local continua funcionando (Client Component)**
DADO a lista de clubes já carregada (via SC ou após troca de ano)
QUANDO o usuário digita um termo no campo de busca
ENTÃO a lista é filtrada localmente (sem novo fetch), comportamento idêntico ao atual
(`useMemo` + `search.trim().toUpperCase()`).

**Cenário 4 — Navegação para detalhe do clube continua funcionando**
DADO a grid de clubes renderizada
QUANDO o usuário clica em "Ver detalhes" de um clube
ENTÃO navega para `/eficiencia/[clubId]` (via `router.push`), comportamento idêntico ao atual.

**Cenário 5 — Estados de loading/erro/vazio preservados no fluxo client-side**
DADO o Client Component reagindo a troca de ano
QUANDO a API está indisponível, ou o filtro de busca não encontra nenhum clube
ENTÃO `EfficiencyHubEmptyState` exibe "Serviço indisponível" ou "Nenhum clube encontrado" exatamente como
hoje — só o carregamento *inicial* (primeira renderização) deixa de depender desse fluxo, porque já vem
pronto do servidor.

**Cenário 6 — Cache não introduz dado desatualizado**
DADO o Server Component busca `apiGetGlobalEfficiency(undefined)` a cada request
QUANDO a mesma rota é acessada em momentos diferentes
ENTÃO o dado retornado é sempre fresco (sem cache indevido) — `cache: "no-store"` já presente na função
(`user-api.ts:414`) preservado, sem alteração.

## Critérios de aceitação
- `apps/web/app/eficiencia/page.tsx` deixa de ter `"use client"` no topo; vira Server Component
  assíncrono que busca `apiGetGlobalEfficiency(undefined)` e renderiza a grid inicial.
- Novo Client Component (ex. `apps/web/components/user/EfficiencyHubClient.tsx`) recebe a lista inicial
  via props e mantém: `selectedYear`, refetch por ano, `search`, filtro local, `router.push` do botão
  "Ver detalhes", e `EfficiencyHubEmptyState`.
- `curl http://localhost:3000/eficiencia` (sem executar JS) retorna HTML contendo nome de clube real e
  pontuação — verificável sem browser.
- Medição Lighthouse mobile (mesmo método/preset da PP-048) em `/eficiencia` mostra LCP reduzido em
  relação à baseline de 5.413,1ms — não é preciso atingir o limiar "bom" (≤2,5s) nesta Spec, mas deve
  haver melhora mensurável, registrada no relatório de entrega.
- `npm run build --workspace apps-web` verde.
- Suite de teste verde, incluindo T-E-01 (Playwright) confirmando Cenários 1-5.
- `cache: "no-store"` preservado no fetch usado pelo Server Component (Cenário 6).

## Fora de escopo
- `/events/[id]` e `/` (home) — Specs futuras, cada uma com seu próprio ciclo tripartite e medição.
- Qualquer mudança em `apiGetGlobalEfficiency` ou outro endpoint da API NestJS — contrato de API
  inalterado, só muda quem chama (servidor Next.js em vez de browser, no fetch inicial).
- Introduzir `revalidate`/ISR — mantém `cache: "no-store"` (SSR dinâmico, sem cache).
- Migrar rotas `admin/**` — usam auth via sessionStorage, fora do escopo desta Spec.
- Corrigir a ausência de `cache: "no-store"` em `apiGetAthletes` (risco declarado para quando
  `/events/[id]` for migrada em Spec futura — não é usado por `/eficiencia`, não bloqueia esta entrega).
- Confirmar `API_INTERNAL_URL` em produção (VM Oracle) — não verificável nesta sessão sem SSH; declarar
  no relatório de entrega como item para Leo confirmar antes do deploy real, não bloqueia a entrega local.

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/app/eficiencia/page.tsx` — remover `"use client"`, virar Server Component assíncrono
  - `apps/web/components/user/EfficiencyHubClient.tsx` (novo) — Client Component com toda a
    interatividade hoje em `page.tsx`
  - Teste Playwright novo em `apps/web/e2e/` (mesmo padrão da PP-050) cobrindo Cenários 1-5
- Arquivos que NÃO devem ser tocados:
  - `apps/web/lib/user-api.ts` (nenhuma função alterada, só consumida)
  - `apps/web/lib/auth.ts` (`getApiBase`/`getHeaders` já funcionam em SSR, sem adaptação necessária)
  - `apps/web/app/eficiencia/[clubId]/page.tsx` (rota de detalhe, fora de escopo)
  - `apps/web/app/user/events/[id]/page.tsx`, `apps/web/app/page.tsx` (fora de escopo desta Spec)
  - `apps/api/**`, `apps/worker/**`, `prisma/schema.prisma`
- DDL: não aplicável
- Contrato de API: não aplicável — mesmo endpoint, muda só o chamador
- Dependências novas: nenhuma

## Plano de testes
### Cobertura geral
- Camadas: integração leve (leitura de arquivo, para confirmar ausência de `"use client"` no SC) + e2e
  (Playwright, para o resto — RSC assíncrono não é testável via `renderToStaticMarkup`, conforme
  contraponto técnico da Rodada 2)
- Arquivos de teste a criar: 1 spec Playwright novo em `apps/web/e2e/`
- COBERTURA: regressão=4 corretude=2 — regressão via Cenários 2, 3, 4, 5 (interatividade que não deve
  mudar); corretude via Cenários 1 e 6 (HTML inicial contém dado real; cache não introduz staleness) —
  fonte independente: o próprio HTML retornado pelo servidor sem JS, e o comportamento de fetch já
  conhecido de `cache: "no-store"`, não a mesma função relida.

### T-I-01 — Server Component sem "use client"
Camada: integração leve (leitura de arquivo)
DADO: `apps/web/app/eficiencia/page.tsx` após a mudança
QUANDO: arquivo é lido
ENTÃO: não contém a diretiva `"use client"` no topo (confirma que virou Server Component).

### T-E-01 — HTML inicial contém dado real sem JS (Cenário 1)
Cenário: usuário/crawler acessa `/eficiencia` sem executar JavaScript
Passos: `fetch`/requisição HTTP direta a `http://localhost:3000/eficiencia` (sem Playwright/browser,
simulando ausência de JS)
Verificações: resposta contém nome de clube real (ex. "PARÁ CLUBE") e "Pontuação:" no HTML bruto.

### T-E-02 — Troca de ano, busca e navegação continuam funcionando (Cenários 2, 3, 4)
Cenário: usuário interage com a página após o carregamento inicial
Passos: Playwright navega para `/eficiencia`, aguarda carregamento, seleciona um ano no `<select>`,
digita um termo de busca, clica em "Ver detalhes" de um clube
Verificações: lista atualiza após troca de ano (novo fetch client-side); lista filtra sem novo fetch ao
buscar; navegação ocorre para `/eficiencia/[clubId]` correto.

### T-E-03 — Estados de erro/vazio preservados (Cenário 5)
Cenário: troca de ano retorna vazio ou API indisponível (simulado)
Passos: Playwright simula resposta vazia/erro da API para o fetch client-side de troca de ano
Verificações: `EmptyState` correspondente ("Serviço indisponível" ou "Nenhum clube encontrado") aparece.

### Cobertura de falhas silenciosas
- T-E-01 verifica o efeito real (dado presente no HTML bruto), não apenas HTTP 200 — a página podia
  retornar 200 e ainda mostrar só skeleton/loading se a migração para SC estivesse incompleta.
- T-E-02 verifica efeito real de cada interação (dado mudou, filtro aplicado, navegação ocorreu), não só
  que o evento de clique disparou.

### Comando para rodar a suite
```
npm run build --workspace apps-web
npx tsx --tsconfig apps/web/tsconfig.json --test apps/web/tests/*.test.tsx
npx tsx --tsconfig apps/web/tsconfig.json --test apps/web/e2e/*.spec.ts
```

Medição de performance (fora da suite de testes, parte do relatório de entrega):
```
docker compose --profile local-ui build frontend
docker compose --profile local-ui up -d --force-recreate frontend
npx lighthouse http://localhost:3000/eficiencia --form-factor=mobile --throttling-method=simulate --output=json
```
(mesmo preset/throttling documentado em `docs/sessions/2026-09-18-PP-048-web-vitals-relatorio.md`)

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-18)

Rascunho original com 3 itens (escopo de migração, autenticação, cache) e 3 `[PENDENTE]`. Candidatos
iniciais de páginas: `/events/[id]`, `/`, `/eficiencia` (nesta ordem por LCP medido). Item de caminho
`apps/web/app/user/eficiencia/page.tsx` listado por engano (é redirect vazio).

### CAT — Rodada 2 — Contraponto técnico (2026-09-18)

Executado via agent `florestech-claude-cat-counterpoint` (Codex não disponível/autorizado). Leitura
independente de `/events/[id]/page.tsx`, `/page.tsx`, `/eficiencia/page.tsx`, `auth.ts`, `user-api.ts`.

**Divergência corrigida:** caminho `apps/web/app/user/eficiencia/page.tsx` é redirect vazio, não a
página real (`apps/web/app/eficiencia/page.tsx`).

**Posição técnica:**
- Item 1 COMO: viável, mas em `/events/[id]` o dado inicial também decide `activeTab` client-side —
  migrar exige portar essa decisão para o servidor também, não só mover o fetch.
- Item 1 ONDE: recomendou inverter a ordem — começar por `/eficiencia` (menor risco, menos estado),
  não `/events/[id]` (maior risco, maior complexidade) — e fazer uma Spec por página, não as 3 juntas.
- Item 3: `cache: "no-store"` confirmado equivalente em RSC; alertou que `apiGetAthletes` não tem essa
  opção declarada — risco só relevante quando `/events/[id]` for migrada (Spec futura).
- Hipótese de impacto: reuso do método Lighthouse da PP-048 é viável; alertou sobre `API_INTERNAL_URL`
  em produção nunca ter sido exercitado (sem SSR até agora) — risco operacional a confirmar, não a
  assumir.

### CAT — Rodada 3 — Resolução (2026-09-18)

Todos os `[PENDENTE]` resolvidos com base no contraponto. Sem itens `[LEO DECIDE]` — todas as decisões
tinham resposta técnica objetiva. Escopo final: só `/eficiencia`, com a divisão exata Server/Client
Component confirmada após releitura completa do arquivo (138 linhas) e validação visual contra print de
produção fornecido por Leo (grid de clubes com pontuação e badge de medalhas, batendo exatamente com
`formatClubMedalBadge`/`totalPontuacao` do código-fonte).

Draft fechado por Leo (✅ explícito) em 2026-09-18. `## SPEC ATIVA` formada a partir deste histórico.
