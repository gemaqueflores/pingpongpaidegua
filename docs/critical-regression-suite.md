# Suite Crítica de Regressão

Este projeto já teve bugs reais em superfícies diferentes do produto. Esta suite existe para travar as classes de falha mais caras antes de qualquer mudança nova em:

- eventos agregados e child events
- carreira de duplas e duplas mistas
- group single classification
- sincronização destrutiva de inscrições
- política operacional por situação do evento
- consultas públicas que exigem inscrição confirmada

## Comando único

```bash
npm run test:regression:critical
```

## O que esta suite cobre

### `packages/shared/test/performance.test.ts`

- resolução de índice do atleta na partida
- pares com ordem e separador diferentes
- pares com alias legado de um integrante
- cálculo de aproveitamento de pontos

### `apps/api/test/user-service.event-summary-cache.test.ts`

- paridade entre `listEvents` e `getEventSummary`
- seleção determinística da auditoria oficial por evento
- proteção contra divergência dependente do tamanho do lote consultado

### `apps/api/test/user-service.event-medalists-cache.test.ts`

- medalhistas em evento agregado com child events
- resolução de clube em duplas com placeholder reconciliado
- aplicação correta de sufixo do child event no nome da categoria

### `apps/api/test/user-service.event-efficiency-ranking.test.ts`

- deduplicação de medalhistas de dupla no mesmo evento
- categorias vazias não entram na eficiência
- `athleteCount` usa atletas únicos com inscrição confirmada
- `athleteCount` permanece estável em escopo agregado multi-ID

### `apps/api/test/user-service.athlete-career-pairs.test.ts`

- carreira de pares com confrontos de dupla
- prioridade da categoria oficial quando há duplicidade
- bloqueio de falso positivo por membro parcial
- reconhecimento de alias legado em `scorePlayers`
- cálculo de pontos, classificação e medalha do par em grupo único

### `apps/api/test/group-simulation-scope.test.ts`

- simulador usa apenas `INSCRITO` no escopo `confirmed`
- `PRE_INSCRITO` e `null` não entram como confirmados

### `apps/api/test/user-service.group-simulation-history.test.ts`

- histórico da simulação exclui todos os `eventIds` do agregado atual
- preferência histórica de grupos não aprende com child events do próprio torneio

### `apps/api/test/user-service.registration-queries.test.ts`

- consultas públicas exigem inscrição confirmada
- busca pública acento-insensível
- diretório de pares exige lastro competitivo publicado
- contagem e listagem agregadas em evento multi-ID
- aplicação de sufixo de child event em categorias agregadas

### `apps/worker/test/event-situation.test.ts`

- política operacional por situação do evento
- bloqueio de sincronização destrutiva em `stage-3-resultados`
- bloqueio de payload incidental de inscrições
- guardrail de snapshot parcial sobre base forte

### `apps/worker/test/registration-snapshot.test.ts`

- remoção de categoria ausente do snapshot oficial
- merge confirmado de categoria
- cancelamento de categoria com poucos inscritos
- guarda de sincronização destrutiva por cobertura

## Quando rodar

Rodar obrigatoriamente antes de:

- mudanças em eventos agregados
- mudanças em carreira de atletas ou pares
- mudanças em normalização de nomes compostos
- mudanças em leitura pública derivada
- mudanças em sincronização de inscrições
- deploys que mexam em regra de negócio do worker ou da API

## O que esta suite nao substitui

Ela não substitui:

- `npm run validate:update:prod`
- auditorias de evento em produção
- testes amplos do workspace inteiro

Ela é a cerca rápida para impedir regressão das classes de bug que já ocorreram no produto.
