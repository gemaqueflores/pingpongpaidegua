# PP-014 — Inserção manual do evento 5707 (Open APTM) e scrape retroativo

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — operação administrativa pontual via endpoint já existente, sem alteração de código
- e2e-playwright-agent: não — não há mudança de UI
- report-builder-agent: não — relatório simples de execução é suficiente

## Objetivo
Evento "Open APTM" (cbtmEventId 5707), realizado em 30/05/2026, não foi inserido na base de produção no momento devido. Hoje é 17/06/2026 — o evento já terminou. É preciso cadastrá-lo retroativamente e obter (via scrape) todas as informações já publicadas pela CBTM (categorias, atletas, confrontos, resultados), já que o pipeline automático não rodou durante a janela natural do evento.

## Contexto
- Caminho de criação manual já existe e não precisa ser alterado: `POST /admin/events` → `apps/api/src/admin/admin-events.controller.ts:60-63` → `AdminEventsService.createEvent` (`apps/api/src/admin/admin-events.service.ts:117-171`).
- O service decide o enfileiramento de scrape automaticamente a partir do campo `concluido`: se `true` → `queue.enqueueScrapeNow(event.id)` (scrape imediato, fila `"scrape-event"`); se `false` → fila normal (`enqueueScrape`).
- Como o evento já ocorreu, deve ser criado com `concluido: true` para acionar o scrape imediato em vez de esperar a janela natural (que já passou).
- `nivel: "OPEN"` deve ser enviado explicitamente no payload — eventos Open entram no circuito estadual com peso de rating `REGIONAL` (`STATE_CIRCUIT_EVENT_LEVELS`, `apps/api/src/user/user.service.ts:71`). Não preencher `nivel` deixaria o frontend inferindo o tipo pelo nome, comportamento legado que deve ser evitado aqui.
- DTO de criação já aceita esses campos: `apps/api/src/admin/dto/create-admin-event.dto.ts`.

## Causa raiz
- Causa imediata: o evento 5707 nunca foi submetido ao endpoint `POST /admin/events`; nenhum registro `Event` existe na base de produção para ele.
- Causa sistêmica: não há automação que detecte e alerte sobre eventos CBTM publicados que não foram cadastrados na janela correta — cadastro depende de ação manual do operador. Fora de escopo desta spec propor essa automação; registrar como candidato a melhoria futura se o padrão se repetir.
- Padrão: não há classe episódica registrada para "evento esquecido"; primeira ocorrência observada.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Criação do evento já concluído
DADO que o evento cbtmEventId=5707 não existe na base de produção
QUANDO o Codex chama `POST /admin/events` com o payload da seção "Payload de criação"
ENTÃO a API retorna 201 com o evento criado, `concluido=true`, `nivel=OPEN`, e enfileira scrape imediato (`enqueueScrapeNow`) — confirmar nos logs do worker que o job da fila `scrape-event` foi processado para este evento.

### Cenário 2 — Scrape retroativo completo
DADO que o evento 5707 foi criado com `concluido=true`
QUANDO o scrape imediato processa o evento (`scrape.processor.ts:321`, `processEventJob`)
ENTÃO categorias, atletas, confrontos e resultados publicados pela CBTM para o evento são capturados, parseados e persistidos (`RawCapture` + upsert), sem necessidade de reenfileiramento manual.

### Cenário 3 — Verificação se o scrape automático não cobriu tudo
DADO que o scrape inicial (`enqueueScrapeNow` no momento da criação) pode ter ocorrido antes de todos os dados finais (resultados) estarem publicados no site da CBTM
QUANDO o Codex verifica o estado pós-scrape do evento (read model / contagem de categorias, atletas e confrontos)
ENTÃO se dados parecerem incompletos (ex.: confrontos sem resultado final, categorias sem atletas), o Codex aciona `POST /admin/events/:id/scrape-now?stage=1` (e `stage=2`/`stage=3` se aplicável) para forçar novo scrape completo antes de reportar conclusão.

## Critérios de aceitação
- Evento 5707 existe em produção com: `cbtmEventId=5707`, `nome` contendo "Open APTM", `nivel=OPEN`, `concluido=true`, `inicioInscricoes=2026-05-01`, `fimInscricoes=2026-05-27`, `inicioRealizacao=2026-05-30`, `fimRealizacao=2026-05-30`.
- Scrape executado com sucesso — sem erros fatais nos logs do worker para este evento.
- Categorias, atletas e confrontos do evento aparecem na API pública (`GET` de listagem de evento) com dados não vazios.
- Resultados/confrontos do evento (já que ocorreu e terminou) aparecem com status final, não "pendente".

## Fora de escopo
- Qualquer alteração de código (controller, service, DTO, processor) — usar exclusivamente o endpoint e fluxo já existentes.
- Criar automação para detectar eventos não cadastrados retroativamente.
- Reclassificar `nivel` de outros eventos Open cadastrados sem `nivel` preenchido (mencionado apenas como contexto histórico).

## Impacto técnico
- Nenhum arquivo de código a criar/modificar — operação de dados via API já existente em produção.
- Arquivos que NÃO devem ser tocados: todo o código de `apps/api/src/admin/`, `apps/worker/src/pipeline/`, `prisma/schema.prisma`.
- DDL/migração: não aplicável.
- Contrato de API: inalterado.
- Dependências novas: nenhuma.

## Payload de criação (referência exata para o Codex)

```json
POST /admin/events
{
  "cbtmEventId": 5707,
  "nome": "Open APTM",
  "nivel": "OPEN",
  "concluido": true,
  "inicioInscricoes": "2026-05-01",
  "fimInscricoes": "2026-05-27",
  "inicioRealizacao": "2026-05-30",
  "fimRealizacao": "2026-05-30"
}
```

Ajustar nome exato do evento se o site da CBTM usar grafia diferente de "Open APTM" — Codex deve confirmar o nome oficial na página do evento (cbtmEventId=5707) antes de submeter, e declarar no relatório se houve ajuste.

## Plano de testes

### Cobertura geral
- Esta é uma operação administrativa de dados em produção, não desenvolvimento de feature nova — não há T-* de código novo.
- Verificação substitui testes automatizados: checagem manual pós-execução via API e logs.

### V-01 — Evento criado corretamente
DADO o payload acima submetido a `POST /admin/events`
QUANDO o Codex consulta `GET /admin/events/5707` (ou rota equivalente de leitura admin)
ENTÃO todos os campos do payload estão persistidos exatamente como enviados, e `lastScrapeAt` não é nulo após o scrape.

### V-02 — Scrape produziu dados
DADO o evento 5707 com scrape executado
QUANDO o Codex consulta a API pública do evento (categorias, atletas, confrontos)
ENTÃO contagens são maiores que zero em cada uma dessas coleções.

### V-03 — Sem erro fatal no worker
DADO o job de scrape do evento 5707 na fila `scrape-event`
QUANDO o Codex inspeciona os logs do worker para esse job
ENTÃO não há exceção não tratada nem falha de lock (`scrapeLockedAt` deve voltar a `null` após conclusão).

### Cobertura de falhas silenciosas
- Não basta a API retornar 201 na criação — Codex deve confirmar com leitura subsequente (`GET`) que os dados persistidos e o scrape resultante (categorias/atletas/confrontos) realmente existem, não apenas que o HTTP respondeu sem erro.

### Comando para rodar a suite
Não aplicável — operação manual de dados, sem suite de testes a executar. Codex deve reportar evidência via chamadas HTTP reais (request/response) e trecho de log do worker.
