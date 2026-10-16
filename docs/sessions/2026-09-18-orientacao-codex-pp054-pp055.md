## Orientação para o Codex — PP-054 + PP-055

**Ordem obrigatória: PP-054 primeiro, mergeada, só então iniciar PP-055.** PP-055 depende do
comportamento corrigido pela PP-054 (ver "Dependência" no header de PP-055) — implementar fora de ordem
invalida o saneamento.

---

## PP-054 — correção de upsert (jogo reagendado)

### Spec aprovada
caminho: `docs/specs/PP-054-versao-vigente-jogo-reagendado.md`
instrução de leitura: implementar exclusivamente contra `## SPEC ATIVA`; `## HISTÓRICO` é consulta para
não reabrir rota já descartada, nunca fonte de instrução
aprovação Leo: "54 e 55 aprovadas" (2026-09-18)

### Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: não (mudança interna de resolução de linha, sem input externo novo).
- e2e-playwright-agent: não.
- report-builder-agent: não.

### Plano de testes (resumo)
- IDs: T-U-01, T-I-01, T-I-02, T-I-03, T-I-04
- arquivo de teste a criar: `apps/worker/test/upsert-match-reschedule.test.ts`
- comando de execução: `npm --prefix apps/worker test`

### Contexto
branch base: main | commit topo: verificar no início da implementação

### Pré-condições
- git config user.email = gemaqueflores@gmail.com
- branch: fix/pp-054-versao-vigente-jogo-reagendado (a partir de main)
- DDL aplicado: não aplicável (sem migração)

### Arquivos a criar/modificar
- `apps/worker/src/pipeline/upsert.service.ts` — bloco de resolução de `existingMatch` (hoje
  `:1598-1650`): adicionar fallback por `eventId + categoryId + cbtmMatchId` normalizado, via `findMany`,
  só executado se o fallback `legacyMatchKey` já existente também não encontrar nada. Detalhe completo na
  Spec, seção "Arquivos a criar/modificar".
- `apps/worker/src/pipeline/match-merge.ts` — exportar (ou extrair helper puro) a normalização numérica
  de `cbtmMatchId` hoje usada dentro de `extractCbtmMatchId()` (`:98-121`), para reuso em
  `upsert.service.ts` sem duplicar a regex.
- Novo: `apps/worker/test/upsert-match-reschedule.test.ts`.

### Arquivos que NÃO devem ser tocados
- `packages/shared/src/index.ts` (`computeMatchKey`, `parseBrazilianDateTime`)
- `shouldPruneStage3StaleMatches()` e seu gate `eventConcluded` em `upsert.service.ts`
- `apps/api/src/user/user.service.ts` (`buildEventScheduleSnapshot`)
- `apps/api/src/user/read-model-mirror.ts`
- Bloco de `prisma.match.create` em `upsert.service.ts` (`:1794-1815`) — não muda, só passa a ser
  alcançado com menos frequência.

### Ordem de implementação (Red-Green-Refactor por T-*)
Para cada T-*, em sequência, commits separados:
1. RED: test(worker): T-<id> red — <desc>
2. GREEN: feat(worker): T-<id> green — <desc>
3. REFACTOR (opcional): refactor(worker): T-<id> refactor — <desc>
Concluir T-<id> antes de iniciar T-<id+1>. Ordem sugerida: T-U-01 → T-I-02 (regressão primeiro, trava o
comportamento atual) → T-I-01 → T-I-04 → T-I-03.
Ao final: rodar suite completa do worker para confirmar ausência de regressão.

### Validação antes de reportar
- todos os T-* implementados e verdes
- suite completa do worker verde
- DoD do CLAUDE.md do projeto cumprido (build verde, hook ativo, sem --no-verify fora da exceção formal)

### Reportar ao concluir
Formato padrão "FORMATO DE ENTREGA CODEX → CLAUDE" do contrato — branch, commit topo, PR URL, mapeamento
T-*↔teste↔commits, evidência Red, evidência de suite verde, superfície de segurança tocada, assunções.

---

## PP-055 — saneamento retroativo evento 59

**Só iniciar após PP-054 mergeada.** Implementação e dry-run estão autorizados por esta aprovação.
**Execução real (`--execute`) em produção exige mensagem separada e explícita de Leo — não está
autorizada por este envelope nem pela aprovação da Spec.**

### Spec aprovada
caminho: `docs/specs/PP-055-saneamento-matches-duplicados-evento59.md`
instrução de leitura: implementar exclusivamente contra `## SPEC ATIVA`
aprovação Leo: "54 e 55 aprovadas" (2026-09-18) — cobre implementação e dry-run, não execução real

### Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — script opera remoção transacional de dados de produção; revisar controle
  de acesso, ausência de SQL cru concatenado, dry-run como padrão real (não apenas documentado).
- e2e-playwright-agent: não.
- report-builder-agent: sim — relatório antes/depois é critério de aceitação (C5).

### Plano de testes (resumo)
- IDs: T-I-01, T-I-02, T-I-03, T-I-04, T-I-05
- arquivo de teste a criar: `scripts/test/pp-055-saneamento-matches-duplicados.test.ts` (ajustar local
  conforme convenção de testes de `scripts/` do projeto, se diferente)
- comando de execução: `npm --prefix apps/worker test` (ajustar se o script tiver runner próprio)

### Contexto
branch base: main (após merge de PP-054) | commit topo: verificar no início

### Pré-condições
- PP-054 mergeada em main
- git config user.email = gemaqueflores@gmail.com
- branch: chore/pp-055-saneamento-matches-evento59

### Arquivos a criar/modificar
- `scripts/pp-055-saneamento-matches-duplicados.ts` (novo) — `--event-id` obrigatório, `--execute`
  opcional (ausência = dry-run). Reaproveitar normalização de `cbtmMatchId` da PP-054 e
  `clearEventReadModelCaches`/`prisma.readModelCache.deleteMany` já existente em
  `apps/worker/src/pipeline/scrape.processor.ts:2707-2711` (extrair para função exportável se hoje for
  método privado).
- Novo arquivo de teste correspondente.

### Arquivos que NÃO devem ser tocados
- Qualquer arquivo de `apps/api` ou `apps/web`
- `apps/worker/src/pipeline/upsert.service.ts` (já corrigido pela PP-054, não alterar de novo aqui)

### Ordem de implementação (Red-Green-Refactor por T-*)
Ordem sugerida: T-I-02 (regressão: grupo com 1 linha intacto) → T-I-04 (isolamento entre eventos) →
T-I-01 (dry-run) → T-I-05 (ambiguidade por placar) → T-I-03 (execução real remove).
Ao final: rodar dry-run manual documentado como evidência adicional de homologação (não é execução real).

### Validação antes de reportar
- todos os T-* implementados e verdes
- dry-run executado manualmente ao menos uma vez com saída documentada no relatório de entrega
- script **não** foi executado com `--execute` em produção — declarar explicitamente essa ausência no
  relatório de entrega
- DoD do CLAUDE.md do projeto cumprido

### Reportar ao concluir
Mesmo formato padrão. Adicionar explicitamente: confirmação de que `--execute` não foi rodado contra
produção, e output do dry-run mais recente anexado/referenciado.
