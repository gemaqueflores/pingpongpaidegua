# PP-072 — Atualização de dependências com CVE (produção e dev)

<!-- Spec unificada v7. Sem ## SPEC ATIVA: ciclo tripartite em andamento. Codex NÃO implementa a partir do HISTÓRICO. -->
Estado: CAT RASCUNHO — Rodada 1 | Projeto: PingPong PaiD'egua | Backlog: PP-SEC-007; fecha também PEND-CBTM-006 (`CLAUDE.md`)

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
