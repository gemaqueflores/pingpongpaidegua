# PP-015 — Filtro por ano no ranking de eficiência (/eficiencia)

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — entrega altera query Prisma/DTO e endpoint público (`GET /efficiency?year=`)
  com input de usuário (query param) influenciando filtro de dados retornados.
- e2e-playwright-agent: não — mudança é coberta por testes de unidade/integração no backend e teste de
  componente no frontend; não há fluxo crítico de navegação ponta a ponta novo que justifique e2e dedicado.
- report-builder-agent: não — entrega não exige relatório estruturado de evidências além do formato padrão
  de entrega Codex → Claude.

## Objetivo
Permitir que o usuário filtre o ranking de eficiência (`/eficiencia`) por ano civil do evento, já que os
pesos de medalha (ouro/prata/bronze) podem variar ao longo do tempo conforme o manual da CBTM — hoje o
ranking soma pontuação de todos os eventos da base usando um único peso global, o que torna impossível
comparar/somar corretamente pontuações entre anos com pesos diferentes.

## Contexto — estado atual relevante, decisões prévias
- `apps/web/app/eficiencia/page.tsx` consome `apiGetGlobalEfficiency()` (`apps/web/lib/user-api.ts:404-411`)
  → `GET /efficiency` sem parâmetros.
- `user.controller.ts:81-84` (`listGlobalEfficiency`) → `user.service.ts:2916-2928`
  (cache em memória `globalEfficiencyCache`, TTL único) → `computeEfficiencyRanking({})`
  (`user.service.ts:2930-3304`), que já aceita `eventIds?: number[]` como filtro opcional (não usado hoje
  pela rota pública).
- O peso de medalha é aplicado **por evento**, dentro do loop em `user.service.ts:3261-3279`, multiplicado
  por `eventWeight` (nível/competição). `weights` hoje é resolvido **uma única vez** por chamada
  (`user.service.ts:2954-2955`), via `getEfficiencyWeights()` (`user.service.ts:6418-6466`), que lê a linha
  única `efficiencyConfig(id=1)` — sem coluna de vigência.
- Schema atual (`prisma/schema.prisma:415-424`): `model EfficiencyConfig { id Int @id, pesoOuro, pesoPrata,
  pesoBronze, createdAt, updatedAt }`.
- `Event` (`prisma/schema.prisma:62-82`) tem `dataInicio`/`dataFim` (`DateTime?`, nullable).
- Admin existente e ativo (achado relevante, não estava no levantamento inicial): `getEfficiencyConfig`/
  `updateEfficiencyConfig` em `admin-events.service.ts:173-205` e `admin-events.controller.ts:36-42`, com UI
  em `apps/web/app/admin/page.tsx` (linhas ~335-1128). O `updateEfficiencyConfig` atual faz `upsert` sobre
  `id: 1` e **não invalida nenhum cache de eficiência** — bug latente que esta spec corrige como parte do
  mesmo esforço, já que o admin está sendo alterado de qualquer forma.
- Achado adicional: `apps/web/app/admin/page.tsx:337-339` inicializa o formulário de pesos com
  `useState("400")`/`useState("240")`/`useState("120")` — valores hardcoded que não refletem nem o default
  real do backend (`130/80/50`). Esta spec remove esse hardcode.
- Decisão de produto (Leo): pesos passam a ser **versionados por período de vigência usando datas exatas**
  (`dataInicioVigencia` obrigatória, `dataFimVigencia` nullable), com efeito retroativo — o registro mais
  antigo cadastrado cobre todos os eventos anteriores a ele. `dataFimVigencia = null` = vigente
  indefinidamente (sempre o estado do registro mais recente). Ao cadastrar um novo registro com
  `dataInicioVigencia` futura, o backend fecha automaticamente o `dataFimVigencia` do registro vigente
  anterior.
- Decisão de produto (Leo): seed inicial de `EfficiencyConfigVersion` usa o **valor real hoje em exercício e
  aprovado em produção** (`efficiency_config(id=1)`), não um valor fixo arbitrário.
- Decisão de produto (Leo): **frontend nunca hardcoda valor de peso/configuração** — todo valor exibido vem
  de fetch ao backend; estado antes do fetch responder é "carregando", nunca um número fixo.
- Ciclo tripartite completo em `docs/specs/PP-015-draft.md` — histórico de decisões e posições técnicas do
  Codex (escopo, performance, riscos de cache, achado do admin existente).

## Causa raiz
- **Causa imediata**: o endpoint `GET /efficiency` e a função `computeEfficiencyRanking` não aceitam nem
  aplicam nenhum filtro de período; o peso de medalha é resolvido uma única vez por chamada em vez de por
  evento, impossibilitando pesos diferentes por ano.
- **Causa sistêmica**: o modelo de dados de configuração de pesos (`EfficiencyConfig`) foi desenhado como
  singleton global desde o início, sem previsão de versionamento temporal — decisão de modelagem adequada
  apenas enquanto a CBTM nunca alterou os pesos entre manuais. Não há precedente de classe E registrada em
  EPISODIC_MEMORY para este padrão (singleton de configuração que precisa de histórico) — primeira ocorrência
  observada neste projeto.
- **Padrão**: não identificado em entregas anteriores do projeto (consultado SESSION_STATE.md e specs PP-001
  a PP-014 — nenhuma trata de versionamento de configuração).

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Filtro por ano específico
DADO que existem eventos com `dataInicio` em 2024, 2025 e 2026, e um único registro de
`EfficiencyConfigVersion` vigente desde antes de 2024 (`dataFimVigencia: null`)
QUANDO o usuário seleciona o ano 2025 no filtro de `/eficiencia`
ENTÃO o ranking soma apenas medalhas de eventos com `dataInicio` no ano civil 2025, usando o peso vigente
naquela data (o único registro disponível, por efeito retroativo).

### Cenário 2 — "Todos os anos" (default)
DADO o mesmo conjunto de eventos do Cenário 1
QUANDO o usuário não seleciona nenhum ano (estado inicial da página)
ENTÃO o ranking soma medalhas de todos os eventos da base (incluindo os com `dataInicio` nulo), aplicando o
peso vigente na data de cada evento individualmente.

### Cenário 3 — Múltiplos períodos de vigência
DADO que existe um registro vigente desde antes de 2024 (`dataFimVigencia: null` originalmente) com pesos
P1, e a CBTM emite novo manual em 2027, e um novo registro é cadastrado com `dataInicioVigencia: 2027-01-01`
e pesos P2
QUANDO o backend processa essa criação
ENTÃO o registro anterior passa a ter `dataFimVigencia: 2026-12-31` (fechado automaticamente) e o novo
registro fica com `dataFimVigencia: null`; eventos com `dataInicio` em 2026 ou antes continuam usando P1,
eventos com `dataInicio` em 2027 ou depois usam P2.

### Cenário 4 — Evento sem `dataInicio`
DADO um evento com `dataInicio: null`
QUANDO o usuário filtra por um ano específico (ex: 2025)
ENTÃO esse evento não entra no ranking filtrado
QUANDO o usuário seleciona "Todos os anos"
ENTÃO esse evento entra no ranking, usando o peso de vigência mais antigo disponível (fallback retroativo).

### Cenário 5 — Ano inválido na query
DADO o endpoint `GET /efficiency`
QUANDO o usuário (ou client) chama com `?year=abc` ou `?year=99999`
ENTÃO o endpoint retorna `400 Bad Request` com mensagem clara — não cai silenciosamente em "todos os anos".

### Cenário 6 — Admin atualiza peso vigente
DADO o registro vigente atual com pesos P1 (`dataFimVigencia: null`)
QUANDO o administrador salva novos pesos P2 via `/admin` (sem informar data — backend usa "agora")
ENTÃO um novo registro é criado com `dataInicioVigencia` = momento do save e `dataFimVigencia: null`; o
registro anterior (P1) passa a ter `dataFimVigencia` = momento do save (ou imediatamente anterior); o cache
de eficiência (`globalEfficiencyCache` e `clubEfficiencyCache`) é invalidado.

### Cenário 7 — Frontend sem hardcode
DADO o formulário de pesos em `/admin` antes do fetch de `apiGetEfficiencyConfig()` responder
QUANDO a página é carregada
ENTÃO os campos de peso aparecem vazios/desabilitados/com skeleton — nunca pré-preenchidos com um número
fixo que não venha do backend.

## Critérios de aceitação — verificáveis objetivamente
1. `GET /efficiency?year=<ano>` retorna ranking considerando apenas eventos com `dataInicio` no ano civil
   informado, com peso resolvido por `dataInicioVigencia`/`dataFimVigencia` de cada evento individualmente.
2. `GET /efficiency` (sem `year`) preserva o conjunto de eventos atual (incluindo `dataInicio` nulo), com
   peso resolvido por evento (não mais um peso único por chamada).
3. `GET /efficiency` retorna `availableYears: number[]` calculado no backend — frontend nunca calcula ou
   hardcoda essa lista.
4. `GET /efficiency?year=<inválido>` retorna `400`.
5. Resolução de peso vigente: registro com `dataInicioVigencia <= dataInicio do evento` E
   (`dataFimVigencia IS NULL` OU `dataFimVigencia >= dataInicio do evento`); fallback para o registro de
   `dataInicioVigencia` mais antiga quando nenhum cobre a data (efeito retroativo).
6. Criar um novo `EfficiencyConfigVersion` com `dataInicioVigencia` futura fecha automaticamente o
   `dataFimVigencia` do registro vigente anterior, dentro de uma transação Prisma.
7. `updateEfficiencyConfig` invalida `globalEfficiencyCache` e `clubEfficiencyCache` após salvar.
8. Migration popula o registro inicial de `EfficiencyConfigVersion` com o valor real lido de
   `efficiency_config(id=1)` no momento da migração (fallback `DEFAULT_EFFICIENCY_WEIGHTS` se a linha não
   existir), `dataFimVigencia: null`.
9. `apps/web/app/admin/page.tsx` não inicializa nenhum estado de peso com valor numérico hardcoded — estado
   inicial é vazio/loading até o fetch responder.
10. `apps/web/app/eficiencia/page.tsx` ganha seletor de ano (opções vindas de `availableYears` da resposta da
    API) com "Todos os anos" como opção padrão/inicial.
11. `getEfficiencyWeights` resolve todas as versões em uma única query por chamada de
    `computeEfficiencyRanking`/`listGlobalEfficiency` (sem N+1 por evento).
12. Comportamento de `/eficiencia/[clubId]` (`getClubEfficiencyCareer`) permanece inalterado (sem filtro de
    ano) — verificado por teste de não-regressão.

## Fora de escopo
- Filtro de ano na página de detalhe do clube (`/eficiencia/[clubId]`) — fica para spec futura, reaproveitando
  a função de resolução de peso por data criada aqui.
- Filtro por intervalo de anos (múltiplos anos simultâneos) — apenas ano único ou "todos".
- Tela de administração de histórico completo de múltiplos registros de vigência (listar/editar/excluir
  registros passados) — CRUD simples do registro vigente atual é suficiente nesta spec.
- Exposição de `dataInicioVigencia`/`dataFimVigencia` editável manualmente na UI do admin — backend sempre
  usa "agora" como `dataInicioVigencia` do novo registro ao salvar.
- Remoção da tabela legada `EfficiencyConfig` — permanece no schema, sem novo uso após a migration inicial.

## Impacto técnico

### Arquivos a criar/modificar
- `prisma/schema.prisma` — nova model `EfficiencyConfigVersion` (`id Int @id @default(autoincrement())`,
  `dataInicioVigencia DateTime`, `dataFimVigencia DateTime?`, `pesoOuro Int`, `pesoPrata Int`,
  `pesoBronze Int`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`); índice em
  `dataInicioVigencia`.
- `prisma/migrations/<novo>/migration.sql` — cria tabela + `INSERT ... SELECT` a partir de
  `efficiency_config` (id=1) com `dataFimVigencia: null`; fallback para `DEFAULT_EFFICIENCY_WEIGHTS` se a
  linha não existir no momento da migração.
- `apps/api/src/user/user.service.ts`:
  - `getEfficiencyWeights` (linha 6418-6466) — nova assinatura aceitando `referenceDate?: Date`, carrega
    todas as `EfficiencyConfigVersion` ordenadas por `dataInicioVigencia` e resolve em memória.
  - `computeEfficiencyRanking` (linha 2930-3304) — passa a resolver peso **por evento** usando `dataInicio`
    como `referenceDate` (substituindo a resolução única em 2954-2955/3268-3276); aceita `year?: number`
    em `input` para filtrar eventos por ano civil de `dataInicio`.
  - `listGlobalEfficiency` (linha 2916-2928) — aceita `year?: number`, cache key composta
    (`globalEfficiencyCache` passa a ser `Map<string, {...}>` por chave `year ?? "todos"`); calcula e retorna
    `availableYears`.
- `apps/api/src/user/user.controller.ts` (linha 81-84) — `@Query("year") year?: string`, parse e validação
  (400 se inválido).
- `apps/web/lib/user-api.ts` (linha 130-137, 404-411) — `GlobalEfficiencyResponse.availableYears: number[]`;
  `apiGetGlobalEfficiency(year?: number)`.
- `apps/web/app/eficiencia/page.tsx` — seletor de ano (select/dropdown) populado por `availableYears`,
  estado de ano selecionado, refetch ao trocar.
- `apps/api/src/admin/admin-events.service.ts` (linha 173-205) — `getEfficiencyConfig`/
  `updateEfficiencyConfig` lendo/escrevendo o registro vigente de `EfficiencyConfigVersion`
  (`dataFimVigencia: null`); `updateEfficiencyConfig` cria novo registro fechando o anterior numa transação
  Prisma e invalida `globalEfficiencyCache`/`clubEfficiencyCache`.
- `apps/web/app/admin/page.tsx` (linha 335-339, 583-625, 1095-1128) — remove hardcode de `useState`; estado
  inicial vazio/loading.

### Arquivos que NÃO devem ser tocados
- `apps/web/app/eficiencia/[clubId]/page.tsx`, `apps/web/components/user/ClubEfficiencyCareerPanel.tsx`,
  `getClubEfficiencyCareer` (`user.service.ts:3306+`) — comportamento atual preservado integralmente
  (não-regressão intencional, fora de escopo).
- `apps/api/src/admin/admin-events.controller.ts` — sem mudança de assinatura HTTP das rotas de eficiência
  (linhas 36-42), apenas comportamento interno do service.
- Tabela `EfficiencyConfig` (model Prisma) — não removida, sem novo uso após a migration inicial.

### DDL / migração
- Nova tabela `efficiency_config_version` com seed inicial via `INSERT ... SELECT` do valor real de
  `efficiency_config(id=1)` (ver Critério 8).

### Contrato de API alterado
- `GET /efficiency` — novo query param opcional `year`; novo campo `availableYears` na resposta. Mudança
  aditiva (não quebra clientes existentes que não enviam `year`).

### Dependências novas
- Nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (resolução de peso por data, fechamento automático de vigência), integração
  (endpoint `/efficiency` com filtro, endpoint admin de update), componente (frontend sem hardcode, seletor
  de ano)
- arquivos de teste a criar: `apps/api/src/user/user.service.spec.ts` (ou arquivo de teste já existente para
  o service, se houver — Codex verifica antes de criar novo), `apps/api/src/admin/admin-events.service.spec.ts`,
  `apps/web/app/eficiencia/page.test.tsx`, `apps/web/app/admin/page.test.tsx` (ou equivalentes conforme
  padrão de testes já adotado no projeto)
- fixtures/mocks: eventos com `dataInicio` em anos distintos (2024, 2025, 2026, null); múltiplos registros de
  `EfficiencyConfigVersion` com janelas de vigência distintas

### T-U-01 — Resolução de peso vigente por data exata
Camada: função (`getEfficiencyWeights`/resolução de versão)
DADO: três registros de `EfficiencyConfigVersion` — A (`dataInicioVigencia: 2020-01-01`,
`dataFimVigencia: 2025-12-31`), B (`dataInicioVigencia: 2026-01-01`, `dataFimVigencia: null`)
QUANDO: resolver peso para `referenceDate = 2025-06-01` e depois para `referenceDate = 2026-06-01`
ENTÃO: primeira chamada retorna os pesos do registro A; segunda chamada retorna os pesos do registro B

### T-U-02 — Fallback retroativo (data anterior a todos os registros)
Camada: função
DADO: único registro de `EfficiencyConfigVersion` com `dataInicioVigencia: 2026-01-01`,
`dataFimVigencia: null`
QUANDO: resolver peso para `referenceDate = 2018-03-01`
ENTÃO: retorna os pesos desse único registro (efeito retroativo, sem lançar erro)

### T-U-03 — Sem nenhum registro cadastrado
Camada: função
DADO: tabela `EfficiencyConfigVersion` vazia
QUANDO: resolver peso para qualquer `referenceDate`
ENTÃO: retorna `DEFAULT_EFFICIENCY_WEIGHTS` (130/80/50)

### T-U-04 — Fechamento automático de vigência ao criar novo registro
Camada: função (`updateEfficiencyConfig` adaptado)
DADO: registro vigente com `dataFimVigencia: null`
QUANDO: criar novo registro com `dataInicioVigencia` no futuro
ENTÃO: registro anterior passa a ter `dataFimVigencia` preenchido (imediatamente anterior à nova
`dataInicioVigencia`); novo registro fica com `dataFimVigencia: null`; operação ocorre dentro de uma
transação (ambas as escritas persistem ou nenhuma persiste)

### T-I-01 — Endpoint filtra por ano
Camada: endpoint (`GET /efficiency?year=`)
DADO: eventos com `dataInicio` em 2024, 2025 e 2026, medalhas distribuídas entre eles
QUANDO: requisição `GET /efficiency?year=2025`
ENTÃO: resposta contém apenas a soma de medalhas/pontuação de eventos com `dataInicio` em 2025;
`availableYears` lista os três anos

### T-I-02 — Endpoint sem filtro preserva comportamento atual (com peso por evento)
Camada: endpoint
DADO: mesmo conjunto de eventos do T-I-01, mais um evento com `dataInicio: null`
QUANDO: requisição `GET /efficiency` (sem `year`)
ENTÃO: resposta inclui todos os eventos (incluindo o de `dataInicio` nulo); pontuação de cada clube reflete
o peso vigente na data de cada evento individualmente, não um peso único aplicado a tudo

### T-I-03 — Ano inválido retorna 400
Camada: endpoint
DADO: endpoint `GET /efficiency`
QUANDO: requisição `GET /efficiency?year=abc`
ENTÃO: resposta `400 Bad Request`

### T-I-04 — Update de peso invalida cache
Camada: endpoint + estado interno (cache)
DADO: `GET /efficiency` já foi chamado uma vez (cache populado)
QUANDO: `PUT/POST` de atualização de peso no admin é executado, seguido de novo `GET /efficiency`
ENTÃO: o segundo `GET` reflete o novo peso (não retorna o valor cacheado anterior)

### T-I-05 — getEfficiencyWeights não gera N+1
Camada: integração (verificação de número de queries)
DADO: ranking com N eventos distintos e M registros de `EfficiencyConfigVersion`
QUANDO: `computeEfficiencyRanking` é executado
ENTÃO: o número de queries para `EfficiencyConfigVersion` é constante (1), independente de N

### T-C-01 — Frontend admin sem hardcode antes do fetch
Camada: componente (`apps/web/app/admin/page.tsx`)
DADO: página renderizada, fetch de `apiGetEfficiencyConfig()` ainda não resolvido
QUANDO: snapshot do estado inicial dos campos de peso é capturado
ENTÃO: campos não exibem `"400"`/`"240"`/`"120"` nem nenhum outro número fixo — exibem estado de
carregamento/vazio

### T-C-02 — Seletor de ano no hub de eficiência
Camada: componente (`apps/web/app/eficiencia/page.tsx`)
DADO: resposta mockada de `apiGetGlobalEfficiency` com `availableYears: [2024, 2025, 2026]`
QUANDO: usuário seleciona o ano 2025 no seletor
ENTÃO: `apiGetGlobalEfficiency` é chamado novamente com `year: 2025`; lista renderizada reflete a nova
resposta (não apenas reordena os dados já carregados)

### T-NR-01 — Não-regressão da página de clube
Camada: integração/componente
DADO: `/eficiencia/[clubId]` e `getClubEfficiencyCareer`
QUANDO: a entrega desta spec é aplicada
ENTÃO: comportamento da página de clube permanece idêntico ao anterior (peso único mais recente aplicado a
toda a carreira, sem filtro de ano) — teste de snapshot/contrato preexistente continua verde sem alteração

### Cobertura de falhas silenciosas
- Update de peso no admin: teste verifica handler chamado E efeito persistido (T-U-04, T-I-04) — não confia
  apenas em retorno HTTP 200.
- Filtro de ano: teste lê o payload retornado e confirma o conjunto de eventos somado, não apenas o status
  da requisição (T-I-01, T-I-02).
- Formulário admin: T-C-01 verifica ausência de hardcode por inspeção do estado renderizado, não apenas por
  leitura de código.

### Comando para rodar a suite
`npm --prefix apps/api test` (backend) e `npm --prefix apps/web test` (frontend) — confirmar comando exato
com Codex caso a estrutura de scripts divirja do CLAUDE.md do projeto.
