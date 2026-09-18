# Knowledge — Padrões do Revisor (Claude) — PingPong PaiD'egua

## Contador de arquivamento
Entregas encerradas desde a última revisão de arquivamento: 0
Limiar: 10

## Desvios registrados

### 2026-05-21 — Sessão infra/PP-002 — Expansão de papel
Claude editou `apps/web/app/events/page.tsx` (arquivo TypeScript de produção) ao receber verbo "prossiga" de Leo sem agente explícito. Erro de papel — Claude=Revisor, código de produção cabe ao Codex.
- Corrigido imediatamente após intervenção de Leo
- Arquivo revertido ao estado original antes de criar specs
- Ação preventiva: antes de qualquer edição de código, verificar extensão do arquivo. `.tsx`, `.ts`, `.py`, `.go` → parar e criar spec. `.md`, `.sh`, config → permitido.

### 2026-06-12 — PP-006 — Prescrição de correção introduziu edge não previsto
No parecer CB-4 prescrevi a implementação ("true + `snapshotHasCategory`") em vez do critério de aceitação ("preservar 404 para categoria inexistente, manter `[]` para categoria válida sem inscritos"). O Codex seguiu a prescrição à risca e o resultado divergiu do legacy num edge (categoria válida sem inscritos: era `[]`, virou 404). Ação preventiva: em itens ❌, prescrever comportamento verificável (DADO/QUANDO/ENTÃO), não implementação; se prescrever implementação, validá-la contra os edges do legacy antes de gravar o parecer.

### 2026-06-12 — PP-006 — Lacuna de Spec virou achado de segurança
A Spec dizia "o prewarm propaga o modo (header ou parâmetro)" sem definir ONDE a API recebe o modo nem o mecanismo de confiança — o Codex escolheu o interceptor de rotas públicas e nasceu o CB-7 (publishMode anônimo). Ação preventiva: quando a Spec introduz canal entre serviços, especificar ponto de entrada, mecanismo de confiança e default explícitos.

## Padrões de sucesso

### 2026-06-12 — PP-006 — Verificação estrutural do Git antes do conteúdo
Checar `git rev-list --count` + mensagens de commit ANTES de ler arquivos detectou Q12 em segundos e organizou a rodada. Adotar como primeiro passo padrão de homologação.

### 2026-06-12 — PP-006 — Worktree dedicado por rodada de revisão
`git worktree add` por rodada permite Read físico dos artefatos do PR sem poluir o checkout; remover ao final da rodada para nunca auditar estado obsoleto.

### 2026-05-22 — Security review com sub-agentes paralelos
Lançar sub-agente de identificação de vulnerabilidades → lançar sub-agentes paralelos de false-positive filtering — eficaz para eliminar ruído sem aumentar contexto principal. Usar neste projeto em todos os security reviews.

### 2026-05-21 — Diagnóstico de infra por SSH step-by-step
Diagnóstico sequencial (host key → usuário → certbot → CORS curl) com confirmação explícita a cada etapa — eficaz para evitar suposições em ambientes desconhecidos. Documentar decisões de infra no CLAUDE.md do projeto imediatamente (DEC-CBTM-001, DEC-CBTM-002).
