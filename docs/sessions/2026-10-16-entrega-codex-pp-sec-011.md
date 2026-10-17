# Entrega para revisão — PP-SEC-011

Spec: `docs/specs/PP-SEC-011-token-admin-web-storage.md`, SPEC ATIVA v1, aprovada por Leo em 2026-10-16.
Branch: `fix/pp-sec-011-mitigacao-token-storage`. Base: `6c72e52`.

Produção: somente comentários em `apps/web/lib/auth.ts`, documentando mitigação residual B2 e bloqueio PEND-CBTM-001. Nenhuma linha funcional alterada. Backlog fechado conforme decisão B2; fechamento não significa eliminação da exposição via XSS.
Testes: mock de Storage e window restaurado após cada teste, sem dependência nova, no runner node:test/tsx existente.

| ID | Teste | Commit etapa Red | Commit Green | Refactor |
|---|---|---|---|---|
| T-U-01 | apps/web/tests/auth.test.tsx:28 | e4b49b2 | b9da0d5 | 8a8eea7 |
| T-U-02 | apps/web/tests/auth.test.tsx:47 | 573850e | 0d548d3 | sem refactor próprio |
| T-U-03 | apps/web/tests/auth.test.tsx:58 | 99295d7 | e8cf7f7 | sem refactor próprio |

## Evidência executada

Os três testes passaram antes das respectivas etapas de documentação: comportamento preexistente, conforme exceção expressa na orientação. Não houve RED funcional. Primeiro ensaio T-U-01 falhou por mock.property exigir propriedade window preexistente; fixture corrigida antes do commit, sem alterar produção.

Última suíte web: `npm --prefix apps/web test`, 67 testes, 67 pass, 0 fail, 0 skipped, duração 3521.363 ms.
Suíte API: `npm --prefix apps/api test`, 247 testes, 247 pass, 0 fail, 0 skipped.
Builds: `npm run build --workspace apps-api` e `npm run build --workspace apps-web` concluídos; web emite aviso de runtime edge desabilitar geração estática na página afetada, sem impedir build.
Logs locais: `%TEMP%/pp-sec-011-web-final.log`, `pp-sec-011-api.log`, `pp-sec-011-build-api.log`, `pp-sec-011-build-web.log`.

`npm run verify:changed` interrompeu em encoding de arquivos preexistentes não relacionados em `.codex-worktrees/` e `docs/evidence/PP-063/`. Não foram alterados. Checagens explícitas `npm run verify:encoding -- <arquivos da entrega>` e `npm run verify:security -- <arquivos da entrega>` passaram (4 arquivos antes deste relatório). Scanner da skill também passou para auth e testes.

Hook preexistente ativo: `.githooks/pre-commit`, core.hooksPath=.githooks; executa encoding staged e `npm run test:regression:critical`. Todos os commits com hook normal; nenhum --no-verify. Cerca crítica passou em cada commit.

## Desvios e assunções

- Por erro de sequenciamento, comentários iniciais de auth foram staged enquanto o hook do primeiro commit executava e entraram em e4b49b2 junto do teste. b9da0d5 acrescenta a referência ao bloqueio estrutural. Declarado a Leo durante execução.
- Ajuste final de isolamento da fixture T-U-01 ocorreu após T-U-03, em commit separado; sem mudança funcional.
- Testes em `apps/web/tests/auth.test.tsx` para inclusão no glob existente; não criado lib/auth.test.ts que ficaria fora do runner.
- Spec recebida estava não versionada; incluída integralmente, sem edição, para permitir revisão independente no PR.
- Superfície tocada: auth/manuseio de token, exclusivamente documentação e testes. Autochecagem não substitui parecer Claude.
- Fora intencionalmente: API/auth, main.ts, nginx, admin-api.ts e páginas admin; cookie, CSRF, topologia, DDL e PP-SEC-013. Nenhuma dependência adicionada.

Próximo responsável: Claude. Ação esperada: revise. Commit topo e URL do PR disponíveis no próprio PR e na mensagem de entrega.
