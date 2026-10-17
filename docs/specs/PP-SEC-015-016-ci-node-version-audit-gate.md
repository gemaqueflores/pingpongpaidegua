# PP-SEC-015/016 — CI: node-version incompatível com Vitest 5 + ausência de gate de npm audit completo

<!-- Spec unificada v7. ## SPEC ATIVA é a única seção de instrução; ## HISTÓRICO é consulta. -->

## SPEC ATIVA — PP-SEC-015-016 — v1
ID: PP-SEC-015-016 | Projeto: PingPong PaiD'egua | Branch: fix/pp-sec-015-016-ci-testes-audit
Criada por: Claude | Data: 2026-10-17 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-10-17 | Escopo: novo workflow de CI em pull_request + push main com job de testes (parser/shared/api/worker) e job de audit completo (sem --omit=dev) bloqueando em Crítico; Node 24 nos 3 workflows que usam Node

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — novo gate de segurança (audit) e novo workflow com permissões de CI;
  revisar que não introduz exposição de secrets nem permissões excessivas
- e2e-playwright-agent: não — mudança é infraestrutura de CI, sem fluxo de UI
- report-builder-agent: não

## Objetivo
Eliminar duas lacunas de processo relacionadas: (1) nenhum PR passa hoje por gate automatizado de testes
antes do merge, e os workflows existentes usam Node 20, incompatível com Vitest 5 (packages/parser e
packages/shared); (2) não existe gate de `npm audit` completo no CI nem no pre-commit, então
vulnerabilidades críticas de devDependencies só são descobertas por auditoria manual esporádica.

## Contexto
PP-SEC-015 e PP-SEC-016 eram itens separados no backlog, mas o CAT (Rodadas 1-3) identificou causa comum:
ausência de CI de testes/audit em PR. Reexecução/Grep confirmou que os 4 workflows existentes
(`deploy-backend.yml`, `post-commit-validation.yml`, `production-drift-check.yml`, `scrape-every-2h.yml`)
não executam `npm test` nem `vitest` em lugar nenhum — são deploy, smoke de produção e drift check,
nunca testes de regressão. O pre-commit hook local já roda uma cerca crítica (`test:regression:critical`),
mas isso só protege quem tem o hook ativo — sem rede de segurança do lado do GitHub.

## Causa raiz
- Causa imediata: `node-version: 20` nos workflows que usam Node (incompatível com Vitest 5 e com a flag
  `--experimental-test-module-mocks` de `apps/api`, que exige >=22.3); ausência de qualquer execução de
  `npm audit` em CI.
- Causa sistêmica: o projeto nunca teve um workflow de CI de testes desde sua criação — não há decisão
  documentada que explique essa ausência (confirmado pelo Codex, Rodada 2), é lacuna, não escolha
  deliberada.
- Padrão: 4ª ocorrência nesta sessão de "lacuna de processo só descoberta por auditoria manual"
  (PEND-CBTM-006, PP-SEC-014, PP-SEC-013/017, agora PP-SEC-015/016) — candidato forte a registrar em
  `EPISODIC_MEMORY.md` se Leo concordar; Claude não promove sozinho, só sinaliza aqui.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Job de testes roda em PR e push para main**
DADO um PR aberto contra `main` (ou um push direto para `main`)
QUANDO o workflow novo dispara
ENTÃO um job `test` instala dependências (`npm ci`), gera o Prisma Client explicitamente
(`npm run prisma:generate` ou equivalente), e executa `npm test` (parser, shared, api, worker — `apps-web`
não incluído, conforme `package.json:14` atual) usando Node 24; o job falha se qualquer teste falhar.

**Cenário 2 — Job de audit roda independente do job de testes**
DADO o mesmo PR/push
QUANDO o workflow novo dispara
ENTÃO um job `audit` independente instala dependências e executa `npm audit` **completo** (sem
`--omit=dev`) com um script de gate que falha o job se houver qualquer vulnerabilidade Crítica; falha de
rede/resposta inválida do `npm audit` também falha o job (nunca é tratado como "sem vulnerabilidade").

**Cenário 3 — Gate de audit não quebra por vulnerabilidades Altas já conhecidas**
DADO as 4 vulnerabilidades Altas já conhecidas e aceitas temporariamente (PP-SEC-017, cadeia
Prisma/deepmerge-ts/effect)
QUANDO o job `audit` roda
ENTÃO o job passa (limiar inicial é só Crítico) — sem precisar de allowlist/exceção explícita para essas
4 altas neste momento.

**Cenário 4 — Consistência de versão Node nos workflows existentes**
DADO os 3 workflows que hoje usam `setup-node` (`post-commit-validation.yml`,
`production-drift-check.yml`, e o novo workflow desta Spec)
QUANDO qualquer um deles roda
ENTÃO todos usam `node-version: 24`, evitando divergência de ambiente entre workflows do mesmo
repositório.

## Critérios de aceitação
- Novo arquivo `.github/workflows/<nome>.yml` (Codex escolhe o nome, ex. `pr-checks.yml`) com gatilho
  `pull_request` + `push` para `main`, 2 jobs independentes (`test`, `audit`).
- Job `test`: Node 24, `npm ci`, geração explícita do Prisma Client, `npm test` (raiz) executado e
  resultado refletido no status do job.
- Job `audit`: Node 24, `npm ci`, `npm audit --json` (sem `--omit=dev`) processado por um script novo em
  `scripts/` que falha (`exit 1`) se houver qualquer vulnerabilidade `critical`, passa se houver só
  `high`/`moderate`/`low`, e falha também se o comando `npm audit` retornar erro operacional (rede,
  resposta malformada) em vez de dado de vulnerabilidade válido.
- `post-commit-validation.yml` e `production-drift-check.yml`: `node-version` 20 → 24.
- `docs/backlog-seguranca-qualidade.md`: PP-SEC-015 e PP-SEC-016 fechados juntos, referenciando esta Spec.
- Script do gate de audit testável isoladamente com fixtures sintéticas (JSON simulando resposta do
  `npm audit`), sem depender de rodar o audit real para o teste unitário.

## Fora de escopo
- Configurar branch protection no GitHub (tornar os checks obrigatórios para merge) — ação manual de Leo
  no repositório, feita depois que o workflow existir e rodar com sucesso ao menos uma vez.
- Incluir `apps-web` no job de testes deste workflow — `npm test` raiz não cobre web hoje; se for
  desejado no futuro, é uma Spec própria (adicionar `apps-web` ao script `test` raiz ou criar step
  separado).
- Allowlist/exceção para vulnerabilidades Altas específicas (ex. PP-SEC-017) — não necessário com o
  limiar "só Crítico"; se Leo decidir no futuro bloquear Altas também, precisa de nova Spec definindo o
  mecanismo de exceção.
- Medição de duração/custo do novo workflow — não há dado disponível antes da implementação; não é
  critério de aceitação desta Spec.
- Qualquer mudança nos workflows de deploy/scraping (`deploy-backend.yml`, `scrape-every-2h.yml`) — não
  tocados.

## Impacto técnico
- Arquivos a criar/modificar:
  - Novo `.github/workflows/<nome>.yml` — job `test` + job `audit`.
  - Novo script em `scripts/` (ex. `scripts/audit-gate.ts`) — processa `npm audit --json` e aplica o
    limiar de severidade; testável com fixtures sintéticas.
  - `.github/workflows/post-commit-validation.yml:28` — `node-version: 20` → `24`.
  - `.github/workflows/production-drift-check.yml:75` — `node-version: 20` → `24`.
  - `docs/backlog-seguranca-qualidade.md` — fechar PP-SEC-015 e PP-SEC-016.
- Arquivos que NÃO devem ser tocados: `deploy-backend.yml`, `scrape-every-2h.yml`, `.githooks/pre-commit`
  (gate de audit é só no CI remoto nesta Spec, não no hook local — manter hook local como está).
- DDL / migração: não aplicável.
- Contrato de API alterado: não aplicável.
- Dependências novas: nenhuma biblioteca nova necessária — `npm audit --json` é nativo do npm; o script
  de gate usa Node/TS já disponíveis no projeto (mesmo padrão de `scripts/check-encoding.ts`).

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (gate de audit), integração (CI real em runner limpo)
- arquivos de teste a criar: teste unitário do script de gate (`scripts/audit-gate.test.ts` ou local
  equivalente ao padrão já usado no projeto para scripts)
- fixtures/mocks: JSON sintético simulando saída de `npm audit --json` com 0/1/N vulnerabilidades em cada
  severidade, e um caso de erro operacional (JSON malformado/ausente)

COBERTURA: regressão=1 corretude=3

### T-U-05 — gate falha com vulnerabilidade crítica sintética (corretude)
Camada: função/script (`scripts/audit-gate.ts`)
DADO um fixture JSON com 1 vulnerabilidade `critical` (valor fixado no fixture, não gerado pela função)
QUANDO o gate processa o fixture
ENTÃO o gate retorna/sai com código de falha (exit != 0) [corretude]

### T-U-06 — gate passa com apenas vulnerabilidades altas (corretude)
Camada: função/script
DADO um fixture JSON com N vulnerabilidades `high`/`moderate`/`low` e 0 `critical`
QUANDO o gate processa o fixture
ENTÃO o gate retorna/sai com sucesso (exit 0) — prova que o limiar é só Crítico, não bloqueia por Alto
[corretude]

### T-U-07 — gate falha em erro operacional do audit (corretude)
Camada: função/script
DADO uma saída inválida/malformada simulando falha de rede ou resposta corrompida do `npm audit`
QUANDO o gate processa essa entrada
ENTÃO o gate falha (exit != 0) — nunca trata ausência de dado válido como "sem vulnerabilidade" [corretude]

### T-I-01 — workflow real roda em checkout limpo do GitHub Actions (regressão/integração)
Camada: integração (CI real)
DADO o PR desta própria Spec aberto contra `main`
QUANDO o novo workflow dispara
ENTÃO o job `test` executa a suite real (parser/shared/api/worker) com resultado refletido no PR, e o job
`audit` roda o `npm audit` real do projeto (0 crítica esperada, conforme estado atual confirmado nesta
sessão) — confirma que o pipeline funciona em ambiente real do GitHub, não só localmente [regressão]

### Cobertura de falhas silenciosas
- `[não aplicável — Spec é infraestrutura de CI, sem UI/formulário/exclusão]`.

### Comando para rodar a suite
`npx tsx --test scripts/audit-gate.test.ts` (ou equivalente ao padrão de teste de scripts já usado no
projeto) + verificação do próprio PR no GitHub Actions após abertura (T-I-01 só é observável no PR real).

## Skills Codex a ativar — justificativa
- `security-review-agent`: obrigatória — introduz gate de segurança novo (audit) e um workflow de CI com
  acesso a `secrets`/permissões de repositório; revisar que não expõe segredo nem amplia permissão
  desnecessariamente (workflow não precisa de `permissions: write`, só `contents: read`).

---

## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-10-17)

**Origem dos itens:** `docs/backlog-seguranca-qualidade.md` PP-SEC-015 (Baixo, não bloqueante) e
PP-SEC-016 (Médio, não bloqueante).

#### Estado atual (confirmado por leitura direta, não só pelo texto do backlog)

- `node-version: 20` em `.github/workflows/post-commit-validation.yml:28` e
  `production-drift-check.yml:75` — confirmado.
- `.github/workflows/`: só 4 arquivos (`deploy-backend.yml`, `post-commit-validation.yml`,
  `production-drift-check.yml`, `scrape-every-2h.yml`). **Nenhum workflow executa `npm test` ou
  `vitest`** — confirmado por Grep em todo o diretório. `post-commit-validation` roda só
  `validate:update:prod` (smoke de produção); `production-drift-check` roda `drift:check` (SSH na VM);
  `deploy-backend` faz deploy via SSH; `scrape-every-2h` não foi lido ainda nesta rodada, mas pelo nome
  não é candidato a rodar testes.
- **Achado que amplia o escopo original do backlog:** o texto de PP-SEC-015 trata o problema como "Node
  20 incompatível com Vitest 5, mas sem quebra ativa porque parser/shared não rodam no CI" — isso é
  verdade, mas a causa raiz mais ampla é que **nenhum PR passa por gate automatizado de testes antes do
  merge**. O pre-commit hook local (`test:regression:critical`) já roda parte da suite (inclusive
  `@cbtm/shared -- performance.test.ts`, que usa Vitest 5, sem problema porque a máquina local tem
  Node 24), mas isso só protege quem tem o hook ativo localmente — não há rede de segurança no lado do
  GitHub.
- `apps/api/package.json:10`: `test` usa `--experimental-test-module-mocks`, exige Node >= 22.3
  (confirmado pelo próprio backlog, não re-verificado nesta rodada — flag é do runner nativo `node --test`,
  não do Vitest).
- `package.json` raiz (`test`): roda `@cbtm/parser`, `@cbtm/shared`, `apps-api`, `apps-worker` em sequência
  — é o candidato natural a rodar em CI de PR, mas precisa de Node >= 22.3 (API) e compatível com
  Vitest 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`, conforme registrado no backlog).
- `.githooks/pre-commit`: só mojibake + `test:regression:critical` (subconjunto pequeno, não a suite
  completa). Sem gate de `npm audit`.
- Nenhum `engines` declarado em `package.json` raiz nem em `apps/api/package.json` — não há trava
  declarativa de versão de Node para quem desenvolve localmente.

#### O que fazer — ambiguidades identificadas

1. **[PENDENTE: escopo — só corrigir node-version nos workflows existentes, ou criar CI de PR que rode a
   suite completa?]**
   - Opção A (mínima, fiel ao texto original do backlog): trocar `node-version: 20` para uma versão
     compatível (`22` ou `24`) nos 2 workflows existentes, preparando o terreno para incluir
     parser/shared no futuro, sem adicionar novo workflow agora.
   - Opção B (mais ampla, resolve a causa sistêmica real): criar um novo workflow de CI que roda em
     `pull_request` (ou `push` para `main`), executando `npm test` (suite completa) + `npm audit
     --omit=dev` com gate de severidade, usando Node compatível. Isso cobre PP-SEC-015 e PP-SEC-016 ao
     mesmo tempo, mas é escopo maior — introduz CI de PR que não existe hoje.
   - Risco de não fazer nada além do mínimo: PP-SEC-016 (ausência de gate de audit) continuaria sem
     solução, exigindo uma 2ª Spec depois.

2. **[PENDENTE: qual versão de Node usar nos workflows — 22 ou 24?]**
   - `apps/api` exige `>= 22.3` (flag experimental). Vitest 5 aceita `^22.12.0 || ^24.0.0 || >=26.0.0`.
     `22.12.0` ou mais recente satisfaz ambos. Ambiente local roda `24.13.0`. Usar `24` alinha com o
     ambiente de desenvolvimento local e tem mais margem futura; usar `22.12+` é mais conservador.

3. **[PENDENTE: limiar do gate de `npm audit` — falhar em Crítico apenas, ou também em Alto?]**
   - Backlog original sugere "falhar em Crítico" como ponto de partida. Mas a esta altura da sessão,
     PP-SEC-017 (Prisma/deepmerge-ts/effect) já deixou 4 altas conhecidas e aceitas temporariamente no
     projeto — se o gate falhar em Alto, ele quebraria o CI imediatamente por um item já conhecido e sem
     correção segura disponível. Precisa de mecanismo de exceção/allowlist para avisos sem fix, não só um
     limiar fixo.

4. **[PENDENTE: o gate de audit roda em todo PR, ou só em push para main/agendado?]**
   - Rodar em todo PR dá feedback mais rápido, mas qualquer `npm install` de dependência nova dispara o
     gate imediatamente — pode ser percebido como fricção. Rodar só em push para `main`/agendado é menos
     invasivo, mas detecta o problema depois do merge, não antes.

#### Hipótese de impacto técnico (preliminar)

- **Se Opção A (mínima):** `.github/workflows/post-commit-validation.yml`,
  `.github/workflows/production-drift-check.yml` — só a linha `node-version`. Sem novo arquivo.
- **Se Opção B (CI completo):** novo arquivo `.github/workflows/<nome>.yml` rodando `npm ci`, `npm test`,
  `npm audit --omit=dev` com script de gate por severidade (provavelmente novo script em `scripts/`,
  seguindo o padrão de `scripts/check-encoding.ts`/`scripts/security-scan.ts` já existentes). Mais a
  correção de `node-version` nos 2 workflows existentes (consistência).

### CAT — Rodada 2 (Codex) — 2026-10-17

Resposta transportada por Leo, verificada por Claude via Grep no histórico local do Codex (match em
`~/.codex/sessions/2026/10/17/rollout-2026-10-17T01-04-35-...jsonl`) — proveniência confirmada. Evidência
estática declarada pelo próprio Codex; sem execução de suíte nem alteração de arquivos.

Posição por item:

1. **[RESOLVIDO] Escopo: Opção B (CI completo), com correção à Rodada 1.** Viável tecnicamente, depende
   de decisão de Leo. **Correção factual:** PP-SEC-016 exige audit **completo, sem `--omit=dev`** — a
   Rodada 1 de Claude não havia sido explícita sobre isso; o objetivo original do item é justamente
   capturar vulnerabilidades de devDependencies (ver PEND-CBTM-006/PP-SEC-014, que só apareceram por
   auditoria manual). Opção A sozinha resolveria só PP-SEC-015.

2. **[RESOLVIDO] Node: 24.** Lockfile confirma Vitest 5.0.3 aceita Node 24; atende também
   `apps/api` (`--experimental-test-module-mocks`, >=22.3) e alinha com o ambiente de desenvolvimento
   local (confirmado `v24.13.0`). Sem necessidade de matriz 22/24 neste escopo.

3. **[RESOLVIDO] Limiar do audit: bloquear só Crítico inicialmente.** Atende à proposta original do
   backlog sem bloquear pelas 4 altas já conhecidas e aceitas (PP-SEC-017). Allowlist de altas fica
   desnecessária neste limiar; se Leo decidir bloquear altas também no futuro, precisará de exceções
   específicas e revisáveis. **Importante:** falha de rede, resposta inválida ou erro operacional do
   `npm audit` deve fazer o job falhar — nunca ser interpretado como "sem vulnerabilidade encontrada".

4. **[RESOLVIDO] Gatilhos: todo `pull_request` e `push` para `main`, jobs independentes (testes e audit
   separados).** Garante que ambos produzam resultado mesmo se um falhar. Observação importante do
   Codex: criar o YAML não garante bloqueio de merge por si só — exige também configurar branch
   protection no GitHub (fora do escopo de um arquivo de workflow; é configuração do repositório, ação
   que Leo precisa fazer separadamente, não uma Spec de código).

**Achados adicionais do Codex, verificados por Claude:**
- Testes usam mocks/fixtures/funções puras, algum HTTP com servidor local em porta dinâmica — **sem
  Postgres/Redis real** (confirmado por Claude: busca por `PrismaClient`/`createConnection`/`new Redis(`
  nos diretórios de teste de `apps/api`/`apps/worker` não encontrou nenhum uso). Precisa comprovação em
  runner limpo do GitHub Actions antes de considerar certo (ambiente pode diferir).
- `apps/api` e `apps/worker` têm `pretest` que compila `@cbtm/shared`/`@cbtm/parser` — confirmado por
  Claude em `apps/api/package.json:9` e `apps/worker/package.json:10`. Geração do Prisma Client
  (`prisma:generate` no `package.json` raiz) precisa ser explicitada no CI, pois não é automática via
  `postinstall` — confirmado por Claude (nenhum `postinstall` com `prisma generate` encontrado).
- `npm test` raiz cobre parser/shared/api/worker, **não inclui `apps-web`** — confirmado por Claude em
  `package.json:14`. A Spec precisa nomear essa cobertura com precisão (web fica fora deste CI, teria que
  ser workflow/step separado se quiséssemos cobrir).
- Não há decisão documentada explicando a ausência de CI de testes — não é possível afirmar que foi
  deliberada.
- Duração/consumo de CI ainda não medidos — sem estimativa disponível.
- Sugestão de T-*: provar o gate primeiro com entradas sintéticas (crítica bloqueia, só altas passam no
  limiar proposto, erro operacional bloqueia), depois validar instalação/testes reais em checkout limpo
  no GitHub Actions. Fixtures sintéticas só para o teste do gate; o audit real continua consultando as
  dependências reais do projeto.

### CAT — Rodada 3 (Claude) — 2026-10-17

Resolução consolidada: escopo passa a ser Opção B (CI completo de PR) com audit **completo** (sem
`--omit=dev`), Node 24, limiar inicial "bloqueia só Crítico", gatilhos em `pull_request` + `push main`
com jobs independentes para testes e audit.

#### Itens [LEO DECIDE] — bloco consolidado

- **Confirmar Opção B (CI completo) em vez de só corrigir `node-version`** — maior escopo, mas resolve
  PP-SEC-015 e PP-SEC-016 juntos, numa única Spec.
- **Branch protection no GitHub:** criar o workflow não bloqueia merge por si só — Leo precisa configurar
  manualmente os checks como obrigatórios nas regras de proteção da branch `main` depois que o workflow
  existir e rodar pelo menos uma vez com sucesso (passo fora desta Spec, ação operacional de Leo no
  GitHub, não código).
- **Timing:** executar já, ou aguardar alguma prioridade concorrente?

#### Hipótese de impacto técnico final

- Novo arquivo `.github/workflows/pr-checks.yml` (nome sugestivo; Codex pode propor nome diferente na
  implementação) com 2 jobs independentes: `test` (Node 24, `npm ci`, `prisma generate` explícito, `npm
  test` raiz — parser/shared/api/worker, não web) e `audit` (Node 24, `npm ci`, `npm audit` completo sem
  `--omit=dev`, script de gate que falha em Crítico e trata erro operacional como falha).
- Novo script em `scripts/` (seguindo padrão de `scripts/check-encoding.ts`/`scripts/security-scan.ts`)
  para o gate de severidade do audit, testável com fixtures sintéticas.
- `.github/workflows/post-commit-validation.yml` e `production-drift-check.yml`: `node-version` 20 → 24,
  por consistência (mesmo não rodando testes, alinhar a versão do runner evita divergência futura).
- `docs/backlog-seguranca-qualidade.md`: fechar PP-SEC-015 e PP-SEC-016 juntos, referenciando esta Spec.

**Decisão de Leo (2026-10-17):** Opção B completa confirmada — novo workflow de CI rodando testes +
audit completo em todo PR, Node 24, bloqueando só Crítico por ora. Leo configurará branch protection
manualmente no GitHub depois que o workflow existir e rodar com sucesso pelo menos uma vez (fora do
escopo desta Spec).

### CAT — Fechamento (2026-10-17)

Rascunho aprovado por Leo (✅). Ciclo tripartite completo (3 rodadas). Spec formal segue abaixo.
