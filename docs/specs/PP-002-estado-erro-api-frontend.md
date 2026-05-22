# PP-002 — Estado de erro explícito quando API está indisponível

## Objetivo
Eliminar a falha silenciosa nas páginas hub do frontend: quando a API falha (timeout, TLS expirado, rede, 5xx), o usuário deve ver mensagem de erro distinguível de "sem dados", em vez de tela vazia idêntica a uma lista vazia.

## Contexto
Quatro páginas têm `.catch()` que silenciam completamente erros de rede/TLS:

| Arquivo | Linha atual | Comportamento atual |
|---|---|---|
| `apps/web/app/events/page.tsx` | 123 | `.catch(() => setEvents([]))` → tela vazia sem distinção |
| `apps/web/app/atletas/page.tsx` | 33 | `.catch(() => setAthletes([]))` → tela vazia sem distinção |
| `apps/web/app/eficiencia/page.tsx` | 32 | `.catch(() => setData(null))` → tela vazia sem distinção |
| `apps/web/app/page.tsx` | 170, 175, 180 | 3 catches silenciosos — eventos, total de atletas e eficiência global |

O componente `EmptyState` já está importado em todas as páginas e aceita `title` e `description`. O padrão de `apiError` state + renderização condicional já existe e funciona em `apps/web/app/eficiencia/[clubId]/page.tsx` e `apps/web/app/user/eficiencia/[clubId]/page.tsx`.

## Causa raiz
- **Causa imediata:** `.catch()` atribui estado vazio sem sinalizar falha; `EmptyState` de "sem resultados" cobre ambos os casos sem distinção.
- **Causa sistêmica:** ausência de convenção de tratamento de erro nas páginas hub — as páginas de detalhe (clubId, athleteKey) já foram corrigidas, as de listagem não.
- **Padrão:** Q11 — falha silenciosa. Primeira ocorrência registrada formalmente.

## Cenários funcionais

**DADO** que a API está inacessível (timeout, TLS expirado, rede)  
**QUANDO** o usuário acessa `/events`  
**ENTÃO** vê mensagem "Serviço indisponível" — não a mensagem de filtro vazio

**DADO** que a API está inacessível  
**QUANDO** o usuário acessa `/atletas`  
**ENTÃO** vê mensagem de erro — não lista vazia silenciosa

**DADO** que a API está inacessível  
**QUANDO** o usuário acessa `/eficiencia`  
**ENTÃO** vê mensagem de erro — não lista vazia silenciosa

**DADO** que a API está inacessível  
**QUANDO** o usuário acessa `/` (home)  
**ENTÃO** a seção de eventos exibe mensagem de erro; os cards de estatística (atletas, clubes) mostram estado de erro ou `-` com indicação

**DADO** que a API responde normalmente  
**QUANDO** o usuário acessa qualquer uma das páginas acima  
**ENTÃO** comportamento idêntico ao atual — nenhuma regressão

**DADO** que a API responde mas não há dados (lista vazia real)  
**QUANDO** o usuário acessa qualquer uma das páginas acima  
**ENTÃO** exibe mensagem de "sem resultados" — NÃO "serviço indisponível"

## Critérios de aceitação
1. `events/page.tsx`: estado `apiError: boolean` adicionado; `.catch()` seta `apiError=true`; quando `!loading && apiError`: renderiza `<EmptyState title="Serviço indisponível" description="Não foi possível carregar os eventos. Tente novamente em instantes." />` antes da verificação de `filteredEvents.length === 0`
2. `atletas/page.tsx`: mesmo padrão — `apiError` state; `.catch()` seta `apiError=true`; quando `!loading && apiError && athletes.length === 0`: renderiza EmptyState de erro
3. `eficiencia/page.tsx`: mesmo padrão — `apiError` state; renderiza EmptyState de erro quando `!loading && apiError`
4. `page.tsx` (home): flag `eventsApiError: boolean`; seção "Eventos na base" renderiza EmptyState de erro quando `!loadingEvents && eventsApiError`; cards de estatística (atletas/clubes) mantêm comportamento atual — exibem `0` e `0` quando falha, sem mensagem de erro separada (não é bloqueante para o usuário nessa página)
5. O estado de erro é limpo em nova tentativa bem-sucedida (`.then()` seta `setApiError(false)`)
6. Todos os outros estados, filtros, skeleton e lógica de ordenação permanecem intactos

## Fora de escopo
- Botão "Tentar novamente" — não implementar
- Alteração em páginas de detalhe (`/events/[id]`, `/eficiencia/[clubId]`, `/career/[athleteKey]`) — já têm tratamento adequado
- Alteração em `apps/web/lib/auth.ts` ou `user-api.ts`
- Alteração no componente `EmptyState` — usar como está
- Internacionalização de mensagens de erro
- Logging de erros no client

## Impacto técnico

**Arquivos a modificar:**
- `apps/web/app/events/page.tsx` — adicionar estado `apiError`, ajustar `.catch()`, adicionar renderização condicional antes do EmptyState de filtro vazio
- `apps/web/app/atletas/page.tsx` — mesmo padrão
- `apps/web/app/eficiencia/page.tsx` — mesmo padrão
- `apps/web/app/page.tsx` — adicionar estado `eventsApiError`; ajustar `.catch()` de eventos; renderização condicional na seção "Eventos na base"

**Arquivos a criar:**
- Nenhum arquivo novo de produção

**Arquivos que NÃO devem ser tocados:**
- `apps/web/lib/auth.ts` — fetchWithRecovery intacto
- `apps/web/lib/user-api.ts` — intacto
- `apps/web/components/ui/EmptyState.tsx` — usar sem modificar
- `apps/web/app/eficiencia/[clubId]/page.tsx` — já correto, não tocar
- `apps/web/app/user/eficiencia/[clubId]/page.tsx` — já correto, não tocar
- `apps/web/app/user/career/[athleteKey]/page.tsx` — já correto, não tocar
- `apps/web/app/user/events/[id]/page.tsx` — já correto, não tocar
- `apps/web/tests/ui-snapshots.test.tsx` — não tocar (testa componentes isolados, não páginas)

**DDL / migração:** não aplicável  
**Contrato de API alterado:** não  
**Dependências novas:** nenhuma

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: componente (renderToStaticMarkup) para cada página afetada
- Arquivos de teste a criar: adicionar casos ao arquivo existente `apps/web/tests/ui-snapshots.test.tsx`
- Fixtures/mocks: mock de `apiGetEvents`, `apiGetAthletesDirectory`, `apiGetGlobalEfficiency` rejeitando Promise

### T-U-01 — events/page: EmptyState de erro renderiza quando apiError=true
Camada: componente `EventsHubPage` em estado pós-fetch com erro  
DADO: `apiError=true`, `loading=false`, `events=[]`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Serviço indisponível"  
E NÃO contém "Nenhum evento atende aos filtros" (mensagem de filtro vazio)

### T-U-02 — events/page: EmptyState de filtro renderiza quando sem erro mas lista vazia
Camada: componente `EventsHubPage`  
DADO: `apiError=false`, `loading=false`, `events=[]`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Sem resultados" ou equivalente ao filtro vazio  
E NÃO contém "Serviço indisponível"

### T-U-03 — atletas/page: EmptyState de erro renderiza quando apiError=true
Camada: componente `AthletesHubPage`  
DADO: `apiError=true`, `loading=false`, `athletes=[]`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Serviço indisponível"

### T-U-04 — eficiencia/page: EmptyState de erro renderiza quando apiError=true
Camada: componente `EfficiencyHubPage`  
DADO: `apiError=true`, `loading=false`, `data=null`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Serviço indisponível"

### T-U-05 — page.tsx home: seção de eventos exibe erro quando eventsApiError=true
Camada: componente `HomePage`  
DADO: `eventsApiError=true`, `loadingEvents=false`, `events=[]`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Serviço indisponível" na seção de eventos

### T-U-06 — estado de erro limpo em nova chamada bem-sucedida
Camada: lógica de `.then()` em cada página  
DADO: chamada anterior falhou (`apiError=true`)  
QUANDO: nova chamada bem-sucedida executada (`.then()` chamado)  
ENTÃO: `apiError` volta para `false` e dados são exibidos normalmente

### Cobertura de falhas silenciosas
- UI/Componente: T-U-01 a T-U-05 verificam efeito real (texto de erro presente no HTML), não apenas renderização do componente pai
- Formulário: não aplicável
- Persistência: não aplicável — páginas de leitura
- Autenticação: não aplicável

### Cobertura de falhas silenciosas (categoria específica desta spec)
- Ausência de regressão: T-U-02 garante que erro e filtro vazio são estados distintos — não confundir um com o outro
- `page.tsx` home: cards de atletas/clubes exibem `0` quando API falha — aceitável nesta página por serem dados secundários; não requer EmptyState separado

### Comando para rodar a suite
```bash
npm run test --workspace apps/web
```

---

## Correções obrigatórias — (reservado para parecer)
