## SPEC ATIVA — PP-051 — v1
ID: PP-051 | Projeto: PingPong PaiD'egua | Branch: chore/pp-051-consolidacao-design-tokens
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é CSS/apresentação pura, sem auth, query, input renderizado,
  upload ou segredo tocado.
- e2e-playwright-agent: não — a suíte Playwright criada na PP-050 não é o nível de teste adequado aqui
  (ver Plano de testes); reuso de `ui-snapshots.test.tsx` (renderToStaticMarkup) é suficiente.
- report-builder-agent: não — relatório padrão do orquestrador já cobre a granularidade necessária.

## Objetivo
Consolidar inconsistências reais de CSS/design tokens identificadas em auditoria visual completa de
`apps/web/app/globals.css`, sem alterar a paleta de cor base nem a identidade visual do produto — é
limpeza estrutural, não redesign. Reduz risco de manutenção (dois sistemas de token paralelos, CSS morto,
duplicação de blocos idênticos) e melhora consistência de apresentação (tratamento de números, paleta de
medalha unificada).

## Contexto
Auditoria completa de `globals.css` (3461 linhas) executada por um agent Explore desta sessão, com
verificação independente por amostragem (grep próprio confirmando ausência de uso das variáveis/classes
apontadas como mortas). Ciclo tripartite completo executado: Rodada 1 (rascunho, `## HISTÓRICO` abaixo),
Rodada 2 (contraponto técnico independente via agent `florestech-claude-cat-counterpoint`, sem Codex
disponível nesta sessão — Leo autorizou explicitamente uso exclusivo de agents Claude, inclusive para
implementação), Rodada 3 (resolução). Duas decisões de produto/design levadas a Leo e já resolvidas: 
`.container` duplicado mantém comportamento visual atual (não é mudança de layout); paleta de medalha
`eff-row-*` prevalece sobre `classification-row-*`.

Implementação desta Spec via agent `florestech-claude-code-implementer` (paridade de autoridade com o
Codex, incluindo Git de escrita, decisão de Leo em 2026-09-18) — não o Codex.

## Causa raiz
- Causa imediata: `globals.css` acumulou um segundo bloco `:root` ("Responsive system foundation",
  linhas 3365-3386) que redeclara conceitos já existentes no `:root` oficial (linhas 1-25) com hex
  hardcoded, provavelmente de uma tentativa de refatoração de responsividade que nunca foi integrada ao
  sistema de tokens original (`designTokens.ts`). Duplicação de vocabulário de medalha
  (`eff-row-*`/`classification-row-*`) sugere duas implementações independentes do mesmo conceito visual
  em momentos distintos, sem reuso.
- Causa sistêmica: ausência de revisão periódica de CSS morto/duplicado no projeto — não há processo hoje
  que capture esse tipo de drift estrutural antes que ele se acumule. Não gera candidato a regra de
  contrato nesta Spec (é a primeira ocorrência formal documentada), mas fica registrado como padrão a
  observar se recorrer.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Token único, sem paralelo morto**
DADO `globals.css` com dois blocos `:root` (oficial e duplicado)
QUANDO o bloco duplicado (3365-3386) é removido e o único uso real (`--radius-1` em `.event-empty-state`)
migra para o token oficial equivalente
ENTÃO existe um único bloco `:root` de tokens; nenhuma variável CSS sem uso localizável por `grep var(--`.

**Cenário 2 — `.container` sem duplicação, comportamento visual idêntico**
DADO `.container` declarado duas vezes (linhas 48-52 com padding 24px, morta por cascata; linhas 3388+
com padding responsivo 16px, vencedora hoje)
QUANDO a primeira declaração é removida
ENTÃO existe uma única declaração de `.container`; o padding renderizado em qualquer viewport é idêntico
ao estado anterior à mudança (Cenário de regressão, não de mudança visual).

**Cenário 3 — Números de destaque com tabular-nums consistente**
DADO ~10 seletores que exibem placar/contagem/pontuação/ranking sem `font-variant-numeric: tabular-nums`
QUANDO a propriedade é adicionada a cada um deles
ENTÃO todo número de destaque do produto usa a mesma técnica de alinhamento de dígito; peso/tamanho de
cada seletor permanece o que já era (não uniformizado entre contextos, por design).

**Cenário 4 — Barras de medalha sem duplicação estrutural**
DADO `.career-medal-bar-track`/`.club-medal-bar-track` e `.career-medal-bar-fill.*`/`.club-medal-bar-fill.*`
como blocos CSS idênticos duplicados
QUANDO os seletores são combinados (vírgula) em uma única regra
ENTÃO o CSS gerado é idêntico ao anterior; renderização de `ClubEfficiencyCareerPanel` e
`AthleteSummaryCard` sem mudança visual.

**Cenário 5 — Paleta de medalha unificada nas linhas de tabela**
DADO `.classification-row-ouro/prata/bronze` com valores RGB distintos de `.eff-row-gold/silver/bronze`
QUANDO os valores de `.classification-row-*` são substituídos pelos valores de `.eff-row-*`
ENTÃO a página de carreira do atleta (`/user/career/[athleteKey]`) passa a exibir as mesmas cores de
medalha que a página de evento (`/user/events/[id]`); nenhum `.tsx` é alterado (só valor de cor no CSS).

**Cenário 6 — CSS morto removido sem regressão de renderização**
DADO `.home-club-medal-legend`, `.athlete-summary-head` (e filhos), `.athlete-summary-share` sem nenhuma
referência em `.tsx` do projeto (confirmado por grep)
QUANDO as regras são removidas de `globals.css`
ENTÃO build e suíte de testes existente continuam verdes; nenhuma página renderiza de forma diferente
(essas classes nunca eram aplicadas a nenhum elemento).

## Critérios de aceitação
- Um único bloco `:root` de tokens em `globals.css`; grep por `var(--radius-2`, `var(--radius-3`,
  `var(--space-1` a `var(--space-6`, `var(--muted-2` retorna vazio (variáveis removidas, não só sem uso).
- `.container` com uma única declaração no arquivo.
- `font-variant-numeric: tabular-nums` presente nos ~10 seletores listados no Item 2 do histórico, além
  dos 3 que já tinham.
- `.career-medal-bar-*`/`.club-medal-bar-*` unificados via seletor combinado, sem duplicação de bloco.
- `.classification-row-ouro/prata/bronze` com os mesmos valores RGB de `.eff-row-gold/silver/bronze`.
- `.home-club-medal-legend`, `.athlete-summary-head` (e filhos), `.athlete-summary-share` removidos de
  `globals.css`.
- `npm run build --workspace apps-web` verde.
- `npm test --workspace apps-web` (ou equivalente) verde, incluindo os T-* novos descritos no Plano de
  testes.
- Nenhum arquivo `.tsx` alterado — confirmar via `git diff --stat` restrito a `apps/web/app/globals.css`
  e `apps/web/tests/ui-snapshots.test.tsx` apenas.

## Fora de escopo
- Redesign de paleta, tipografia ou layout — esta Spec é consolidação/limpeza, não a proposta de direção
  visual mais ampla discutida antes do ciclo tripartite (essa fica para Spec futura, se Leo confirmar
  seguir adiante após ver o resultado desta consolidação).
- Renomear className em qualquer `.tsx` — decisão de Leo foi manter os nomes semânticos existentes.
- Alterar padding/layout perceptível de `.container` — decisão de Leo foi manter comportamento atual.
- Criar suíte de teste de regressão visual (screenshot/pixel) — fora do escopo, usa-se o precedente já
  existente (`ui-snapshots.test.tsx`).
- Qualquer mudança em `apps/api`, `apps/worker`, `prisma/schema.prisma`.
- Item "revisão de cor do `.card` principal" (`box-shadow: rgba(1,110,97,...)`, tom que não bate com
  nenhum token atual) — observação da auditoria original, não entrou no escopo aprovado por Leo; registrar
  como candidato a Spec futura se relevante.

## Impacto técnico
- Arquivos a criar/modificar:
  - `apps/web/app/globals.css` — único arquivo de produção tocado (Cenários 1-6)
  - `apps/web/tests/ui-snapshots.test.tsx` — estendido com T-* novos (ver Plano de testes)
- Arquivos que NÃO devem ser tocados:
  - `apps/web/components/user/ClubEfficiencyCareerPanel.tsx`
  - `apps/web/components/career/AthleteSummaryCard.tsx`
  - `apps/web/app/user/career/[athleteKey]/page.tsx`
  - `apps/web/app/user/events/[id]/page.tsx`
  - `apps/web/lib/designTokens.ts` (fonte de token React não muda — só o CSS solto duplicado é removido)
  - `apps/api/**`, `apps/worker/**`, `prisma/schema.prisma`
- DDL: não aplicável
- Contrato de API: não aplicável
- Dependências novas: nenhuma

## Plano de testes
### Cobertura geral
- Camada: componente (via `renderToStaticMarkup`, técnica já usada em `ui-snapshots.test.tsx`)
- Arquivo de teste a modificar: `apps/web/tests/ui-snapshots.test.tsx` (estender, não criar novo arquivo)
- COBERTURA: regressão=4 corretude=2 — regressão via Cenários 2, 4, 6 (comportamento/estrutura que não
  deve mudar) mais suíte completa do projeto continuando verde; corretude via Cenários 3 e 5 (propriedade
  nova presente, valor de cor migrado — verificável por fonte independente: o próprio valor esperado
  declarado nesta Spec, não a mesma regra CSS relida). Item 1 (remoção de token morto) não gera T-* Red-
  Green — ver nota de limitação abaixo, verificado por grep/build, não por teste de componente.

### T-U-01 — `.container` renderiza com classe única, sem regressão de padding
Camada: componente
DADO: `Hero`/página que usa `.container` renderizada via `renderToStaticMarkup`
QUANDO: HTML gerado é inspecionado
ENTÃO: `class="container"` presente uma única vez na árvore esperada; teste de regressão não verifica
valor computado de padding (fora do alcance de `renderToStaticMarkup`) — declarado como limitação, não
como corretude não coberta.

### T-U-02 — Números de destaque com `tabular-nums` (verificação de build CSS, não de componente)
Camada: integração leve (leitura de arquivo)
DADO: `apps/web/app/globals.css` após a mudança
QUANDO: arquivo é lido e os ~12 seletores de número de destaque são localizados por nome
ENTÃO: cada um contém `font-variant-numeric: tabular-nums` — teste de leitura de arquivo (grep-like),
não de renderização, já que a propriedade CSS não aparece no HTML gerado por `renderToStaticMarkup`.

### T-U-03 — `ClubEfficiencyCareerPanel` e `AthleteSummaryCard` renderizam classes de barra de medalha
Camada: componente
DADO: `ClubEfficiencyCareerPanel` e `AthleteSummaryCard` renderizados com dados de exemplo (ouro/prata/
bronze)
QUANDO: HTML é inspecionado
ENTÃO: `club-medal-bar-fill`/`career-medal-bar-fill` com classes `gold`/`silver`/`bronze` continuam
presentes (Cenário 4 — regressão estrutural, className não muda, só o CSS por trás é unificado).

### T-U-04 — `globals.css` sem variáveis de token duplicadas (verificação de arquivo)
Camada: integração leve (leitura de arquivo)
DADO: `apps/web/app/globals.css` após a mudança
QUANDO: arquivo é lido
ENTÃO: nenhuma ocorrência de `--radius-2:`, `--radius-3:`, `--space-1:` a `--space-6:`, `--muted-2:`
(declaração removida, não só ausência de uso) — corretude verificada contra a lista exata de variáveis
que a Spec determinou remover, fonte independente da implementação.

### T-U-05 — `.classification-row-*` com os mesmos valores RGB de `.eff-row-*`
Camada: integração leve (leitura de arquivo)
DADO: `apps/web/app/globals.css` após a mudança
QUANDO: os blocos `.classification-row-ouro/prata/bronze` e `.eff-row-gold/silver/bronze` são lidos
ENTÃO: os valores RGB batem exatamente (ouro `255,212,59`, prata `220,230,246`, bronze `255,184,106`) —
corretude contra os valores literais declarados nesta Spec, não contra a implementação relida.

### T-U-06 — CSS morto ausente
Camada: integração leve (leitura de arquivo)
DADO: `apps/web/app/globals.css` após a mudança
QUANDO: arquivo é lido
ENTÃO: nenhuma ocorrência de `.home-club-medal-legend`, `.athlete-summary-head`, `.athlete-summary-share`.

### Cobertura de falhas silenciosas
Não aplicável — sem formulário, UI interativa nova, ou persistência nesta entrega. Risco de falha
silenciosa real (regressão visual de cor/gradiente não capturada por nenhum T-*) é declarado explicitamente
acima (Impacto técnico) como limitação conhecida, mitigada por comparação visual manual de Leo no Docker
local antes do merge — não por automação, porque a técnica de teste disponível no projeto
(`renderToStaticMarkup` + assert sobre HTML) não inspeciona CSS computado.

### Comando para rodar a suite
```
npm run build --workspace apps-web
npm test --workspace apps-web
```

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-18)

Rascunho original produzido após auditoria completa de `globals.css` por agent Explore, com 4 itens e 3
`[PENDENTE]`. Conteúdo integral abaixo, preservado como registrado durante o ciclo:

#### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

Contexto: auditoria visual completa de `apps/web/app/globals.css` (3461 linhas, lida por inteiro por um
agent Explore desta sessão, achados verificados por amostragem independente) identificou 4 categorias de
inconsistência confirmadas, aprovadas por Leo para entrar em Spec:

1. Dois sistemas de design tokens coexistindo sem reconciliação
2. Tratamento tipográfico de números (placar/pontuação/ranking) aplicado de forma inconsistente
3. Vocabulário de "medalha" duplicado (inglês/português, dois blocos CSS quase idênticos)
4. CSS morto confirmado (classes sem uso, variáveis sem uso)

**Item 1 — Dois sistemas de token:** `apps/web/lib/designTokens.ts` (fonte oficial) coexiste com um
segundo bloco `:root` solto em `globals.css:3365-3386` que redeclara os mesmos conceitos com hex
hardcoded. Confirmado: `--radius-2`/`--radius-3`/`--space-1..6`/`--muted-2` sem uso; `--radius-1` usado
1 vez; `--success`/`--danger` redeclaram valores já presentes no `:root` oficial.

**Item 2 — Tipografia de números:** `tabular-nums` aplicado em só 3 de ~12 seletores candidatos.

**Item 3 — Vocabulário de medalha duplicado:** `eff-row-*`/`classification-row-*` (cores próximas mas
distintas) e `career-medal-bar-*`/`club-medal-bar-*` (blocos CSS idênticos).

**Item 4 — CSS morto confirmado:** `.home-club-medal-legend`, `.athlete-summary-head` (e filhos),
`.athlete-summary-share` sem uso confirmado em `.tsx`.

### CAT — Rodada 2 — Contraponto técnico (2026-09-18)

Executado via agent `florestech-claude-cat-counterpoint` (Codex não disponível/autorizado nesta sessão —
Leo confirmou uso exclusivo de agents Claude, inclusive para implementação). Leitura independente do
rascunho + código-fonte, sem acesso à análise interna da sessão que escreveu a Rodada 1.

**Concordo:** Item 4 sem risco (grep independente confirma). Hipótese de impacto técnico correta.
`.container` duplicado confirmado (segunda declaração vence em cascata hoje).

**Divergência de peso de evidência:** Item 3 — o rascunho dizia "não levantado ainda" sobre quais
componentes usam as classes de medalha; o contraponto levantou por grep e encontrou os 4 arquivos `.tsx`
exatos com número de linha (`ClubEfficiencyCareerPanel.tsx:80-90`, `AthleteSummaryCard.tsx:103-106`,
`career/[athleteKey]/page.tsx:279-282,685,702` via `getClassificationRowClass`,
`events/[id]/page.tsx:586-588`).

**Lacunas apontadas:**
- Item 3 (linhas de tabela): divergência de cor entre paletas precisa de decisão de Leo antes de poder
  implementar — não é impedimento técnico, é decisão de produto/design.
- Item 2: sem lacuna técnica real, ambas opções triviais.
- Nível de teste: precedente direto já existe em `apps/web/tests/ui-snapshots.test.tsx`
  (`renderToStaticMarkup` + `assert.match`/`assert.doesNotMatch` sobre className) — nível certo de
  granularidade, não precisa de Playwright/PP-050 para este escopo. Limitação: não cobre valor computado
  de cor/gradiente.

**Alertas para a Spec:** declarar explicitamente a limitação de cobertura de cor/gradiente; categoria
"não aplicável" para T-* Red-Green de remoção de token morto (não observável via `renderToStaticMarkup`);
se `.container` for fundido, mudança de padding em telas pequenas não é neutra — checar com Leo (fez-se:
Leo escolheu manter comportamento atual).

### CAT — Rodada 3 — Resolução (2026-09-18)

Todos os `[PENDENTE]` resolvidos com base no contraponto da Rodada 2. Dois itens levados a
`[LEO DECIDE]`:

1. **`.container` duplicado** — Leo decidiu: manter comportamento visual atual (opção 1), remover só a
   declaração morta.
2. **Paleta ouro/prata/bronze duplicada** — Leo decidiu: `eff-row-*` prevalece;
   `classification-row-*` adota os mesmos valores RGB, sem renomear className em nenhum `.tsx`.

Draft fechado por Leo (✅ explícito) em 2026-09-18. `## SPEC ATIVA` formada a partir deste histórico.

### Parecer — Rodada 1 (2026-09-18) — [✅ aprovado]

#### Pré-parecer
- [x] `gh pr view 51` executado — PR real, `OPEN`, `MERGEABLE`, 2 commits, branch
      `chore/pp-051-consolidacao-design-tokens`
- [x] `gh pr diff 51 --name-only` — 2 arquivos, batendo exatamente com o relatório (`globals.css`,
      `ui-snapshots.test.tsx`); nenhum arquivo fora do declarado
- [x] Diff completo lido (`gh pr diff 51`) — todos os 6 cenários conferidos linha a linha: bloco `:root`
      duplicado removido, `.container` morto removido, `tabular-nums` adicionado, barras de medalha
      unificadas, `classification-row-*` com valores RGB de `eff-row-*` (confirmado exato:
      `255,212,59`/`220,230,246`/`255,184,106`), CSS morto removido incluindo a ocorrência extra em media
      query que a Spec não citava
- [x] Suite reexecutada por esta sessão via checkout real do PR (`git fetch origin pull/51/head`) — não
      aceita por declaração: `npm test --workspace apps-web` = 55/55 pass, incluindo os 6 T-U-* novos
- [x] `npm run build --workspace apps-web` reexecutado por esta sessão — verde, 23 páginas geradas
- [x] `git diff origin/main --stat` restrito aos 4 arquivos `.tsx` proibidos + `designTokens.ts` —
      confirmado vazio (nenhum tocado)
- [x] `grep -c` das 3 classes mortas no `globals.css` do PR — 0 ocorrências, confirma remoção completa
- Nenhum item foi avaliado de memória ou por declaração do agent implementador sem confirmação por
  leitura/execução própria desta sessão

Observação de proveniência: implementação por subagente Claude (`florestech-claude-code-implementer`)
delegado por esta mesma sessão. Auditoria seguiu o mesmo padrão de independência total das entregas
anteriores (PP-050) — nada aceito por declaração.

#### Score
✅ 9 itens | ⚠️ 0 itens | ❌ 0 itens | Cobertura diff: 2/2 arquivos auditados por completo

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
Nenhum bloqueante. Dois desvios declarados pelo implementador, ambos verificados e aceitos:
- `.event-empty-state`: a Spec previa migrar `--radius-1`/`--border-strong`/`--surface-2` para tokens
  oficiais equivalentes. Só `--radius-1` tinha equivalente exato (`var(--token-radius-component, 12px)`,
  confirmado em `designTokens.ts`); as outras duas foram inline com o valor rgba literal idêntico ao
  original, em vez de aproximar por token próximo mas não idêntico. Decisão correta — preserva
  renderização pixel-perfect, que é o objetivo desta Spec (consolidação sem mudança visual), e evita
  introduzir uma mudança de aparência não intencional só para "usar token por usar token".
- Remoção da ocorrência extra de `.athlete-summary-share` dentro de uma media query, não citada
  explicitamente nos seletores-base do Cenário 6 da Spec — correto: deixar essa ocorrência órfã
  contradiria o próprio objetivo do Cenário 6 (classe morta completamente removida) e teria feito o
  T-U-06 falhar de qualquer forma.

#### Cobertura de testes (T-* da Spec)
- T-U-01 (.container classe única) — rótulo: `EXECUTADA` (reexecutado): coberto ✅
- T-U-02 (tabular-nums em ~10+3 seletores) — rótulo: `EXECUTADA`: coberto ✅
- T-U-03 (ClubEfficiencyCareerPanel/AthleteSummaryCard renderizam classes de medal-bar) — rótulo:
  `EXECUTADA`: coberto ✅
- T-U-04 (ausência de variáveis de token duplicadas) — rótulo: `EXECUTADA`: coberto ✅
- T-U-05 (classification-row-* com RGB de eff-row-*) — rótulo: `EXECUTADA`, também conferido por leitura
  direta do diff (valores batem exatos com a decisão de Leo): coberto ✅
- T-U-06 (CSS morto ausente) — rótulo: `EXECUTADA`, reforçado por `grep -c` independente = 0: coberto ✅
- Casos de teste ausentes na Spec que Claude recomenda adicionar: nenhum

#### Security review
- Executado: ✅ sem achados. Mudança é CSS/apresentação pura, sem auth/query/input/segredo tocado —
  security-review-agent corretamente marcado "não" na Spec.

#### Conclusão
PP-051 aprovada sem ressalvas bloqueantes. Os 6 cenários da Spec foram implementados e verificados de
forma independente por esta sessão (não só pela declaração do implementador): dois sistemas de token
consolidados em um único `:root`, `.container` sem duplicação e sem mudança de comportamento visual,
tratamento tipográfico de números padronizado, barras de medalha unificadas estruturalmente, paleta de
medalha das linhas de tabela unificada conforme decisão de Leo, e CSS morto removido por completo
(incluindo uma ocorrência que a própria Spec não havia mapeado). Nenhum arquivo `.tsx` de produção foi
tocado. Pronta para merge; recomendo comparação visual manual de Leo no Docker local antes, já que o
risco residual de regressão de cor/gradiente não é coberto por teste automatizado (limitação já declarada
na Spec, não uma lacuna desta entrega).
