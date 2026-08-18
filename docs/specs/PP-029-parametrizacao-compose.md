# PP-029 — Parametrização definitiva do docker-compose.yml (remove defaults funcionais em produção)

## Status: v2 — variáveis separadas por serviço, rollback e janela de deploy corrigidos (contraponto verificado)

## Prioridade: Alta (1 de 3 — CAT PP-026, achados derivados de PP-028). Implementar antes de PP-030.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — objetivo direto da Spec é eliminar segredo default versionado.
- e2e-playwright-agent: não.
- report-builder-agent: sim — confirmar item a item que produção não depende mais de nenhum fallback do
  compose, e que o rollback foi testado antes de declarar pronto.

## Objetivo

Eliminar do `docker-compose.yml` versionado qualquer valor default que funcione como segredo real
(`POSTGRES_PASSWORD: postgres`, `JWT_SECRET`/`ADMIN_PASSWORD_HASH` com fallback funcional), substituindo
por variáveis obrigatórias sem fallback — o compose deve falhar explicitamente ao subir se essas
variáveis não forem fornecidas — **sem colapsar os pools de conexão distintos que API e worker já usam
hoje**.

## Errata v1 → v2 (correções aceitas)

**Achado central:** confirmado por leitura (`docker-compose.yml:116-118` vs `149-151`) que API e worker
usam a **mesma variável de ambiente do host** (`DATABASE_URL_WRITE`/`DATABASE_URL_READ`), mas com
**defaults de `connection_limit` diferentes** (API: `8` write / `12` read; worker: `6` write / `4`
read) — essa distinção só existe hoje porque cada serviço tem seu próprio *default*. Se a v1 tornasse
essas variáveis obrigatórias de forma genérica (uma só por nome), o operador de produção teria que
escolher um único valor de `connection_limit` para os dois serviços, perdendo a distinção intencional.

**Corrigido:** variáveis distintas por serviço, propagadas via `docker-compose.yml`:
- `API_DATABASE_URL_WRITE` / `API_DATABASE_URL_READ` — usadas pelo serviço `api`.
- `WORKER_DATABASE_URL_WRITE` / `WORKER_DATABASE_URL_READ` — usadas pelo serviço `worker`.
- `DATABASE_URL` de cada serviço aponta para a respectiva URL de escrita do mesmo serviço (`API_...WRITE`
  para `api`, `WORKER_...WRITE` para `worker`) — não uma variável compartilhada única.

**Demais correções aceitas:**
- T-C-01 deve rodar em ambiente explicitamente vazio (não herdar o `.env` local do desenvolvedor, que
  contaminaria o teste negativo com valores já presentes).
- Rollback não deve restaurar os defaults inseguros do `docker-compose.yml` original — deve restaurar o
  `docker-compose.override.yml` operacional (que já contém as credenciais rotacionadas de PP-027/PP-028)
  como caminho de reversão seguro.
- O workflow `deploy-backend.yml` recria hoje apenas `api`/`worker` — esta migração precisa de janela
  própria que também recria `postgres` (para aplicar as novas variáveis de conexão), com remoção do
  override **somente depois** de comparar a resolução do `docker compose config` (novo) contra o
  comportamento atual (com override), confirmando equivalência antes de remover.
- O override não é removido por `git checkout` (é operacional, não versionado, fora do controle do Git) —
  removê-lo é ação explícita do Codex no servidor, não efeito colateral de nenhuma operação Git.
- `.env.production.example` (hoje só 3 linhas: `NODE_ENV`, `ALLOW_INSECURE_DEV_AUTH_DEFAULTS`,
  `FRONTEND_URL` — confirmado por leitura) precisa listar **todas** as variáveis agora obrigatórias, sem
  nenhum valor funcional — apenas nome + comentário do que deve ser preenchido.

## Contexto e causa raiz

PP-027 e PP-028 corrigiram vazamentos ativos (JWT/credencial admin, senha do Postgres), mas ambas as
correções em produção dependeram de **patches operacionais fora do versionamento**
(`docker-compose.override.yml`, isolado via `.git/info/exclude` do servidor) — o `docker-compose.yml`
principal continua contendo os defaults inseguros originais:
- `docker-compose.yml:23`: `POSTGRES_PASSWORD: postgres` — literal, sem parametrização alguma.
- `docker-compose.yml:100`: `ADMIN_PASSWORD_HASH: ${ADMIN_PASSWORD_HASH:-$2a$12$665oCAgtDnKAz4A9NLc/MOU3jd7wWdbLdrIWe9mIHwM6ypIzo45la}` — fallback funcional (hash bcrypt válido de senha conhecida).
- `docker-compose.yml:97`: `JWT_SECRET: ${JWT_SECRET:-local-dev-jwt-secret-change-me}` — fallback funcional.
- `docker-compose.yml:116-118,149-151`: `DATABASE_URL_WRITE`/`DATABASE_URL_READ`/`DATABASE_URL` com
  connection string completa incluindo `postgres:postgres@postgres` como fallback, **compartilhada entre
  API e worker apesar de pools distintos** (causa raiz corrigida nesta v2).

**Causa sistêmica:** um `docker-compose.yml` pensado originalmente para "funcionar out-of-the-box em dev
local" foi reaproveitado como base para produção sem que os defaults fossem removidos.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — compose falha explicitamente sem variáveis obrigatórias**
DADO que `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `API_DATABASE_URL_WRITE`,
`API_DATABASE_URL_READ`, `WORKER_DATABASE_URL_WRITE`, `WORKER_DATABASE_URL_READ` não estão setadas
QUANDO `docker compose config` é executado em ambiente explicitamente vazio (sem `.env` local herdado)
ENTÃO o Docker Compose recusa resolver a configuração para os serviços que dependem dessas variáveis
(sintaxe `${VAR:?mensagem de erro}` nativa do Compose).

**Cenário 2 — ambiente de desenvolvimento local continua funcionando com `.env` explícito**
DADO um `.env` local com todas as variáveis obrigatórias (incluindo as 4 novas de banco separadas por
serviço) explicitamente declaradas
QUANDO `docker compose up` é executado localmente
ENTÃO os serviços sobem normalmente, cada um com seu próprio `connection_limit` preservado.

**Cenário 3 — migração em produção preserva credenciais já rotacionadas, com janela própria**
DADO que produção já tem as credenciais reais (pós PP-027/PP-028) hoje aplicadas via
`docker-compose.override.yml`
QUANDO o `docker-compose.yml` parametrizado é aplicado em janela de manutenção que recria `postgres` +
`api` + `worker` (não só api/worker como o workflow padrão faz)
ENTÃO o comportamento observável não muda — mesmas credenciais, agora como variáveis nomeadas por
serviço; override é removido **somente após** confirmar que `docker compose config` resolve de forma
equivalente ao estado anterior.

## Critérios de aceitação

- `docker-compose.yml` não contém nenhum valor literal que funcione como segredo — nem como valor
  direto, nem como fallback de `${VAR:-default}`.
- Variáveis de segredo/conexão usam `${VAR:?mensagem}` para os serviços `postgres`, `api`, `worker`.
- `api` usa `API_DATABASE_URL_WRITE`/`API_DATABASE_URL_READ`; `worker` usa
  `WORKER_DATABASE_URL_WRITE`/`WORKER_DATABASE_URL_READ` — variáveis distintas, não compartilhadas,
  preservando os `connection_limit` diferentes já em uso hoje.
- Variáveis não-sensíveis (timeouts, limites, feature flags) permanecem com fallback.
- `.env.production.example` lista todas as variáveis agora obrigatórias, sem nenhum valor funcional —
  apenas nome + comentário.
- README atualizado explicando o novo comportamento de falha explícita e a nova nomenclatura de
  variáveis de banco por serviço.
- `docker-compose.override.yml` operacional só é removido após confirmação de equivalência (Cenário 3) —
  não é passo automático desta Spec, é decisão tomada durante a janela de deploy.

## Fora de escopo

- Não alterar a lógica de `resolveJwtSecret`/`resolveBootstrapAdminPasswordHash`/
  `ALLOW_INSECURE_DEV_AUTH_DEFAULTS` em código (já corrigido em PP-027).
- Não rotacionar nenhuma credencial nesta Spec (já feito em PP-027/PP-028) — apenas renomeia/reorganiza
  como as credenciais já rotacionadas são referenciadas.
- Não segmentar rede Docker (PP-031).
- Não adicionar autenticação ao Redis (PP-030) — mas PP-029 deve ser implementada **antes** de PP-030,
  pois PP-030 também toca variáveis de ambiente do mesmo `docker-compose.yml`.

## Impacto técnico

- Arquivos a modificar:
  - `docker-compose.yml` — remover defaults funcionais; separar `API_DATABASE_URL_*`/
    `WORKER_DATABASE_URL_*`.
  - `.env.production.example` — listar todas as variáveis obrigatórias sem valor funcional.
  - `apps/api/.env.example`, `apps/worker/.env.example` — atualizar para a nova nomenclatura.
  - `README.md` — seção de deploy/produção.
- Arquivos que NÃO devem ser tocados: código de aplicação (`apps/api/src`, `apps/worker/src`) — a
  aplicação já lê `DATABASE_URL_WRITE`/`DATABASE_URL_READ` do próprio ambiente do container, então o
  container `api` recebe `DATABASE_URL_WRITE=${API_DATABASE_URL_WRITE}` internamente (renomeação só na
  camada do compose, sem tocar o código que já lê o nome de variável de sempre dentro do container).
- DDL: nenhuma.
- **Rollback (corrigido):** reverter para o `docker-compose.override.yml` operacional já existente em
  produção (que contém as credenciais já rotacionadas), não para o `docker-compose.yml` original com
  defaults inseguros — nunca reintroduzir os defaults como caminho de reversão.
- **Janela de deploy (corrigida):** esta migração recria `postgres` além de `api`/`worker` — não cabe no
  workflow `deploy-backend.yml` padrão (que só recria api/worker); Codex executa como operação manual
  documentada, com o mesmo cuidado de `wait_service`/healthcheck já usado no workflow.

## Plano de testes

### Cobertura geral
- camada obrigatória: validação de configuração (`docker compose config`), não teste de código
  TypeScript.

### T-C-01 — Compose falha sem variáveis obrigatórias (ambiente explicitamente vazio)
DADO: execução em ambiente isolado sem `.env` local herdado (ex.: `env -i` ou equivalente, Codex confirma
o mecanismo que garante isolamento real) e nenhuma das variáveis obrigatórias setada
QUANDO: `docker compose config` é executado
ENTÃO: falha com mensagem de erro citando a variável ausente — não passa silenciosamente por herdar
valor do ambiente do desenvolvedor.

### T-C-02 — Compose sobe normalmente com .env local completo, pools preservados
DADO: `.env` local com `API_DATABASE_URL_WRITE`/`READ` e `WORKER_DATABASE_URL_WRITE`/`READ` distintos
(valores de teste com `connection_limit` diferentes entre si)
QUANDO: `docker compose config` é executado
ENTÃO: a configuração resolvida mostra `api` com seu `connection_limit` e `worker` com o dele —
confirmando que não há mais compartilhamento acidental de pool.

### T-C-03 — Comparação de equivalência antes de remover o override (substitui o antigo "grep de padrões")
**Correção aceita:** o scanner de segurança do projeto já rodou sobre os 4 arquivos de config sem
achados, e mesmo assim os defaults conhecidos estavam presentes — scanner automático não é evidência
suficiente. Substituído por:
DADO: o `docker-compose.yml` novo (parametrizado) e o estado atual de produção (com override)
QUANDO: `docker compose config` roda com as variáveis de ambiente reais de produção fornecidas (via
`.env` de produção, não hardcoded)
ENTÃO: a resolução final (`docker compose config` output) é comparada manualmente por Codex contra o
comportamento atual antes de remover o override — confirmação humana/funcional, não apenas ausência de
match de regex.

### Comando para rodar a suite
`docker compose config` (validação estática) — mais `npm run verify:encoding` para os arquivos `.md`/
`.env.example` tocados.
