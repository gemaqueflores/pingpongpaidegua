# PP-071 — Exposição pública: abuso do formulário de suporte e CORS de previews Vercel

<!-- Spec unificada v7. Sem ## SPEC ATIVA: ciclo tripartite em andamento. Codex NÃO implementa a partir do HISTÓRICO. -->
Estado: CAT RASCUNHO — Rodada 1 | Projeto: PingPong PaiD'egua | Backlog: PP-SEC-009, PP-SEC-010
Depende de: PP-070 mergeado (rate/limite por IP só é confiável depois que `req.ip` deixar de ser forjável)

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT — Rodada 1 (2026-09-27) — Claude analista
Origem: `estudos/docs/specs/ORQ-002-auditoria-seguranca-20-itens.md`. Fast track proibido (2 superfícies, produção).

#### Achado A — PP-SEC-009: `POST /support/report-problem` sem proteção de abuso
- `apps/api/src/user/user.controller.ts:167` — rota pública; `user.service.ts:1007` `reportProblem` envia e-mail
  (`SUPPORT_EMAIL`, linha 60) a cada chamada válida. Único limite: classe `support-report-problem` do
  `SimpleRateLimitMiddleware` (`RATE_LIMIT_STRICT_LIMIT` = 40/min no compose). HTML já escapado (linhas 1047-1050).
- Proposta: teto no próprio `UserService.reportProblem`, em memória (API é instância única): **5 por IP por hora** e
  **50 por dia no total**; excedente → `429` sem enviar e-mail. O controller passa `request.ip` ao service.
  [PENDENTE Codex: em memória basta ou reusar o Redis do rate limit? Reinício zera o contador — aceitável?]
- Sem captcha: exigiria serviço externo e dependência nova (Q7) — fora deste PP.

#### Achado B — PP-SEC-010: CORS aceita qualquer `https://*.vercel.app` com credenciais
- `apps/api/src/main.ts:31` — `allowVercelPreviews = FRONTEND_ALLOW_VERCEL_PREVIEWS !== "false"` (ligado por padrão);
  `docker-compose.yml:92` fixa `"true"`. Rodada 2 do PP-070 confirmou `true` na VM.
- A produção depende disso hoje porque o `FRONTEND_URL` da VM não é o domínio Vercel
  (`docs/sessions/2026-05-21-infra-cert-renewal.md:43-45`); domínio de produção:
  `https://pingpongpaidegua.vercel.app` (`docs/runbook-producao-oracle-vercel.md:187`).
- Proposta: previews só quando a env for exatamente `"true"` (padrão desligado); compose
  `FRONTEND_ALLOW_VERCEL_PREVIEWS: ${FRONTEND_ALLOW_VERCEL_PREVIEWS:-false}`; runbook §9 atualizado.
  Pré-condição de deploy: `.env` da VM com `FRONTEND_URL=https://pingpongpaidegua.vercel.app`.
  [LEO DECIDE: você usa preview deployments do Vercel contra a API de produção? Se sim, a alternativa é allowlist
  do prefixo do projeto (`https://pingpongpaidegua-*.vercel.app`) em vez de desligar]

#### Impacto técnico (hipótese)
`apps/api/src/user/user.controller.ts`, `apps/api/src/user/user.service.ts`, `apps/api/src/main.ts`,
`docker-compose.yml`, `docs/runbook-producao-oracle-vercel.md`. Testes: `apps/api/test/user-service.support-email.test.ts`
(existente) + `apps/api/test/pp071-cors-origin.test.ts`. Não tocar: frontend, DTO (limites já existem), auth.
Para T-* de CORS: extrair `isOriginAllowed` de `main.ts` para `apps/api/src/common/cors-origin.ts` (mesmo padrão do PP-070).

#### Plano de testes preliminar — COBERTURA: regressão=2 corretude=4
- T-U-01 [corretude] 6ª chamada do mesmo IP na mesma hora → 429 e transporter **não** chamado (contador de envios = 5).
- T-U-02 [corretude] 51ª chamada no dia, IPs distintos → 429.
- T-U-03 [regressão] chamada válida dentro dos limites continua enviando 1 e-mail com HTML escapado.
- T-U-04 [corretude] `isOriginAllowed("https://qualquer.vercel.app")` com env ausente → `false`.
- T-U-05 [corretude] com env `"true"` → `true` (comportamento opt-in preservado).
- T-U-06 [regressão] `FRONTEND_URL` exato continua permitido; localhost continua permitido.

#### Fora de escopo
Captcha/serviço anti-bot externo; CSP (PP-059); token no Web Storage (PP-SEC-011).

### CAT — Rodada 2 (2026-09-27) — contraponto técnico Codex

**Posição:** implementável, com o desenho dos limitadores ajustado para reutilizar o Redis já operado pela API. O middleware existente comprova disponibilidade de `ioredis` e de operação atômica por Lua; portanto, os contadores de 5/IP/hora e 50/dia não precisam de nova dependência nem devem ficar somente em memória, onde reinícios e múltiplas réplicas reiniciariam/dividiriam o limite. A decisão de ORQ-004 fecha o preview como opt-in, com padrão `false`; `FRONTEND_URL` exato e localhost permanecem permitidos.

**Riscos e correções de teste:** a chave por IP precisa receber o endereço já normalizado pela borda do PP-070, sem confiar diretamente em XFF. Os dois limites devem usar incremento/expiração atômicos, e a política para indisponibilidade do Redis deve ser explícita; fallback local preserva proteção parcial sem transformar falha de infraestrutura em indisponibilidade total. Acrescentar teste de concorrência/TTL e de duas instâncias compartilhando o mesmo Redis, além dos casos sequenciais já descritos. A prévia Vercel deve ser testada ausente, `false` e `true`, evitando verdade implícita por variável não vazia.

**Claro para implementação:** alterar o controller para fornecer o IP confiável, criar chaves sem dados pessoais além do IP necessário e manter a resposta 429 genérica. Não registrar corpo, e-mail ou mensagem do suporte. Não há dependência de VM nesta entrega.
