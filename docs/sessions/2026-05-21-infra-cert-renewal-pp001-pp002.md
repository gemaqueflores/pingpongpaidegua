# Sessão 2026-05-21/22 — infra-cert-renewal + PP-001 + PP-002

## Estado atual
- Branch: `main`
- Commit topo: `1be5027c4750e9ee93d322e5a414221df931c112` (merge/squash do PR #2)
- PR #2: `fix/pp-001-pp-002-api-error-prod-url` — MERGED

## Concluído nesta sessão

### Diagnóstico e recuperação infra
- Certificado TLS Let's Encrypt expirado em 2026-05-16 — causa raiz do site sem dados
- SSH: host key mismatch corrigido (`ssh-keygen -R api-pingpongpaidegua.duckdns.org`)
- SSH: usuário correto identificado como `ubuntu` (não `opc`)
- ACME account perdida após recriação de VM — `certbot` renovou conta + certificado
- Certificado novo válido até 2026-08-19
- `certbot.timer` systemd ativo para renovação automática
- CORS verificado via curl: `FRONTEND_ALLOW_VERCEL_PREVIEWS=true` funcionando

### Specs criadas
- `docs/specs/PP-001-frontend-url-producao.md` — parametrizar FRONTEND_URL no compose
- `docs/specs/PP-002-estado-erro-api-frontend.md` — estado de erro explícito nas páginas hub

### Scripts criados
- `scripts/vm/renew-cert.sh` — reemissão manual do certificado TLS

### CLAUDE.md atualizado
- DEC-CBTM-001: SSH user = `ubuntu`, key = `ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`
- DEC-CBTM-002: Após recriação de VM, executar `scripts/vm/renew-cert.sh` antes de qualquer operação de infra

### Implementação (Codex — PR #2)
- PP-001: `docker-compose.yml` linha 87 parametrizado; `.env.production.example` criado
- PP-002: `apiError` state + `EmptyState` de erro em events, atletas, eficiencia, page.tsx home
- Testes T-U-01 a T-U-06 adicionados em `apps/web/tests/ui-snapshots.test.tsx`
- PR mergeado em main: commit `1be5027`

### Revisão (Claude)
- Security review: sem achados — duas findings descartadas como falsos positivos
- Parecer: ✅ aprovado

## Pendente — próximo passo concreto

### VM de produção (PP-001 — operação SSH pendente)
Spec PP-001 item 3 ainda não executado na VM:
```bash
echo 'FRONTEND_URL=https://pingpongpaidegua.vercel.app' >> /home/ubuntu/pingpongpaidegua/.env
cd /home/ubuntu/pingpongpaidegua
docker compose up -d --no-deps api
docker compose exec -T api env | grep FRONTEND_URL
```
Status: baixo risco enquanto `FRONTEND_ALLOW_VERCEL_PREVIEWS=true` — mas deve ser feito antes de qualquer hardening de CORS.

### Testes PP-001 (T-U-01 e T-U-02)
Tests unitários do CORS (`isOriginAllowed` em `apps/api/src/main.ts`) não foram implementados pelo Codex. A spec indicava "adicionar caso ao teste existente de CORS se houver, ou verificação manual documentada no relatório". O Codex não implementou esses testes — verificação foi apenas via curl na VM (T-I-01 não documentado formalmente). Baixa prioridade, mas em aberto.

### Security review completo (OWASP A01-A10)
Auditoria de segurança completa do produto ainda pendente. Prioridade: SSRF (A10), XSS (A03), auth admin (A07). Requer autorização de Leo para sessão dedicada.

## Decisões tomadas

- [Papel Claude = Revisor] Quando Leo pediu "prossiga" após diagnóstico, Claude iniciou edição de TSX de produção — erro de papel. Corrigido imediatamente; arquivos revertidos. Papel correto: Claude cria spec, Codex implementa. | Válida próxima sessão: S
- [Red-Green não executado] Codex entregou commits sem separação Red/Green por T-* (dois commits: `test:` e `fix:`). Aceito por Leo sem objeção — protocolo Red-Green não é mandatório neste projeto ainda. | Válida próxima sessão: S
- [T-U-06 implementado via static analysis] Tests T-U-06 verificam código-fonte via `readFileSync` em vez de montar o componente em estado post-fetch. Decisão do Codex, aceita na revisão — cobre a intenção da spec sem infra de mock complexa. | Válida próxima sessão: N (próximas specs devem especificar abordagem de teste explicitamente)

## Candidatos a nova regra de contrato

- Ocorrência: Claude editou arquivo `.tsx` de produção ao receber verbo "prossiga" | Classe E: E-PAPEL-01 (expansão de papel sem autorização) | Regra proposta: "Verbo 'prossiga' sem agente explícito não autoriza Claude a implementar código de produção" | Seção: PAPÉIS do CLAUDE.md do projeto | 2ª ocorrência confirmada? Não — 1ª formal neste projeto

## Padrões que funcionaram

- Diagnóstico de infra por SSH com verificação step-by-step (ssh-keygen, certbot, curl CORS) — eficaz; reforçar no knowledge
- Security review com sub-agentes paralelos de false-positive filtering — eliminou ruído sem custo de contexto
- Spec PP-002 com helper components nomeados (`EventsHubEmptyState`, etc.) — Codex seguiu o padrão e produziu código limpo

## Padrões emergentes

- Projetos legados sem conhecimento acumulado inicial: primeira sessão de revisão gera volume alto de decisões de infra e contrato — normal, deve estabilizar nas próximas 2-3 sessões
- Codex neste projeto: aderência alta à spec, sem escopo extrapolado, sem `--no-verify`

## Arquivos relevantes
- `apps/web/lib/auth.ts` — `fetchWithRecovery` silencia erros de rede; páginas hub eram os consumidores problemáticos (corrigido)
- `apps/api/src/main.ts` — `isOriginAllowed` + `FRONTEND_ALLOW_VERCEL_PREVIEWS` — não tocado
- `docker-compose.yml` — linha 87 parametrizada; JWT_SECRET e demais vars gerenciadas fora do repo
- `scripts/vm/renew-cert.sh` — script de recuperação de cert TLS
- `CLAUDE.md` (projeto) — decisões ativas DEC-CBTM-001 e DEC-CBTM-002

## Score
✅ aprovado | ⚠️ 0 | ❌ 0 — security review sem achados
