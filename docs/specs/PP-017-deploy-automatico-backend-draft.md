# PP-017 — Rascunho: deploy automático do backend (API/worker) na VM Oracle

## Origem
Descoberto durante verificação pós-merge do PP-016: o código foi mergeado em `main` (commit `7248f72`),
mas a badge "Partidas Previstas" em produção continuou mostrando o valor antigo porque a API roda em
container Docker na VM Oracle (`129.213.86.180`) que não é rebuildado automaticamente. Confirmado por
leitura de `.github/workflows/*.yml`: existem workflows de scrape (`scrape-every-2h.yml`) e de
verificação/drift (`production-drift-check.yml`, `post-commit-validation.yml`), mas nenhum faz
`git pull` + `docker compose build` + restart dos serviços `api`/`worker` ao mergear em `main`. O Vercel
(frontend) tem integração nativa com o GitHub e redeploya automaticamente — só o backend depende de
intervenção manual via SSH.

## Ambiguidades

### O QUÊ
[RESOLVIDO: `workflow_dispatch` manual com um clique, não deploy automático no push. Codex confirmou:
VM Always Free + risco de evento ao vivo em andamento = automatizar os comandos sem automatizar o
*momento* da execução. Leo aciona manualmente após o merge.]

### Achado crítico — origin da VM não apontava para GitHub
Durante a execução do deploy manual do PP-016, Codex descobriu que o `origin` git da VM apontava para um
**bundle local antigo** (`deploy-main-95cea45.bundle`), não para o repositório GitHub. Um simples
`git pull origin main` não teria funcionado — foi necessário gerar e enviar um bundle novo
(`deploy-main-7248f72.bundle`) manualmente, então fazer fast-forward a partir dele.
[RESOLVIDO — bloqueante de implementação: antes de qualquer workflow automatizado de deploy, é preciso
**reconfigurar o remote da VM para apontar ao GitHub real** (`git remote set-url origin
https://github.com/gemaqueflores/pingpongpaidegua.git` ou via SSH deploy key, a definir), e validar
`git fetch origin main` funcionando de fato via rede a partir da VM antes de automatizar `git pull` no
workflow. Sem essa correção de configuração, o workflow do PP-017 vai falhar exatamente como o deploy
manual teria falhado sem a intervenção do bundle.]

### COMO — gatilho e escopo do rebuild
[RESOLVIDO: gatilho é `workflow_dispatch` (não `on: push`), com `paths` lógico aplicado como **decisão do
operador no momento de disparar** (não filtro automático de workflow, já que o disparo já é manual). Escopo
de rebuild por input do `workflow_dispatch` ou lógica interna:
- mudança em `apps/api/**`, `packages/**`, `prisma/**`, `docker/api.Dockerfile`, compose → rebuild `api`
- mudança em `apps/worker/**`, `packages/**`, `prisma/**`, `docker/worker.Dockerfile`, compose → rebuild `worker`
- mudança em `packages/**` ou `prisma/**` → rebuild `api`+`worker` juntos (mais seguro, posição do Codex)
Implementação exata (input manual escolhendo serviço(s), ou o workflow sempre rebuilda os dois por
simplicidade) fica para a Spec formal — Codex priorizou segurança sobre granularidade.]

### ONDE — janela seguro de execução e risco operacional
A VM é Oracle Always Free com memória limitada (runbook menciona necessidade de swap, sem o que há
travamentos). `docker compose build` de `api`+`worker` (TypeScript + Prisma generate) consome memória/CPU
de forma não-trivial, e a VM já roda `postgres`+`redis`+`api`+`worker` ao mesmo tempo. Há também o job de
scrape rodando a cada 30 min (`scrape-every-2h.yml`, `cron: */30 * * * *`) que usa `docker compose run` no
worker — risco de colisão entre um rebuild de deploy e uma execução de scrape simultânea.
[RESOLVIDO: serialização com o scrape via `concurrency: group: scrape-on-vm, cancel-in-progress: false` é
**obrigatória**, não opcional — posição firme do Codex dado o histórico de instabilidade da VM Always Free
sem swap suficiente.]

### Definição de pronto
[RESOLVIDO — posição do Codex, sem objeção: workflow `workflow_dispatch` executa deploy, deixa container(s)
no commit esperado (`git log -1` confere com o commit disparado), `docker compose ps` mostra serviços
healthy, smoke check de `localhost:4000/` (liveness básico) **e** smoke funcional em `/events/:id` (id
configurável via input do workflow, default a um evento conhecido) confirmando payload coerente. Sem
exigência de notificação externa (Slack/email) nesta entrega — falha do workflow já é visível no GitHub
Actions, suficiente para o uso manual com um clique.]

## Abordagem técnica (resolvida — Rodada 3, com posição do Codex)

Reaproveitar o padrão já existente em `scrape-every-2h.yml`: `appleboy/ssh-action` com os mesmos secrets já
configurados (`ORACLE_SSH_HOST`, `ORACLE_SSH_USER`, `ORACLE_SSH_PRIVATE_KEY`, `ORACLE_SSH_PORT`,
`ORACLE_APP_DIR`), mesmo padrão de detecção `docker compose` v2 / `docker-compose` v1.

Esboço de workflow novo (`.github/workflows/deploy-backend.yml`):
0. **Pré-requisito de infraestrutura (bloqueante):** reconfigurar `git remote` da VM para apontar ao
   GitHub real (não ao bundle local `deploy-main-*.bundle`), e validar `git fetch origin main` funcionando
   via rede a partir da VM. Sem isso, o passo 2 abaixo falha exatamente como o `git pull` manual teria
   falhado durante o deploy do PP-016.
1. Gatilho: `workflow_dispatch` com inputs — `service` (api | worker | both, default both) e `event_id`
   para o smoke check funcional (default a um evento conhecido/configurável).
2. Conectar via SSH, `cd $APP_DIR`, `git fetch origin main && git checkout main && git pull origin main`.
3. `docker compose build <serviços selecionados>` conforme input.
4. `docker compose up -d <serviços selecionados>` (restart só dos serviços afetados, sem tocar
   `postgres`/`redis`).
5. Smoke check pós-deploy: confirmar `git log -1` no container/VM bate com o commit disparado,
   `docker compose ps` com status healthy, `curl -fsS http://localhost:4000/` (liveness) e
   `curl -fsS http://localhost:4000/events/<event_id>` (smoke funcional, payload coerente).
6. `concurrency: group: scrape-on-vm, cancel-in-progress: false` (mesmo grupo do workflow de scrape,
   obrigatório) para serializar e nunca rodar deploy e scrape ao mesmo tempo na VM com recursos limitados.

Trade-off explícito: rebuild de imagem Docker completa (não só `restart`) é necessário porque o código
TypeScript é compilado em build-time na imagem (`docker/api.Dockerfile`) — um simples `restart` sem rebuild
serviria o binário antigo. Esse processo já é lento/pesado na VM Always Free; daí a obrigatoriedade de
serializar com o scrape via `concurrency`.

## Hipótese de impacto técnico (atualizada — Rodada 3)

- **Correção de infraestrutura na VM (fora do repositório, fora de "código"):** `git remote set-url origin
  <url-github>` na VM, validado com `git fetch` real antes de qualquer workflow. Não é mudança de arquivo
  versionado — é configuração de ambiente, similar a uma DEC-CBTM. Precisa ser feita uma vez,
  manualmente, antes do PP-017 poder funcionar.
- Novo arquivo: `.github/workflows/deploy-backend.yml` — segue o padrão estrutural de
  `scrape-every-2h.yml` (mesmos secrets, mesma detecção de compose, mesmo `appleboy/ssh-action`), gatilho
  `workflow_dispatch` com inputs `service` e `event_id`.
- Nenhuma mudança em `docker-compose.yml`, `Dockerfile`s ou código de aplicação.
- Nenhuma mudança em segredos do GitHub — todos os secrets necessários (`ORACLE_SSH_*`) já existem,
  reutilizados de `scrape-every-2h.yml`/`production-drift-check.yml`.
- Risco operacional principal: tempo de build na VM Always Free pode ser longo (vários minutos) — não há
  hoje medição desse tempo; primeira execução real vai revelar se é viável dentro do timeout do workflow
  (sugestão inicial: `timeout-minutes: 30`, ajustável).
- `concurrency: group: scrape-on-vm, cancel-in-progress: false` é obrigatório (não opcional) por decisão do
  Codex — reusa o mesmo group já usado por `scrape-every-2h.yml`.

## Status do ciclo
Todos os `[PENDENTE]` resolvidos com a posição do Codex (Rodada 2), sem itens `[LEO DECIDE]` pendentes —
Codex não levantou nenhum ponto que exija decisão de produto/negócio de Leo, apenas decisões técnicas que
ele já se posicionou com firmeza (workflow manual, paths filtrados, concorrência obrigatória). Achado
crítico de infraestrutura (remote da VM apontando para bundle local) registrado como pré-requisito
bloqueante da implementação. Draft pronto para aprovação de Leo e conversão em Spec formal.
