# PP-007 — Open Graph: nome do evento indisponível

## Objetivo
Corrigir o preview de link (Open Graph / Twitter Card) da página de evento, que exibe "nome indisponível" em vez do nome real do evento.

## Contexto
`generateMetadata` em `apps/web/app/events/[id]/layout.tsx` busca a lista completa de eventos (`/events`) e filtra pelo id. Se a lista vier vazia, nula ou o evento não estiver nela (resposta lenta, timeout de 4 s, ou evento canônico não listado), o fallback `"nome indisponível"` é exibido no preview.

O endpoint `GET /events/:id` já existe na API e retorna `{ id, nome, ... }` — o mesmo campo usado pelo `layout.tsx`.

O layout de atleta (`apps/web/app/events/[id]/athletes/[athleteId]/layout.tsx`) já usa o padrão correto: uma única chamada direta ao endpoint específico.

## Causa raiz
- **Causa imediata:** `fetchJson<EventRow[]>("/events")` busca todos os eventos e filtra por id em memória. A lista pode não conter o evento (timeout, lista grande, edge cases de paginação futura) ou pode demorar mais que o limite de 4 s.
- **Causa sistêmica:** ausência de padrão explícito no projeto para `generateMetadata` de páginas de detalhe — o dev seguiu o padrão da listagem em vez do padrão de endpoint direto.

## Cenários funcionais

**DADO** que um usuário compartilha a URL `https://pingpongpaidegua.vercel.app/events/51`  
**QUANDO** o scraper de Open Graph (WhatsApp, Telegram, Twitter, etc.) acessa a URL  
**ENTÃO** o título do preview deve conter o nome real do evento (ex.: "3TMB26 - Mestre Bianor Coelho"), não "nome indisponível"

**DADO** que o endpoint `/events/:id` retorna `null` (evento inexistente ou timeout)  
**QUANDO** o scraper acessa a URL  
**ENTÃO** o fallback "nome indisponível" é exibido — comportamento aceitável para evento inválido

## Critérios de aceitação
1. `generateMetadata` em `apps/web/app/events/[id]/layout.tsx` chama `fetchJson<EventRow>(`/events/${id}`)` em vez de `fetchJson<EventRow[]>("/events")`
2. `eventName` é lido diretamente do objeto retornado (`.nome`), não de um `.find()`
3. Fallback `"nome indisponível"` permanece para o caso de retorno nulo
4. Nenhum outro arquivo é alterado

## Fora de escopo
- Outros layouts de evento (atleta já está correto)
- Cache de metadados em `seo.ts` (comportamento preservado)
- Open Graph de outras páginas (listagem `/events`, home, etc.)
- Qualquer alteração na API

## Impacto técnico

**Arquivos a modificar:**
- `apps/web/app/events/[id]/layout.tsx` — substituir chamada `/events` por `/events/${id}` e ajustar leitura do campo

**Arquivos que NÃO devem ser tocados:**
- `apps/web/lib/seo.ts` — lógica de cache e `fetchJson` preservada
- `apps/api/src/user/user.controller.ts` — endpoint já existe
- `apps/api/src/user/user.service.ts` — sem alteração
- `apps/web/app/events/[id]/athletes/[athleteId]/layout.tsx` — já correto, não alterar

**DDL / migração:** nenhuma  
**Contrato de API alterado:** nenhum  
**Dependências novas:** nenhuma

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: unitário (mock de `fetchJson`)
- Arquivo de teste a criar: `apps/web/app/events/[id]/layout.test.ts`
- Fixtures/mocks: mock de `fetchJson` retornando objeto `{ id: 51, nome: "3TMB26 - Mestre Bianor Coelho" }` e mock retornando `null`

### T-U-01 — nome do evento resolvido corretamente
Camada: função `generateMetadata`  
DADO: `fetchJson("/events/51")` retorna `{ id: 51, nome: "3TMB26 - Mestre Bianor Coelho" }`  
QUANDO: `generateMetadata({ params: Promise.resolve({ id: "51" }) }, ...)` é chamado  
ENTÃO: `metadata.title` contém `"3TMB26 - Mestre Bianor Coelho"`; `metadata.openGraph.title` idem

### T-U-02 — fallback quando API retorna null
Camada: função `generateMetadata`  
DADO: `fetchJson("/events/99")` retorna `null`  
QUANDO: `generateMetadata({ params: Promise.resolve({ id: "99" }) }, ...)` é chamado  
ENTÃO: `metadata.title` contém `"nome indisponível"`

### T-U-03 — URL chamada é /events/:id, não /events
Camada: função `generateMetadata`  
DADO: spy/mock em `fetchJson`  
QUANDO: `generateMetadata` é chamado com id `"51"`  
ENTÃO: `fetchJson` foi chamado com argumento `"/events/51"` — **nunca** com `"/events"`

### Cobertura de falhas silenciosas
- T-U-03 garante que a chamada não regride para `/events` list em versão futura

### Comando para rodar a suite
```
npm --prefix apps/web test -- layout.test.ts
```

[não aplicável — integração e e2e: mudança é SSR/build-time, sem fluxo de usuário interativo testável além do unitário]
