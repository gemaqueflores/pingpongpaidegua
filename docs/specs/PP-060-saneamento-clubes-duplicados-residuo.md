## SPEC ATIVA — PP-060 — v1
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-060 | Projeto: PingPong PaiD'egua | Branch: chore/pp-060-saneamento-clubes-duplicados-residuo
Criada por: Claude | Data: 2026-09-19 | Versão da Spec: v1

**Decorrente da reconciliação `docs/specs/PP-058-reconciliacao-pp053-pp057.md` (CAT concluído,
aprovado por Leo em 2026-09-19).** PP-053 Item 2 (PR #56) e PP-057 foram fechadas sem merge — os
alvos que mapeavam (7 IDs de clube) já não existem em produção (consolidados por via não rastreada
nesta sessão). Uma nova varredura encontrou 10 pares de clube duplicado diferentes, ainda ativos.

**Timing — decisão explícita de Leo em 2026-09-19, a poucas horas do evento 4TMB26:** implementar e
validar o script (dry-run) agora é autorizado; **`--execute` em produção fica bloqueado até o evento
concluir**, mesmo padrão já aplicado a PEND-CBTM-006 e PP-059. Motivo declarado por Leo: uma
conciliação anterior já consumiu mais de 6h e quase deixou o site fora do ar antes de uma competição —
risco de escrita real em múltiplas tabelas horas antes do 4TMB26 não é aceitável.

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — script opera fusão/remoção transacional de dados em produção (clubes,
  atletas, e tabelas com FK para `athletes.id`); revisar controle de acesso, ausência de SQL cru
  concatenado, dry-run como padrão real, e que nenhum caminho de código chegue a `--execute` sem flag
  explícita.
- e2e-playwright-agent: não — não há fluxo de UI.
- report-builder-agent: sim — critério de aceitação exige relatório antes/depois estruturado por par.

## Objetivo
Implementar e validar (via dry-run, sem escrita) um script de saneamento que funde os 10 pares de
clube duplicado hoje ativos em produção — mesmo clube físico, IDs diferentes, divergindo apenas por
variação de sufixo de UF na formatação do `normalized_name` armazenado (`-PA`, `- PA`, `(PA)`,
ausente) — de volta a um único registro por clube físico, realocando os atletas/relações
correspondentes sem perda de dado.

## Contexto
Investigação read-only em produção (`docs/specs/PP-058-reconciliacao-pp053-pp057.md`, CAT Rodada 3)
confirmou 10 pares de clube duplicado por leitura direta do Postgres:

| Par | Vencedor (mais antigo) | Duplicado (criado 2026-09-19 00:52 UTC) |
|---|---|---|
| 1 | `132` PARÁ CLUBE - PA | `211` |
| 2 | `133` GRÊMIO LITERÁRIO E RECREATIVO PORTUGUÊS - PA | `214` |
| 3 | `134` ASSEMBLÉIA PARAENSE - PA | `212` |
| 4 | `137` CABANA CLUBE - PA | `216` |
| 5 | `138` PAYSANDU SPORT CLUB - PA | `215` |
| 6 | `139` BEL.TT/CAMINHO DO BEM-PA | `210` |
| 7 | `144` ASSOCIAÇÃO DE MESATENISTAS DE MARABÁ - PA | `219` |
| 8 | `146` ASSOCIAÇAO DE MESATENISTAS DE PARAUAPEBAS-PA | `218` |
| 9 | `170` YOSHIDA TT - IGREJA CRISTÃ EVANGÉLICA DA AMAZONIA (PA) | `213` |
| 10 | `204` MARDEY TT / APANB - PA | `217` |

Todos os 10 "duplicados" foram criados em 2026-09-19 00:52:56–00:52:57 UTC — **2 horas antes** do
merge da correção de causa raiz da PP-053 (2026-09-19 02:53:26 UTC). Guarda executada nesta mesma
investigação (`SELECT * FROM clubs WHERE created_at > '2026-09-19 02:53:26'` → 0 linhas) confirma que
**nenhum clube novo foi criado em produção desde a correção** — isto é saneamento de resíduo antigo,
não reincidência de bug ativo. `ensureClub` (verificado em `apps/worker/src/pipeline/upsert.service.ts:2099`,
chamado nas linhas 1113 e 4407) já aplica `normalizeClubName` corretamente nos dois pontos de criação
de clube — sem lacuna de código encontrada, não é necessária nova correção de causa raiz.

Escopo **global** (não restrito ao evento 59) — os 10 pares podem ter atletas vinculados em outros
eventos além do 59; o script deve varrer todos os eventos, não só o 59.

## Causa raiz
- Causa imediata: 10 clubes duplicados criados pelo comportamento pré-correção (`normalizeText` puro,
  sem remoção de sufixo de UF, usado antes do merge da PP-053) — resíduo histórico.
- Causa sistêmica: já tratada e corrigida pela PP-053 (Item 1, PR #52) e reforçada pela PP-056 no fluxo
  de partidas. Confirmado nesta Spec que não há lacuna remanescente no código atual.
- Padrão: mesma classe de PP-053 Item 2 / PP-057 (saneamento retroativo pós-correção de causa raiz).

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Fusão de clube duplicado sem duplicata de atleta no par
DADO um par de clube (vencedor/duplicado) onde nenhum atleta aparece nos dois lados no mesmo evento
QUANDO o script funde o par (modo `--execute`, fora do escopo desta rodada)
ENTÃO todos os atletas do clube duplicado são realocados (`club_id`) para o clube vencedor, o clube
duplicado é removido, e a contagem total de atletas não muda

### Cenário 2 — Atleta duplicado no mesmo evento (aparece nos dois clubes do par)
DADO um atleta que aparece duas vezes no mesmo evento, uma vez vinculado a cada clube do par
QUANDO o script processa esse caso
ENTÃO os registros de atleta são consolidados em um único `athlete_id`, preservando o histórico de
partidas (`match_participants`), aliases (`athlete_aliases`) e vínculos (`event_athlete_links`) de
ambos os lados, sem violar nenhuma constraint única

### Cenário 3 — Dry-run não escreve nada
DADO o script rodando sem a flag `--execute`
QUANDO executado contra qualquer banco (dev, homologação, produção)
ENTÃO nenhuma linha é criada, atualizada ou removida — apenas relatório de contagens/diagnóstico é
impresso

### Cenário 4 — Relatório antes/depois estruturado
DADO uma execução (dry-run ou `--execute`)
QUANDO o script conclui
ENTÃO emite relatório por par: clube vencedor, clube duplicado, atletas antes/depois de cada lado,
pares de atleta duplicado detectados, linhas reatribuídas em `match_participants`/`athlete_aliases`/
`event_athlete_links`, colisões detectadas (se houver)

## Critérios de aceitação
- Script cobre os 10 pares listados acima, com IDs explícitos (não descoberta dinâmica de pares nesta
  versão — mesma abordagem de `scripts/pp-053-merge-clubs.ts`, lista fixa confirmada por query real).
- Dry-run executado contra `cbtm_homolog` (ou banco de homologação equivalente), com relatório
  documentado no PR.
- Nenhum `--execute` roda nesta Spec — nem local, nem homologação, nem produção. Autorização de
  execução real é rodada separada, após o 4TMB26 concluir.
- Scanner de segurança sem achados críticos/altos.

## Fora de escopo
- `--execute` em qualquer ambiente (autorização separada, pós-evento).
- Descoberta dinâmica de novos pares além dos 10 listados (se aparecer um 11º par por nova captura,
  vira Spec própria — o código de criação de clube já está corrigido, não é esperado).
- `style-src` da CSP, PP-059, PP-052 — assuntos não relacionados.
- Qualquer alteração em `normalizeText`/`normalizeClubName` genéricos — já corrigidos e fora de escopo
  desta Spec de saneamento de dado.

## Impacto técnico
- Arquivos a criar: `scripts/pp-060-saneamento-clubes-residuo.ts` (novo — não reaproveitar
  `scripts/pp-053-merge-clubs.ts` por IDs diferentes; pode reaproveitar estrutura/lógica de transação
  como referência).
- Arquivos que NÃO devem ser tocados: `apps/worker/src/pipeline/upsert.service.ts`,
  `packages/shared/src/index.ts` (causa raiz já corrigida, não mexer).
- DDL: nenhuma.
- Contrato de API: nenhum alterado.

## Plano de testes
### Cobertura geral
- camadas: unitário (lógica de detecção de par/reatribuição) + script de integração (dry-run real
  contra homologação)
- arquivos de teste: `scripts/test/pp-060-saneamento-clubes-residuo.test.ts` (se aplicável ao padrão
  já usado em `scripts/pp-053-merge-clubs.ts`)
COBERTURA: regressão=1 corretude=2

### T-U-01 [corretude] — dry-run não escreve nada
DADO os 10 pares e um snapshot de contagem antes
QUANDO o script roda sem `--execute`
ENTÃO contagem de `clubs`/`athletes` após é idêntica à anterior

### T-I-01 [corretude] — relatório reporta os pares corretos
DADO o script rodando contra homologação em dry-run
QUANDO concluído
ENTÃO o relatório lista exatamente os 10 pares com IDs corretos e contagens reais lidas do banco

### T-I-02 [regressão] — clubes/atletas fora dos 10 pares não aparecem no relatório de mudança
DADO clubes sem duplicata no banco de homologação
QUANDO o script roda
ENTÃO nenhum desses clubes aparece nas seções de "a ser alterado" do relatório

### Comando para rodar a suite
`npx tsx scripts/pp-060-saneamento-clubes-residuo.ts --dry-run` contra `cbtm_homolog`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### Origem (2026-09-19)
Decorrente do fechamento de PP-053 Item 2 (PR #56, fechado sem merge) e PP-057 (fechada sem
implementação) — ver `docs/specs/PP-058-reconciliacao-pp053-pp057.md` para a investigação completa
que levou a esta Spec.
