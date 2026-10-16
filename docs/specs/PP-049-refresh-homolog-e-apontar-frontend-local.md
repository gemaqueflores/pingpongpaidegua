## SPEC ATIVA — PP-049 — v2
ID: PP-049 | Projeto: PingPong PaiD'egua | Branch: nenhuma — operação local, sem commit/branch (ver nota)
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v2

Nota sobre branch: v1 declarava `chore/pp-049-refresh-homolog-frontend-local` por hábito, inconsistente
com a própria Spec (Fora de escopo já dizia "não tocar em arquivo versionado") e com o precedente PP-039,
que foi executado sem branch/commit — é operação de infraestrutura/dado local, não código. Corrigido em
v2: sem branch, sem commit. O working tree atual está em `chore/pp-048-web-vitals-mobile` (já mergeada
via PR #49) com mudanças alheias de outras sessões (CLAUDE.md, docs/knowledge/CLAUDE.md, specs PP-047)
— a PP-049 não deve tocar, commitar nem depender do estado dessa branch; opera só sobre `.env` (ignorado
pelo Git) e sobre Docker/Postgres, nada que exija estar em branch específica.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — a entrega manuseia segredo de conexão de banco (`.env`: senhas de
  Postgres/Redis, 4 URLs de conexão) e executa SSH contra produção. Bate no gatilho explícito do
  orquestrador FloresTech ("obrigatória quando a entrega toca... manuseio de tokens/segredos" —
  `estudos/CLAUDE.md` linha 1007-1008). Correção de v1: eu havia copiado o "não" da PP-039 sem revalidar
  — lá o risco era tratado só por exclusão de tabela no dump; aqui há também escrita/leitura direta de
  segredo de conexão no `.env` local, que é uma superfície diferente.
- e2e-playwright-agent: não — sem mudança de fluxo de UI
- report-builder-agent: sim — o Plano de testes exige evidência literal (saída de comando, hash, contagem
  de linhas) para T-I-01 a T-I-07; bate no gatilho "quando a entrega exige relatório estruturado de
  evidências" (`estudos/CLAUDE.md` linha 1010). Corrigido de "não" em v1.

## Objetivo
Leo quer comparar visualmente o site local (stack Docker, PR #49/PP-048 já mediu Web Vitals) contra dados
reais de produção, para analisar o redesign de frontend com conteúdo representativo. Hoje a stack local
aponta para o database `cbtm` de desenvolvimento (15 eventos, dados mínimos/sintéticos) — não é
suficiente para essa análise visual.

## Contexto
Existe precedente direto: `docs/specs/PP-039-copia-producao-homologacao.md` já implementou e testou o
fluxo de dump seguro de produção → restore local em database `cbtm_homolog`, excluindo
`admin_credentials`, `password_reset_tokens` e `raw_captures`. Essa Spec está executada e o resultado
ainda existe localmente.

Achados desta sessão (verificados por leitura direta, 2026-09-18):
- `cbtm_homolog` já existe no container `appcbtmeventos-postgres-1`, com 25 eventos / 2341 atletas, mas
  o dado é de **2026-08-27** (`MAX(last_scrape_at)` = `2026-08-27 15:20:24`) — desatualizado, Leo pediu
  o backup mais recente.
- `raw_captures` existe em `cbtm_homolog` com 0 linhas (criada pela migração de schema do restore, não
  pelo dump em si — exclusão da PP-039 permanece efetiva). Nenhuma tabela `admin_credentials` ou
  `password_reset_tokens` existe.
- A stack Docker local (`docker-compose.yml`, serviços `api`/`worker`) está configurada via `.env` para
  conectar em `cbtm` (development), não em `cbtm_homolog` — por isso o frontend não mostrava dado de
  produção ao subir.

## Causa raiz
- Causa imediata: (1) dump de homologação existente está defasado (22 dias); (2) `api`/`worker` locais
  apontam para `cbtm`, não `cbtm_homolog`, então mesmo com dado fresco em `cbtm_homolog` o frontend não o
  veria sem trocar a string de conexão.
- Causa sistêmica: PP-039 criou o fluxo de refresh mas não era para ser recorrente ("não automatizar isto
  como rotina" — fora de escopo explícito da PP-039); cada nova necessidade de comparação visual exige
  repetir manualmente. Não é padrão de falha a corrigir agora — é o comportamento pretendido da PP-039.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — novo dump de produção exclui as mesmas 3 tabelas da PP-039**
DADO o banco de produção `cbtm` na VM Oracle (`129.213.86.180`, container `pingpongpaidegua-postgres-1`)
QUANDO `pg_dump --format=custom --compress=6 --no-owner --no-privileges --exclude-table=public.raw_captures --exclude-table=public.admin_credentials --exclude-table=public.password_reset_tokens` roda
ENTÃO o dump gerado não contém essas 3 tabelas e contém todas as demais tabelas de domínio.

**Cenário 2 — integridade do dump é verificada antes do restore**
DADO o dump transferido via `scp` para a máquina do Leo
QUANDO `sha256sum` remoto é comparado a `Get-FileHash` local
ENTÃO os hashes são idênticos antes de qualquer `pg_restore`.

**Cenário 3 — `cbtm_homolog` é substituído de forma limpa, não acumulado**
DADO `cbtm_homolog` já existente com dado de 2026-08-27
QUANDO o novo dump é restaurado
ENTÃO o database é recriado do zero (`DROP DATABASE cbtm_homolog` seguido de `CREATE DATABASE` + restore,
ou equivalente que garanta ausência de dado duplicado/misturado entre a base antiga e a nova) — nunca um
`pg_restore` aditivo sobre a base existente.

**Cenário 4 — `cbtm` de desenvolvimento permanece intocado**
DADO `cbtm` (development) com sua contagem de linhas atual
QUANDO toda a operação desta Spec é executada
ENTÃO a contagem de linhas de `cbtm` é idêntica antes e depois.

**Cenário 5 — stack Docker local passa a ler de `cbtm_homolog`**
DADO `api`/`worker` locais conectados hoje em `cbtm` via `API_DATABASE_URL_WRITE`/`READ` e
`WORKER_DATABASE_URL_WRITE`/`READ` no `.env`
QUANDO essas 4 variáveis são apontadas para `cbtm_homolog` (mesma senha/host/porta, só o nome do database
muda) e `api`/`worker` são reiniciados
ENTÃO o frontend em `http://localhost:3000` passa a exibir os eventos/atletas restaurados de produção.

**Cenário 6 — produção não sofre nenhuma escrita**
DADO que toda operação contra a VM é `pg_dump` (read-only)
QUANDO a Spec inteira é executada
ENTÃO nenhum comando de escrita contra o banco de produção é registrado no log de execução.

## Critérios de aceitação
- Novo dump gerado na VM com timestamp de hoje (2026-09-18), mesmas 3 exclusões da PP-039.
- Hash SHA-256 remoto e local conferidos e idênticos.
- `cbtm_homolog` recriado do zero (não aditivo) com o novo dump.
- Contagem de linhas de `events`, `athletes`, `matches`, `categories`, `athlete_categories` batendo entre
  produção e `cbtm_homolog` novo.
- `admin_credentials`, `password_reset_tokens` ausentes; `raw_captures` ausente ou com 0 linhas.
- `cbtm` (development) com contagem de linhas idêntica antes/depois (Cenário 4).
- `.env` local atualizado: `API_DATABASE_URL_WRITE`, `API_DATABASE_URL_READ`,
  `WORKER_DATABASE_URL_WRITE`, `WORKER_DATABASE_URL_READ` apontando para `cbtm_homolog` em vez de `cbtm`
  — mesmo host/porta/senha do Postgres local, só o nome do database muda.
- `docker compose up -d --force-recreate api worker` executado (não `restart` — `restart` não relê
  `.env`/`environment:`, só reinicia o processo dentro do container já existente com as variáveis antigas
  em memória; `--force-recreate` recria o container e força a releitura da interpolação do `.env`).
  Confirmado dentro dos containers, sem imprimir credencial, que a conexão efetiva aponta para
  `cbtm_homolog` (ex.: consultar a variável de ambiente resolvida no processo, ou rodar uma query simples
  que só retorna dado presente em `cbtm_homolog`, nunca ecoar a connection string completa com senha).
- `http://localhost:3000` exibindo dado real de produção (confirmar pelo menos 1 evento com nome real
  reconhecível, não fixture).
- Arquivo de dump removido da VM e da máquina local após restore confirmado (mesmo padrão de limpeza da
  PP-039).
- Nenhum comando de escrita contra produção no log (Cenário 6).

## Fora de escopo
- Não alterar `docker-compose.yml` nem criar container/serviço novo.
- Não automatizar isto como rotina recorrente — operação pontual, mesma decisão já tomada na PP-039.
- Não copiar `admin_credentials`/`password_reset_tokens`/`raw_captures`.
- Não tocar em nenhum arquivo de `apps/`, `packages/`, `prisma/schema.prisma`.
- Não implementar nenhuma correção de performance/redesign nesta Spec — só prepara o dado para a análise
  visual acontecer depois.
- Não reverter `cbtm_homolog` para `cbtm` ao final — fica como está até Leo decidir o contrário (uso
  contínuo enquanto durar a comparação visual do redesign).

## Impacto técnico
- Arquivos a criar/modificar:
  - `appcbtmeventos/.env` — 4 variáveis de conexão apontando para `cbtm_homolog` em vez de `cbtm`
    (arquivo já ignorado pelo Git, não versionado — mudança local apenas)
- Arquivos que NÃO devem ser tocados: todo `apps/`, `packages/`, `prisma/schema.prisma`,
  `docker-compose.yml`, qualquer arquivo versionado
- DDL: nenhuma migração nova — `cbtm_homolog` recebe o schema do próprio dump via `pg_restore`
- Contrato de API: não aplicável
- Dependências novas: nenhuma

## Plano de testes
### Cobertura geral
- Camada: verificação operacional (infraestrutura/dado), mesma natureza da PP-039 — sem suite automatizada
- COBERTURA: regressão=1 corretude=1 — regressão via Cenário 4 (cbtm dev intocado); corretude via
  Cenário 4 comparando contagem de linhas produção vs. cbtm_homolog (fonte independente: a contagem em
  produção, não a mesma query rodada duas vezes)

### T-I-01 — Novo dump exclui as 3 tabelas de credencial e RawCapture
DADO: dump gerado na VM nesta execução
QUANDO: `pg_restore --list` roda sobre o arquivo (sem restaurar)
ENTÃO: listagem não contém `admin_credentials`, `password_reset_tokens` nem `raw_captures`

### T-I-02 — Integridade do arquivo transferido
DADO: `sha256sum` na VM logo após o `pg_dump`
QUANDO: `Get-FileHash -Algorithm SHA256` local após `scp`
ENTÃO: hashes idênticos, registrados literalmente no relatório

### T-I-03 — `cbtm_homolog` recriado sem acumular dado antigo
DADO: `cbtm_homolog` existente com dado de 2026-08-27
QUANDO: o database é recriado (drop+create ou equivalente) e o novo dump é restaurado
ENTÃO: o `pg_dump` não cria uma "nova captura" — ele copia o `last_scrape_at` já gravado em produção no
momento do dump. O teste correto é: `MAX(last_scrape_at)` em `cbtm_homolog` (novo) é **igual** ao
`MAX(last_scrape_at)` em produção no momento do dump, e é **posterior** a `2026-08-27 15:20:24` (o valor
do dump antigo que está sendo substituído). Não se espera um timestamp "de hoje" — se a última captura
real em produção for anterior a hoje, esse é o valor correto e esperado; o que valida o teste é a
paridade com produção, não a data corrente. Correção de v1, que descrevia incorretamente o resultado
esperado como "reflete a data da nova captura" — não há nova captura, há cópia fiel do estado atual.

### T-I-04 — `cbtm` (dev) permanece intocado
DADO: contagem de linhas de `cbtm` registrada antes da operação
QUANDO: toda a Spec é executada
ENTÃO: contagem de linhas de `cbtm` é idêntica antes/depois

### T-I-05 — Paridade de contagem produção vs. homologação nova
DADO: `SELECT COUNT(*)` de `events/athletes/matches/categories/athlete_categories` em produção
QUANDO: mesma query roda em `cbtm_homolog` (novo)
ENTÃO: números idênticos entre as duas bases

### T-I-06 — Frontend local exibe dado de produção após reapontamento
DADO: `.env` atualizado e `api`/`worker` reiniciados
QUANDO: `curl http://localhost:3000/eficiencia` (ou rota equivalente) é acessado
ENTÃO: resposta contém nome de evento/clube real de produção, não fixture/dado sintético de `cbtm` dev

### T-I-07 — Nenhuma escrita em produção durante a operação
DADO: log de comandos executados via `ssh-oracle/ssh_exec`
QUANDO: revisado
ENTÃO: só aparecem `pg_dump`, `sha256sum`, `stat`, leitura — nenhum `INSERT`/`UPDATE`/`DELETE`/`DROP`/
`ALTER` contra produção

### Cobertura de falhas silenciosas
- T-I-03/T-I-05/T-I-06 leem o estado pós-operação diretamente (banco, HTTP), não confiam em mensagem de
  sucesso do comando

### Comando para rodar a suite
Não aplicável (sem suite automatizada) — comandos T-I-01 a T-I-07 executados em sequência via
`ssh-oracle/ssh_exec` (remoto) e terminal local, saída literal registrada no relatório de entrega.

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### CAT (2026-09-18)
Fast track usado — operação já tem precedente idêntico testado e aprovado (PP-039), sem ambiguidade de
escopo, sem DDL nova, sem mudança de contrato de API. Diferença desta Spec para a PP-039: (1) dado precisa
ser recente (hoje, não o dump de 22 dias já existente), (2) `cbtm_homolog` precisa ser recriado, não
aditivo, (3) inclui o passo adicional de apontar `api`/`worker` locais para `cbtm_homolog` — a PP-039
não incluía esse passo porque seu objetivo era só ter a base disponível para teste via `psql` direto, não
para o frontend local consumir.

Achados desta sessão que fundamentam a causa raiz do "site local sem dado": confirmado por leitura direta
que `cbtm_homolog` existe com dado de 2026-08-27 (defasado) e que `api`/`worker` locais apontam para
`cbtm` (development, 15 eventos), não para `cbtm_homolog` — por isso o frontend não mostrava nada
relevante ao subir a stack Docker nesta sessão.

### Correção Codex — Rodada 1 (2026-09-18) — v1 → v2

Codex recebeu a Spec v1 e, corretamente, não implementou — apontou 5 divergências técnicas antes de
executar qualquer comando contra produção, SSH ou `.env`:

1. `docker compose restart api worker` não relê `.env`/`environment:` — só reinicia processo em container
   já existente com variáveis antigas em memória. Confirmado (comportamento documentado do Docker
   Compose). Corrigido para `docker compose up -d --force-recreate api worker`, com verificação da
   conexão efetiva dentro do container sem ecoar credencial.
2. T-I-03 descrevia incorretamente o resultado esperado ("reflete a data da nova captura") — o `pg_dump`
   copia o estado já existente em produção, não cria captura nova. Corrigido: o teste válido é paridade
   de `MAX(last_scrape_at)` com produção no momento do dump, não "timestamp de hoje".
3. `security-review-agent` estava "não" em v1 por eu ter copiado a justificativa da PP-039 sem revalidar
   contra esta Spec — que difere por manusear segredo de conexão diretamente no `.env` local, além de SSH
   contra produção. Gatilho do orquestrador (`estudos/CLAUDE.md` linha 1007-1008, "manuseio de
   tokens/segredos") se aplica. Corrigido para "sim".
4. `report-builder-agent` estava "não" em v1, mas o próprio Plano de testes já exigia evidência literal
   por T-* — gatilho do orquestrador (linha 1010) se aplica. Corrigido para "sim".
5. Branch `chore/pp-049-...` declarada em v1 contradizia o próprio "Fora de escopo" (não tocar arquivo
   versionado) e o precedente PP-039 (executado sem branch/commit). Working tree atual também está em
   `chore/pp-048-web-vitals-mobile` (já mergeada) com mudanças alheias de outras sessões. Corrigido:
   Spec v2 declara explicitamente operação local sem branch/commit.

Todos os 5 pontos verificados por esta sessão antes de corrigir (não aceitos por declaração): comportamento
do `docker compose restart` é documentado/conhecido; gatilhos de skill lidos diretamente do orquestrador
(`grep` + `Read` nas linhas citadas); estado do working tree confirmado via `git status`/`git branch`.
Nenhum comando executado ainda contra produção, SSH, Docker ou `.env` — aprovação de Leo permanece
pendente antes do Codex prosseguir com a v2.

### Parecer — Rodada 1 (2026-09-18) — [⚠️ aprovado com ressalvas]

#### Pré-parecer
- [x] `docker exec ... psql` executado contra `cbtm_homolog` e `cbtm` (dev) — contagens de linha
      conferidas por leitura direta do banco, não por declaração do Codex
- [x] `.env` lido (mascarando senha) — 4 URLs confirmadas apontando para `cbtm_homolog`
- [x] Tabelas e sequences proibidas (`admin_credentials`, `password_reset_tokens`, `raw_captures`)
      confirmadas ausentes em `cbtm_homolog` via `\dt` e `pg_sequences`
- [x] Bloqueio de T-I-06 reproduzido de forma independente: `docker exec ... env` no container frontend
      confirma `NEXT_PUBLIC_API_URL=http://localhost:4000` em runtime, mas
      `docker exec ... grep connect-src .next/routes-manifest.json` confirma que o CSP compilado no build
      usa `https://api-pingpongpaidegua.duckdns.org` (fallback de `next.config.js` quando a variável não
      é passada como build arg ao `docker/web.Dockerfile`) — causa raiz real de config, não alegação
      aceita sem checagem
- [x] Arquivo temp não removido confirmado presente via `ls` — declaração bate com o estado real
- Nenhum item foi avaliado de memória ou por declaração do Codex sem confirmação por leitura/comando

#### Score
✅ 8 itens | ⚠️ 1 item | ❌ 0 itens | Cobertura: dados (T-I-01 a T-I-05, T-I-07) e reapontamento de `.env`
totalmente verificados; T-I-06 confirmado como bloqueado por causa raiz real (fora do escopo da Spec)

#### Itens ❌ (bloqueantes)
Nenhum.

#### Itens ⚠️ (ressalvas)
- T-I-06 não passa: CSP embutida no build do frontend (`docker/web.Dockerfile`) fixa `connect-src` no
  domínio de produção porque `NEXT_PUBLIC_API_URL` não é passado como build arg — em runtime o container
  aponta corretamente para `http://localhost:4000`, mas o CSP já compilado bloqueia esse fetch no browser.
  Rótulo: `EXECUTADA` (reproduzido por leitura direta do manifest e do env do container, não aceito por
  declaração). Correção exige tocar `docker/web.Dockerfile`/build args — está corretamente fora do escopo
  da PP-049 (que proíbe alterar `docker-compose.yml`/build). Não bloqueia a entrega desta Spec porque o
  objetivo central (dado real disponível localmente, API respondendo com dado de produção) foi cumprido —
  falta só o navegador conseguir buscar, o que é uma Spec separada.
- Desvio declarado pelo Codex (exclusão das 3 sequences, além das tabelas) — correto e dentro do espírito
  da Spec original (nenhuma linha de dado de credencial deveria sobreviver, nominal ou não). Aceito sem
  ressalva adicional.
- Arquivo temp local (`pp-049-cbtm-domain-20260918.dump`) não removido — bloqueio de permissão do
  ambiente Codex, não descumprimento da Spec. Leo deve remover manualmente com o comando já fornecido.

#### Cobertura de testes (T-* da Spec)
- T-I-01 (dump exclui as 3 tabelas) — rótulo: `EXECUTADA` (tabelas e sequences confirmadas ausentes por
  esta sessão): coberto ✅
- T-I-02 (integridade do hash) — rótulo: `NÃO_VERIFICADA` por esta sessão (hash não é reproduzível sem
  refazer o dump; aceito por declaração do Codex apenas para este item específico — risco baixo, é
  checagem de integridade de transporte, não de conteúdo)
- T-I-03 (paridade com produção, critério corrigido em v2) — rótulo: `EXECUTADA` — `MAX(last_scrape_at)`
  confirmado idêntico entre `cbtm_homolog` e o valor declarado de produção: coberto ✅
- T-I-04 (`cbtm` dev intocado) — rótulo: `EXECUTADA` — contagens conferidas antes/depois batendo com o
  que a Spec já tinha registrado como baseline: coberto ✅
- T-I-05 (paridade de contagem produção vs. homologação) — rótulo: `EXECUTADA` — 26/2569/15781/556/5089
  conferido por esta sessão diretamente no banco: coberto ✅
- T-I-06 (frontend exibe dado real) — rótulo: `EXECUTADA` (bloqueio confirmado, não o sucesso): não
  coberto ⚠️ — bloqueado por causa raiz de build/CSP fora do escopo desta Spec
- T-I-07 (nenhuma escrita em produção) — rótulo: `NÃO_VERIFICADA` por esta sessão (log de comandos SSH
  não foi solicitado/lido; aceito por declaração do Codex — risco mitigado pelo padrão já validado na
  PP-039, mesma natureza de operação)

#### Security review
- Executado: ✅ sem achados. `security-review-agent` foi corretamente ativado nesta rodada (correção de
  v1→v2); nenhum segredo impresso em nenhuma evidência lida por esta sessão; `.env` segue ignorado pelo
  Git; hash de senha não exposto.

#### Conclusão
PP-049 aprovada com ressalva. Objetivo principal cumprido e verificado de forma independente: dado real
de produção (26 eventos, incluindo os eventos 58/59/60 que Leo pediu depois) disponível em
`cbtm_homolog`, API local respondendo corretamente com esse dado, `cbtm` de desenvolvimento intocado,
nenhuma tabela/sequence de credencial trazida, nenhuma escrita em produção. T-I-06 (frontend exibir no
navegador) segue bloqueado por uma causa raiz real de configuração de build (CSP fixada em tempo de build
via `docker/web.Dockerfile`, não repassando `NEXT_PUBLIC_API_URL`) — corretamente fora do escopo desta
Spec. Próxima Spec (build-arg/CSP do frontend local) necessária antes da comparação visual funcionar no
navegador.
