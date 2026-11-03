# PingPong Paid’égua — appcbtmeventos

## Status: desenvolvimento encerrado

**Encerramento registrado em 3 de novembro de 2026.**

O PingPong Paid’égua foi desenvolvido para acompanhar competições de tênis de mesa e consolidar históricos de atletas e clubes. Diante das melhorias em implantação no portal oficial da CBTM, Leonardo Flores decidiu encerrar a evolução do projeto e disponibilizar o código publicamente como portfólio e referência técnica.

O repositório preserva a implementação, as decisões de arquitetura e os aprendizados do projeto. Não haverão de novas funcionalidades, correções ou suporte, nem compromisso de continuidade dos serviços hospedados.

Este encerramento é uma decisão do autor que colabora, coopera e apoia as iniciativas da CBTM, mantendo-se a disposição da entidade para demais melhorias. As referências a ambientes, serviços, testes e procedimentos nas seções abaixo são documentação histórica; não comprovam disponibilidade ou validação atuais.

## Sobre o projeto

Monorepo desenvolvido para captura, normalização, persistência, auditoria e consulta pública de eventos CBTM, com foco em acompanhamento em tempo real e scout técnico histórico.

A implementação foi organizada para cobrir o ciclo completo de um evento:
- scraping de inscricoes, grupos e resultados
- parse e normalizacao de dados oficiais
- persistencia e reconciliacao no PostgreSQL
- read models publicos e administrativos
- frontend publico e painel administrativo

## Leitura rápida

| Aspecto | Descrição |
|---|---|
| Público | Atletas, clubes, treinadores e administração de eventos |
| Problema | Dados competitivos dispersos e divergências entre capturas, resultados e projeções |
| Solução | Pipeline de captura, normalização, reconciliação e consulta com histórico auditável |
| Arquitetura | API, worker de ingestão, interface web e pacotes compartilhados |
| Persistência | PostgreSQL como fonte persistida; Redis para filas e cache |

O trabalho desenvolvido concentra-se em engenharia de dados e software para acompanhamento esportivo. Scraping, regras determinísticas e automação operacional não implicam uso de modelos de IA no produto.

Para executar localmente, consulte **Ambiente Local** e **Build e Testes** abaixo. Os comandos e descrições de validação devem ser confrontados com os resultados do commit e ambiente utilizados; não representam garantia de CI ou produção atuais.

## Objetivos originais do produto
- acompanhar eventos CBTM em tempo real via API publica e scraping resiliente
- persistir historico de atletas para scout tecnico de medalhas, pontos, sets e desempenho competitivo
- persistir historico de clubes refletindo os resultados obtidos por seus atletas representantes
- destacar atletas e clubes com melhor desempenho anual e acumulado, sem mascarar divergencias com a origem oficial

Diretrizes adotadas durante o desenvolvimento:
- operar dentro dos limites da Oracle Cloud Always Free (`2 OCPU / 12 GB`)
- priorizar experiencia mobile-first, responsiva e leve
- preservar a autonomia operacional do sistema para receber, capturar, reconciliar e publicar eventos

## Documentacao da Raiz
- `README.md`: visao funcional, arquitetura e operacao do repositorio.
- `AGENTS.md`: contexto permanente do projeto para agentes e assistentes.
- `PROMPTS.md`: catalogo de prompts operacionais reutilizaveis.
- `docs/critical-regression-suite.md`: cerca critica de regressao para superficies sensiveis do produto.
- `docs/project-maturity-2026-04.md`: fechamento documental do estado atual do projeto.

## Stack
- API: NestJS + Prisma + PostgreSQL
- Worker: BullMQ + Playwright + parser compartilhado
- Web: Next.js
- Shared: `packages/shared`
- Parser: `packages/parser`
- Cache e filas: Redis
- Infra local e producao: Docker Compose
- Infra alvo: Oracle Cloud Always Free

## Estrutura

```text
.
|- apps
|  |- api
|  |- worker
|  `- web
|- packages
|  |- parser
|  `- shared
|- prisma
|- fixtures
|- docs
|- scripts
|- docker
|- AGENTS.md
|- PROMPTS.md
|- README.md
`- docker-compose.yml
```

## Visao Arquitetural
O pipeline principal do worker segue esta ordem:
1. captura (`INSCRICOES`, `GRUPOS`, `RESULTADOS`)
2. persistencia de `raw_captures`
3. parse em `@cbtm/parser`
4. upsert e reconciliacao no banco
5. auditoria do scrape run
6. publicacao e aquecimento seletivo de read models

Observacoes importantes:
- `Fase Eliminatoria` nao e fonte primaria de scraping.
- Eventos podem ser simples ou agregados por configuracao administrativa.
- Redis nao substitui a verdade persistida no PostgreSQL.
- O projeto prioriza resiliencia e degradacao controlada para o Always Free.

## Dominio
Entidades centrais:
- `Event`
- `Category`
- `Athlete`
- `Match`
- `ScrapeRun`
- `ReadModelCache`

Regras de dominio relevantes no estado atual:
- fontes validas: `INSCRICOES`, `GRUPOS`, `RESULTADOS`
- `WO` e `WO duplo` nao contam como partida jogada
- `bye` avanca, mas nao conta como partida jogada
- podio padrao: `1 ouro`, `1 prata`, `ate 2 bronzes`
- excecoes de podio dependem de regra oficial ou configuracao validada
- quadro de medalhas/eficiencia do site contabiliza categorias `Rating (R*)`
- em duplas e duplas mistas, a unidade competitiva e a dupla, nao cada atleta separadamente

## Quadro de Medalhas e Eficiencia
Pesos atuais do site:
- ouro: `130`
- prata: `80`
- bronze: `50`

Pontuacao por evento:
- `pontuacao = quantidade x peso_da_medalha x peso_do_evento`

Desempate do ranking:
1. `pontuacao total`
2. `ouro`
3. `prata`
4. `bronze`

Pesos de evento atualmente usados no projeto:
- `BRASILEIRAO = 18`
- `SELETIVA_NACIONAL = 12`
- `COPA_BRASIL_OURO = 9`
- `COPA_BRASIL_PRATA = 6`
- `ESTADUAL = 3`
- `REGIONAL = 1`

Observacao:
- o quadro do site pode divergir do trofeu oficial da federacao quando a federacao usar outra regra administrativa ou excluir categorias `R*`.

## Duplas e Duplas Mistas
O site oficial publica dados de duplas de forma inconsistente entre abas.
Exemplos comuns:
- inscricoes: `ATLETA A # ATLETA B`
- grupos: apenas um integrante da dupla
- resultados: `ATLETA A - ATLETA B`

Por isso, o projeto normaliza pares e prioriza:
- unidade competitiva canonica
- reconciliacao por aliases
- deduplicacao por evento/categoria quando necessario
- preservacao do clube correto da dupla ou dupla mista

## API Principal
### Auth
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`

### Admin
- `GET /admin/events`
- `GET /admin/events/efficiency-config`
- `PUT /admin/events/efficiency-config`
- `GET /admin/events/merges`
- `POST /admin/events/merges`
- `DELETE /admin/events/merges/{mergeId}`
- `POST /admin/events`
- `PUT /admin/events/{id}`
- `DELETE /admin/events/{id}`
- `POST /admin/events/{id}/mark-completed`
- `POST /admin/events/{id}/scrape-now`
- `POST /admin/events/{id}/reprocess-post-scrape`
- `POST /admin/events/{id}/reprocess-lifecycle`
- `GET /admin/events/{id}/scrape-runs`
- `GET /admin/events/{id}/audit`
- `GET /admin/events/{id}/audit-history`
- `GET /admin/events/{id}/athlete-conflicts`
- `POST /admin/events/{id}/athlete-conflicts/{conflictId}/resolve`
- `POST /admin/events/raw-captures/cleanup`
- `POST /admin/events/{id}/raw-captures/cleanup`

### Publica
- `GET /events`
- `GET /events/{id}`
- `GET /events/{id}/athletes?search=`
- `GET /events/{id}/clubs?search=`
- `GET /events/{id}/categories`
- `GET /events/{id}/clubs/{clubId}/athletes`
- `GET /events/{id}/athletes/{athleteId}/summary`
- `GET /events/{id}/athletes/{athleteId}/identity`
- `GET /events/{id}/efficiency`
- `GET /events/{id}/medalists`
- `GET /events/{id}/group-simulation`
- `GET /efficiency`
- `GET /clubs/{clubId}/efficiency-career`
- `GET /athletes/directory?search=`
- `GET /athletes/{athleteKey}/career`
- `POST /support/report-problem`

## Web
Rotas principais:
- home publica: `http://localhost:3000/`
- hub de eventos: `http://localhost:3000/events`
- hub de atletas: `http://localhost:3000/atletas`
- ranking global de clubes: `http://localhost:3000/eficiencia`
- login admin: `http://localhost:3000/admin/login`
- painel admin: `http://localhost:3000/admin`
- pagina canonica de evento: `http://localhost:3000/events/{id}`
- pagina canonica do atleta no evento: `http://localhost:3000/events/{id}/athletes/{athleteId}`
- simulador de grupos: `http://localhost:3000/events/{id}/group-simulator`
- carreira canonica do atleta: `http://localhost:3000/career/{athleteKey}`
- eficiencia historica do clube: `http://localhost:3000/eficiencia/{clubId}`

Tambem existem paginas institucionais publicas:
- `/sobre`
- `/contato`
- `/privacidade`
- `/colabore`
- `/reportar-problema`

Observacao:
- ainda existem aliases e redirecionamentos herdados em `/user/...`, mas a documentacao deve privilegiar as rotas canonicas do App Router atual.

## Ambiente Local
Pre-requisito: Docker Desktop ativo.

Subir infraestrutura + backend + worker:

No desenvolvimento local, crie um `.env` explicito com os segredos e URLs exigidos pelo Compose. Os
valores abaixo sao apenas nomes; gere ou escolha valores exclusivos para o ambiente local:

```bash
ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true
POSTGRES_PASSWORD=<senha-local>
JWT_SECRET=<segredo-local>
ADMIN_PASSWORD_HASH='<hash-bcrypt-local>'
API_DATABASE_URL_WRITE=postgresql://postgres:<senha-local>@postgres:5432/cbtm?connection_limit=8&pool_timeout=30&connect_timeout=10
API_DATABASE_URL_READ=postgresql://postgres:<senha-local>@postgres:5432/cbtm?connection_limit=12&pool_timeout=30&connect_timeout=10
WORKER_DATABASE_URL_WRITE=postgresql://postgres:<senha-local>@postgres:5432/cbtm?connection_limit=6&pool_timeout=30&connect_timeout=10
WORKER_DATABASE_URL_READ=postgresql://postgres:<senha-local>@postgres:5432/cbtm?connection_limit=4&pool_timeout=30&connect_timeout=10
REDIS_PASSWORD=<senha-redis-local-hexadecimal-ou-base64url>
REDIS_URL=redis://:<senha-redis-local-hexadecimal-ou-base64url>@redis:6379
```

O `docker-compose.yml` falha explicitamente se qualquer uma das nove variaveis estiver ausente ou vazia.
Hashes bcrypt devem ficar entre aspas simples no `.env`, para preservar os caracteres `$`.
Use senha Redis hexadecimal/base64url ou aplique percent-encoding antes de inclui-la em `REDIS_URL`.

Depois suba os servicos:

```bash
docker compose up --build -d
docker compose ps
```

Subir tambem o frontend do monorepo via Docker:

```bash
docker compose --profile local-ui up --build -d
```

Servicos locais:
- API: `http://localhost:4000`
- Web: `http://localhost:3000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

Credenciais locais de desenvolvimento:
- usuario admin: `admin-local`
- senha local padrao: `admin-local-change-me`

Em producao, configure obrigatoriamente:
- `NODE_ENV=production`
- `ALLOW_INSECURE_DEV_AUTH_DEFAULTS=false`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `POSTGRES_PASSWORD`
- `API_DATABASE_URL_WRITE` e `API_DATABASE_URL_READ`
- `WORKER_DATABASE_URL_WRITE` e `WORKER_DATABASE_URL_READ`
- `REDIS_PASSWORD` e `REDIS_URL` autenticada com a mesma senha

API e worker usam variaveis de entrada distintas no Compose para preservar seus pools de conexao. Dentro
de cada container, elas continuam sendo expostas como `DATABASE_URL_WRITE`, `DATABASE_URL_READ` e
`DATABASE_URL`, sem alterar o contrato da aplicacao. Nao existem fallbacks funcionais para credenciais no
Compose versionado.

O Redis recebe `requirepass` no processo do container. O healthcheck usa `REDISCLI_AUTH`, evitando senha
como argumento `-a` do `redis-cli`. API, worker e scripts operacionais continuam consumindo a URL
completa por `REDIS_URL`.

Os cenarios de integracao de autenticacao exigem Docker e Redis real; por isso, sao executados
explicitamente fora da suite unitária padrao:

```bash
npm run test:redis-auth
```

Os defaults publicos de autenticacao so sao aceitos quando
`ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true` estiver definida explicitamente para desenvolvimento local/CI.

## Variaveis e Operacao
Valores de conexao locais padrao nos `.env.example`:
- API write: `connection_limit=6`
- API read: `connection_limit=10`
- Worker write: `connection_limit=4`
- Worker read: `connection_limit=2`

Perfil de produção documentado na Oracle A1 (`2 OCPU / 12 GB`):
- Postgres:
  - `max_connections=80`
  - `shared_buffers=512MB`
  - `max_wal_size=4GB`
- Redis:
  - `maxmemory=256MB`
- API:
  - `NODE_OPTIONS=--max-old-space-size=768`
  - write pool `8`
  - read pool `12`
- Worker:
  - `NODE_OPTIONS=--max-old-space-size=1536`
  - write pool `6`
  - read pool `4`
  - prewarm `100 atletas / concorrencia 3 / timeout 10s`

Esses limites seguem conservadores para Always Free, mas deixam de estrangular a VM A1 como acontecia na `E2.1.Micro`.

## Build e Testes
Comandos uteis:

```bash
npm install
npm run build --workspace apps-api
npm run build --workspace apps-worker
npm run build --workspace apps-web
npm run test --workspace apps-api
npm run test --workspace apps-worker
```

Testes importantes ja existentes cobrem, entre outros:
- read models e cache
- deduplicacao de duplas e duplas mistas
- regras de podio
- regras de WO e WO duplo
- sincronizacao de inscricoes
- integridade do worker antes do upsert

Suite critica de regressao:

```bash
npm run test:regression:critical
```

Essa suite trava as classes de bug mais caras que ja ocorreram no projeto, com foco especial em:
- eventos agregados e child events
- carreira de pares
- medalhistas e eficiencia
- simulacao de grupos
- sincronizacao destrutiva de inscricoes

## Operacao em VM
A infraestrutura de produção documentada utilizava uma VM Oracle Cloud Always Free com Docker Compose. Este registro não confirma que os serviços continuam ativos.
Medidas operacionais importantes ja adotadas:
- housekeeping leve de Docker
- health check periodico da VM
- watchdog funcional de eventos criticos
- alertas opcionais por webhook para falhas operacionais
- limite conservador de conexoes Prisma/Postgres
- prewarm calibrado para a VM A1
- self-heal com baixo impacto
- reinicio automatico do `worker` quando houver `scrape_locked_at` stale persistente
- workflow de scrape alinhado ao intervalo operacional de evento (`30 min`)
- hardening basico de SSH com `fail2ban` e `ufw`

Scripts relacionados:
- `scripts/vm/ppg-vm-health.sh`
- `scripts/vm/ppg-event-watch.sh`
- `scripts/vm/ppg-send-alert.sh`
- `scripts/vm/alerts.env.example`
- `scripts/vm/ppg-housekeeping.sh`
- `scripts/vm/install-vm-ops.sh`
- `scripts/vm/install-ssh-hardening.sh`

Checklist minimo de migracao de VM:
1. restaurar banco e validar contagens basicas de eventos/atletas/partidas
2. subir stack com `docker compose` e validar `api`, `worker`, `postgres` e `redis`
3. reinstalar scripts operacionais com `scripts/vm/install-vm-ops.sh`
4. confirmar no `crontab -l` a presenca de:
   - `ppg-recover`
   - `ppg-vm-health`
   - `ppg-housekeeping`
   - `ppg-event-watch`
5. validar `scripts/validate-update.ts --target=prod`
6. validar `ops:autonomy-check` dentro do container do `worker`
7. so depois desligar a VM antiga

Monitoramento funcional de evento:
- roda na VM a cada `10 min`
- observa eventos em `POS_INSCRICOES_PRE_EVENTO`, `GRADES_PUBLICADAS_PRE_JOGO`, `EM_ANDAMENTO` e `POS_EVENTO` recente
- audita inconsistencias entre resumo do evento e quadro de medalhistas
- pode disparar:
  - `scrape-now-force:stage-2` com cooldown quando detectar mismatch autoritativo de inscricoes no pre-evento
  - `post-scrape-reprocess` com cooldown quando encontrar inconsistencias de publicacao

Alertas operacionais:
- `ppg-vm-health`, `ppg-event-watch` e `ppg-recover` suportam alertas por `Discord`, `Telegram` e `WhatsApp`
- cooldown configuravel via `PPG_ALERT_COOLDOWN_SECONDS`
- roteamento por tipo do alerta:
  - `PPG_ALERT_ROUTES_DEFAULT`
  - `PPG_ALERT_ROUTES_WARN`
  - `PPG_ALERT_ROUTES_FAIL`
  - `PPG_ALERT_ROUTES_{ALERT_KEY}`
- cada rota aceita uma lista separada por virgula no formato:
  - `discord`
  - `telegram`
  - `whatsapp`
  - ou com perfil:
    - `discord:ops`
    - `telegram:diretoria`
    - `whatsapp:critico`
- exemplos:
  - `PPG_ALERT_ROUTES_WARN=discord:ops,telegram:ops`
  - `PPG_ALERT_ROUTES_FAIL=discord:ops,telegram:ops,whatsapp:critico`
  - `PPG_ALERT_ROUTES_RECOVER_FAILED=discord:ops,telegram:ops,whatsapp:critico`

Credenciais por canal:
- Discord:
  - padrao: `PPG_DISCORD_WEBHOOK_URL`
  - por perfil: `PPG_DISCORD_WEBHOOK_URL_OPS`
- Telegram:
  - padrao: `PPG_TELEGRAM_BOT_TOKEN`, `PPG_TELEGRAM_CHAT_ID`
  - por perfil: `PPG_TELEGRAM_BOT_TOKEN_OPS`, `PPG_TELEGRAM_CHAT_ID_OPS`
- WhatsApp Cloud API:
  - padrao:
    - `PPG_WHATSAPP_TOKEN`
    - `PPG_WHATSAPP_PHONE_NUMBER_ID`
    - `PPG_WHATSAPP_TO`
    - `PPG_WHATSAPP_MESSAGE_TYPE`
    - `PPG_WHATSAPP_TEMPLATE_NAME`
    - `PPG_WHATSAPP_TEMPLATE_LANG`
  - por perfil:
    - `PPG_WHATSAPP_TOKEN_CRITICO`
    - `PPG_WHATSAPP_PHONE_NUMBER_ID_CRITICO`
    - `PPG_WHATSAPP_TO_CRITICO`
    - `PPG_WHATSAPP_MESSAGE_TYPE_CRITICO`
    - `PPG_WHATSAPP_TEMPLATE_NAME_CRITICO`
    - `PPG_WHATSAPP_TEMPLATE_LANG_CRITICO`

## Fluxo histórico de desenvolvimento
1. Auditar a implementacao atual.
2. Identificar a camada do problema.
3. Aplicar a menor correcao auditavel.
4. Ajustar testes.
5. Validar build e testes do workspace afetado.
6. So depois subir para producao.

## Referencias de Fixture
Fixtures usadas para parser e testes offline:
- `fixtures/results.txt`
- `fixtures/golden/*.txt`

## Notas Finais
- O projeto privilegia evidencia e rastreabilidade sobre heuristica solta.
- Divergencias com federacao ou site oficial devem ser explicadas com base em captura persistida, regra validada ou configuracao explicita.
- Quando houver diferenca entre visao analitica do site e trofeu oficial, a diferenca deve ser documentada, nao mascarada.

## Registro técnico anterior ao encerramento

A avaliação abaixo é preservada como registro histórico da documentação anterior, sem revalidação nesta atualização:
- infraestrutura e operacao autonoma: maduras
- ingestao e reconciliacao de dados: confiaveis
- eventos agregados e child events: cobertos por regressao critica
- camadas derivadas principais (`career`, `medalists`, `efficiency`, `group simulation`): consolidadas
- experiencia publica principal: orientada a leitura mobile e a consumo rapido de dados em evento
- scouts historicos de atletas e clubes: presentes nas superficies publicas, com recortes acumulados e parte dos recortes anuais ja disponiveis no frontend

### Backlog histórico — sem previsão de implementação

Os itens abaixo foram preservados para referência e não constituem compromissos de manutenção:
- consolidar e explicitar melhor, na documentacao e nas interfaces, a leitura de destaque anual para clubes e atletas
- revisoes futuras de qualidade devem priorizar novos casos reais antes de expandir heuristicas
- toda nova mudanca sensivel em eventos agregados deve manter ou ampliar a `test:regression:critical`
- notificacoes externas existem como base tecnica, mas permanecem opcionais ate definicao operacional
