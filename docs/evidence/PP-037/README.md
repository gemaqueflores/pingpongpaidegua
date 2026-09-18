# PP-037 — evidência de implementação

Projeto: PingPong PaiDegua. Etapa: implementação. Autor: Codex.
Base: `main` / `781ca5e`. Branch: `fix/pp-037-pureza-individual-duplas`.
Estado: implementação validada por testes; E2E visual pendente por bloqueio de execução.
Próximo responsável: Leo, para disponibilizar frontend local; depois Claude, para revisão.
Spec: [PP-037](../../specs/PP-037-pureza-aproveitamento-individual-duplas.md).

## Mudança e limites

`isDoublesEntry` combina os três detectores existentes: nome do competidor, categoria e evento.
O ranking público usa apenas individuais. `computeEfficiencyRankingByModality` calcula e retorna
internamente `individual` e `doubles`, incluindo medalhas e pontuação ponderada por clube.
O wrapper `computeEfficiencyRanking` mantém exatamente as chaves `weights` e `ranking`.

`getAthleteCareerByModality` separa partidas antes de construir eventos, performance por categoria,
aproveitamento e tabelas de medalhas. Seu retorno interno contém duas carreiras completas:
`individual` e `doubles`. `getAthleteCareer` retorna apenas `individual`, sem acrescentar campos.
Essas estruturas são resultados internos por chamada, não persistência ou cache adicional;
podem ser reutilizadas por implementação futura. Não há exclusão de dados no banco.

Escolha: filtrar antes de `buildCareerMedalTable`, mantendo `career-medals.ts` inalterado.
A separação anterior também atende ao frontend, que recalcula medalhas usando
`events[].performanceByCategory`; mudar somente `medalTable` não corrigiria a tela.
Pares continuam calculados internamente, incluindo aliases e prioridade de categoria oficial.
Na API pública, uma chave que representa somente um par passa a ter totais individuais zerados;
as cinco regressões de pares verificam o cálculo interno preservado e os zeros públicos.

`getAthleteSummary()` e `packages/shared/src/index.ts` não foram alterados.
A carreira de clubes conserva seu comportamento anterior: o filtro antes incondicionalmente verdadeiro
foi removido desse consumidor para que a nova semântica não amplie a correção para outra rota.
Sem DDL, mudança de frontend, regras esportivas novas ou dados de produção alterados.

## Rastreabilidade por cenário

| Cenário | RED | GREEN | Refactor | Teste atual |
|---|---|---|---|---|
| T-U-01 | `0d47df4` | `c8ee011` | — | `apps/api/test/user-service.pp037-modalities.test.ts:5` |
| T-U-02 | `857b626` | `5de7489` | — | `apps/api/test/user-service.pp037-modalities.test.ts:16` |
| T-U-03 | `9fa89cb` | `30a203d` | `f88b839` | `apps/api/test/user-service.pp037-modalities.test.ts:30` e `:41` |
| T-U-04 | dispensado por Leo | `510d894` | — | `apps/api/test/user-service.pp037-modalities.test.ts:48` |
| T-I-01 | dispensado por Leo | `a47623a` | — | `apps/api/test/user-service.athlete-summary-cache.test.ts:211` |

Domínio instável TDD — self-check extra: sequência Git individual conferida; nenhum ciclo agrupado.
T-U-04/T-I-01 são GREEN de caracterização, explicitamente autorizados por Leo nesta sessão.
T-I-01 preserva as expectativas originais; apenas identificação e comentário do teste mudaram.
T-U-03 falhou realmente em evento de duplas mistas com categoria genérica (`1 !== 0`).
O caso com categoria explicitamente mista e a carreira já estavam verdes pelas correções anteriores;
isso não foi apresentado como falha independente.
T-U-01/T-U-02 falharam com `2 !== 1`. No GREEN de T-U-01, a expectativa auxiliar de pontuação
foi corrigida de 130 para 390, pois o peso estadual existente é 3. A falha RED de medalhas permanece válida.

## Evidência EXECUTADA

- [Base](api-baseline.log): `npm run test --workspace apps-api`, 220/220.
- [Suíte](api-suite.log): mesmo comando, 225/225, zero falhas/skips.
- [Validação após extração das fixtures](verify-changed.log): `npm run verify:changed`,
  encoding, scanner, 225 testes e build API verdes.
- [Build API](build-api.log): `npm run build --workspace apps-api`, exit 0.
- [Build web](build-web.log): `npm run build --workspace apps-web`, exit 0.
- Execuções dirigidas: [U01 RED](u01-red.log), [U01 GREEN](u01-green.log),
  [U02 RED](u02-red.log), [U02 GREEN](u02-green.log),
  [U03 RED](u03-red.log), [U03 GREEN](u03-green.log), [U04 GREEN](u04-green.log).
- Hook ativo: `git config core.hooksPath` = `.githooks`; email correto.
  Todos os commits executaram o hook normal, incluindo a cerca crítica; nenhum `--no-verify`.
  O teste novo não pertence à lista fixa da cerca, por isso os commits RED puderam usar hook normal.
- `git diff --check` sem erros. Fontes novas/editadas em UTF-8; blobs Git com LF.
- Comparação determinística com `781ca5e`: corpo de `getAthleteSummary()` preservado.

O scanner inicialmente apontou CORS wildcard no mock do roteiro visual. O mock foi restringido
a `http://localhost:3001`; a segunda execução de `verify:changed` passou integralmente.
As fixtures são sintéticas e exclusivas de teste; nenhum total oficial é afirmado com base nelas.

## E2E — NÃO VERIFICADA

O build web passou, mas isso não é confirmação visual. A revisão automática rejeitou
`npx next start --port 3001` com `blocked by policy`, sem detalhar motivo. Nenhum comando
equivalente foi tentado para contornar a rejeição. Nenhum screenshot ou sucesso visual é alegado.

Roteiro preparado: `apps/api/test/pp037-visual-check.ts`, com fixtures reutilizadas de
`apps/api/test/fixtures/pp037-modalities.ts` e respostas calculadas pelo serviço real.
Com frontend local disponível em `http://localhost:3001`, executar:

```powershell
npx tsx --tsconfig apps/api/tsconfig.json apps/api/test/pp037-visual-check.ts
```

O roteiro confere `/eficiencia` (1 ouro, 390 pontos) e `/career/alice` (1 prata, 32/74 pontos,
1 confronto), em 1440x1000 e 390x844; verifica overflow horizontal e erros de página, e grava
payloads, screenshots e resultado em `tmp/pp037-visual/`. O roteiro ainda não foi executado.
Não usa banco, autenticação ou produção; não instala dependências e não inicia frontend.

DoD permanece incompleto somente pela confirmação visual pendente. Esta evidência é self-check
de implementação, não parecer de aprovação. Sem merge ou deploy.
