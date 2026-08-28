# PP-039 — Cópia da base de produção para homologação local

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — nenhum código de produção/superfície de auth/input é criado ou alterado;
  o risco relevante (exposição de credencial) é tratado diretamente nesta Spec via exclusão de tabelas,
  não requer varredura OWASP de código.
- e2e-playwright-agent: não — sem mudança de UI/fluxo de usuário.
- report-builder-agent: não.

## Objetivo

Criar uma base de homologação local (Docker Desktop do Leo, database `cbtm_homolog` no container
`appcbtmeventos-postgres-1`) com uma cópia fiel dos dados estruturados de produção, para permitir testar e
validar a implementação de PP-037 (separação individual/duplas) e a decisão de limpeza de PP-038 sem
nenhum risco à integridade do banco de produção. Motivação adicional do Leo: a base local também serve
como material de estudo/análise offline dos eventos já capturados.

## Contexto

CAT/ciclo tripartite `docs/specs/PP-039-draft.md` (Rodadas 1-3, fechado). Produção roda em
`pingpongpaidegua-postgres-1` na VM Oracle (`129.213.86.180`), acessível via MCP `ssh-oracle` — Claude
formula comandos, Codex executa (padrão já usado em PP-028/PP-030/PP-031/PP-036). Ambiente local já tem
`appcbtmeventos-postgres-1` (Postgres 16-alpine, porta `127.0.0.1:5432`) rodando o database `cbtm` de
desenvolvimento.

`prisma/schema.prisma` mapeado: `AdminCredential.passwordHash` e `PasswordResetToken.email`/`tokenHash`
são as únicas tabelas com dado de credencial (de admin, não de atleta) — não devem existir fora de
produção, mesmo como hash. `Athlete` não tem CPF/telefone/e-mail — só nome, clube, estado/região,
pontuação, dado já público na própria aplicação. `raw_captures` é ~95% do tamanho do banco (achado
PP-036) e é HTML bruto sem uso nos testes de PP-037/PP-038.

## Causa raiz

Não aplicável — esta Spec não corrige um bug; é uma operação de infraestrutura solicitada para viabilizar
testes seguros de PP-037/PP-038 sem expor produção a risco.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — dump de produção exclui dado de credencial**
DADO o banco de produção `cbtm` com as tabelas `admin_credentials`, `password_reset_tokens`,
`raw_captures` e todas as demais tabelas de domínio
QUANDO o `pg_dump` é executado com `--exclude-table=public.raw_captures
--exclude-table=public.admin_credentials --exclude-table=public.password_reset_tokens`
ENTÃO o arquivo de dump gerado não contém essas 3 tabelas, e contém todas as demais (incluindo
`read_model_caches`, `event_sync_runs`, `efficiency_config`, `_prisma_migrations`).

**Cenário 2 — integridade do dump é verificada antes do restore**
DADO o dump gerado na VM e transferido via `scp` para a máquina do Leo
QUANDO o `sha256sum` remoto é comparado ao `Get-FileHash` local
ENTÃO os hashes são idênticos antes de qualquer `pg_restore` ser executado — dump corrompido/truncado
nunca chega a ser restaurado.

**Cenário 3 — restore não afeta o banco de desenvolvimento local**
DADO o container local `appcbtmeventos-postgres-1` já rodando o database `cbtm` de desenvolvimento
QUANDO o restore é executado
ENTÃO os dados são restaurados em um database **novo e separado** (`cbtm_homolog`), e o `cbtm` de
desenvolvimento permanece inalterado (contagem de linhas antes/depois idêntica).

**Cenário 4 — contagem de linhas confere entre produção e homologação**
DADO a base `cbtm_homolog` restaurada localmente
QUANDO se compara `COUNT(*)` de `events`, `athletes`, `matches`, `categories` entre produção e
`cbtm_homolog`
ENTÃO os números são idênticos (cópia fiel das tabelas não excluídas).

**Cenário 5 — produção não sofre nenhuma escrita**
DADO que toda a operação de dump é `pg_dump` (read-only) executado via `docker exec` na própria VM
QUANDO a Spec inteira é executada, do dump ao restore local
ENTÃO nenhum comando de escrita (`INSERT`/`UPDATE`/`DELETE`/`DROP`/migração) é executado contra o banco de
produção em nenhum momento.

## Critérios de aceitação

- Dump gerado na VM via `pg_dump --format=custom --compress=6 --no-owner --no-privileges` com as 3
  exclusões do Cenário 1.
- Hash SHA-256 remoto e local conferidos e idênticos antes do restore (Cenário 2).
- Restore em `cbtm_homolog` (database novo), não em `cbtm` (Cenário 3).
- Contagem de linhas de `events`, `athletes`, `matches`, `categories`, `athlete_categories` batendo entre
  produção e `cbtm_homolog` (Cenário 4).
- Confirmação explícita de que `admin_credentials`, `password_reset_tokens` e `raw_captures` não existem
  (ou existem vazias, com 0 linhas) em `cbtm_homolog` — `\dt` + `SELECT COUNT(*)` se a tabela existir por
  algum motivo inesperado.
- Nenhum comando de escrita contra produção registrado no log de execução (Cenário 5).
- Arquivo local de dump (`Downloads\pp-039-cbtm-domain.dump`) e arquivo remoto na VM
  (`/home/ubuntu/pp-039-cbtm-domain.dump`) removidos após o restore confirmado — não deixar cópia
  redundante do dump em disco além da base restaurada.

## Fora de escopo

- Não expor `cbtm_homolog` publicamente ou por rota de API nova — uso é local, via `psql`/cliente direto
  do Leo/Codex.
- Não automatizar isto como rotina recorrente — cópia pontual para viabilizar PP-037/PP-038. Pipeline de
  sync recorrente, se desejado depois, é Spec separada.
- Não copiar `admin_credentials`/`password_reset_tokens`/`raw_captures`.
- Não alterar `docker-compose.yml` nem criar container/serviço novo — reaproveita
  `appcbtmeventos-postgres-1` já existente.
- Não implementar PP-037 nem executar limpeza de PP-038 nesta Spec — só prepara o ambiente para que essas
  duas sejam testadas com segurança depois.

## Impacto técnico

- Arquivos a criar/modificar: nenhum arquivo de código do repositório. Toda a operação é execução de
  comandos (SSH/Docker/`psql`) documentada nesta Spec e no relatório de entrega do Codex.
- Arquivos que NÃO devem ser tocados: todo o código de `apps/`, `packages/`, `prisma/schema.prisma`,
  `docker-compose.yml` — nenhum deve ser modificado por esta Spec.
- DDL: nenhuma migração nova. `cbtm_homolog` recebe o schema tal como já existe em produção, via
  `pg_restore` do próprio dump (que inclui a definição das tabelas copiadas).
- Contrato de API: não aplicável — nenhuma API é tocada.
- Dependências novas: nenhuma (usa `pg_dump`/`pg_restore`/`scp`/`docker` já disponíveis no ambiente).

## Plano de testes

### Cobertura geral
- Camada: verificação operacional (infraestrutura/dado), não teste automatizado de código — não há
  `apps/api/test` a criar/alterar nesta Spec.
- "T-*" abaixo são checagens de integridade a executar e registrar no relatório de entrega, com comando e
  saída literal.

### T-I-01 — Dump exclui as 3 tabelas de credencial e RawCapture
DADO: dump gerado na VM
QUANDO: `pg_restore --list` é executado sobre o arquivo de dump (sem restaurar)
ENTÃO: a listagem não contém `admin_credentials`, `password_reset_tokens` nem `raw_captures`.

### T-I-02 — Integridade do arquivo transferido
DADO: `sha256sum` calculado na VM logo após o `pg_dump`
QUANDO: `Get-FileHash -Algorithm SHA256` é calculado localmente após o `scp`
ENTÃO: os dois hashes são idênticos (string exata registrada no relatório).

### T-I-03 — Restore isolado em `cbtm_homolog`
DADO: `cbtm` de desenvolvimento com sua contagem de linhas atual registrada antes do restore
QUANDO: o restore é executado em `cbtm_homolog`
ENTÃO: a contagem de linhas de `cbtm` (desenvolvimento) é idêntica antes e depois — nenhuma tabela do
`cbtm` foi tocada.

### T-I-04 — Paridade de contagem produção vs. homologação
DADO: `SELECT COUNT(*) FROM events/athletes/matches/categories/athlete_categories` em produção
QUANDO: a mesma query roda em `cbtm_homolog`
ENTÃO: os números são idênticos entre as duas bases.

### T-I-05 — Nenhuma escrita em produção durante a operação
DADO: o log de comandos executados via `ssh-oracle/ssh_exec` durante toda a Spec
QUANDO: revisado
ENTÃO: nenhum comando de escrita (`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`pg_restore` contra o banco de
produção) aparece — só `pg_dump`, `sha256sum`, `stat`, leitura de arquivo.

### T-I-06 — Limpeza de arquivos temporários do dump
DADO: dump restaurado e validado (T-I-04 verde)
QUANDO: os arquivos `/home/ubuntu/pp-039-cbtm-domain.dump` (VM) e
`Downloads\pp-039-cbtm-domain.dump` (local) são removidos
ENTÃO: `ls`/`Test-Path` confirmam que ambos não existem mais.

### Cobertura de falhas silenciosas
- Integração/infra: T-I-01 verifica o efeito real do `--exclude-table` (lista do dump), não apenas que o
  comando "rodou sem erro".
- T-I-03/T-I-04 leem o estado pós-operação diretamente no banco (contagem de linhas), não confiam em
  mensagem de sucesso do `pg_restore`.

### Comando para rodar a suite
Não aplicável (sem suite automatizada). Comandos individuais T-I-01 a T-I-06 executados em sequência via
`ssh-oracle/ssh_exec` (remoto) e terminal local do Codex (local), com saída literal registrada no
relatório de entrega.
