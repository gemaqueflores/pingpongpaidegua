## Orientação para o Codex — PP-SEC-013 migração Next 16

### Spec aprovada
caminho: docs/specs/PP-SEC-013-prisma-next-major-cve.md
instrução de leitura: implementar exclusivamente contra `## SPEC ATIVA`; `## HISTÓRICO` (CAT Rodadas 1-3)
é consulta para não reabrir as decisões já fechadas (escopo reduzido a Next 16, middleware em Edge,
Turbopack primeiro), nunca fonte de instrução.
aprovação Leo: ✅ explícito em sessão, 2026-10-17

### Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — migração toca `apps/web/middleware.ts` (CSP/nonce da PP-059) e a rota
  `apps/web/app/api/pix-qrcode/route.ts`.
- e2e-playwright-agent: sim — já instalado desde PP-059; obrigatório validar sob build de produção real.
- report-builder-agent: não.

### Plano de testes (resumo)
- IDs: T-U-04, T-B-01, T-E-03, T-E-04 (critérios completos na Spec, seção "Plano de testes")
- arquivo de teste: estender `apps/web/e2e/csp-nonce.spec.ts` com T-E-03/T-E-04; T-U-04/T-B-01 são
  verificação de regressão da suite/build existentes, sem novo arquivo necessário
- comando de execução: `npm --prefix apps/web test && npm run build --workspace apps-web && npx playwright test apps/web/e2e/csp-nonce.spec.ts`
- COBERTURA: regressão=3 corretude=2 (já declarado na Spec)

### Contexto
branch base: `main`, commit topo `215acdd` (confirmar atualização antes de iniciar — pode já ter avançado
com o merge dos PRs anteriores desta sessão).

### Pré-condições
- `git config user.email` = gemaqueflores@gmail.com
- branch base: main
- DDL aplicado: não aplicável

### Decisões já fechadas pelo CAT — não reabrir
- Escopo é SÓ a migração Next 16 (postcss). A parte Prisma/deepmerge-ts/effect NÃO entra nesta Spec —
  vira novo item de backlog (ver seção "Arquivos a criar/modificar" sobre o backlog).
- `apps/web/middleware.ts` permanece em Edge. NÃO criar `proxy.ts`, NÃO migrar runtime para Node.js.
- Bundler: tentar Turbopack (padrão do Next 16) primeiro. Só cair para `--webpack` se houver
  incompatibilidade real e comprovada (ex.: `@next/bundle-analyzer` ou build falhando sob Turbopack) —
  documentar a decisão e o motivo explicitamente no relatório de entrega, não decidir silenciosamente.

### Arquivos a criar/modificar
- `apps/web/package.json` — `next` 15.5.27 → 16.4.2 (ou patch mais recente da 16.x disponível no momento
  da implementação), demais devDependencies conforme `npm install next@16` resolver.
- `apps/web/next.config.js` — ajustar só se o guia oficial de upgrade do Next 16 exigir
  (https://nextjs.org/docs/app/guides/upgrading/version-16). Config atual é simples (`output: "standalone"`,
  `redirects`, bundle analyzer) — não expandir além do necessário para compatibilidade.
- `apps/web/app/api/pix-qrcode/route.ts` — revisar uso de APIs de request síncronas descontinuadas no
  Next 16 (ver guia oficial, seção sobre APIs de request). Sem mudança de contrato da rota (mesmo
  input/output).
- `apps/web/e2e/csp-nonce.spec.ts` — adicionar T-E-03 (QRCode válido/inválido) e T-E-04 (`/admin/login`
  hidrata com nonce correto), mantendo T-E-01/T-E-02 existentes intactos.
- `docs/backlog-seguranca-qualidade.md` — fechar PP-SEC-013 com escopo reduzido (só Next 16, referenciar
  esta Spec); abrir novo item PP-SEC-017 para a parte Prisma/deepmerge-ts/effect, sem Spec, status
  "aguardando correção upstream — `@prisma/config@6.19.2` exige `deepmerge-ts@7.1.5`/`effect@3.18.4`
  fixos, ambos em range vulnerável; sem override seguro demonstrado".

### Arquivos que NÃO devem ser tocados
- `apps/api/src/**` — nenhuma mudança de API nesta Spec.
- `apps/web/middleware.ts` não deve ser renomeado/movido para `proxy.ts`.
- `apps/web/tests/csp-nonce.test.tsx` não deve precisar mudar o caminho de import de `../middleware` — se
  precisar, é sinal de desvio do escopo (middleware mudou de lugar/nome), declarar explicitamente por quê.

### Ordem de implementação (Red-Green-Refactor por T-*)
Ordem sugerida pelo CAT (Rodada 2, Codex): baseline → migração do Next → testes/build → E2E de produção.
Para cada T-*, em sequência, commits separados:
1. RED: test(web): T-<id> red — <desc>
2. GREEN: feat(web): T-<id> green — <desc>  (ou fix: quando for correção de incompatibilidade)
3. REFACTOR (opcional): declarar "sem refactor para T-<id>" se não houver necessidade
Concluir T-<id> antes de iniciar T-<id+1>.
Ao final: rodar suite completa de `apps/web` (unitário + build + e2e) para confirmar ausência de
regressão, e `npm audit --omit=dev` para confirmar que `next`/`postcss` saíram da lista.

### Validação antes de reportar
- T-U-04, T-B-01, T-E-03, T-E-04 implementados e verdes.
- `npm audit --omit=dev` sem `next`/`postcss` como alto/moderado.
- Suite completa de `apps/web` verde (unitário 67 + novos).
- `npm run build --workspace apps-web` verde.
- Decisão de bundler documentada (Turbopack ou `--webpack`, com motivo se for o segundo).
- DoD do CLAUDE.md do projeto cumprido.

### Reportar ao concluir
branch, commit topo, PR URL
para cada T-*: hashes red / green / refactor (ou "sem refactor")
mapeamento T-* ↔ arquivo:linha do teste
log de execução da suite completa (unitário + build + e2e)
confirmação de pre-commit hook ativo
decisão de bundler tomada e por quê
assunções feitas
arquivos deixados fora intencionalmente
confirmação de que `apps/web/middleware.ts` permanece em Edge sem mudança de runtime
