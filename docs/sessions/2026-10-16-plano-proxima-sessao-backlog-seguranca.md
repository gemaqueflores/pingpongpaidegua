# Plano para a próxima sessão — PingPong PaiD'egua

Continuação da sessão de higienização de 2026-10-16 (worktrees, PP-062, PEND-CBTM-006, PP-SEC-008 — ver
`SESSION_STATE.md`, entrada "2026-10-16 — PP-062 encerramento documental + higiene de worktrees/branches").
Repositório está limpo: checkout principal em `main` sincronizado, só a worktree PP-060 pendente de
decisão (avaliação conjunta já disparada, ver `docs/sessions/2026-10-16-avaliacao-conjunta-worktree-pp060.md`).

## Passo 0 — Fechar a avaliação conjunta da worktree PP-060

Retomar `docs/sessions/2026-10-16-avaliacao-conjunta-worktree-pp060.md` com a resposta do Codex, decidir
com Leo: remover (branch nunca mergeada, PR #58 closed) ou preservar como registro histórico de desvio
Q3. Ação mecânica trivial depois de decidido — não é um item de Spec.

## Passo 1 — Atualizar o backlog de segurança (dívida de documentação, não código)

Confirmado por leitura direta do código atual (`apps/api/src/common/default-no-store.middleware.ts`,
`apps/api/src/common/trust-proxy.ts`) que **PP-SEC-005 e PP-SEC-006 já têm a correção de código em
`main`** via Spec PP-070 (mergeada, PR #62). O backlog
(`docs/backlog-seguranca-qualidade.md`) ainda lista os dois como "Alto"/ativos, sem marcar fechados —
igual ao que já aconteceu com PEND-CBTM-006/PP-SEC-007/008 antes de serem corrigidos no arquivo.
Ação: Claude atualiza a tabela (Edit, não Write) marcando PP-SEC-005 e PP-SEC-006 como fechados,
referenciando a Spec PP-070 e o commit/PR de mergeada, igual ao padrão já usado para PP-SEC-007/012/014.
Não precisa de Spec nova — é correção de registro.

## Passo 2 — Itens de segurança genuinamente abertos (ordenados por severidade)

| ID | Severidade | Resumo | Observação para a próxima sessão |
|---|---|---|---|
| PP-SEC-011 | Médio | CSP `script-src 'unsafe-inline'` ainda ativo em `apps/web/next.config.js:12` (confirmado por leitura nesta sessão) — XSS pode exfiltrar token admin em Web Storage. | Ciclo tripartite (`ft-cat`) já foi feito para isso em PP-059 (3 rodadas, todos os `[LEO DECIDE]` resolvidos), mas a Spec formal nunca foi aberta — ficou adiada para depois do 4TMB26 (evento concluído, verificar com Leo se já pode retomar). Reaproveitar o CAT já fechado, não refazer do zero. |
| PP-SEC-013 | Alto | Produção com 5 altas + 1 moderada (cadeia Prisma/`deepmerge-ts`/`effect`, e `next`→`postcss`, corrigível só via Next 16). | Requer Spec dedicada para migração major (Prisma + Next 16) — maior escopo, avaliar com Leo se abre agora ou aguarda janela de manutenção. |
| PP-SEC-001 | Médio | Nunca houve rodada formal OWASP A01-A10 completa sobre o código atual — só revisões por diff/PR. | Avaliar custo/benefício de uma auditoria completa dedicada vs. continuar via security review por PR (já obrigatório em toda entrega). |
| PP-SEC-002 | Médio | Scraping/HTTP externo sem allowlist/proteção SSRF formalizada. | Specs futuras que tocarem fetch/scraping devem incluir T-* de SSRF — já é regra do rodapé do backlog; não precisa de ação isolada a menos que Leo priorize. |
| PP-SEC-003 | Médio | Segredos em CI/logs — procedimento é security review manual a cada workflow alterado, não uma correção única. | Sem ação isolada necessária; já é processo corrente. |
| PP-SEC-004 | Baixo | XSS por dado externo renderizado — React escapa por padrão, item é preventivo. | Sem ação isolada necessária. |
| PP-SEC-009 | Médio | `/support/report-problem` sem proteção anti-bot; limite contornável via PP-SEC-006 (que já foi corrigido — reavaliar se o vetor de contorno ainda existe). | Verificar primeiro se a correção do XFF (PP-SEC-006) já reduz esse risco antes de abrir Spec nova. |
| PP-SEC-010 | Médio | CORS aceita qualquer preview `*.vercel.app` com `credentials: true`. | Specs futuras de CORS devem revisar; não é bloqueante hoje (impacto limitado, bearer não é cookie). |
| PP-SEC-015 | Baixo | Node 20 no CI incompatível com Vitest 5 (suites parser/shared não rodam no CI hoje). | Spec própria: atualizar `node-version` dos workflows, avaliando impacto em `apps/api` (`--experimental-test-module-mocks`, exige Node ≥22.3) antes de incluir as suites no pipeline. |
| PP-SEC-016 | Médio | Sem gate de `npm audit` completo no CI/pre-commit. | Spec própria: definir limiar de falha, escopo (dev incluso) e tratamento de falso positivo. |

## Passo 3 — Priorização sugerida (não vinculante — Leo decide)

1. **PP-SEC-011** (CSP nonce) — maior severidade residual com CAT já pronto, menor esforço de retomada.
2. **PP-SEC-013** (CVEs de produção, major Prisma/Next 16) — maior severidade, mas maior escopo; avaliar
   janela de manutenção.
3. **PP-SEC-015/016** (gates de CI) — baixo risco individual, mas reduzem recorrência de toda a classe
   "vulnerabilidade só descoberta por auditoria manual" (PEND-CBTM-006, PP-SEC-007, PP-SEC-013 já
   seguiram esse padrão).
4. Demais itens Médio/Baixo seguem como processo corrente (T-* obrigatório quando a superfície for
   tocada), sem necessidade de Spec isolada.

## Verificação de abertura da próxima sessão

Ao retomar, ler nesta ordem: `SESSION_STATE.md` (sessão ativa/encerradas), este arquivo, e o backlog já
atualizado (`docs/backlog-seguranca-qualidade.md`) — não repetir o levantamento, só confirmar se algo
mudou desde 2026-10-16.
