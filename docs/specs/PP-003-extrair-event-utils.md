# PP-003 — Extrair lógica de evento duplicada para `event-utils.ts`

## Objetivo
Eliminar a duplicação de funções de domínio de evento que existem copiadas literalmente em `apps/web/app/page.tsx` e `apps/web/app/events/page.tsx`, reduzindo o risco de divergência silenciosa quando a API introduzir novos valores de `situacaoComputada` ou `nivel`.

## Contexto
As seguintes funções são idênticas (ou quase idênticas) nos dois arquivos:

| Função | `app/page.tsx` | `app/events/page.tsx` |
|---|---|---|
| `formatDate` | linha ~44 | linha 25 |
| `toTs` | linha ~52 | linha 35 |
| `resolveDisplayStatus` | linha ~58 | linha 41 |
| `eventStatusLabel` | linha ~85 | linha 68 |
| `eventStatusTone` | linha ~93 | linha 76 |
| `sortEventsByStatusAndDate` | linha ~100 | linha 83 |
| `inferEventType` | linha ~118 | linha 96 |

Types duplicados:
- `EventDisplayStatus` — definido em ambos os arquivos
- `EventTypeFilter` — definido em ambos

Nota: `apps/web/app/user/events/[id]/page.tsx` tem versão própria de `inferEventType` (linha 120) e `formatDate` (linha 92) com variações menores — **não tocar nesse arquivo** nesta spec.

## Causa raiz
- **Causa imediata:** funções copiadas entre arquivos em vez de importadas de módulo compartilhado.
- **Causa sistêmica:** ausência de módulo utilitário de domínio para a entidade Evento no frontend.
- **Padrão:** dívida técnica acumulada no crescimento das páginas hub.

## Cenários funcionais

**DADO** que a API introduz novo valor em `nivel` ou `situacaoComputada`  
**QUANDO** o desenvolvedor corrige `resolveDisplayStatus` ou `inferEventType`  
**ENTÃO** a correção se propaga para todas as páginas que importam `event-utils` — sem necessidade de editar múltiplos arquivos

**DADO** que o usuário acessa `/events` ou `/` (home)  
**QUANDO** os filtros e cards são renderizados  
**ENTÃO** comportamento idêntico ao atual — nenhuma regressão

## Critérios de aceitação
1. Arquivo `apps/web/lib/event-utils.ts` criado exportando:
   - `type EventDisplayStatus`
   - `type EventTypeFilter`  
   - `type EventStatusFilter`
   - `function formatDate(value: string | null): string`
   - `function toTs(value: string | null): number | null`
   - `function resolveDisplayStatus(event: EventRow): EventDisplayStatus` — onde `EventRow` é importado de `user-api`
   - `function eventStatusLabel(status: EventDisplayStatus): string`
   - `function eventStatusTone(status: EventDisplayStatus): "open" | "closed" | "done"`
   - `function sortEventsByStatusAndDate(rows: EventRow[]): EventRow[]`
   - `function inferEventType(event: EventRow): Exclude<EventTypeFilter, "ALL">`
2. `apps/web/app/events/page.tsx`: remove as 7 funções e 2 tipos duplicados; importa do módulo `../../lib/event-utils`
3. `apps/web/app/page.tsx`: remove as 7 funções e 2 tipos duplicados; importa do módulo `../lib/event-utils`
4. Nenhuma alteração de comportamento — as funções exportadas são cópias exatas das versões atuais

## Fora de escopo
- Alterar `apps/web/app/user/events/[id]/page.tsx` — tem variantes próprias, não tocar
- Alterar `apps/web/app/user/career/[athleteKey]/page.tsx` — não usa essas funções
- Alterar qualquer componente de UI
- Alterar `user-api.ts` ou `auth.ts`
- Alterar lógica de qualquer uma das funções — apenas mover, não refatorar

## Impacto técnico

**Arquivos a criar:**
- `apps/web/lib/event-utils.ts`

**Arquivos a modificar:**
- `apps/web/app/events/page.tsx` — remover funções/types duplicados, adicionar import
- `apps/web/app/page.tsx` — remover funções/types duplicados, adicionar import

**Arquivos que NÃO devem ser tocados:**
- `apps/web/app/user/events/[id]/page.tsx`
- `apps/web/app/user/career/[athleteKey]/page.tsx`
- `apps/web/lib/user-api.ts`
- `apps/web/lib/auth.ts`
- `apps/web/components/**` — nenhum componente

**DDL / migração:** não aplicável  
**Contrato de API alterado:** não  
**Dependências novas:** nenhuma

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: unitário — testar as funções exportadas de `event-utils.ts` diretamente
- Arquivos de teste a criar: `apps/web/tests/event-utils.test.ts`
- Fixtures/mocks: objetos `EventRow` inline — sem mock de API

### T-U-01 — `resolveDisplayStatus` retorna CONCLUIDO quando `concluido=true`
Camada: função pura  
DADO: `event = { concluido: true, userStatus: "INSCRICOES_ABERTAS", situacaoComputada: "EM_ANDAMENTO", groupsDefined: false, inicioRealizacao: null, fimRealizacao: null, dataInicio: null, dataFim: null, fimInscricoes: null }`  
QUANDO: `resolveDisplayStatus(event)`  
ENTÃO: retorna `"CONCLUIDO"`

### T-U-02 — `resolveDisplayStatus` retorna GRUPOS_DIVULGADOS quando grades publicadas
Camada: função pura  
DADO: `situacaoComputada = "GRADES_PUBLICADAS_PRE_JOGO"`, `concluido = false`, `userStatus = "INSCRICOES_ABERTAS"`  
QUANDO: `resolveDisplayStatus(event)`  
ENTÃO: retorna `"GRUPOS_DIVULGADOS"`

### T-U-03 — `inferEventType` retorna BRASILEIRAO para nivel NACIONAL
Camada: função pura  
DADO: `event = { nivel: "NACIONAL", nome: "Campeonato" }`  
QUANDO: `inferEventType(event)`  
ENTÃO: retorna `"BRASILEIRAO"`

### T-U-04 — `inferEventType` usa heurística de nome quando nivel=null
Camada: função pura  
DADO: `event = { nivel: null, nome: "Copa Norte de Tênis de Mesa" }`  
QUANDO: `inferEventType(event)`  
ENTÃO: retorna `"COPA"`

### T-U-05 — `sortEventsByStatusAndDate` ordena abertos antes de concluídos
Camada: função pura  
DADO: dois eventos — `[{ userStatus: "CONCLUIDO", dataInicio: "2025-01-01" }, { userStatus: "INSCRICOES_ABERTAS", dataInicio: "2025-06-01" }]`  
QUANDO: `sortEventsByStatusAndDate(events)`  
ENTÃO: evento aberto vem primeiro no array resultado

### T-U-06 — `formatDate` retorna "-" para null
Camada: função pura  
DADO: `value = null`  
QUANDO: `formatDate(null)`  
ENTÃO: retorna `"-"`

### Cobertura de falhas silenciosas
- UI/Componente: não aplicável — refactor puro, sem mudança de comportamento
- Formulário: não aplicável
- Persistência: não aplicável
- Autenticação: não aplicável
- Regressão: T-U-01 a T-U-06 garantem que as funções exportadas se comportam identicamente à versão inlineada

### Comando para rodar a suite
```bash
npm run test --workspace apps/web
```

---

## Correções obrigatórias — (reservado para parecer)
