# PP-033 — Corrigir incompatibilidade lazyConnect/enableOfflineQueue em autonomy-sanity-check.ts

## Spec mínima inline (correção pontual — bug de configuração localizado, sem DDL, sem novo arquivo de produção)

Objetivo: `scripts/autonomy-sanity-check.ts` falha na checagem de fila (`checkQueue`/
`checkEventFreshness`) mesmo com Redis autenticado e saudável — achado durante a janela de produção de
PP-030 (falso negativo confirmado pelo Codex: "erro no formatador do harness gerou falso negativo",
rastreado por Claude à combinação de opções do cliente BullMQ, não ao harness em si).

## Causa raiz

Confirmado por leitura direta em `scripts/autonomy-sanity-check.ts`, duas ocorrências idênticas (linha
94-103 em `checkQueue`, linha 185-193 em `checkEventFreshness`):

```ts
const queue = new Queue("scrape-event", {
  connection: {
    url: redisUrl,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  },
});
```

`lazyConnect: true` adia a conexão real até o primeiro comando ser enviado. `enableOfflineQueue: false`
rejeita imediatamente qualquer comando enviado antes da conexão estar pronta, em vez de enfileirá-lo até
a conexão abrir. Como o BullMQ dispara comandos internos assim que a `Queue` é instanciada/usada, essa
combinação específica causa falha na primeira operação de forma intermitente/frequente — mesmo com Redis
saudável e credencial correta.

**Causa imediata:** as duas opções (`lazyConnect: true` + `enableOfflineQueue: false`) juntas.
**Causa sistêmica:** essas opções não trazem benefício real neste script — o arquivo já envolve toda
chamada relevante em `withTimeout()` (função própria do script, linha 28-43, timeout de 12000ms), que já
garante que o script não trava indefinidamente se o Redis estiver indisponível. As duas opções do BullMQ
são redundantes com essa proteção já existente.

**Confirmado por comparação:** os outros 2 scripts que instanciam `Queue("scrape-event", ...)`
(`scripts/production-quality-gate.ts:380-384`, `apps/api/src/common/queue.service.ts:16-18`) **não** usam
`lazyConnect`/`enableOfflineQueue` e funcionam corretamente — confirma que o padrão simples (sem essas
duas opções) é o que já está validado no resto do projeto.

## Cenário

DADO o Redis de produção autenticado e saudável (pós-PP-030)
QUANDO `autonomy-sanity-check.ts` executa `checkQueue`/`checkEventFreshness`
ENTÃO a checagem de fila deve completar com sucesso (`status: "pass"` ou `"warn"` por backlog real, nunca
`"fail"` por erro de conexão espúrio) — mesmo comportamento que `production-quality-gate.ts` já tem hoje.

## Critério de aceitação

- Remover `lazyConnect: true` e `enableOfflineQueue: false` das duas ocorrências (`checkQueue`,
  `checkEventFreshness`) em `scripts/autonomy-sanity-check.ts`.
- Manter `maxRetriesPerRequest: 1` e `retryStrategy: () => null` — essas não causam o bug e preservam o
  comportamento de falha rápida em caso de indisponibilidade real do Redis (não confundir com as duas
  opções removidas).
- Não alterar `withTimeout()` nem a lógica de negócio dos checks — a correção é só na configuração de
  conexão do `Queue`.
- Script executa com sucesso contra Redis real autenticado (mesmo padrão de verificação já usado em
  `scripts/test-redis-auth.ts` de PP-030 — Codex pode reaproveitar esse harness ou testar diretamente
  contra um Redis local/efêmero).

## Fora de escopo

- Não alterar `production-quality-gate.ts`/`live-event-watch.ts`/`queue.service.ts` — já corretos, sem o
  bug.
- Não adicionar novos testes automatizados dedicados a este script nesta Spec — é script operacional, não
  coberto por suite automatizada hoje (mesmo padrão já registrado em PP-030 para os 3 scripts
  operacionais); validação é por execução manual real contra Redis, documentada no relatório de entrega.
- Não investigar/alterar o harness de deploy que originalmente relatou o falso negativo (já foi corrigido
  separadamente durante a janela de produção de PP-031, conforme relatado pelo Codex).

## Impacto técnico

- Arquivo a modificar: `scripts/autonomy-sanity-check.ts` (2 ocorrências, linhas 94-103 e 185-193 na
  versão atual — Codex confirma linha exata antes de editar, pode ter mudado).
- Arquivos que NÃO devem ser tocados: `production-quality-gate.ts`, `live-event-watch.ts`,
  `queue.service.ts`, `simple-rate-limit.middleware.ts`.
- DDL: nenhuma.
- Dependências novas: nenhuma.

## Validação

Não há T-* formal (script operacional sem suite automatizada, mesmo padrão de PP-030). Validação:
executar `autonomy-sanity-check.ts` contra Redis real autenticado (local ou produção, read-only — o
script só lê estado, não deveria escrever) e confirmar que o check de fila não falha por erro de conexão
espúrio.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — correção de configuração de cliente Redis, sem superfície nova de
  auth/input/exposição.
- e2e-playwright-agent: não.
- report-builder-agent: não — relatório de execução simples basta.
