# PP-030 — Autenticação Redis (requirepass) e atualização de consumidores

## Status: v2 — consumidores operacionais adicionais, mecânica de senha/compose corrigida, testes reais exigidos (contraponto verificado)

## Prioridade: Alta (2 de 3 — CAT PP-026, achado de PP-028 Rodada 3/R2). Implementar **depois** de PP-029.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim.
- e2e-playwright-agent: não.
- report-builder-agent: sim — confirmar que todos os consumidores (residentes e operacionais) foram
  atualizados e validados individualmente, não apenas "a fila funciona" de forma agregada.

## Objetivo

Adicionar autenticação (`requirepass`) ao Redis de produção, e propagar a credencial para todos os
consumidores reais no código e em scripts operacionais, fechando a lacuna de defesa em profundidade
identificada em PP-028 R2.

## Errata v1 → v2 (correções aceitas)

**Consumidores operacionais adicionais confirmados** (além dos 3 residentes já mapeados na v1):
`scripts/autonomy-sanity-check.ts:397`, `scripts/live-event-watch.ts:402`,
`scripts/production-quality-gate.ts:382` — todos leem `process.env.REDIS_URL` como string completa
(mesmo padrão dos residentes), então provavelmente não exigem código novo, apenas a variável de ambiente
correta no momento da execução — mas devem entrar na validação/checklist desta Spec, não ficar de fora.

**Mecânica de senha corrigida:**
- Gerar a senha em formato hexadecimal ou base64url (sem caracteres reservados de URL como `@`, `/`,
  `:`, espaço) — evita a necessidade de percent-encoding manual ao montar `redis://:<senha>@host:porta`.
  Se por algum motivo a senha gerada contiver caractere reservado, aplicar percent-encoding antes de
  embutir na URL (não montar a URL com a senha crua).
- **A imagem `redis:7-alpine` não expõe uma variável de ambiente nativa que ative `requirepass`** — a
  única forma correta é passar `--requirepass <valor>` no `command` do serviço no `docker-compose.yml`.
  Como o valor não pode ser hardcoded no `command` (seria o mesmo erro que PP-029 corrige), a expansão da
  variável de ambiente **dentro do container** exige `$$REDIS_PASSWORD` na sintaxe do Compose (o `$$`
  escapa o `$` para o Compose não tentar resolver no host, deixando a resolução para o shell dentro do
  container) — não `${REDIS_PASSWORD}` simples, que seria resolvido pelo Compose no host e poderia vazar
  em `docker inspect`/logs do processo de orquestração.
- **Healthcheck:** preferir `REDISCLI_AUTH` como variável de ambiente do healthcheck (lida
  automaticamente pelo `redis-cli`) em vez de `redis-cli -a <senha> ping`, que expõe a senha em texto
  claro na listagem de processos (`ps`) durante a execução do healthcheck e gera warning do próprio
  `redis-cli` sobre insegurança do uso via linha de comando.

**Testes corrigidos — T-I-01 a T-I-04 exigem Redis real, não existe hoje:**
Não há suite de integração com Redis real no projeto atualmente. Estes T-* não podem ser "testes
unitários com mock" — exigem `docker compose up redis` (ou um Redis efêmero equivalente) em CI/local, e
um script de integração reproduzível (novo, criado nesta Spec) que sobe o Redis autenticado e valida os
cenários. Se não houver tempo/infra de CI para isso nesta rodada, T-I-01 a T-I-04 tornam-se checklist
manual de validação pós-deploy (documentado explicitamente como tal no relatório de entrega, não
apresentado como suite automatizada se não for).

**Sequenciamento (aceito):** PP-029 antes de PP-030 — ambas tocam o mesmo `docker-compose.yml` e as
mesmas variáveis de ambiente de produção; aplicar PP-030 antes de PP-029 estar concluída aumenta o risco
de conflito entre as duas mudanças na mesma janela.

**Confirmação do fallback local (aceita, já era esperado):** o `try/catch` em
`simple-rate-limit.middleware.ts` já cobre falha assíncrona de autenticação do Redis — não regride, sem
mudança necessária nessa lógica.

## Contexto e causa raiz

CAT PP-026/PP-028 R2: a rede `pingpongpaidegua_default` contém 4 containers (api, worker, postgres,
redis). Confirmado por leitura do `docker-compose.yml:43-78`: o serviço `redis` não define `requirepass`.

**Precisão de risco:** comprometer o Redis isoladamente não implica automaticamente execução no container
ou acesso ao PostgreSQL — o risco lateral depende de outro container/serviço com acesso à rede já estar
comprometido. É lacuna de defesa em profundidade, não vulnerabilidade crítica isolada.

**Consumidores reais de `REDIS_URL` (confirmado por `Grep`, v2 completa):**
1. `apps/api/src/common/queue.service.ts:16-18` — BullMQ.
2. `apps/api/src/common/simple-rate-limit.middleware.ts:227-233` — ioredis direto.
3. `apps/worker/src/config.ts:28` — consumido pelo BullMQ do worker.
4. `scripts/autonomy-sanity-check.ts:397` — operacional.
5. `scripts/live-event-watch.ts:402` — operacional.
6. `scripts/production-quality-gate.ts:382` — operacional.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Redis exige autenticação**
DADO o Redis de produção com `requirepass` configurado via `$$REDIS_PASSWORD` no `command`
QUANDO uma conexão é tentada sem a senha correta
ENTÃO a conexão é rejeitada (`NOAUTH Authentication required`).

**Cenário 2 — Todos os 6 consumidores autenticam corretamente**
DADO `REDIS_URL` atualizada para incluir a credencial (senha sem caractere reservado, ou devidamente
percent-encoded)
QUANDO API, worker, e cada um dos 3 scripts operacionais são executados
ENTÃO todos conectam com sucesso — sem erro `NOAUTH`/`WRONGPASS`.

**Cenário 3 — Healthcheck usa REDISCLI_AUTH, não expõe senha em `ps`**
DADO o healthcheck do serviço `redis` configurado com `REDISCLI_AUTH` como variável de ambiente
QUANDO o healthcheck executa `redis-cli ping`
ENTÃO autentica com sucesso sem a senha aparecer como argumento de linha de comando visível em `ps`.

**Cenário 4 — Fallback local do rate limit não regride**
DADO uma falha de autenticação ou conexão com o Redis
QUANDO uma requisição HTTP chega à API
ENTÃO o fallback já existente (bucket local em memória) continua funcionando — confirmado, sem mudança
nessa lógica.

## Critérios de aceitação

- Redis de produção configurado com `requirepass` via `command: [..., "--requirepass", "$$REDIS_PASSWORD"]`.
- Senha gerada sem caracteres reservados de URL, ou com percent-encoding aplicado corretamente se
  necessário.
- Healthcheck usa `REDISCLI_AUTH`, não `-a` na linha de comando.
- `REDIS_URL` propagada corretamente para os 6 consumidores confirmados (3 residentes + 3 operacionais).
- Fallback local do rate limit validado como não regredido (Cenário 4).
- Nenhuma credencial nova aparece em log, código versionado, `docker inspect` do host, ou mensagem de
  chat.
- Implementada **depois** de PP-029 concluída.

## Fora de escopo

- Não migrar para Redis ACL — `requirepass` simples é suficiente para o modelo atual.
- Não segmentar rede Docker (PP-031).
- Não alterar a lógica de fallback do rate limit em si.
- Não expor a porta 6379 publicamente — binding a `127.0.0.1` permanece.

## Impacto técnico

- Arquivos a modificar:
  - `docker-compose.yml` — serviço `redis`: `command` com `--requirepass $$REDIS_PASSWORD`; healthcheck
    com `REDISCLI_AUTH`; serviços `api`/`worker`: `REDIS_URL` com credencial.
  - `apps/api/.env.example`, `apps/worker/.env.example` — novo formato de `REDIS_URL`.
  - `scripts/autonomy-sanity-check.ts`, `scripts/live-event-watch.ts`,
    `scripts/production-quality-gate.ts` — sem mudança de código esperada (já leem `REDIS_URL` completa),
    mas incluídos na checklist de validação operacional pós-deploy.
- Arquivos que NÃO devem ser tocados: lógica de `queue.service.ts`/`simple-rate-limit.middleware.ts` além
  do necessário para ler a URL já com credencial embutida.
- DDL: nenhuma.
- Rollback: remover `--requirepass` do `command` do Redis e reverter `REDIS_URL` — reversível sem perda
  de dado permanente (Redis é cache/fila; pior caso é perda de jobs em andamento na fila).

## Plano de testes

### Cobertura geral
- **Correção aceita:** não há suite de integração com Redis real hoje. Camada obrigatória depende da
  decisão de infra: se houver tempo/CI disponível, criar script de integração reproduzível (novo,
  `scripts/test-redis-auth.ts` ou equivalente, Codex propõe nome) que sobe Redis autenticado via
  `docker compose` e valida os 4 cenários; se não houver, os itens abaixo tornam-se checklist manual
  documentado como tal — nunca apresentados como suite automatizada se não forem.

### T-I-01 — Conexão sem credencial é rejeitada
DADO: Redis com `requirepass` configurado (ambiente real via `docker compose`, não mock)
QUANDO: uma conexão é tentada sem senha
ENTÃO: rejeitada com erro de autenticação — evidência: saída real do comando/log, não asserção sobre
comportamento assumido.

### T-I-02 — BullMQ (API) conecta corretamente com credencial
DADO: `REDIS_URL` com credencial válida, Redis real rodando
QUANDO: `QueueService` inicializa
ENTÃO: fila `scrape-event` operacional — `getHealth()` retorna `status: "ok"`.

### T-I-03 — Rate limit (ioredis direto) conecta corretamente com credencial
DADO: `REDIS_URL` com credencial válida, Redis real rodando
QUANDO: uma requisição HTTP passa pelo `SimpleRateLimitMiddleware`
ENTÃO: contagem via Redis funciona (não cai no fallback local).

### T-I-04 — Fallback local não regride se credencial estiver errada
DADO: `REDIS_URL` com credencial inválida/ausente
QUANDO: uma requisição HTTP chega
ENTÃO: o middleware ainda responde (fallback local em memória).

### T-C-01 — 6 consumidores validados na checklist operacional pós-deploy
Não é T-* de código — é item do relatório de entrega: Codex confirma, um a um, que os 3 scripts
operacionais executam sem erro `NOAUTH` após a rotação, além dos 3 consumidores residentes já cobertos
por T-I-02/T-I-03.

### Comando para rodar a suite
`npm run test --workspace apps-api` + execução real de `docker compose up redis` para os T-I-* que
exigem Redis real (Codex confirma o comando exato do script de integração, se criado).
