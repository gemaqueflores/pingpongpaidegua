# PP-039 (draft) — Cópia da base de produção para homologação local

## Status: Rodada 3 — resolvido, pronto para virar Spec formal

## Objetivo

Antes de qualquer limpeza de `RawCapture` (PP-038) ou implementação da separação individual/duplas
(PP-037), criar uma base de homologação local (Docker Desktop do Leo) com uma cópia fiel dos dados
estruturados de produção, para permitir testar/validar sem risco à integridade do banco de produção.
Motivação adicional do próprio Leo: "aprender com a leitura dos eventos para melhorar o desempenho e
autonomia do projeto" — a base de homologação também serve de material de estudo/análise offline.

## Contexto (confirmado por leitura de código)

- Produção roda em container `pingpongpaidegua-postgres-1` na VM Oracle (`129.213.86.180`), acessível via
  MCP `ssh-oracle` — Claude formula comandos, Codex executa (padrão já usado em PP-028/PP-030/PP-031/
  PP-036).
- Ambiente local já tem Docker Desktop configurado (`docker-compose.yml` do projeto), usado para testar
  PP-029/PP-030/PP-031 com containers efêmeros reais.
- `prisma/schema.prisma` mapeado nesta rodada — models com dado sensível identificados:
  - `AdminCredential.passwordHash` (linha 373-382) — hash de credencial de admin, pós-rotação PP-027/
    PP-034. Não deve existir fora de produção, mesmo como hash.
  - `PasswordResetToken.email`/`tokenHash` (linha 360-371) — token de reset de senha de admin, mesmo
    raciocínio.
  - `Athlete` (linha 129-161): nome (`nameDisplay`/`nameNormalized`), clube, estado/região, pontuação —
    **sem CPF, telefone ou e-mail** no schema. Dado pessoal presente é só nome civil + vínculo
    clube/estado, já público na fonte oficial CBTM (os mesmos dados já exibidos publicamente pelo próprio
    site do projeto).
  - Nenhum outro model do schema tem campo de e-mail/telefone/documento de atleta.
- `raw_captures` é ~95% do tamanho do banco (achado PP-036) — dump completo incluindo essa tabela é
  desnecessário para o objetivo desta cópia (testar PP-037/PP-038, que são sobre dado estruturado:
  `matches`, `categories`, `athletes`, `athlete_categories`, `events`, `scrape_runs.extraction_stats`).

## Ambiguidades

**O QUE:** dump/restore completo (`pg_dump`/`pg_restore`) de todo o banco `cbtm`, ou dump seletivo
excluindo tabelas de credencial de admin e `raw_captures`?
**COMO:** `pg_dump` direto do container de produção via SSH, transferido por SFTP (MCP `ssh-oracle` já
suporta `sftp_read`/`sftp_write`) para a máquina do Leo, depois `pg_restore` em novo container Postgres
local?
**ONDE:** novo container Postgres local (`docker-compose` do projeto, serviço adicional tipo
`postgres-homolog`), separado do container `postgres` de desenvolvimento já existente (se houver) —
Codex confirma se já existe um serviço Postgres local no `docker-compose.yml` reaproveitável ou se precisa
de serviço novo.
**Definição de pronto:** base local restaurada, com contagem de linhas por tabela-chave (`events`,
`athletes`, `matches`, `categories`) conferindo com produção, sem tabelas de credencial de admin.

[RESOLVIDO: dump/restore Postgres por **exclusão** (`pg_dump --exclude-table`), não por lista positiva —
mais seguro contra omissão de tabela nova/esquecida do que enumerar manualmente. Exclui apenas
`raw_captures` (95% do tamanho, HTML bruto sem uso nos testes de PP-037/PP-038), `admin_credentials`
(hash de credencial de admin) e `password_reset_tokens` (token de reset de admin). Todo o restante —
incluindo `read_model_caches`, `event_sync_runs`, `efficiency_config` e `_prisma_migrations`, identificadas
pelo Codex como ausentes da lista original deste rascunho — é preservado no dump, por serem dado/derivação
de domínio (cache reconstruível de dado público, histórico de sync, config de eficiência), não credencial.
Achado do Codex aceito: lista positiva manual no rascunho estava incompleta frente ao schema atual —
exclusão por nome evita esse risco de omissão se o schema crescer.]

[RESOLVIDO: transporte em duas etapas.
1. `pg_dump` executado via `docker exec` na VM (formato `--format=custom --compress=6 --no-owner
   --no-privileges`, excluindo `raw_captures`/`admin_credentials`/`password_reset_tokens`), stdout
   redirecionado para arquivo no filesystem da VM (`/home/ubuntu/pp-039-cbtm-domain.dump`), executado por
   Codex via `ssh-oracle/ssh_exec`.
2. Transferência VM → máquina do Leo via `scp` (OpenSSH local, chave já existente em
   `estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`) — não via `ssh-oracle/sftp_read` (limite de
   1MB por chamada, inadequado para dump de dezenas de MB). `sha256sum` remoto conferido contra
   `Get-FileHash` local antes de prosseguir para o restore — integridade do dump verificada antes de tocar
   o banco local.]

[RESOLVIDO: container local já existente reaproveitado — `appcbtmeventos-postgres-1` (serviço `postgres`
do `docker-compose.yml`, Postgres 16-alpine, porta `127.0.0.1:5432`). Restaurar em database separado no
mesmo servidor (`cbtm_homolog`, via `createdb -T template0`), não no `cbtm` de desenvolvimento — evita
colisão sem exigir container/serviço novo. `pg_restore --no-owner --no-privileges --exit-on-error` a
partir do dump copiado para dentro do container via `docker cp`.]

## Hipótese de impacto técnico

- Nenhuma alteração em produção — só leitura (`pg_dump` é read-only sobre o banco de produção).
- Novo serviço `docker-compose` local (ou reaproveitamento de existente) — a confirmar com Codex.
- Nenhuma mudança em código de aplicação — isto é operação de infraestrutura/dado, não Spec de feature.
- Sem DDL: schema restaurado é o mesmo de produção via `pg_restore`.

## Fora de escopo

- Não expor a base de homologação publicamente ou por rota de API nova — uso é local, via `psql`/cliente
  direto do Leo/Codex.
- Não automatizar isto como rotina recorrente nesta Spec — é uma cópia pontual para viabilizar PP-037/
  PP-038. Se Leo quiser um pipeline de sync recorrente depois, é Spec separada.
- Não copiar `admin_credentials`/`password_reset_tokens` (ver RESOLVIDO acima).
- Não copiar `raw_captures` em bloco nesta rodada.
