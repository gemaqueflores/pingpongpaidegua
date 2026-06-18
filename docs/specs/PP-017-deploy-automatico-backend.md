# PP-017 — Deploy manual com um clique do backend (API/worker) na VM Oracle

Domínio instável: TDD Red-Green-Refactor verificável no Git — atenção redobrada (classe [[E01]] ativa,
`Documents/estudos/EPISODIC_MEMORY.md`). **Particularidade desta entrega:** o artefato é infraestrutura
(workflow GitHub Actions + comandos shell via SSH), não código de aplicação testável por `node:test`. Por
decisão de Leo no fechamento do ciclo tripartite, **não se aplica ciclo Red-Green clássico** (não há
função pura para test runner) — cada T-* desta Spec é **execução real do workflow contra a VM**, com
evidência de log/saída anexada ao relatório de entrega como critério de aceitação obrigatório, substituindo
o par de commits red/green. Codex deve declarar explicitamente essa adaptação no relatório (ver seção
"Validação antes de reportar").

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — o workflow nasce com acesso a credenciais SSH de produção (`ORACLE_SSH_PRIVATE_KEY`) e executa comandos remotos arbitrários determinados pelo `git fetch/pull` do conteúdo de `main`; é preciso confirmar que não há injeção de comando via input do `workflow_dispatch` (`service`, `event_id`) e que os secrets não são logados.
- e2e-playwright-agent: não — não há UI envolvida nesta entrega.
- report-builder-agent: não — não há exigência de relatório estruturado de evidências além do já previsto no formato padrão de entrega Codex → Claude.

## Objetivo

Hoje, mudanças mergeadas em `main` que afetam o backend (`apps/api`, `apps/worker`, `packages/shared`,
`prisma`) só chegam à produção (VM Oracle `129.213.86.180`) via intervenção manual por SSH — confirmado no
incidente do PP-016 (2026-06-18): o PR foi mergeado, mas a badge "Partidas Previstas" continuou com o valor
antigo até alguém entrar na VM, fazer `git pull`/rebuild/restart manualmente. Esta entrega adiciona um
workflow `workflow_dispatch` (acionado manualmente com um clique no GitHub Actions, não automático no push)
que executa o deploy de forma padronizada e auditável, eliminando a dependência de digitar comandos SSH à
mão e o risco de esquecer algum passo (como aconteceu: rebuild sem antes corrigir o remote da VM).

## Contexto

Ciclo tripartite concluído (`docs/specs/PP-017-deploy-automatico-backend-draft.md`, aprovado ✅ por Leo).
Decisões da Rodada 2/3:
- Gatilho `workflow_dispatch` manual, não `on: push` — risco de rebuild involuntário em VM Always Free
  durante evento ao vivo (posição firme do Codex).
- Reaproveitar o padrão já existente em `.github/workflows/scrape-every-2h.yml` (`appleboy/ssh-action`,
  mesmos secrets `ORACLE_SSH_HOST`/`ORACLE_SSH_USER`/`ORACLE_SSH_PRIVATE_KEY`/`ORACLE_SSH_PORT`/
  `ORACLE_APP_DIR`, mesma detecção `docker compose` v2 / `docker-compose` v1).
- `concurrency: group: scrape-on-vm, cancel-in-progress: false` é **obrigatório** — serializa com o scrape
  que já roda na VM a cada 30 min, evitando colisão de recursos na VM Always Free sem swap suficiente.

## Causa raiz

- **Causa imediata:** não existe nenhum workflow ou script que automatize `git pull` + `docker compose
  build` + restart de `api`/`worker` na VM — confirmado por leitura de todos os arquivos em
  `.github/workflows/`. `production-drift-check.yml` e `post-commit-validation.yml` são checagens
  read-only; `scrape-every-2h.yml` só executa o worker em modo one-shot, sem rebuild de imagem.
- **Causa sistêmica:** o processo de deploy do backend nunca foi formalizado como parte do fluxo SDD/TDD do
  projeto — cresceu organicamente como runbook manual (`docs/runbook-producao-oracle-vercel.md`) para
  cenários de infraestrutura (TLS, CORS, OCI), sem cobrir o ciclo recorrente de "código novo mergeado →
  precisa chegar à VM".
- **Achado adicional descoberto durante a resolução do incidente PP-016:** o `git remote` da VM apontava
  para um **bundle local antigo** (`deploy-main-95cea45.bundle`), não para o repositório GitHub real. Um
  `git pull origin main` direto teria falhado — foi necessário gerar e enviar manualmente um bundle novo
  (`deploy-main-7248f72.bundle`) e fazer fast-forward a partir dele. Esta Spec inclui a correção desse
  remote como **pré-requisito bloqueante** de infraestrutura, fora do escopo de código versionado, mas
  necessário para o workflow funcionar.
- **Padrão:** primeira ocorrência registrada deste tipo de falha (merge não refletido em produção por
  ausência de pipeline) — não há classe E em `EPISODIC_MEMORY.md` para isso ainda.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — deploy manual de `api` apenas
DADO o remote da VM corrigido apontando para o GitHub real e um commit novo em `main` com mudança em
`apps/api/**`
QUANDO o operador aciona `workflow_dispatch` com input `service=api` e `event_id` de um evento conhecido
ENTÃO o workflow conecta via SSH, atualiza o código (`git fetch && git pull`), executa `docker compose
build api`, `docker compose up -d api` (sem tocar `worker`/`postgres`/`redis`), e confirma sucesso via smoke
check

### Cenário 2 — deploy manual de `worker` apenas
DADO o mesmo contexto do Cenário 1, mas mudança restrita a `apps/worker/**`
QUANDO o operador aciona o workflow com input `service=worker`
ENTÃO apenas o serviço `worker` é rebuildado e reiniciado, sem afetar `api`

### Cenário 3 — deploy de `api`+`worker` juntos (mudança em `packages/**` ou `prisma/**`)
DADO uma mudança em `packages/shared/**` ou `prisma/schema.prisma`
QUANDO o operador aciona o workflow com input `service=both` (default)
ENTÃO ambos os serviços são rebuildados e reiniciados na mesma execução

### Cenário 4 — smoke check pós-deploy confirma commit esperado
DADO um deploy concluído (qualquer cenário acima)
QUANDO o workflow executa o passo de validação
ENTÃO o `git log -1` no diretório da aplicação na VM confere com o commit SHA que disparou o workflow,
`docker compose ps` mostra os serviços selecionados como `healthy`, `curl -fsS http://localhost:4000/`
retorna sucesso, e `curl -fsS http://localhost:4000/events/<event_id>` retorna payload JSON válido

### Cenário 5 — falha de build não deixa a VM em estado pior que antes
DADO uma falha hipotética durante `docker compose build` (ex.: erro de sintaxe introduzido por engano em
`main`)
QUANDO o workflow tenta o deploy
ENTÃO o workflow falha de forma visível no GitHub Actions (log de erro do build), e os containers antigos
em produção continuam rodando sem interrupção (porque `docker compose up -d` só substitui containers após
build bem-sucedido — comportamento padrão do Docker Compose, sem necessidade de lógica adicional de
rollback nesta entrega)

### Cenário 6 — concorrência com o scrape é serializada, não simultânea
DADO o workflow de scrape (`scrape-every-2h.yml`) em execução no momento em que o operador aciona o deploy
QUANDO o workflow de deploy é disparado
ENTÃO ele aguarda na fila do `concurrency: group: scrape-on-vm` até o scrape terminar, em vez de executar
em paralelo

### Cenário 7 — remote da VM corrigido permite fetch real do GitHub
DADO o estado atual da VM (remote apontando para bundle local, conforme descoberto no incidente PP-016)
QUANDO a correção de infraestrutura (pré-requisito desta Spec) é aplicada
ENTÃO `git fetch origin main` executado manualmente na VM retorna sucesso e reflete o commit mais recente
de `main` no GitHub, sem necessidade de bundle manual

## Critérios de aceitação

- Workflow `workflow_dispatch` existe em `.github/workflows/deploy-backend.yml`, com inputs `service`
  (`api` | `worker` | `both`, default `both`) e `event_id` (string, default a um evento conhecido a
  definir).
- Pré-requisito de infraestrutura cumprido: `git remote -v` na VM aponta para a URL do GitHub real, e
  `git fetch origin main` executado manualmente confirma sucesso antes da primeira execução do workflow.
- Execução do workflow com qualquer combinação de `service` rebuilda e reinicia apenas os serviços
  selecionados, sem afetar `postgres`/`redis` nem o serviço não selecionado.
- Workflow falha de forma visível (não silenciosa) se o build ou o smoke check falhar; containers antigos
  permanecem rodando em caso de falha de build.
- `concurrency: group: scrape-on-vm, cancel-in-progress: false` presente no workflow.
- Smoke check confirma: commit SHA na VM == commit que disparou o workflow, `docker compose ps` healthy,
  `/` e `/events/<event_id>` respondendo.
- Evidência de pelo menos uma execução real do workflow contra a VM, com log anexado ao relatório de
  entrega (substitui o ciclo Red-Green clássico para esta entrega de infraestrutura).

## Fora de escopo

- Deploy automático no push (`on: push`) — decisão explícita de manter o disparo manual.
- Rollback automático em caso de falha — comportamento atual do Docker Compose (containers antigos
  permanecem rodando até build bem-sucedido) é suficiente; rollback ativo (ex.: reverter para imagem
  anterior automaticamente) não foi pedido e não está nesta Spec.
- Notificação externa (Slack/email) em caso de falha do workflow — falha já é visível no GitHub Actions.
- Deploy do frontend (Vercel já tem deploy automático nativo via GitHub, não é tocado).
- Qualquer mudança em `docker-compose.yml`, `Dockerfile`s ou código de aplicação — esta entrega é só
  infraestrutura de CI/deploy.
- Medição/otimização do tempo de build na VM Always Free — primeira execução real vai revelar o tempo
  necessário; ajuste de `timeout-minutes` é permitido como parte da implementação, mas otimização de
  performance de build não é objetivo desta Spec.

## Impacto técnico

### Arquivos a criar/modificar

- `.github/workflows/deploy-backend.yml` (novo) — estrutura seguindo o padrão de
  `.github/workflows/scrape-every-2h.yml`:
  - `on: workflow_dispatch` com `inputs: service` (choice: api/worker/both, default both) e
    `inputs: event_id` (string, default a definir com Leo/Codex — sugestão: usar o mesmo
    `vars.DRIFT_EVENT_ID` já usado em `production-drift-check.yml` como default, para reaproveitar
    configuração existente).
  - `concurrency: group: scrape-on-vm, cancel-in-progress: false` (linha 6-8 do padrão existente em
    `scrape-every-2h.yml`).
  - Step de pré-check de secrets (`ORACLE_SSH_HOST`, `ORACLE_SSH_USER`, `ORACLE_SSH_PRIVATE_KEY`,
    `ORACLE_SSH_PORT`) seguindo o padrão de `scrape-every-2h.yml` linhas 27-67.
  - Step principal via `appleboy/ssh-action@v1.2.0` (mesma versão usada em `scrape-every-2h.yml:72`):
    `cd $APP_DIR` → `git fetch origin main && git checkout main && git pull origin main` → detecção de
    `docker compose`/`docker-compose` (reaproveitar lógica de `scrape-every-2h.yml:92-104`) → `build` e
    `up -d` apenas dos serviços conforme `inputs.service`.
  - Step de smoke check: comparar `git log -1 --format=%H` na VM com `github.sha`, `docker compose ps`,
    `curl -fsS http://localhost:4000/`, `curl -fsS http://localhost:4000/events/${{ inputs.event_id }}`.

### Pré-requisito de infraestrutura (executar antes de qualquer teste do workflow)

- Na VM (`129.213.86.180`, diretório da aplicação — confirmar path exato via `ORACLE_APP_DIR` ou
  `$HOME/pingpongpaidegua` conforme padrão de `scrape-every-2h.yml:85`):
  `git remote set-url origin https://github.com/gemaqueflores/pingpongpaidegua.git` (ou via SSH deploy key,
  conforme método de auth já usado pelo `appleboy/ssh-action` para a própria conexão — Codex decide o
  método de auth do `git fetch` em si, HTTPS com token ou SSH, desde que documentado no relatório).
  Validar com `git fetch origin main` executado manualmente, confirmando que reflete o commit real do
  GitHub.

### Arquivos que NÃO devem ser tocados

- `docker-compose.yml`, `docker/api.Dockerfile`, `docker/worker.Dockerfile` — nenhuma mudança de imagem ou
  configuração de serviço.
- `.github/workflows/scrape-every-2h.yml`, `production-drift-check.yml`, `post-commit-validation.yml` —
  apenas referenciados como padrão, não modificados.
- Qualquer arquivo em `apps/api/src`, `apps/worker/src`, `apps/web` — esta entrega não altera código de
  aplicação.
- Segredos do GitHub (`ORACLE_SSH_*`) — reutilizados como já existem, sem criação de novo secret nesta
  entrega (a menos que o método de auth do `git fetch` na VM exija um novo secret de deploy key, a
  declarar explicitamente no relatório se for o caso).

### Dependências novas

Nenhuma — reaproveita `appleboy/ssh-action` já usado no projeto.

## Plano de testes

### Cobertura geral
- Camada: infraestrutura/CI — sem testes unitários `node:test` (não há lógica de aplicação pura nesta
  entrega). Cada T-* é uma **execução real verificável**, não um arquivo de teste automatizado.
- Artefato de evidência: log de execução do GitHub Actions (ou trecho relevante) + saída de comandos SSH
  executados manualmente para os pré-requisitos, anexados ao relatório de entrega.
- Sem arquivos de teste a criar — distinto do padrão Red-Green usual do projeto, por ser infraestrutura.

### T-I-01 — pré-requisito: remote da VM corrigido e fetch real funcionando
Camada: infraestrutura (execução manual via SSH, antes do workflow existir)
DADO: o remote da VM hoje aponta para bundle local (`deploy-main-95cea45.bundle`, estado conhecido do
incidente PP-016)
QUANDO: Codex executa `git remote set-url origin <url>` e `git fetch origin main`
ENTÃO: o fetch retorna sucesso e `git log origin/main -1` reflete o commit mais recente real do GitHub,
sem necessidade de bundle manual

### T-I-02 — workflow existe e está acionável manualmente
Camada: infraestrutura (GitHub Actions)
DADO: `.github/workflows/deploy-backend.yml` criado e mergeado/disponível na branch
QUANDO: Codex aciona o workflow via `gh workflow run deploy-backend.yml -f service=api -f
event_id=<id>` (ou interface do GitHub Actions)
ENTÃO: o workflow inicia e aparece como execução em andamento, sem erro de configuração de inputs

### T-I-03 — deploy de `api` apenas não afeta `worker`
Camada: infraestrutura (execução real contra a VM)
DADO: workflow acionado com `service=api`
QUANDO: a execução completa
ENTÃO: log mostra `docker compose build api` e `docker compose up -d api` executados, **sem** menção a
rebuild do `worker`; `docker compose ps` pós-execução mostra `worker` com o mesmo container ID/idade de
antes da execução (não foi recriado) — Cenário 1

### T-I-04 — deploy de `worker` apenas não afeta `api`
Camada: infraestrutura (execução real contra a VM)
DADO: workflow acionado com `service=worker`
QUANDO: a execução completa
ENTÃO: análogo ao T-I-03, invertido — `api` não é recriado — Cenário 2

### T-I-05 — deploy `both` rebuilda os dois serviços
Camada: infraestrutura (execução real contra a VM)
DADO: workflow acionado com `service=both` (ou default, sem input)
QUANDO: a execução completa
ENTÃO: log mostra build e restart de `api` e `worker` na mesma execução — Cenário 3

### T-I-06 — smoke check confirma commit e saúde pós-deploy
Camada: infraestrutura (execução real contra a VM)
DADO: qualquer execução completa do workflow (T-I-03, T-I-04 ou T-I-05)
QUANDO: o passo de smoke check roda
ENTÃO: `git log -1` na VM bate com o SHA que disparou o workflow, `docker compose ps` mostra os serviços
selecionados `healthy`, `curl localhost:4000/` e `curl localhost:4000/events/<event_id>` retornam sucesso
— Cenário 4

### T-I-07 — concorrência serializa com o scrape, sem execução simultânea
Camada: infraestrutura (GitHub Actions, `concurrency`)
DADO: o workflow `scrape-every-2h.yml` em execução ativa no momento do disparo
QUANDO: o workflow de deploy é acionado
ENTÃO: a execução do deploy aparece como "queued"/aguardando no GitHub Actions até o scrape concluir, não
como execução paralela simultânea — Cenário 6 (verificável observando a aba Actions durante uma janela de
scrape agendado, ou forçando a colisão manualmente via `workflow_dispatch` do scrape + deploy em sequência
rápida)

### Cobertura de falhas silenciosas
- O workflow não deve reportar sucesso se o smoke check funcional (`/events/<event_id>`) falhar mesmo que
  o `docker compose ps` esteja healthy — T-I-06 cobre isso explicitamente (saúde do container ≠ API
  funcionalmente correta).
- Falha de build não deve deixar a VM em estado peor (containers antigos derrubados sem novos no lugar) —
  Cenário 5 é validado por comportamento padrão do Docker Compose, não requer T-* dedicado de execução real
  (seria necessário introduzir uma falha deliberada em produção, o que não é justificável); Codex deve
  declarar no relatório que validou esse comportamento via leitura da documentação do Docker Compose
  (`docker compose up -d` só substitui containers após build bem-sucedido) ou via teste em ambiente local/
  staging, não em produção.

### Categorias não aplicáveis
- Formulário/Cadastro, Edição/Atualização, Exclusão, Upload/Arquivo: não aplicável — não há entidade de
  domínio sendo manipulada.
- Autenticação/Autorização: não aplicável diretamente — o controle de acesso é o próprio GitHub (quem pode
  acionar `workflow_dispatch` em `main`), não uma rota da aplicação.
- Integração externa: parcialmente aplicável — a "integração" é a própria VM via SSH; T-I-01 a T-I-07
  cobrem esse aspecto.
- Regra de negócio: não aplicável — não há regra de domínio CBTM envolvida.

### Comando para rodar a suite
Não há suite de testes automatizada para esta entrega (infraestrutura). Validação é por execução real:
```
gh workflow run deploy-backend.yml -f service=api -f event_id=<id>
gh run watch <run-id>
```
