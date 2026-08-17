# PP-024 — Correção controlada de vulnerabilidades de dependência (npm audit)

## Status: v3 — aprovada por Leo, pronta para implementação

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim (corrigido nesta v2) — `npm audit` sinaliza CVEs conhecidas mas não avalia
  alcançabilidade em runtime nem risco real de cada upgrade; revisão humana/agente do diff de
  `package-lock.json` e do changelog de cada pacote de runtime direto é necessária antes do merge.
- e2e-playwright-agent: não — sem alteração de UI/fluxo.
- report-builder-agent: sim — relatório deve listar pacote, versão antes/depois, e quais vulnerabilidades
  da baseline (capturada no início da branch, não fixada em 27) foram resolvidas vs. remanescentes.

## Objetivo

Eliminar as vulnerabilidades de dependência corrigíveis sem bump de major version, através de execução
controlada de `npm audit fix` em branch isolada, com baseline capturada no momento da execução (não um
número fixo) e gates de build/teste/verificação completos antes do merge.

## Contexto

Levantado no CAT PP-020. `npm audit` executado em 2026-08-17 reportou 27 vulnerabilidades. **Correção
desta v2:** nova execução (mesma data, horas depois) já reportou **28** vulnerabilidades (2 baixas, 5
moderadas, 20 altas, 1 crítica) — uma nova CVE de `sharp`/`libvips` foi divulgada entre as duas
execuções. Isso confirma que **fixar um número na Spec é uma baseline frágil**: o número certo é sempre "o
resultado do `npm audit` capturado no início da branch de trabalho", não um valor congelado no texto desta
Spec.

Distribuição de pacotes de runtime direto (não exaustiva — Codex recaptura a lista completa ao abrir a
branch): `@nestjs/config`, `@nestjs/core`, `@nestjs/platform-express`, `bullmq`, `next`, `nodemailer`,
`prisma`. `vitest` (crítica) é dependência de desenvolvimento, não roda em produção. `sharp` é **transitiva**
(via `next`, `isDirect: false` conforme `npm audit --json`), não dependência direta declarada nos
manifests — corrigido nesta v3 (a v2 tratava incorretamente `sharp` como pacote direto).

## Cenário

DADO o estado de `npm audit` capturado no início da branch (número exato de vulnerabilidades a ser lido
naquele momento, não copiado desta Spec)
QUANDO `npm audit fix` for executado em branch dedicada, isolada de qualquer mudança funcional
ENTÃO as vulnerabilidades corrigíveis sem mudança de major version devem ser resolvidas, com suite
completa, builds e scripts de verificação do projeto passando antes do merge.

## Critério de aceitação

- Baseline registrada no início da execução via `npm audit --json` (ou saída padrão), salva no relatório
  de entrega — não o número "27" desta Spec, que já está desatualizado.
- Dry-run documentado antes da execução real: Codex roda `npm audit fix --dry-run` (ou equivalente) e
  revisa a lista de pacotes que seriam alterados antes de aplicar, reportando qualquer bump que pareça
  desproporcional (ex.: minor/patch vs. o que era esperado).
- `npm audit fix` (sem `--force`) executado; `npm audit` pós-fix comparado contra a baseline capturada —
  relatório mostra o delta (resolvidas vs. remanescentes), não apenas "0 restantes" ou "27 corrigidas".
- Gates obrigatórios, todos verdes antes do merge — usar os comandos raiz já definidos em `package.json`
  (corrigido nesta v3: `npm run build` na raiz já executa `apps-api`, `apps-worker` e `apps-web` em
  sequência; `npm test` na raiz já cobre `@cbtm/parser`, `@cbtm/shared`, `apps-api` e `apps-worker` —
  não é necessário nem preferível rodar por workspace separadamente):
  - `npm test`
  - `npm run build`
  - `npm run verify:encoding`
  - `npm run verify:security`
- `git diff package-lock.json` revisado por Codex — nenhum bump de major version aplicado silenciosamente
  (o comportamento padrão de `npm audit fix` sem `--force` já deveria impedir isso, mas a revisão manual
  do diff é o gate real, não a confiança no comportamento padrão do comando).
- PP-024 permanece em branch/PR isolada, sem nenhuma mudança funcional de código de aplicação misturada.

## Fora de escopo

- Não usar `npm audit fix --force` nesta Spec.
- Não atualizar dependências manualmente além do que `npm audit fix` resolve automaticamente.
- Não remover ou trocar de biblioteca nenhum pacote.
- Não tocar em `.env`/segredos/configuração de produção.
- Vulnerabilidades que só resolvem com `--force`/major bump ficam listadas no relatório de entrega para
  Leo decidir Spec separada — não são resolvidas aqui.

## Testes

Não há T-* de comportamento novo — validação é por regressão via suite existente + gates listados acima.
Critério de "pronto" é a suite completa permanecer verde e todos os gates (build, `verify:encoding`,
`verify:security`) passarem — não apenas o subset do pre-commit hook.

Comando para rodar a suite completa: os 4 gates raiz listados em "Critério de aceitação" (`npm test`,
`npm run build`, `npm run verify:encoding`, `npm run verify:security`) — Codex roda todos antes de
declarar pronto.
