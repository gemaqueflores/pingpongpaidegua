## Spec — PP-046 — Estreitar `AuthUser.role` para literal "ADMIN"

<!-- Renomeada de PP-041 para PP-046 em 2026-09-18: PP-041 já existia mergeado (PR #40,
     fix/pp-041-jwt-secret-min-length) — colisão de ID atribuída por engano na criação desta Spec.
     Conteúdo técnico inalterado, apenas o identificador. -->

Objetivo: remover a variante de tipo `"USER"` de `AuthUser.role`, que sugere suporte multi-role inexistente e pode causar 403 silencioso se alguém usar `@Roles("USER")` sem revisar `validate()`.

Contexto: achado PEND-CBTM-004 do `CLAUDE.md` do projeto, verificado em 2026-09-18. `RolesGuard` (`apps/api/src/common/roles.guard.ts:23`) usa `user.role` de fato para autorizar — não é campo morto. Mas `validate()` (`apps/api/src/auth/jwt.strategy.ts:23-52`) só produz o literal `"ADMIN"`, nunca `"USER"`, porque `role` nunca é assinado no JWT (`apps/api/src/auth/auth.service.ts:212-216` assina só `sub`/`username`/`tokenVersion`). O único uso real de `@Roles(...)` hoje é `@Roles("ADMIN")` em `apps/api/src/admin/admin-events.controller.ts:26` e `apps/api/src/auth/auth.controller.ts:37`.

Cenário: DADO o tipo `AuthUser.role: "ADMIN" | "USER"` em `apps/api/src/common/current-user.decorator.ts:6`, QUANDO nenhum caminho do código produz `"USER"`, ENTÃO o tipo deve ser estreitado para o literal `"ADMIN"` até existir implementação real de outro papel.

Critério: `AuthUser.role` declarado como `"ADMIN"` (não union); `RolesGuard.canActivate` (`roles.guard.ts:11`) com o tipo do parâmetro genérico de `getAllAndOverride` ajustado de `Array<"ADMIN" | "USER">` para `Array<"ADMIN">`; comentário de uma linha em `jwt.strategy.ts` no `validate()` explicando que `role` vem do banco por design single-admin, não do payload do token; typecheck (`npm run build --workspace apps-api`) verde após a mudança.

Testes: T-U-01 — `RolesGuard.canActivate` retorna `true` para request autenticado com `@Roles("ADMIN")` e `user.role === "ADMIN"` (regressão — comportamento atual não deve mudar). T-U-02 — typecheck falha em tempo de compilação se algum código tentar atribuir `"USER"` a `AuthUser.role` (corretude — prova que o union foi de fato estreitado, não só documentado).

Fora de escopo: qualquer implementação de papel `"USER"` real; qualquer mudança em `RolesGuard`/`@Roles` além do tipo do array aceito; qualquer mudança em `AuthAccount` (`auth.service.ts:8-14`) ou no corpo de resposta HTTP do login (`role` retornado ao cliente permanece igual).

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é só de tipo, sem alteração de lógica de autorização ou superfície nova
- e2e-playwright-agent: não — não afeta fluxo de UI
- report-builder-agent: não — entrega trivial, relatório padrão basta
