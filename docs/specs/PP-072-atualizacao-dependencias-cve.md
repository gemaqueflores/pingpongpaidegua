# PP-072 — Atualização de dependências com CVE (produção e dev)

## SPEC ATIVA — PP-072 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-072 | Projeto: PingPong PaiD'egua | Branch: `fix/pp-072-dependencias-cve`
Criada por: Claude | Data: 2026-09-27 | Versão da Spec: v1
Aprovada por: Leo | Data: 2026-09-27 | Escopo: audit fix sem force + nodemailer 10; altas com major em PP-SEC-013 — aprovação em chat ("aprovo as 13 Specs", 2026-09-27), cobre a Versão da Spec v1 e as decisões embutidas
Decisões embutidas: `nodemailer` 8 → 10 (Leo, ORQ-004); altas remanescentes que exigem major de framework ficam
registradas no backlog como PP-SEC-013, **não** entram aqui.

## Skills Codex a ativar
- florestech-implementacao — obrigatória. | security-review-agent: sim — cadeia de dependências (A06) e transporte SMTP.
- e2e-playwright-agent: não. | report-builder-agent: sim — tabela de vulnerabilidades remanescentes.

## Objetivo
Zerar crítica e reduzir altas de produção sem upgrade major de framework; fechar PEND-CBTM-006.

## Critérios de aceitação
1. `npm audit fix` sem `--force` + `nodemailer@^10`; `prisma generate` rodado antes de qualquer build (mesmo passo do CI).
2. `npm audit --omit=dev`: 0 crítica. Cada alta remanescente numa tabela: pacote, cadeia, severidade, major que resolveria, motivo do adiamento.
3. Testes de e-mail (`apps/api/test/user-service.support-email.test.ts` e o de reset em `auth.service.test.ts`) sem
   rede: o mock intercepta `createTransport` do nodemailer 10 (Rodada 2: hoje tenta resolver `smtp.example.test`).
4. Builds de API e web verdes com lock novo; baseline comparado com `main` limpo antes de atribuir quebra ao upgrade.
5. `CLAUDE.md`: PEND-CBTM-006 marcada como fechada com referência a este PP; backlog ganha PP-SEC-013 (remanescentes).

## Fora de escopo
Next 16, Nest 12, Prisma 7, esbuild major; qualquer refatoração.

## Impacto técnico
`package-lock.json`, `apps/api/package.json` (nodemailer), testes de e-mail (ajuste de mock), `CLAUDE.md`,
`docs/backlog-seguranca-qualidade.md`. Nenhum código de produção além do exigido por quebra declarada.

## Plano de testes
COBERTURA: regressão=3 corretude=2 — sem RED de comportamento novo, salvo o do mock (atualização de dependência).
- T-U-01 [corretude] RED: com nodemailer 10, teste de e-mail falha tentando rede → GREEN: mock no limite correto, 0 conexão.
- T-R-01 [regressão] `npm --prefix apps/api test`, worker e `test:regression:critical` verdes.
- T-R-02 [regressão] `prisma generate` + builds API e web verdes.
- T-R-03 [regressão] e-mail de reset e de suporte: assunto/corpo iguais aos atuais (HTML escapado).
- T-C-01 [corretude] audit pós-mudança: 0 crítica; tabela das altas anexada ao relatório.

---
Estado: CAT ENCERRADO (Rodada 3) — SPEC ATIVA v1 APROVADA por Leo (2026-09-27) | Projeto: PingPong PaiD'egua | Backlog: PP-SEC-007; fecha também PEND-CBTM-006 (`CLAUDE.md`)

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-27) — Claude analista
Evidência `EXECUTADA` (Claude, 2026-09-27, `npm audit --omit=dev` na raiz do workspace): 1 crítica (`next`) +
16 altas. `fixAvailable` sem major para todas, **exceto `nodemailer`** (8.x → 10.0.11, major). Versões declaradas:
`next ^15.1.6`, `@nestjs/* ^11.0.11`, `@nestjs/config ^4.0.2`, `prisma`/`@prisma/client ^6.3.1`, `nodemailer ^8.0.1`.

#### Proposta
1. `npm audit fix` **sem** `--force` na raiz (workspaces) — só atualizações dentro do range semver.
2. `nodemailer` 8 → 10: [LEO DECIDE: aceitar major? Uso restrito a `createTransport`/`sendMail` em
   `auth.service.ts` e `user.service.ts` via import dinâmico; a CVE (SMTP command injection por `envelope.size`/
   nome de transporte) não recebe input do usuário nesses dois pontos — alcance provável baixo (`INFERÊNCIA`)].
3. Incluir devDependencies (`@next/bundle-analyzer`, PEND-CBTM-006): rodar também `npm audit` sem `--omit=dev`
   e aplicar o mesmo critério.
4. Regenerar `prisma generate` se `prisma` mudar de patch/minor.
[PENDENTE Codex: alguma atualização dentro do range quebra build/teste? Listar antes de decidir contornar]

#### Impacto técnico (hipótese)
`package-lock.json`; `package.json` de workspaces só se o range precisar subir (nunca major sem decisão Leo).
Nenhum código de produção, salvo ajuste mínimo exigido por quebra declarada.

#### Plano de testes — COBERTURA: regressão=3 corretude=1
Sem RED de comportamento (atualização de dependência não cria comportamento novo) — justificativa registrada.
- T-R-01 [regressão] `npm --prefix apps/api test` verde.
- T-R-02 [regressão] `npm run test --workspace apps-worker` e `npm run test:regression:critical` verdes.
- T-R-03 [regressão] `npm run build --workspace apps-api` e `npm run build --workspace apps-web` verdes.
- T-C-01 [corretude] `npm audit --omit=dev` após a mudança: 0 crítica e 0 alta, ou cada remanescente listado com
  motivo (major pendente de decisão, sem fix upstream).

#### Fora de escopo
Upgrade major de framework (Next 16, Nest 12, Prisma 7); qualquer refatoração.

### CAT — Rodada 2 (2026-09-27) — contraponto técnico Codex

**Posição:** implementável com ressalvas de compatibilidade, e o major do Nodemailer está autorizado por ORQ-004. Em worktree descartável, `nodemailer@10.0.11` removeu a vulnerabilidade específica. O audit de produção ainda apontou 6 ocorrências (5 altas), concentradas em cadeias de Prisma, esbuild e Next/PostCSS que exigem majors fora deste escopo; elas devem ser registradas, não corrigidas com `--force`.

**Riscos e correções de teste:** os dois testes de e-mail tentaram resolver `smtp.example.test`, indicando que o mock atual não intercepta a criação/transporte no Nodemailer 10. O ajuste precisa preservar um teste sem rede, injetando ou mockando o transporte no limite correto. O build experimental da API também falhou após a reinstalação por cliente Prisma não gerado/tipos ausentes; antes de atribuir isso ao upgrade, o ciclo deve executar a geração Prisma usada no CI e comparar com o baseline limpo. Worker e web avançaram, e o build web terminou verde. Não aceitar o audit como verde apenas porque a CVE do Nodemailer desapareceu.

**Claro para implementação:** atualizar lockfile de forma focal, adaptar o mock SMTP, executar geração Prisma antes do build e entregar a tabela de vulnerabilidades remanescentes com pacote, cadeia, severidade e razão para adiamento. Os critérios 0 crítica e remanescentes altas justificadas são tecnicamente alcançáveis sem majors de framework.

### CAT — Rodada 3 (2026-09-27) — Claude analista

Incorporado: `prisma generate` antes do build; mock SMTP para nodemailer 10 (RED real em T-U-01); tabela de altas remanescentes (Prisma/esbuild/Next/PostCSS, exigem major) → PP-SEC-013 no backlog, fora deste PP.
CAT encerrado → `## SPEC ATIVA` v1 no topo; `Aprovada por` aguarda Leo.
