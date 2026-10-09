# PP-072 — evidência de PostgreSQL e Redis reais

Execução do Codex em 2026-10-09, no commit `7e1b80c`, antes do merge da PR #63.

## Ambiente

- Node.js `v24.13.0`
- npm `11.6.2`
- Docker client/server `29.8.2`
- PostgreSQL `16-alpine` (`sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2`)
- Redis `7-alpine` (`sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`)

Nenhuma credencial persistente foi usada. Os containers, portas, banco e senhas foram efêmeros; o PostgreSQL foi removido no bloco `finally`, e `scripts/test-redis-auth.ts` remove seu próprio Redis.

## Redis real — BullMQ e ioredis

Comando, na raiz do repositório:

```powershell
npm run test:redis-auth
```

Saída relevante (`exit 0`):

```text
T-I-01 pass: conexao sem credencial rejeitada por Redis real
T-I-02 pass: QueueService/BullMQ autenticou em Redis real
T-I-02-worker pass: configuracao BullMQ do worker autenticou em Redis real
T-I-03 pass: rate limit persistiu contagem via ioredis autenticado
T-I-04 pass: senha incorreta degradou para bucket local sem quebrar requisicao
```

Essa execução cobre a fila API/worker com a cadeia instalada do BullMQ, incluindo `msgpackr@2.0.5`.

## Worker com PostgreSQL real

Procedimento executado no PowerShell, com segredo aleatório mantido apenas no processo:

```powershell
$taskContainer = 'pp072-evidence-pg-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$taskPassword = [guid]::NewGuid().ToString('N')
try {
  docker run -d --rm --name $taskContainer `
    -e "POSTGRES_PASSWORD=$taskPassword" `
    -e "POSTGRES_DB=cbtm_test" `
    -p "127.0.0.1::5432" postgres:16-alpine

  # Após pg_isready, a porta publicada foi obtida com docker port.
  $taskUrl = "postgresql://postgres:$taskPassword@127.0.0.1:$taskPort/cbtm_test?schema=public"
  $env:DATABASE_URL = $taskUrl
  $env:DATABASE_URL_WRITE = $taskUrl
  $env:DATABASE_URL_READ = $taskUrl

  npm run prisma:deploy
  npm run test --workspace apps-worker
} finally {
  docker rm -f $taskContainer
}
```

Saída relevante das migrations (`exit 0`):

```text
28 migrations found in prisma/migrations
All migrations have been successfully applied.
```

Resumo da suíte do worker (`exit 0`):

```text
tests 101
suites 0
pass 101
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 7113.4966
```

## Escopo e ressalvas

- Evidência produzida no Windows/PowerShell com Docker Desktop; não atesta Node 20.
- O flag `--experimental-test-module-mocks` permanece fora desta evidência e segue como ressalva documental da revisão.
- Não houve acesso a homologação ou produção.
- Este arquivo registra execução; não altera código de produção nem constitui parecer de aprovação.
