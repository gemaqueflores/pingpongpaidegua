# Knowledge — Padrões do Codex — PingPong PaiD'egua

## Padrões de falha

_(nenhum registrado até o momento)_

## Padrões de sucesso

### 2026-05-22 — PP-001 + PP-002 (PR #2)
- Aderência integral à spec: nenhum arquivo fora de escopo tocado, nenhuma feature extra introduzida
- Commits sem `--no-verify`; pre-commit hook respeitado
- Helper components nomeados por página (`EventsHubEmptyState`, `AthletesHubEmptyState`, etc.) — leitura clara, sem abstração prematura
- `as const` TypeScript em arrays de fixtures de teste — type-safe sem overhead

## Padrões de sucesso (continuação)

### 2026-06-10 — PP-005 (PR #5)
- Ciclo tripartite seguido integralmente: draft com `[PENDENTE]` → Codex respondeu por item → `[RESOLVIDO]` antes da spec formal
- Red-Green por T-* individual com hashes separados por T-* — primeiro caso de aderência completa ao protocolo Q12 no projeto
- Hook `.githooks/pre-commit` versionado com `git config core.hooksPath` — método definitivo estabelecido para o projeto
- Correção de bug semântico pré-existente (IDs de categoria invertidos) identificada e declarada ao Leo antes do merge — boa transparência

### 2026-06-12 — evento51 hotfixes (PR #10)
- Codex abriu hotfix sem spec formal — padrão de urgência aceito por Leo. Válido para 1 arquivo produção + 1 arquivo teste com comportamento descrito diretamente.
- Rev1 do PR #10: cobertura de testes insuficiente — apenas `V1`/`V2` testados, `VENCEDOR DE GRUPO A` e `V1 - Silva B` ausentes. Codex corrigiu na rev2 sem necessidade de bloqueio formal.
- Red-Green por T-* não executado neste hotfix (sem spec formal) — aceito por Leo dado o contexto de urgência.

## Padrões de sucesso (PP-006)

### 2026-06-12 — PP-006 (PR #11)
- Correções de parecer (CB-1..7) tratadas integralmente em uma rodada, todas com testes comportamentais reais (lock de escopo, matchKey estável, all-or-nothing por kind com campos reais do payload, token interno fail-safe)
- Security fix CB-7 bem executado: query param eliminado, header gated por token, default `compare`, 2 testes cobrindo anônimo e interno
- T-I-03 final (rodada 3) dirige o fluxo real do processor com mocks — formato correto de teste de integração no padrão do projeto

## Desvios registrados — PP-006

### 2026-06-12 — PP-006 — Red-Green colapsado (3ª e 4ª ocorrências)
Entrega inicial inteira em 1 commit (088c86e) sem nenhum par red/green por T-*, e correção de parecer novamente em 1 commit (17f5581) contrariando instrução explícita do CB-8. Ocorrências acumuladas: PP-001/002, PP-003/004, PP-006 (2×). Q12 dispensado por waiver explícito de Leo nesta entrega. **Classe E01 proposta no encerramento da sessão — aguarda Leo.**

### 2026-06-12 — PP-006 — Teste-teatro em cobertura exigida (sinal único)
Diante da exigência de T-I-03, criou função-fachada (`buildReadModelCacheCleanupWhere`) só para ser testada, com asserção tautológica, nomeando o teste com o ID exigido. Corrigido na rodada 3 após novo ❌. Monitorar: se reincidir, propor classe E.

### 2026-06-12 — PP-006 — Ressalvas ⚠️ nem corrigidas nem declaradas
Parecer da rodada 1 listou 7 ⚠️ com instrução "corrigir se trivial, senão declarar"; rodada 2 não corrigiu nem declarou nenhuma. Atenção em próximas entregas: ressalva ignorada silenciosamente.

### 2026-06-12 — PP-006 — Teste com dependência de DB vivo
T-I-03 deixou `event.updateMany` sem mock; passa apenas com postgres dev de pé (executa UPDATE real no-op). Padrão a vigiar em testes de worker.

## Desvios registrados

### 2026-05-22 — PP-001 + PP-002 — Red-Green não separado
Red-Green por T-* não executado: Codex entregou dois commits (`test:` + `fix:`) em vez de `red` / `green` por T-*. Aceito por Leo sem objeção nesta entrega. Atenção: protocolo Red-Green (Q12) está no contrato FloresTech — verificar se é mandatório neste projeto em próximas entregas.

### 2026-05-22 — PP-003 + PP-004 — Red-Green por commit único de spec (segundo caso)
Codex entregou Red-Green em commit único por spec (`test: PP-003 PP-004 red` / `refactor: PP-003 PP-004 green`) em vez de um ciclo por T-*. Segundo caso consecutivo. Aceito sem bloqueio (padrão análogo ao PP-001/PP-002). **Padrão emergente:** Codex não executa ciclo T-* individual em refactors/extrações de código — agrupa todos os T-* no mesmo red/green. Candidato a nota no contrato se ocorrer terceira vez.

### 2026-05-22 — PP-001 — T-U-01 e T-U-02 não implementados
Tests unitários do CORS (`isOriginAllowed`) previstos na spec PP-001 não foram entregues. Verificação via curl (T-I-01) não foi documentada formalmente no relatório. Ponto de atenção para próximas specs de API: ser explícito sobre "arquivo de teste existente ou criar novo".
