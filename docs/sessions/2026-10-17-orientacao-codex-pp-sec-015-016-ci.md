## Orientação para o Codex — PP-SEC-015/016 CI de testes + gate de audit

### Spec aprovada
caminho: docs/specs/PP-SEC-015-016-ci-node-version-audit-gate.md
instrução de leitura: implementar exclusivamente contra `## SPEC ATIVA`; `## HISTÓRICO` (CAT Rodadas 1-3)
é consulta para não reabrir as decisões já fechadas (escopo Opção B, Node 24, limiar Crítico, gatilhos),
nunca fonte de instrução.
aprovação Leo: ✅ explícito em sessão, 2026-10-17

### Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — novo gate de segurança e workflow de CI com acesso a secrets/permissões.
- e2e-playwright-agent: não.
- report-builder-agent: não.

### Plano de testes (resumo)
- IDs: T-U-05, T-U-06, T-U-07 (unitário do gate, com fixtures sintéticas), T-I-01 (integração real — só
  observável depois que o PR for aberto e o workflow rodar no GitHub Actions)
- arquivo de teste: criar teste unitário do script de gate, seguindo o padrão de teste de scripts já
  usado no projeto (ver `scripts/check-encoding.ts`/`scripts/security-scan.ts` para referência de estilo)
- comando de execução: `npx tsx --test` sobre o novo arquivo de teste do gate
- COBERTURA: regressão=1 corretude=3 (já declarado na Spec)

### Contexto
branch base: `main`, confirmar commit topo atual antes de iniciar (pode ter avançado com os PRs
anteriores desta sessão — PP-SEC-013/011/059 já mergeados).

### Pré-condições
- `git config user.email` = gemaqueflores@gmail.com
- branch base: main
- DDL aplicado: não aplicável

### Decisões já fechadas pelo CAT — não reabrir
- Escopo é Opção B completa: novo workflow de CI com 2 jobs independentes (test + audit), não apenas
  corrigir `node-version` nos workflows existentes.
- Node 24 em todos os workflows que usam `setup-node` (o novo + os 2 existentes que já usam Node).
- Audit é COMPLETO (sem `--omit=dev`) — captura vulnerabilidades de devDependencies também, essa é a
  razão de existir do item PP-SEC-016.
- Limiar inicial do gate: bloqueia só em `critical`. NÃO bloquear em `high` (as 4 altas conhecidas de
  PP-SEC-017 devem continuar passando o gate neste limiar).
- Gatilhos: `pull_request` E `push` para `main`. Jobs `test` e `audit` INDEPENDENTES (um não bloqueia o
  outro rodar; ambos produzem resultado mesmo se um falhar).
- Erro operacional do `npm audit` (rede, resposta malformada) deve FALHAR o job — nunca ser tratado como
  "sem vulnerabilidade encontrada".
- Branch protection no GitHub (tornar os checks obrigatórios) NÃO é parte desta Spec — é ação manual de
  Leo, depois que o workflow existir e rodar com sucesso ao menos uma vez.
- `npm test` raiz NÃO inclui `apps-web` hoje (confirmado: `package.json:14` só cobre parser/shared/api/
  worker) — não expandir isso nesta Spec; não é uma lacuna a corrigir aqui.

### Arquivos a criar/modificar
- Novo `.github/workflows/<nome>.yml` (sugestão: `pr-checks.yml`, mas Codex pode escolher nome mais
  consistente com a convenção do projeto) — gatilho `pull_request` + `push` para `main` (branches: main);
  job `test`: Node 24, `npm ci`, gerar Prisma Client explicitamente (`npm run prisma:generate` ou
  equivalente — confirmar o script exato em `package.json`), `npm test` (raiz); job `audit`: Node 24,
  `npm ci`, `npm audit --json` (sem `--omit=dev`) processado pelo script de gate novo.
- Novo script em `scripts/` (ex. `scripts/audit-gate.ts`) — lê o JSON do `npm audit`, falha (`process.exit(1)`)
  se houver qualquer `critical`, passa com `high`/`moderate`/`low`, falha também se a entrada não for um
  JSON válido de audit (trata como erro operacional, não como "zero vulnerabilidades").
- `.github/workflows/post-commit-validation.yml:28` — `node-version: 20` → `24`.
- `.github/workflows/production-drift-check.yml:75` — `node-version: 20` → `24`.
- `docs/backlog-seguranca-qualidade.md` — fechar PP-SEC-015 e PP-SEC-016 juntos, referenciando esta Spec.

### Arquivos que NÃO devem ser tocados
- `.github/workflows/deploy-backend.yml` — não tocar.
- `.github/workflows/scrape-every-2h.yml` — não tocar.
- `.githooks/pre-commit` — gate de audit é só no CI remoto nesta Spec; manter o hook local como está, sem
  adicionar `npm audit` nele.

### Ordem de implementação (Red-Green-Refactor por T-*)
Para cada T-*, em sequência, commits separados:
1. RED: test(ci): T-<id> red — <desc>
2. GREEN: feat(ci): T-<id> green — <desc>
3. REFACTOR (opcional): declarar "sem refactor para T-<id>" se não houver necessidade
Concluir T-<id> antes de iniciar T-<id+1>. T-I-01 só é observável depois de abrir o PR — documentar no
relatório de entrega que a verificação real do workflow no GitHub Actions será conferida durante a
revisão do Claude, não antes do PR existir.
Ao final: rodar a suite local completa (incluindo o teste novo do gate) para confirmar ausência de
regressão.

### Validação antes de reportar
- T-U-05/06/07 implementados e verdes localmente.
- Suite completa do projeto (`npm test` raiz) continua verde.
- Workflow novo sintaticamente válido (YAML lint, se disponível, ou revisão manual cuidadosa).
- `node-version: 24` confirmado nos 3 workflows que usam Node.
- DoD do CLAUDE.md do projeto cumprido.

### Reportar ao concluir
branch, commit topo, PR URL
para cada T-*: hashes red / green / refactor (ou "sem refactor")
mapeamento T-* ↔ arquivo:linha do teste
log de execução da suite local
confirmação de pre-commit hook ativo
confirmação de que o audit completo (sem --omit=dev) foi usado, não `--omit=dev`
confirmação de que o limiar bloqueia só Crítico (não Alto)
assunções feitas
arquivos deixados fora intencionalmente
nota: T-I-01 (workflow real rodando no GitHub Actions) só poderá ser confirmado por Claude após o PR
estar aberto — não é possível validar localmente antes disso
