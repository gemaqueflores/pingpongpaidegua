# Sessão 2026-09-19 — PEND-CBTM-006 + PP-059 (CSP/nonce)

## Estado atual
- Branch principal da sessão: `fix/pp-053-deduplicacao-clubes` (não tocada nesta sessão — sessão foi só CAT/investigação em paralelo).
- Nenhum commit criado nesta sessão. Nenhum código de produção editado (papel Claude=revisor/analista respeitado).

## Concluído nesta sessão
- Consultadas as camadas obrigatórias de abertura: `SESSION_STATE.md`, `DOMAIN_MATURITY.md`, `EPISODIC_MEMORY.md`, `docs/knowledge/CLAUDE.md` do projeto.
- Verificação física (Read + Bash) do estado real de PEND-CBTM-006: worktree `appcbtmeventos-worktrees/pend-cbtm-006-web-audit` na branch `fix/pend-cbtm-006-web-audit`, com `package-lock.json` modificado e não commitado. Confirmado `npm audit fix` sem `--force` já aplicou `next@15.5.25`, `nanoid@3.3.19`, `sharp@0.35.4`; resta 1 alta em `postcss@8.4.31` só corrigível via major (Next 16).
- Verificação física de PEND-CBTM-002: leitura direta de `apps/web/next.config.js` confirma `script-src 'self' 'unsafe-inline'` em `next.config.js:12`, batendo com o texto colado recebido (proveniência não verificada nesta sessão — tratado pelo mérito, confrontado com o código real, não aceito por alegação de autoria).
- Leo decidiu: (1) adiar avaliação/migração Next 16 (PEND-CBTM-006) para depois do evento 4tmb26; (2) formalizar o CAT de CSP/nonce em Spec.
- CAT formalizado em `docs/specs/PP-059-csp-nonce-middleware.md` (Rodada 1 + Rodada 2), renumerado de "PEND-CBTM-002" para PP-059 por colisão de numeração com `PP-058-reconciliacao-pp053-pp057.md`.

## Pendente — próximo passo concreto por item
- **PP-059**: 5 itens `[LEO DECIDE]` registrados no arquivo (escopo `style-src`, ordem de execução vs. PP-052, ambientes de deploy a validar — Vercel + Docker standalone, inclusão/exclusão de `/api/pix-qrcode` no matcher, timing de implementação). Sem essas decisões, Claude não fecha `## SPEC ATIVA` nem inicia Rodada 3.
- **PEND-CBTM-006**: aguardando conclusão do evento 4tmb26. Próximo passo será avaliar riscos da migração Next 15→16 em `apps/web` antes de decidir entre migrar agora ou isolar o residual `postcss` como pendência separada.
- Worktree `pend-cbtm-006-web-audit` permanece como está — `package-lock.json` modificado, não commitado, não descartado.

## Decisões tomadas
- Adiar avaliação de migração Next 16 (residual postcss alto) para após o evento 4tmb26 — motivo: evento começa em poucas horas, prioridade operacional. Válida próxima sessão: S.
- Formalizar CAT de CSP/nonce em arquivo de Spec agora, mesmo sem fechar o ciclo — motivo: preservar rastreabilidade das duas rodadas já existentes (uma delas via texto colado de proveniência não verificada) antes que se percam. Válida próxima sessão: S.
- Renumerar de "PEND-CBTM-002" para PP-059 — motivo: colisão de numeração detectada com PP-058 já existente. Válida próxima sessão: S.

## Candidatos a nova regra de contrato
- Nenhum candidato novo identificado nesta sessão. Não houve desvio ❌/⚠️ do Codex (não houve implementação) nem padrão de sucesso não trivial que justifique promoção — sessão foi puramente de leitura/investigação/CAT.

## Padrões que funcionaram (reforço)
- Verificar fisicamente (Read/Bash) o conteúdo colado atribuído a "Rodada 2 técnica" antes de incorporá-lo ao CAT, em vez de aceitar por declaração — confirmou que a citação de `next.config.js:12` batia exatamente com o arquivo real. Reforçar no contrato: já coberto pela regra existente de "Proveniência de mensagem atribuída a outro agente" no CLAUDE.md global — não precisa de regra nova.

## Padrões emergentes observados nesta sessão
- Duas Specs (PP-052 performance mobile/SSR e PP-059 CSP/nonce) tocam o mesmo `apps/web` com pressões potencialmente opostas (SSR/estático otimizado vs. renderização dinâmica obrigatória por nonce). Sinal único nesta sessão — não promovível ainda, mas registrado como item [LEO DECIDE] em PP-059 para evitar colisão futura.

## Estado para próxima sessão
- Domínios que precisam de atenção extra: Security review — execução real vs. declaração (Em refinamento, PP) — ambas as pendências desta sessão são de segurança/robustez.
- T-* não auditados completamente: nenhum — nenhuma Spec ativa com plano de testes nesta sessão.
- Dúvidas técnicas em aberto: os 5 itens `[LEO DECIDE]` de PP-059; estratégia de migração Next 16 para PEND-CBTM-006.
- Score da sessão: sem parecer emitido — sessão não teve entrega de código para homologar.
