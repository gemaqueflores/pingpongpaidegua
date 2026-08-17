# PP-022 — Diagnóstico de categoria não detecta pódio incompleto (H7)

## Status: v2 — aprovada por Leo, pronta para implementação

## Spec mínima inline (correção pontual — bug de lógica localizado, sem DDL, sem novo arquivo de produção)

Objetivo: o campo `diagnostics.status` retornado por categoria com medalhistas deve distinguir "pódio
completo" de "pódio incompleto", em vez de classificar como `"ok"` qualquer lista de medalhistas não vazia.

## Contexto e causa raiz

Localizado em `apps/api/src/user/user.service.ts:2454-2473`. O bloco que calcula `diagnostics` verifica,
em ordem: `athleteCount === 0` → `"sem_atletas"`; `fullCategoryMatches.length === 0` →
`"sem_confrontos_publicados"`; `medalists.length === 0` → `"classificacao_pendente_ou_indefinida"`; caso
nenhuma das três seja verdadeira → `"ok"`. **Nunca compara `medalists.length` contra
`expectedMedalists`** (calculado logo acima, linhas 2445-2449).

Reproduzido em produção no CAT PP-020: categoria `SUB-17 MAS - DUPLAS` (categoryId 1913) do evento Copa
Brasil Prata Belém 2026, com `expectedMedalists=3`, retornou apenas 2 medalhistas e `diagnostics.status =
"ok"`. Publicadas 4 partidas, 2 jogadas, 2 WO.

Causa imediata: comparação ausente no bloco condicional. Causa sistêmica: o campo `diagnostics` foi
desenhado para sinalizar ausência total (sem atletas / sem confrontos / sem classificação), não para
sinalizar completude parcial — omissão de caso, não erro de lógica em código existente.

**Achado adicional (verificado nesta v2):** o resultado desse cálculo é persistido em `ReadModelCache` sob
a chave `event-medalists-v2` (`apps/api/src/user/user.service.ts:2175`). Sem incrementar a versão da
chave, o cache já existente em produção continuaria servindo o payload antigo (com `status: "ok"` para
pódios incompletos) mesmo após o deploy da correção, até o cache expirar/ser invalidado por outro
mecanismo — o bug pareceria não corrigido mesmo com o código já certo.

## Cenário

DADO uma categoria com `expectedMedalists = N` (N > 0) e confrontos publicados
QUANDO o número de `medalists` resolvidos for maior que zero mas menor que `N`
ENTÃO `diagnostics.status` deve retornar um novo valor (`"medalhistas_incompletos"`) com mensagem
explicando quantos foram encontrados vs. esperados, em vez de `"ok"`.

DADO uma categoria com `medalists.length === expectedMedalists` (pódio completo)
QUANDO o diagnóstico for calculado
ENTÃO `diagnostics.status` permanece `"ok"` — sem regressão no caso majoritário.

## Critério de aceitação

- Novo valor de union type `"medalhistas_incompletos"` adicionado ao tipo `diagnostics.status`
  (linha 305).
- Condição adicionada entre a checagem de `medalists.length === 0` e o `"ok"` final: se
  `medalists.length > 0 && medalists.length < expectedMedalists` → `"medalhistas_incompletos"`, com
  mensagem incluindo os dois números (ex.: `"Encontrados 2 de 3 medalhistas esperados."`).
- Caso `expectedMedalists` seja `0` ou não aplicável, comportamento atual (`"ok"` se há medalhistas)
  permanece — a nova condição só se aplica quando `expectedMedalists > 0`.
- Categoria SUB-17 MAS - DUPLAS (categoryId 1913) da Copa Belém, ao ser consultada após a correção, deve
  retornar `diagnostics.status = "medalhistas_incompletos"`.
- A chave de cache usada para persistir/ler esse read model é incrementada de `event-medalists-v2` para
  `event-medalists-v3` (`user.service.ts:2175`), garantindo que o payload antigo em cache não continue
  sendo servido após o deploy.
- Fixtures e testes existentes que referenciam `event-medalists-v2` são atualizados para `v3` (Codex
  localiza todas as ocorrências via Grep antes de alterar, para não deixar referência órfã à versão
  antiga).
- Teste cobre explicitamente que uma consulta após o deploy força recomputação (não serve payload
  cacheado sob a chave antiga).
- Codex confirma se há outros consumidores do contrato de `diagnostics.status` (frontend, outros
  endpoints) que assumem a união de valores atual como exaustiva, e reporta achados — sem alterá-los
  nesta Spec (ver "Fora de escopo").

## Fora de escopo

- Não investigar/corrigir por que o 3º medalhista está ausente (regra de WO/elegibilidade da categoria
  específica) — isso é um problema de dado, não de diagnóstico; fica para análise separada se Leo
  autorizar.
- Não alterar o cálculo de `expectedMedalists` (linhas 2445-2449).
- Não alterar o comportamento de `"sem_atletas"`, `"sem_confrontos_publicados"` ou
  `"classificacao_pendente_ou_indefinida"` — permanecem como estão.
- Não propagar o novo status para o frontend (badge visual, alerta na UI) nesta Spec — é mudança de
  contrato de API; se desejada, é Spec separada com e2e-playwright-agent.

## Testes

### T-U-01 — Pódio incompleto retorna novo status
Camada: função de cálculo de medalhistas (`user.service.ts`, bloco de `diagnostics`)
DADO: categoria com `expectedMedalists = 3` e `medalists.length = 2`
QUANDO: o diagnóstico é calculado
ENTÃO: `diagnostics.status === "medalhistas_incompletos"` e a mensagem cita "2" e "3".

### T-U-02 — Pódio completo continua "ok" (não regressão)
Camada: mesma função
DADO: categoria com `expectedMedalists = 3` e `medalists.length = 3`
QUANDO: o diagnóstico é calculado
ENTÃO: `diagnostics.status === "ok"`.

### T-U-03 — expectedMedalists ausente/zero não aciona o novo status
Camada: mesma função
DADO: categoria com `expectedMedalists = 0` (ou `null`) e `medalists.length = 1`
QUANDO: o diagnóstico é calculado
ENTÃO: `diagnostics.status === "ok"` — comportamento idêntico ao atual, sem falso positivo.

### T-U-04 — Casos já cobertos (sem_atletas / sem_confrontos_publicados / classificacao_pendente) sem regressão
Camada: mesma função
DADO: os três cenários já existentes (0 atletas; 0 partidas publicadas; medalists vazio)
QUANDO: o diagnóstico é calculado
ENTÃO: os três `status` originais continuam inalterados — reaproveitar/confirmar os testes já existentes
para esses três casos no arquivo de teste de `user.service.ts` (Codex identifica o arquivo/linha exatos ao
implementar).

### T-I-01 — Cache invalidado força recomputação após deploy
Camada: integração (`ReadModelCache` + endpoint de medalhistas)
DADO: um payload já persistido em `ReadModelCache` sob a chave antiga `event-medalists-v2` para um evento,
contendo `status: "ok"` para uma categoria com pódio incompleto
QUANDO: o endpoint de medalhistas é consultado após o deploy desta correção
ENTÃO: a leitura não usa o cache antigo (chave `v2` não é mais consultada), recomputa sob `event-medalists-
v3`, e retorna `status: "medalhistas_incompletos"` para a categoria afetada.

### Comando para rodar a suite
`npm --prefix apps/api test` (ou comando equivalente já usado no projeto para os testes de
`user.service.ts` — Codex confirma comando exato usado nos T-* PP-016 já existentes no mesmo arquivo).

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é lógica de cálculo interna, sem novo input externo, sem query
  nova, sem exposição de dado adicional (o campo `diagnostics` já existe e é público).
- e2e-playwright-agent: não — mudança de contrato de API, sem alteração de UI nesta Spec.
- report-builder-agent: não — relatório de execução simples basta.
