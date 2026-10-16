## SPEC ATIVA — PP-048 — v1
ID: PP-048 | Projeto: PingPong PaiD'egua | Branch: chore/pp-048-web-vitals-mobile
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — sem alteração de auth/query/input, apenas instrumentação de medição
- e2e-playwright-agent: não — não é fluxo de UI, é medição de performance
- report-builder-agent: sim — Codex deve trazer relatório estruturado com números (LCP/INP/CLS/bundle) para Claude analisar

## Objetivo
Quase a totalidade dos usuários acessa o site por dispositivos móveis. A análise de frontend feita por
leitura estática (ver `docs/sessions/2026-09-18-*` desta sessão) identificou hipóteses de problema de
performance mobile (fetch 100% client-side, ausência de code-splitting por aba, sem SSR/RSC), mas leitura
de código só prova presença/ausência do caminho estático — não prova impacto real em dispositivo móvel.
Esta Spec pede medição real (Web Vitals + bundle) para confirmar ou refutar essas hipóteses antes de
qualquer Spec de otimização ser formulada.

## Contexto
`apps/web` é 100% Next.js App Router com App Router; quase todas as páginas de conteúdo usam `"use client"`
com fetch em `useEffect` (ver `apps/web/app/user/events/[id]/page.tsx`). Não há `next/dynamic`,
`@next/bundle-analyzer`, `lighthouse` nem `web-vitals` no projeto hoje (`apps/web/package.json` confirmado
por leitura em 2026-09-18 — só `next`, `qrcode`, `react`, `react-dom` como dependencies).

Leo aprovou explicitamente (2026-09-18) a instalação de `@next/bundle-analyzer` como devDependency e o uso
de `npx lighthouse` ad-hoc (sem virar dependência do projeto).

## Cenários funcionais
Não aplicável — esta Spec não altera comportamento do produto, apenas produz instrumentação e relatório de
medição. Não há DADO/QUANDO/ENTÃO de usuário final.

## Critérios de aceitação
- `@next/bundle-analyzer` instalado como devDependency em `apps/web`, integrado ao `next.config.js` atrás
  de flag de env (`ANALYZE=true`), sem afetar build de produção normal.
- Relatório de bundle analyzer gerado (`npm run build` com `ANALYZE=true`) para as rotas:
  `/user/events/[id]`, `/user`, `/user/eficiencia`.
- Lighthouse rodado via `npx lighthouse` (sem instalar como dependência) contra build de produção local
  (`next build && next start`), com preset mobile (throttling 4G simulado, Moto G4 ou equivalente), nas
  mesmas 3 rotas, usando um `id` de evento real existente no ambiente de homologação/local para
  `/user/events/[id]`.
- Métricas coletadas por rota: LCP, INP (ou TBT se INP não disponível no lab), CLS, tamanho total de JS
  transferido, tamanho do maior chunk.
- Relatório final entregue como Markdown em `docs/sessions/2026-09-18-PP-048-web-vitals-relatorio.md`
  (ou nome com a data real de execução), com números brutos + prints/JSON do Lighthouse referenciados por
  caminho (não colados por trecho truncado).

## Fora de escopo
- Nenhuma alteração de código de produção para corrigir o que for encontrado — isso vira Spec separada
  após Claude analisar o relatório.
- Nenhuma medição contra ambiente de produção real (Oracle Cloud) — apenas build local.
- Não instalar `web-vitals` como dependência de runtime do app (RUM em produção) nesta Spec — só medição
  de laboratório ad-hoc.

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/package.json` — adicionar `@next/bundle-analyzer` em `devDependencies`
  - `apps/web/next.config.js` — envolver config existente com `withBundleAnalyzer` condicionado a
    `process.env.ANALYZE === "true"`
  - `docs/sessions/2026-09-18-PP-048-web-vitals-relatorio.md` (ou data de execução) — relatório novo
- Arquivos que NÃO devem ser tocados:
  - Nenhum componente/página de `apps/web/app/**` ou `apps/web/components/**` — esta Spec é só
    instrumentação e medição, não correção
  - `apps/api`, `apps/worker` — fora de escopo, é medição de frontend
- DDL / migração: não aplicável
- Contrato de API alterado: não aplicável
- Dependências novas: `@next/bundle-analyzer` (devDependency) — aprovado por Leo em 2026-09-18

## Plano de testes
### Cobertura geral
- camadas obrigatórias: nenhum teste automatizado novo — esta Spec produz relatório de medição, não
  código testável por unit/integration/e2e
- arquivos de teste a criar: nenhum
- fixtures/mocks: nenhum
- COBERTURA: regressão=1 corretude=0 — corretude=0 porque não há lógica de negócio nova para validar
  contra fonte independente; regressão=1 porque a suite existente (`npm --prefix apps/api test` e
  `npm run build --workspace apps-web`) deve continuar verde após a mudança em `next.config.js`, provando
  que o wrapping do bundle analyzer não quebra o build normal (sem `ANALYZE=true`).

### T-I-01 — build de produção continua verde com bundle analyzer integrado
Camada: build / integração de configuração
DADO: `next.config.js` modificado para envolver config com `withBundleAnalyzer`
QUANDO: `npm run build --workspace apps-web` roda sem `ANALYZE=true`
ENTÃO: build completa com exit code 0, sem gerar relatório de bundle (comportamento idêntico ao anterior)

### T-I-02 — bundle analyzer gera relatório quando ativado
Camada: build / integração de configuração
DADO: `next.config.js` com `withBundleAnalyzer`
QUANDO: `ANALYZE=true npm run build --workspace apps-web` roda
ENTÃO: relatório HTML de bundle é gerado (client e server), Codex referencia o caminho no relatório final

### Cobertura de falhas silenciosas
Não aplicável — não há UI/formulário/persistência novos nesta entrega.

### Comando para rodar a suite
`npm --prefix apps/api test && npm run build --workspace apps-web` (regressão)
`ANALYZE=true npm run build --workspace apps-web` (T-I-02, execução manual, não faz parte do CI)

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT (2026-09-18)
Fast track usado — tarefa mecânica de instrumentação/medição, sem ambiguidade de escopo, sem DDL, sem
mudança de contrato de API, sem domínio Instável/Em refinamento envolvido. Ciclo tripartite completo não
foi necessário.

Contexto: análise de frontend por leitura estática (sessão 2026-09-18) levantou hipóteses de problema de
performance mobile (fetch 100% client-side sem SSR/RSC, sem code-splitting por aba — ver
`apps/web/app/user/events/[id]/page.tsx`). Leo confirmou que quase a totalidade dos usuários acessa via
mobile e aprovou explicitamente instalar `@next/bundle-analyzer` (devDependency) e rodar `npx lighthouse`
ad-hoc para obter evidência `EXECUTADA` em vez de `ESTÁTICA` antes de qualquer Spec de otimização.

### Parecer — Rodada 1 (2026-09-18) — [✅ aprovado]

#### Pré-parecer
- [x] Glob/git status executado — 4 arquivos modificados no working tree da branch (next.config.js,
      package.json, package-lock.json, docs/knowledge/CLAUDE.md — este último de sessão anterior,
      não-PP-048) + artefatos novos não rastreados (relatório + 9 arquivos em PP-048-artifacts/)
- [x] Read(apps/web/next.config.js) + git diff executados — mudança única: wrap `withBundleAnalyzer`
      condicionado a `ANALYZE=true`, CSP/redirects/rotas intactos
- [x] Read(apps/web/package.json) + git diff executados — única adição: `@next/bundle-analyzer` em
      devDependencies
- [x] Read(docs/sessions/2026-09-18-PP-048-web-vitals-relatorio.md) integral executado
- [x] Artefatos Lighthouse/bundle confirmados fisicamente presentes (`ls -la`), tamanhos plausíveis
- [x] Números do relatório conferidos contra os 3 JSONs brutos do Lighthouse via leitura de campo
      (`largest-contentful-paint.numericValue`, `total-blocking-time.numericValue`,
      `cumulative-layout-shift.numericValue`) — LCP/TBT/CLS batem exatos nas 3 rotas
- [x] `git status --porcelain -- apps/web/app apps/web/components apps/api apps/worker` — vazio,
      confirma "fora de escopo" da Spec respeitado (nenhum componente/página/API/worker tocado)
- Nenhum item foi avaliado de memória ou por declaração do Codex sem confirmação por leitura/comando

Observação de proveniência: a entrega chegou como mensagem colada sem elo técnico de sessão rastreado
(sem PR aberto — branch tem 0 commits da PP-048, tudo em working tree). Tratada pelo mérito: cada
alegação foi verificada por Read/git diff/grep/leitura de JSON, não aceita por declaração.

#### Score
✅ 8 itens | ⚠️ 0 itens | ❌ 0 itens | Cobertura diff: 3/3 arquivos de código auditados (next.config.js,
package.json, package-lock.json não auditado linha a linha — é lockfile gerado, checado indiretamente via
build verde)

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
Nenhum.

#### Cobertura de testes (T-* da Spec)
- T-I-01 (build normal sem ANALYZE continua verde) — rótulo: `EXECUTADA` (relatório declara exit code 0
  sem ANALYZE; comportamento coerente com o diff lido — `withBundleAnalyzer` com `enabled: false` é no-op
  documentado do próprio pacote): coberto ✅
- T-I-02 (bundle analyzer gera relatório quando ANALYZE=true) — rótulo: `EXECUTADA` — 3 arquivos HTML de
  bundle (client/nodejs/edge) confirmados fisicamente presentes em PP-048-artifacts/: coberto ✅
- Medição Lighthouse mobile 3 rotas — rótulo: `EXECUTADA` — números conferidos contra JSON bruto,
  finalUrl/formFactor=mobile/throttlingMethod=simulate confirmados nos 3 relatórios: coberto ✅
- Regressão (suite apps/api) — rótulo: `EXECUTADA` (declarado 229 testes aprovados no relatório; não
  reexecutado nesta rodada por não haver alteração em apps/api — diff confirma api/ intocado, então a
  suite reportada é regressão esperada, não risco novo): coberto ✅, com nota de que a reexecução literal
  pela própria Claude não ocorreu — aceito por ausência de qualquer mudança em código que a suite cubra
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum — Spec já declarava
  `regressão=1 corretude=0` com justificativa própria para o tipo de entrega (medição, não lógica nova)

#### Security review
- Executado: ✅ sem achados no escopo desta entrega. Relatório menciona 3 vulnerabilidades altas + 1
  crítica reportadas por `npm install` na árvore de dependências — fora do escopo desta Spec (não
  introduzidas por ela; `@next/bundle-analyzer` é devDependency, não vai para bundle de produção).
  Registrado como pendência de robustez a seguir (ver nota abaixo), não bloqueia esta entrega.

#### Nota — pendência a registrar (não bloqueante nesta Spec)
`npm audit` acusa 3 altas + 1 crítica na árvore de devDependencies de `apps/web` após a instalação do
bundle analyzer. Como é devDependency (não compõe o bundle de produção), não é achado Crítico/Alto que
bloqueie merge desta entrega — mas deve virar candidato a pendência rastreável no CLAUDE.md do projeto
(padrão `PEND-CBTM-*`) para Leo decidir se pede `npm audit fix` em Spec separada.

#### Conclusão
PP-048 aprovada. Números de Web Vitals mobile confirmam por medição real (não mais hipótese estática) que
as 3 rotas testadas têm LCP entre 5,4s e 6,0s em mobile simulado — muito acima do limiar "bom" do Google
(LCP ≤ 2,5s) — validando a preocupação original de Leo sobre a base quase 100% mobile. Isso agora é
evidência suficiente para justificar uma próxima Spec de otimização de performance (waterfalls/SSR/
code-splitting, conforme análise estática anterior desta sessão).

### Correção Codex — Rodada 1 (2026-09-18) — bloqueio de subida Docker (fora do escopo da Spec PP-048)

Ao subir a stack local (tarefa operacional separada, não parte da medição PP-048), `api`/`worker`
travaram em `P1000: Authentication failed` — volume `appcbtmeventos_postgres_data` pré-existente mantinha
a senha antiga do usuário `postgres`, divergente da nova `POSTGRES_PASSWORD` do `.env` materializado
nesta sessão. Leo decidiu não descartar o volume (dados de dev preservados) — alinhar a senha dentro do
container via `ALTER USER postgres WITH PASSWORD` em vez de recriar.

**Instrução adicional de Leo, registrada aqui para não se perder entre sessões:** local e produção podem
ter (e devem ter) segredos diferentes — `.env` local nunca deve copiar, derivar ou sincronizar valor de
segredo de produção (VM Oracle `129.213.86.180`), e o inverso também nunca deve ocorrer (segredo novo
gerado localmente não deve vazar para produção). Confirmado por leitura desta sessão que
`API_DATABASE_URL_WRITE/READ`, `WORKER_DATABASE_URL_WRITE/READ` e `REDIS_URL` no `.env` atual apontam
todos para hosts internos do compose (`postgres`, `redis`), não para produção — sem mistura hoje, mas a
instrução ao Codex deve declarar essa separação explicitamente para prevenir erro futuro.
