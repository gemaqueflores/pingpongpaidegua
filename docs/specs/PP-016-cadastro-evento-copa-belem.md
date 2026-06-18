# PP-016 — Cadastro do evento agregado Copa Brasil Prata Belém/PA 2026

## Spec mínima inline (tarefa operacional — cadastro de dados, sem código novo)

Objetivo: registrar em produção o primeiro evento de nível COPA agregado (canonical + 3 filhos),
usando os endpoints admin já existentes — nenhuma funcionalidade nova é implementada.

Cenário:
DADO que os 4 IDs CBTM 5826 (canonical), 5827, 5828, 5829 referem-se ao mesmo evento físico
(Copa Brasil Prata de Tênis de Mesa, Belém/PA, 13-16/08/2026, conforme circular oficial anexa)
QUANDO o Codex cadastrar os 4 eventos via `POST /admin/events` e os 3 merges via `POST /admin/events/merges`
ENTÃO a API deve passar a resolver qualquer um dos 4 `eventId` para o canonical (5826) em
`resolveEventScope()`, agregando grupos/confrontos/clubes/atletas/eficiência num único evento público.

Critério de aceitação:
- 4 registros em `events` (tabela `events`), um por `cbtmEventId` (5826/5827/5828/5829), todos com
  `nivel = "COPA"`.
- 3 registros em `event_merges`, todos com `primaryEventId` = id interno do evento `cbtmEventId=5826`.
- `GET` em qualquer endpoint público (`/events/{idInternoDoFilho}/...`) deve devolver os dados agregados
  do canonical (mesmo padrão já validado no evento 3TMB26 — ver `docs/specs/AUDIT-3TMB26-producao.md`).

Fora de escopo:
- Nenhuma mudança de código de produção (não há nada a implementar — endpoints já existem).
- Não inserir categorias, atletas, clubes ou confrontos manualmente — isso é responsabilidade do
  scrape automático, que será enfileirado pelo próprio `createEvent()`.
- Não validar/alterar a regra de pesos de eficiência (`rating_event_weights.json`, COPA_BRASIL_PRATA=6) —
  confirmado que este evento conta pontos para o ranking nacional 2026 (circular, página 2).

Testes: não aplicável — operação de carga de dados via endpoint já testado/coberto pela suite existente
de `admin-events.service.ts`. Codex deve apenas confirmar a resposta HTTP 2xx de cada chamada e o
resultado da leitura pós-cadastro (ver "Validação" abaixo).

---

## Orientação para o Codex — PP-016

### Contexto
A Federação de Tênis de Mesa do Pará convocou a Copa Brasil de Tênis de Mesa Prata 2026 (Belém/PA,
13-16/08/2026). O evento já existe no sistema CBTM-Web com 4 IDs distintos para a mesma competição física:

| ID CBTM | Modalidade (conforme print do CBTM-Web) | Papel no nosso sistema |
|---|---|---|
| 5826 | Olímpico - Raking | **Canonical** (primaryEventId) |
| 5827 | Paraolímpico - Raking | Filho (secondaryEventId) |
| 5828 | Olímpico Dupla | Filho (secondaryEventId) |
| 5829 | Olímpico Dupla Mista | Filho (secondaryEventId) |

Este é o primeiro evento de nível COPA a ser cadastrado como agregado (canonical + filhos) no sistema.
O modelo de agregação (`EventMerge` + `resolveEventScope()`) já existe e já está em produção para o
evento 3TMB26 (canonical 51 + filhos 52/53) — nenhuma mudança de código é necessária aqui, apenas carga
de dados via endpoints admin já existentes.

Leo vai enviar a esta sessão o PDF da circular oficial (`Circular_Copa_Brasil_Prata_Belem_2026.pdf`) com
os dados completos do evento — usar como fonte de verdade para as datas abaixo.

### Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — operação via endpoint admin já existente, sem código novo.
- e2e-playwright-agent: não — não há alteração de UI.
- report-builder-agent: não — relatório simples de execução basta.

### Pré-condições
- git config user.email = gemaqueflores@gmail.com (não é necessário para esta tarefa — não há commit
  de código, apenas chamadas HTTP/admin contra a API).
- Confirmar acesso de ADMIN à API de produção (`Authorization: Bearer <token>` via `POST /auth/login`
  com as credenciais admin já configuradas no ambiente).
- Confirmar com a circular (PDF anexo) que as datas abaixo não foram alteradas por nenhuma errata
  posterior à publicação de 05/06/2026.

### Não é uma implementação de código — é uma operação via API admin
Não há arquivos a criar ou modificar. Não há T-* nem ciclo Red-Green-Refactor. A tarefa é puramente
operacional: 4 chamadas `POST /admin/events` + 3 chamadas `POST /admin/events/merges` contra a API de
produção (ou ambiente que Leo indicar), seguidas de validação de leitura.

### Passo 1 — Criar os 4 eventos (`POST /admin/events`)

Para cada evento, usar `nome` igual a `"Copa Brasil Prata Belém/PA 2026"` (mesmo nome-base nos 4 — a
distinção de modalidade fica a cargo do `categorySuffix` no merge, não do nome do evento em si).

Datas conforme cronograma da circular (Tabela 01, página 4):
- `inicioInscricoes`: `"06/06/2026"`
- `fimInscricoes`: `"31/07/2026"` (encerramento das inscrições sem desconto — usar o prazo mais tardio,
  não o prazo "com desconto" de 28/07)
- `inicioRealizacao`: `"13/08/2026"`
- `fimRealizacao`: `"16/08/2026"`
- `concluido`: `false`
- `nivel`: `"COPA"`

Demais campos do DTO (`ratingMatchFormat`, `seedCriteria`, `groupBestOfSets`, `eliminationBestOfSets`,
`allowCobraAdjustments`, `allowByes`) — usar os defaults do `CreateAdminEventDto`, sem informar
explicitamente, salvo se a circular indicar algo divergente do padrão já usado em outros eventos COPA
cadastrados anteriormente (conferir um evento COPA existente como referência, se houver).

Criar nesta ordem, registrando o `id` interno retornado por cada chamada (necessário no Passo 2):

1. `cbtmEventId: 5826` — este será o canonical.
2. `cbtmEventId: 5827`
3. `cbtmEventId: 5828`
4. `cbtmEventId: 5829`

### Passo 2 — Criar os 3 merges (`POST /admin/events/merges`)

Usar o `id` interno (não o `cbtmEventId`) retornado no Passo 1. `primaryEventId` é sempre o id interno
do evento `cbtmEventId=5826`.

| primaryEventId | secondaryEventId | categorySuffix |
|---|---|---|
| id interno de 5826 | id interno de 5827 | `" - PARA"` |
| id interno de 5826 | id interno de 5828 | `" - DUPLAS"` |
| id interno de 5826 | id interno de 5829 | `" - DUPLA MISTA"` |

### Validação antes de reportar
- `GET /admin/events/merges` confirma as 3 linhas com o `primaryEventId` correto.
- Chamar um endpoint público (ex: `GET /events/{idInternoDe5827}/athletes` ou equivalente) e confirmar
  que a resposta retorna o evento agregado pelo canonical (mesmo padrão de comportamento já documentado
  para 3TMB26 em `docs/specs/AUDIT-3TMB26-producao.md`).
- Confirmar que o scrape foi enfileirado para os 4 eventos (`createEvent()` chama `queue.enqueueScrape()`
  automaticamente quando `concluido: false` — não é necessário acionar nada manualmente).

### Reportar ao concluir
- Os 4 `id` internos gerados (mapeados a cada `cbtmEventId`).
- As 3 chamadas de merge confirmadas (request + status HTTP 2xx).
- Resultado da validação de leitura pós-cadastro (Passo de validação acima).
- Qualquer divergência encontrada entre os dados da circular e o que já estava publicado no CBTM-Web
  (ex: mudança de data, mudança de nome de modalidade) — declarar explicitamente, não silenciar.
- Ambiente onde a operação foi executada (produção ou outro, conforme Leo autorizar no momento do envio).
