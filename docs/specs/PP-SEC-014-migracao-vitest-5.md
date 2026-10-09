# PP-SEC-014 — Migração Vitest 3.2.x → Vitest 5 (críticas de dev no `npm audit` completo)

## SPEC ATIVA — PP-SEC-014 — v2.1 (correções do Parecer Rodada 1)
<!-- v2.1 = v2 aprovada + 2 correções do Parecer Rodada 1 (ver ##### Correções obrigatórias da Rodada 1 no HISTÓRICO).
     Como a versão mudou depois da aprovação, o implementador só age sobre v2.1 após Leo re-carimbar `Aprovada por` abaixo. -->
**Correções obrigatórias (Parecer Rodada 1, 2026-10-09):** (1) regravar `docs/evidence/PP-SEC-014/audit-before.json` e `audit-after.json`
em UTF-8 **sem BOM**, mesmo conteúdo, commit `docs:` separado, provando com `JSON.parse` do blob; (2) o relatório lista os majors
transitivos (`@vitest/mocker`, `@vitest/spy`, `chai`, `es-module-lexer`, `magic-string`, `std-env`, `tinybench`, `why-is-node-running`).
Nada mais muda. Escopo, fora de escopo e plano de testes abaixo permanecem os da v2.

## (v2 base)
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco, e só após `Aprovada por` preenchido. -->
ID: PP-SEC-014 | Projeto: PingPong PaiD'egua | Branch: `fix/pp-sec-014-vitest-5`
Criada por: Claude | Data: 2026-10-09 | Versão da Spec: v2.1
Aprovada por: Leo | Data: 2026-10-09 | Escopo: Migração Vitest 3.2.x → 5 em packages/parser e packages/shared, Vite 8.3.4 transitivo aceito, configs intactas; PP-SEC-015/016 apenas registradas no commit `docs:` final; correções mecânicas da Rodada 1 — aprovação em chat sobre a Versão da Spec v2.1
Estado: `ATIVA` — implementador para se `Aprovada por` ficar em branco ou se a versão aprovada ≠ v2.1 (contrato §Campo `Aprovada por`).
CAT: ENCERRADO (Rodadas 1–3; ✅ de Leo em 2026-10-09). v2 incorpora a Rodada 2 do Codex e as decisões de Leo (Vite 8 aceito; PP-SEC-015/016 fora).
Domínio instável: TDD Red-Green-Refactor verificável no Git — atenção redobrada (E01).

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — A06 (cadeia de dependências); a entrega existe para fechar achado A06 Crítico.
- e2e-playwright-agent: não — nenhuma superfície de UI tocada.
- report-builder-agent: sim — relatório antes/depois do `npm audit` (JSON) e tabela de remanescentes.

## Objetivo
Zerar as vulnerabilidades **críticas** do `npm audit` **completo** (sem `--omit=dev`) do monorepo, hoje
`vitest`/`tinypool` (devDependencies), cuja correção exige `vitest@5.0.3` (major), sem perder nenhum teste de
`packages/parser` e `packages/shared`.

## Contexto
- Origem: Parecer Rodada 2 da PP-072 (item ✅3) — `npm audit` completo = 10 vulnerabilidades, 2 críticas, ambas
  `vitest`/`tinypool`; registrada como PP-SEC-014 no backlog; fecha a parte "dev" da PEND-CBTM-006.
- Vitest é usado **só** em dois workspaces: `packages/parser` (`"vitest": "^3.0.5"`) e `packages/shared`
  (`"vitest": "^3.2.4"`), scripts `"test": "vitest run"`. `apps/api` e `apps/worker` usam `node:test`/`tsx` — não tocar.
- Configs atuais (leitura física em 2026-10-09):
  - `packages/parser/vitest.config.ts`: `defineConfig` de `vitest/config`, `resolve.alias["@cbtm/shared"]` via
    `path.resolve(__dirname, "../shared/src/index.ts")`, `test.include = ["test/**/*.test.ts"]`.
  - `packages/shared/vitest.config.ts`: só `test.include = ["test/**/*.test.ts"]`.
- Os 21 arquivos de teste (11 parser, 10 shared) importam apenas `describe, expect, it` de `"vitest"`; **não** usam
  `vi.*`, `globals`, mocks, timers falsos nem snapshots (grep em 2026-10-09). Superfície de API do Vitest usada é mínima.
- Pacotes são CommonJS (sem `"type": "module"`; `tsconfig.base.json`: `module: CommonJS`, `moduleResolution: Node`).
  `__dirname` no `vitest.config.ts` depende do loader de config do Vite — **ponto de risco real** no Vitest 5 (H2 abaixo).
- Lock atual: `vite 7.3.1`, `esbuild 0.27.3`, `vitest` na linha 3.2.x (a base declarada pelo pedido é 3.2.7, após o
  `audit fix` da PP-072). Contagem de testes de referência (Parecer PP-072 Rodada 2, `EXECUTADA`): parser **35**, shared **58**.
- CI: workflows usam Node 20 e `npm ci`, mas **não rodam** a suite de parser/shared; máquina local = Node 24. `apps/api`
  exige Node ≥ 22.3 por outro motivo (ressalva já registrada na PP-072).

### Hipóteses do CAT — resultado (Rodada 2 do Codex; detalhe no HISTÓRICO)
- H1 (Node/Vite): `vitest@5.0.3` exige Node `^22.12.0 || ^24.0.0 || >=26.0.0` (local 24 atende; Node 20 do CI não — a suite não roda
  no CI, tratado em PP-SEC-015, fora desta Spec). Aceita Vite `^6.4 || ^7 || ^8`; o npm resolveu **Vite 8.3.4**, aceito por Leo.
- H2 (config CJS/`__dirname`): refutada como quebra — as duas configs carregam sem edição. **Configs permanecem intactas.**
- H3 (`vitest run`/`include`): refutada — mesmo comportamento e mesmas contagens.
Esses resultados são declaração do Codex (`EXECUTADA` por ele); o implementador os reconfirma nas pré-condições. Qualquer
divergência (config que não carrega, contagem diferente) é reportada a Leo, não contornada.

## Causa raiz
- Causa imediata: `vitest`/`tinypool` na linha 3.x têm advisory Crítico; `npm audit fix` sem `--force` não corrige (major).
- Causa sistêmica: devDependencies fora da triagem original (PP-SEC-007 mirou `--omit=dev`); gate de `npm audit` completo
  não existe no CI/pre-commit, então críticas de dev só aparecem em auditoria manual.
- Padrão: A06 recorrente (PP-072, PEND-CBTM-006). Classe ativa relevante: E01 (Red-Green por T-*).

## Pré-condições (verificar antes de qualquer edição; falha = parar e reportar a Leo)
1. PR #63 (PP-072) **mergeado em `origin/main`** (verificado por Claude em 2026-10-09: merge `a9b84e9`); branch criada a partir de
   `origin/main` atualizado, em worktree própria (a árvore principal do repo está em outra branch com alterações não commitadas — não usar).
2. Baseline em `main` limpo, antes de qualquer mudança, anexado como evidência:
   `npm ci` → `npm ls vitest vite tinypool` → `npx vitest --version` (o binário **tem** de existir: no experimento do Codex o primeiro
   `npm ci` não o expôs, causa não isolada; se faltar, investigar e reportar a Leo, sem contornar) →
   `npm run test --workspace @cbtm/parser` e `... @cbtm/shared` (anotar nº de testes; esperado 35 e 58) →
   `npm audit --json` (completo) salvo em `docs/evidence/PP-SEC-014/audit-before.json` — **autoritativo** (Codex mediu 4 críticas;
   a medição "2" do Parecer PP-072 está datada).
3. `git config user.email` = `gemaqueflores@gmail.com`; hook `.githooks/pre-commit` ativo (`core.hooksPath`).

## Cenários funcionais
- C1 DADO o monorepo em `main` QUANDO `vitest` dos dois workspaces passa à linha 5 ENTÃO `npm run test --workspace @cbtm/parser`
  e `@cbtm/shared` executam **todos** os testes do baseline (35 e 58 ou o valor medido no pré-condição 2) e passam.
- C2 DADO o lock novo QUANDO `npm audit` (completo) ENTÃO 0 críticas; `vitest` e `tinypool` fora da lista de vulneráveis.
- C3 DADO as configs QUANDO carregadas pelo Vitest 5 ENTÃO sem erro de carga, sem warning de opção obsoleta não tratado,
  alias `@cbtm/shared` resolvendo para `packages/shared/src/index.ts`.
- C4 DADO um teste que deve falhar QUANDO executado sob Vitest 5 ENTÃO a suite sai com código ≠ 0 (a suite não é vacuosamente verde).
- C5 DADO o pipeline de build/regressão do repo QUANDO executado ENTÃO nada fora de Vitest muda de resultado.

## Critérios de aceitação
1. `packages/parser/package.json` e `packages/shared/package.json` declaram `vitest` no mesmo range de linha 5 (`^5.0.3`
   ou superior verificado); versão única resolvida no lock (sem duas versões de `vitest` coexistindo).
2. `npm audit` **completo** (JSON anexado): `metadata.vulnerabilities.critical == 0`. Altas/moderadas remanescentes
   listadas em tabela (pacote × cadeia × severidade × major que resolveria × motivo), não escondidas; se `vitest`/`tinypool`
   ainda constarem por qualquer severidade, justificar com advisory.
3. Contagem de testes executados igual ou maior que o baseline em cada workspace; nenhum `skip`/`only`/`todo` novo; nenhum teste removido.
4. `packages/*/vitest.config.ts` **não são alteradas** (H2/H3 refutadas). Alteração só se uma falha de carga real for reproduzida e
   reportada a Leo antes; sem isso, qualquer diff nelas = ❌ (Q3). O aviso de `configLoader: native` é registrado no relatório, sem ação.
4a. Vite: a versão resolvida pelo npm (esperado `8.3.4`, major acima do 7.3.1 anterior) é **aceita por Leo** e **declarada no relatório**
   (versão, quem a puxa, `npm ls vite`). Sem `overrides` e sem `vite` declarado em `package.json`. Se o npm resolver outra major, parar e reportar.
5. `npm run build --workspace @cbtm/shared` e `@cbtm/parser` verdes; `npm run test:regression:critical` verde;
   `npm --prefix apps/api test` e `npm run test --workspace apps-worker` sem regressão frente ao baseline do pré-condição 2
   (worker com banco: reusar o procedimento de `docs/evidence/PP-072/redis-postgres-validation-2026-10-09.md`, ou atestar Leo).
6. Compatibilidade de runtime declarada: relatório informa o `engines` do Vitest 5 resolvido e a versão de Node da execução (local 24).
   Node 20 do CI é incompatível com Vitest 5 e **não** é tratado aqui (workflows intactos): vira PP-SEC-015 (critério 7).
7. Documentação, em um único commit `docs:` ao final:
   - `docs/backlog-seguranca-qualidade.md`: PP-SEC-014 marcada FECHADA com referência a este PP e ao `audit-after.json`; e **duas linhas
     novas**, abertas como itens não bloqueantes e fora desta Spec (texto abaixo).
   - `CLAUDE.md`: PEND-CBTM-006 atualizada (parte dev fechada; remanescentes apontando PP-SEC-013).

   Linhas a inserir (adaptar só a numeração de colunas ao formato da tabela vigente em `origin/main`):
   ```
   | PP-SEC-015 | Compatibilidade de CI (A06, desenvolvimento) | Baixo (nao bloqueante) | Workflows usam `node-version: 20`, incompativel com `vitest@5` (exige Node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`). Hoje a suite de `packages/parser` e `packages/shared` nao roda no CI, entao nao ha quebra ativa. | Declaracao do Codex no CAT da PP-SEC-014 (Rodada 2); `.github/workflows/post-commit-validation.yml:28` e `production-drift-check.yml:75` (`node-version: 20`). Reexecucao independente: nao feita. | Spec propria: atualizar `node-version` dos workflows (avaliando impacto em `apps/api`, que usa `--experimental-test-module-mocks`, Node >= 22.3) ANTES de incluir as suites de parser/shared no pipeline. |
   | PP-SEC-016 | Lacuna de processo (A06) | Medio (nao bloqueante) | Nao existe gate de `npm audit` completo (sem `--omit=dev`) no CI nem no pre-commit; criticas de devDependencies so apareceram por auditoria manual (PEND-CBTM-006, PP-SEC-014). | Pre-commit executa so mojibake + `test:regression:critical`; workflows usam `npm ci --no-audit`. ESTATICA. | Spec propria: definir limiar (ex.: falhar em Critico), escopo (dev incluido) e tratamento de falso positivo/advisory sem fix; T-* provando que o gate falha com critica sintetica. |
   ```

## Fora de escopo
- Qualquer upgrade de Next 16, Nest, Prisma 7, esbuild/vite como objetivo próprio (só o que Vitest 5 arrastar por peer/dep, declarado);
- migrar `apps/api`/`apps/worker` para Vitest; criar config de coverage; adicionar plugins/reporters;
- alterar `node-version` dos workflows (PP-SEC-015) ou adicionar gate de `npm audit` completo no CI/pre-commit (PP-SEC-016) —
  ambos só **registrados** no backlog por esta entrega, nunca implementados aqui;
- fixar Vite 7 (`overrides` ou declaração de `vite`) — decisão de Leo: Vite 8 transitivo aceito;
- alterar `packages/*/vitest.config.ts` sem falha de carga reproduzida e reportada;
- refatorar testes; `npm audit fix --force`; corrigir as altas de produção da PP-SEC-013.

## Impacto técnico
Criar/modificar:
- `packages/parser/package.json` (range do `vitest`);
- `packages/shared/package.json` (range do `vitest`);
- `package-lock.json` (regenerado por `npm install` focal; revisar diff pacote a pacote — majors transitivos além de
  `vitest`/`tinypool`/`vite`/`esbuild`/`@vitest/*` devem ser listados e justificados);
- `docs/evidence/PP-SEC-014/` (`audit-before.json`, `audit-after.json`, contagens, `npm-ls.txt`, `red-log.md`);
- `docs/backlog-seguranca-qualidade.md`, `CLAUDE.md` (critério 7).
NÃO tocar: `packages/*/vitest.config.ts` (H2/H3 refutadas), `packages/*/src/**`, `packages/*/test/**` (a sentinela de T-C-04 é
temporária e nunca entra em commit), `apps/**`, `.github/workflows/**`, `.githooks/**`, `tsconfig*.json`, `prisma/**`, `scripts/**`.
Alteração em `package.json` raiz: nenhuma.
DDL: não. Contrato de API: não. Dependência nova: nenhuma declarada além da troca de major do `vitest` (decidida pelo backlog;
coberta pela aprovação de Leo desta Spec — Q7). `vite` 8.3.4 entra apenas como transitivo, aceito por Leo e declarado no relatório.

## Plano de testes
COBERTURA: regressão=4 corretude=3

### Cobertura geral
- camadas: suites existentes de parser e shared (unitário), builds TypeScript, `npm audit`.
- arquivos de teste novos: nenhum. T-C-03 e T-C-04 usam mutações **temporárias** (alias invertido; sentinela
  `packages/shared/test/zz-vitest5-sentinel.test.ts`), nunca commitadas — `git diff origin/main...HEAD` não pode listá-las.
- fixtures/mocks: nenhum.
- Categorias do contrato: formulário/edição/exclusão/listagem/auth/integração/upload/UI = `[não aplicável — troca de
  ferramenta de teste de devDependency, sem comportamento de produto]`; regra de negócio = `[não aplicável]`. Aplicáveis:
  regressão de suite e verificação de gate de segurança.

### T-R-01 [regressão] — parser: mesmos testes, mesmo resultado
DADO baseline do pré-condição 2 (nº de testes N_p) QUANDO `npm run test --workspace @cbtm/parser` sob Vitest 5
ENTÃO sai 0 e o nº de testes executados == N_p (lido da saída do runner, não de memória); nenhum skip/todo.

### T-R-02 [regressão] — shared: idem
DADO N_s (baseline) QUANDO `npm run test --workspace @cbtm/shared` ENTÃO sai 0 e executados == N_s; `performance.test.ts` incluído.

### T-R-03 [regressão] — builds, regressão crítica e árvore resolvida
DADO lock novo QUANDO `npm run build --workspace @cbtm/shared`, `... @cbtm/parser` e `npm run test:regression:critical`
ENTÃO todos saem 0 (compara com o baseline em `main` antes de atribuir qualquer falha ao upgrade). `npm ls vitest vite tinypool`
mostra `vitest@5.0.x` único, `vite` na versão aceita (esperado 8.3.4, declarada no relatório) e `tinypool` ausente ou sem advisory;
`npx vitest --version` responde.

### T-R-04 [regressão] — apps fora do escopo inalterados
DADO baseline QUANDO `npm --prefix apps/api test` e `npm run test --workspace apps-worker` ENTÃO resultados == baseline
(API 239/239 conforme Parecer PP-072; worker com banco 101/101 ou atestado). `git diff --stat origin/main...HEAD` não
lista nada em `apps/**` nem `packages/*/src/**`.

### T-C-01 [corretude] — audit completo, valor calculado fora do código
DADO `npm audit --json` pós-mudança QUANDO lido `metadata.vulnerabilities.critical` e a lista `vulnerabilities` ENTÃO
`critical == 0` e as chaves `vitest`/`tinypool` ausentes ou com severidade justificada. O valor vem do advisory do npm, não de
script do repo. Anexar `audit-before.json` e `audit-after.json`; tabela comparativa no relatório.

### T-C-02 [corretude] — RED/GREEN do gate de audit (RED real = críticas presentes)
RED: sobre `main` limpo, `npm audit --json` completo retorna `critical >= 1` com `vitest`/`tinypool` na lista (esperado 4, conforme
medição do Codex; valor lido do JSON, não de memória). Registrar em `docs/evidence/PP-SEC-014/red-log.md` o comando, a saída e o
`audit-before.json`. Commit: `test(deps): T-C-02 red — audit completo com críticas vitest/tinypool` (evidência apenas; sem mudança de dependência).
Não vale como RED: "comando não encontrado", falha de instalação/`npm ci`, `SyntaxError`/`ImportError`.
GREEN: bump de `vitest` nos dois `package.json` + lock → `audit-after.json` com `critical == 0` (T-C-01) e configs carregando sem edição
(T-R-01/T-R-02 verdes sem diff nas `vitest.config.ts`). Commit: `fix(deps): T-C-02 green — vitest 5`.
Se, contra a expectativa, uma config falhar ao carregar sob Vitest 5: parar, anexar o log e reportar a Leo (H2 refutada → nova rodada).
Commits Red e Green separados, com hook normal. `--no-verify` só na exceção formal de commit RED do `CLAUDE.md` (hook bloqueando por
causa do próprio RED), declarando hash e justificativa; aqui o RED é só evidência e o hook deve passar.

### T-C-03 [corretude] — alias resolve ao código real
DADO `packages/parser` sob Vitest 5 QUANDO o teste de parser que depende de `@cbtm/shared` roda (ex.: `doubles-parser.test.ts`)
ENTÃO passa; verificação adicional: inverter temporariamente o alias para caminho inexistente faz a suite **falhar** (prova
que o alias é exercido, não ignorado); reverter e não commitar a inversão.

### T-C-04 [corretude] — a suite detecta falha (anti-vacuidade)
DADO sentinela temporária `expect(1).toBe(2)` em `packages/shared/test/zz-vitest5-sentinel.test.ts` QUANDO
`npm run test --workspace @cbtm/shared` ENTÃO sai ≠ 0 e a saída aponta o arquivo; remover a sentinela e reexecutar T-R-02.
Evidência no `red-log.md`. Prova que `vitest run` do major novo não passa verde sem executar assertions.

### Cobertura de falhas silenciosas
- Suite verde com **zero** testes coletados (mudança de `include`/descoberta) é falha silenciosa: T-R-01/T-R-02 comparam
  contagem, não só exit code.
- Dois `vitest` resolvidos no lock (um por workspace): `npm ls vitest` deve mostrar uma única versão deduplicada.

### Comando para rodar a suite
```
npm ci
npm ls vitest vite tinypool
npx vitest --version
npm run test --workspace @cbtm/parser
npm run test --workspace @cbtm/shared
npm run test:regression:critical
npm audit --json
npm ls vitest tinypool
```

## Entrega esperada do Codex (além do formato padrão)
Tabela audit antes×depois; saída de `npm ls vitest vite tinypool`; `engines`/peers do Vitest 5.0.x resolvido (H1); confirmação de que
H2/H3 seguem refutadas (configs sem diff); declaração do Vite resolvido (versão e origem); aviso `configLoader: native` como
observação; diff do lock resumido (pacotes adicionados/removidos/majors). Qualquer
major transitivo inesperado no lock vira ressalva declarada, não escopo silencioso (lição `msgpackr` da PP-072).

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### Rascunho Claude (2026-10-09) — sem CAT
Spec gravada a partir de leitura física de: `packages/{parser,shared}/{package.json,vitest.config.ts,tsconfig.json}`,
`tsconfig.base.json`, `package.json` raiz, `CLAUDE.md` do projeto, `docs/backlog-seguranca-qualidade.md`,
`docs/specs/PP-072-atualizacao-dependencias-cve.md` (Parecer Rodadas 1–2) e lock (`vitest` 3.2.x, `vite` 7.3.1, `esbuild` 0.27.3).
Não executei `npm view`, `npm audit` nem a suite nesta sessão: requisitos do Vitest 5 (H1–H3) e contagens são
`NÃO_VERIFICADA` por mim; contagens 35/58 vêm do Parecer PP-072 (`EXECUTADA` por Claude em 2026-10-09 naquele contexto).

### Decisões de Leo (2026-10-09) — fechamento do CAT
✅ CAT aprovado. Vite 8.3.4 transitivo aceito e declarado no relatório (diverge da preferência do Codex por Vite 7; decisão de Leo).
PP-SEC-015 (Node dos workflows) e PP-SEC-016 (gate de `npm audit` completo no CI) abertos como não bloqueantes, fora desta Spec;
esta entrega apenas registra as duas linhas no backlog (critério 7), no commit `docs:` final.
Aprovação final da v2 por Leo em 2026-10-09, registrada em `Aprovada por`; confirmou manter PP-SEC-015/016 no commit documental final.

### Decisões de Leo pendentes (v1 — SUPERADAS pela decisão acima; mantidas para rastreabilidade)
1. **Aprovação da Spec** (`Aprovada por`) — sem ela o Codex não implementa.
2. **CAT**: este rascunho não passou por ciclo tripartite. Fast track é vedado (domínio TDD Instável, múltiplos arquivos
   dependentes). Opções: (a) abrir CAT Rodada 2 com o Codex sobre H1–H3; (b) Leo dispensar explicitamente o CAT nesta
   entrega, dado o escopo pequeno (2 package.json + lock + ≤2 configs).
3. **Gate de `npm audit` completo no CI/pre-commit** (causa sistêmica): Spec própria ou ficar fora? Proposto: fora, abrir item de backlog.
4. **Node 20 do CI**: se H1 mostrar que Vitest 5 exige Node mais novo, decidir se isso gera Spec de CI separada (a suite hoje não roda no CI).

### CAT — Rodada 2 (2026-10-09) — contraponto técnico Codex
Proveniência: texto colado por Leo no chat; não verificado em `~/.codex/sessions` — tratado pelo mérito, com os números abaixo
como declaração do Codex (`EXECUTADA` por ele, reexecução independente não feita por Claude).
- **H1:** `vitest@5.0.3` exige Node `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 24.13 local atende; Node 20 do CI **não** é suportado
  (não bloqueia: a suite não roda no CI). Vitest 5 aceita Vite `^6.4 || ^7 || ^8`; Vite 7.3.1 do lock é compatível, mas o npm
  resolveu `vite@8.3.4` no experimento.
- **H2 (refutada como quebra):** as duas configs carregaram sem edição; alias via `__dirname` funcionou; parser 35/35. Aviso de
  que ESM em config CommonJS será incompatível com `configLoader: native` futuro — não é falha agora.
- **H3 (refutada):** parser 11 arquivos/35 testes, shared 10/58 — iguais ao baseline PP-072; `vitest run`/`include` inalterados;
  breaking changes documentados não alcançam as APIs usadas.
- **Audit experimental pós-bump:** critical 0, high 5, moderate 1, low 1; `vitest` único em 5.0.3; `tinypool` saiu da árvore.
  Baseline atual do audit completo = **4 críticas** (a medição "2" do Parecer PP-072 está datada) → `audit-before.json` novo é autoritativo.
- **Risco:** no primeiro `npm ci` do experimento o binário `vitest` não foi exposto; causa não isolada.

### CAT — Rodada 3 (2026-10-09) — Claude analista
Incorporações à futura SPEC ATIVA v2 (já decididas, sem depender de Leo):
- H2/H3 `[RESOLVIDO: refutadas; configs permanecem intactas]`. Consequência: **T-C-02 passa a ser o RED de audit** (4 críticas
  no baseline, `vitest`/`tinypool`) e a verificação de que as configs carregam sem edição; qualquer edição de config sem falha
  reproduzida segue fora de escopo. RED não pode ser "comando não encontrado" nem erro de instalação.
- Pré-condição nova: após `npm ci`, executar `npm ls vitest vite tinypool` e confirmar que o binário `vitest` existe
  (`npx vitest --version`) **antes** do baseline; se faltar, investigar a causa e reportar a Leo — não contornar.
- PP-072 mergeada `[RESOLVIDO]` (declarado pelo Codex; Claude verifica `git log origin/main` na abertura da implementação).
- T-C-03/T-C-04 permanecem como provas temporárias, mutações nunca commitadas.
- Critério 6 mantido: relatório registra Node 20 incompatível; workflows intactos.
- Aviso `configLoader: native` registrado como observação no relatório, sem ação.

`[LEO DECIDE 1] Vite 7 × Vite 8.` O Vitest 5 aceita ambos. Fatos: o npm resolveu Vite 8.3.4 (major acima do 7.3.1 do lock);
audit 0 críticas e 35/35 + 58/58 foram medidos **com Vite 8**; Vite 7 é suportado pelo peer range, mas não foi medido.
- (a) Aceitar Vite 8 transitivo, declarado no relatório (**recomendação de Claude**): fica dentro do que foi medido, não cria
  declaração nova nem `overrides` a manter; Vite aqui é só dependência do runner (não há `vite build` no repo — leitura de
  `scripts` raiz/pacotes), então o major não alcança produto.
- (b) Manter Vite 7 (recomendação do Codex, para reduzir escopo): exige declarar `vite@^7.3.1` em `devDependencies` ou
  `overrides` no `package.json` raiz — dependência/config nova (Q7) e o conjunto Vitest 5 + Vite 7 teria de ser medido de novo
  (audit e suites) antes de aceitar. Divergência com o Codex registrada; a decisão é sua.

`[LEO DECIDE 2] Node 20 do CI.` Registrar item novo no backlog (proposto `PP-SEC-015`/CI, Baixo, não bloqueante): "Vitest 5
exige Node ≥ 22.12; antes de incluir parser/shared no pipeline, atualizar `node-version` dos workflows". Sem alterar workflows
nesta entrega. Recomendação: sim. (A pendente 3 da lista acima — gate de `npm audit` completo no CI — continua fora de escopo
e vira item de backlog separado, se você concordar.)

Próximo passo: com seu ✅ no CAT e as duas decisões acima, Claude grava a `## SPEC ATIVA` v2 (Self-review incluso) para
sua aprovação final (`Aprovada por`). Nenhuma implementação antes disso.

### Parecer — Rodada 1 (2026-10-09) — ❌ bloqueado (1 item trivial) — PR #65, topo `1ec8d9c`

#### Pré-parecer
- [x] Glob/diff: 13 arquivos (`git diff --stat origin/main...HEAD`, worktree `.codex-worktrees/pp-sec-014`, HEAD = `origin/fix/pp-sec-014-vitest-5`)
- [x] Lido contra `origin/main`: `packages/{parser,shared}/package.json`, `CLAUDE.md`, backlog, `package-lock.json` (comparação programática pacote a pacote dos dois locks), `baseline.txt`, `npm-ls-*.txt`, `audit-{before,after}.json` (parseados), `red-log.md` do commit RED; Spec do PR comparada com a cópia aprovada (idêntica). `validation.md` (relatório do Codex) **não lido** antes do fechamento deste parecer
- [x] Classes ativas relevantes: E01; domínio TDD Instável. Desvios que Leo repassou (2 críticas em vez de 4; aviso `configLoader`; falso positivo do scanner) tratados como sinal, cada um reverificado abaixo
- [x] Execução própria na worktree do PR (Node v24.13.0; árvore limpa antes e depois)
- [ ] `confere-citacoes.py` — ver linha final

#### Score
✅ 9 | ⚠️ 4 | ❌ 1 | Cobertura diff: 12/13 arquivos auditados (falta `validation.md`, relatório do Codex — lido só depois deste fechamento; só pode apertar)
Domínio instável "TDD Red-Green" — itens extras verificados: commit RED `58fb74c` (só evidência: audit com 2 críticas) precede o GREEN `25bc958` (bump + lock); RED é falha real (`critical=2`), não erro de instalação nem "comando não encontrado".

#### Itens ❌ (bloqueantes)
- **[Q5] BOM UTF-8 nos dois JSON de evidência.** `docs/evidence/PP-SEC-014/audit-before.json` e `audit-after.json` começam com `EF BB BF` (verificação binária do blob em `1ec8d9c`; `git show` + leitura de bytes). Consequência observada: `JSON.parse` do conteúdo falha com `Unexpected token '﻿'` (rodei; só funcionou após remover o BOM). São os artefatos que a Spec manda anexar para T-C-01 e que servem de prova do audit; evidência que um parser estrito não lê. Provável origem: redirecionamento do PowerShell 5.1 (`>`/`Out-File`) — `INFERÊNCIA`. Os demais arquivos de texto alterados (CLAUDE.md, backlog, Spec, `red-log.md`, `validation.md`, `baseline.txt`, os dois `package.json`) estão sem BOM, LF e UTF-8 válido. — base: arquivos novos (sem equivalente em `origin/main`) vs PR: `docs/evidence/PP-SEC-014/audit-{before,after}.json:1` — rótulo: `EXECUTADA` (checagem binária + `JSON.parse`)
  - Leitura literal do critério "BOM em arquivo que não deveria ter = Q5 ⛔". O escopo textual da Q5 é PT-BR em HTML/JS e estes JSON não têm PT-BR; mantive ❌ porque o defeito é funcional (artefato ilegível por parser estrito) e a correção é mecânica. Leo pode aceitar como waiver explícito se preferir não abrir nova rodada.

#### Itens ⚠️ (ressalvas)
- **Majors transitivos a declarar.** O lock troca de major, além de `vitest` 3.2.7→5.0.3 e `vite` 7.3.6→8.3.4 (aceito por Leo): `@vitest/mocker` e `@vitest/spy` →5.0.3, `chai` 5.3.3→6.3.0, `es-module-lexer` 1.7.0→2.3.2, `magic-string` 0.30.21→1.4.3, `std-env` 3.10.0→4.3.0, `tinybench` 2.9.0→6.2.1, `why-is-node-running` 2.3.0→3.2.1. Entram 33 pacotes e saem 46: o bundler do Vite passa de `rollup` para `rolldown` 1.2.13 e entram binários nativos (`rolldown-binding-*`, `lightningcss*`); saem `tinypool`, `vite-node`, `@rollup/*` e o opcional `@napi-rs/lzma-linux-x64-gnu` (era dependência opcional do `rollup`). Todos são cadeia de ferramenta de teste (devDependencies); nenhum atinge `apps/**`. A Spec exige que o relatório liste os majors; se a lista estiver ausente ou incompleta no relatório, vira ressalva ativa — rótulo: `ESTÁTICA` (lock) + `NÃO_VERIFICADA` (conteúdo do relatório)
- **T-C-03 (alias exercido) e T-C-04 (sentinela falha) não reexecutados por mim.** São mutações temporárias que a Spec manda nunca commitar; confirmei só que nenhuma sentinela foi commitada. A prova indireta de que a suite não é vacuosa é a contagem executada (35 e 58, iguais ao baseline) — rótulo: `EXECUTADA` (contagem) / `NÃO_VERIFICADA` (T-C-03/T-C-04 em si)
- **Altos remanescentes de produção.** `npm audit` completo no PR (rodado por mim): 7 vulnerabilidades — 0 críticas, 5 altas (`prisma`, `@prisma/config`, `deepmerge-ts`, `effect`, `postcss`), 1 moderada (`next`), 1 baixa (`esbuild`). São exatamente as da PP-SEC-013 (produção, exigem Prisma 7/Next 16) e a baixa de dev; nenhuma nova. Pela política Alto seria ❌, mas é limitação já aceita por Leo e rastreada, fora do escopo desta Spec — mantido ⚠️ registrado, não achado novo — rótulo: `EXECUTADA`
- **Worker com banco/Redis não reexecutado.** A entrega não toca `apps/**` (diff vazio), então não há razão estática para regressão; a execução com banco continua `NÃO_VERIFICADA` por mim (esta máquina não tem PostgreSQL/Redis) — rótulo: `ESTÁTICA` (diff vazio) / `NÃO_VERIFICADA`

#### Itens ✅ (verificados)
1. `vitest` `^5.0.3` nos dois `package.json`; `npm ls vitest vite tinypool`: `vitest@5.0.3` único, `vite@8.3.4`, `tinypool` ausente; `npx vitest --version` = 5.0.3. — `EXECUTADA`
2. **T-C-01 / critério 2:** meu `npm audit --json` sobre o HEAD: `critical=0` (total 7); `vitest`, `tinypool` e `@vitest/mocker` fora da lista; igual a `audit-after.json`. — `EXECUTADA`
3. **Desvio 1 (2 críticas, não 4):** `audit-before.json` e `baseline.txt` mostram `critical=2` (`vitest`, `tinypool`) sobre `origin/main` (`a9b84e9`); `red-log.md` explica advisories temporais. Consistente entre os três artefatos e com o Parecer PP-072; a medição "4" do CAT não é reprodutível por mim (`INFERÊNCIA`: advisory variável no tempo). Sem impacto no critério. — `ESTÁTICA` + `EXECUTADA` (audit-after)
4. **T-R-01/T-R-02:** parser 11 arquivos / **35/35**; shared 10 arquivos / **58/58**, sob Vitest 5.0.3; iguais ao baseline; nenhum skip/only/todo novo (diff sem arquivos de teste). — `EXECUTADA`
5. **Configs intactas (critério 4):** `git diff --quiet origin/main HEAD` nas duas `vitest.config.ts` = sem diff; nenhum arquivo em `apps/**`, `packages/*/src|test`, `.github`, `.githooks`, `package.json` raiz. — `ESTÁTICA`
6. **Desvio 2 (aviso `configLoader: native`):** reproduzido na minha execução (ESM em config carregada como CommonJS, `vitest.config.ts:1:1`); não é falha, configs seguem carregando e a suite passa. Observação para o relatório, sem ação, como a Spec determina. — `EXECUTADA`
7. **T-R-03:** `build` de `@cbtm/shared` e `@cbtm/parser` exit 0; `test:regression:critical` exit 0 (vitest 7/7 + 52/52 + 25/25) **depois de** `npm run prisma:generate` — sem gerar o cliente Prisma ele falha (`@prisma/client did not initialize yet`), ambiental e já conhecido da PP-072, não atribuível ao PR. — `EXECUTADA`
8. **T-R-04 (parcial):** `npm --prefix apps/api test` **247/247**, exit 0 (a PP-072 registrou 239; o crescimento vem de `main`, o PR não toca `apps/**`). — `EXECUTADA`
9. **Documentação e escopo de backlog:** `CLAUDE.md` PEND-CBTM-006 e linha PP-SEC-014 do backlog batem com o audit (0 críticas, `tinypool` fora, 35/35 e 58/58); PP-SEC-015 e PP-SEC-016 inseridas como na Spec, e as citações conferem (`node-version: 20` em `post-commit-validation.yml:28` e `production-drift-check.yml:75`; `npm ci --no-audit` em ambos). Ordem dos commits RED→GREEN→docs correta, e-mail do autor `gemaqueflores@gmail.com`. **Desvio 3 (scanner):** `npm run verify:security` rodado por mim = `security scan ok (0 candidate files)`, exit 0; o diff do PR não contém `dangerouslySetInnerHTML`; a menção em `CLAUDE.md` já existe em `origin/main` (PEND-CBTM-002) — não reproduzi o alerta; a classificação "falso positivo documental" não foi contraditada. — `ESTÁTICA` + `EXECUTADA`

#### Cobertura de testes (T-* da Spec)
- T-C-02 [corretude] — RED `58fb74c` → GREEN `25bc958`: RED real (`critical=2`, ordem verificada no `git log`): coberto ✅ (`ESTÁTICA` ordem; `EXECUTADA` GREEN pelo meu audit)
- T-C-01 [corretude] — `EXECUTADA`: coberto ✅ (ressalva: BOM nos JSON, ❌ acima)
- T-R-01 [regressão] / T-R-02 [regressão] — `EXECUTADA`: coberto ✅
- T-R-03 [regressão] — `EXECUTADA`: coberto ✅
- T-R-04 [regressão] — API `EXECUTADA`; worker com banco `NÃO_VERIFICADA` (⚠️)
- T-C-03 / T-C-04 [corretude] — `NÃO_VERIFICADA` por mim (⚠️); depende do relatório
- Casos ausentes que recomendo: nenhum

#### Security review
- Varredura manual A01–A10 (skill `/security-review` não rodada nesta sessão); foco A06/A08. Entrega só de devDependencies de teste: sem código de produção alterado, sem auth/input/segredo tocados (A01–A05, A07, A09–A10 inaplicáveis). A06: crítica de dev removida (2→0); nenhum advisory novo. A08: 33 pacotes novos com binários nativos (`rolldown`, `lightningcss`) entram só na árvore de teste, resolvidos de `registry.npmjs.org` com integridade no lock (`ESTÁTICA`). Sem achados Crítico/Alto novos; altas de produção remanescentes = PP-SEC-013, já rastreadas.

`ESTADO`: ❌ por um único item mecânico (BOM nos dois JSON); nenhum código nem dependência precisa mudar. Correção: regravar `audit-before.json` e `audit-after.json` em UTF-8 sem BOM **com o mesmo conteúdo** (`JSON.parse` deve passar; os números `critical=2` e `critical=0` não mudam) e ajustar o relatório se citar o arquivo. Os ⚠️ viram backlog ou ficam registrados; merge e deploy são de Leo.

##### Adendo (leitura de `validation.md` depois do fechamento acima — regra de catraca: só aperta)
- Parecer mantido: ❌ (BOM). Nada no relatório afrouxa nenhum item.
- **Aperta/confirma:** o relatório resume o lock como "93 entradas" (bate com minha contagem: 33 adicionadas + 46 removidas + 14 alteradas) e fala só em "troca do ecossistema", **sem listar os majors transitivos** exigidos pela Spec → o ⚠️ dos majors fica ativo e vira a correção 2.
- **Confirma:** T-C-03/T-C-04 são só declaração no relatório (mutação do alias → falha por módulo ausente; sentinela → 1 teste falhando) — `NÃO_VERIFICADA` por mim; worker 101/101 é declaração do Codex (`EXECUTADA` por ele, sem log anexado neste PR, ao contrário da PP-072) — não reexecutado por mim. Continua ⚠️, sem efeito no veredito.
- **Divergência a registrar:** o relatório diz que `verify:security` "sinaliza" `CLAUDE.md:33`; na minha execução saiu `ok (0 candidate files)`. Não reproduzi o alerta; o relatório classifica como falso positivo documental e eu não tenho evidência contrária.
- Os JSON de evidência com BOM são citados no relatório como "referência reproduzível" — a reprodução por parser estrito falha (❌ acima).

##### Correções obrigatórias da Rodada 1 (para o Codex — incorporadas à SPEC ATIVA, v2.1)
1. Regravar `docs/evidence/PP-SEC-014/audit-before.json` e `audit-after.json` sem BOM, mesmo conteúdo; commit `docs:` separado; provar com `JSON.parse` do blob. Não alterar mais nada.
2. Relatório (`validation.md`): listar os majors transitivos da lista ⚠️ acima, se ainda não constarem.
