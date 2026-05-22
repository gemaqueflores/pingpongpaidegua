# PP-004 — Padronizar EmptyState nas páginas de detalhe com erro

## Objetivo
Uniformizar o tratamento de erro nas páginas de detalhe `eficiencia/[clubId]` e `career/[athleteKey]` com o padrão `EmptyState` adotado nas páginas hub após PP-002, e eliminar a exposição de `err.message` da API diretamente na UI.

## Contexto

Três páginas de detalhe exibem erros fora do padrão:

**`apps/web/app/eficiencia/[clubId]/page.tsx` (linha 71-75) e `apps/web/app/user/eficiencia/[clubId]/page.tsx` (linha 60-64):**
```tsx
{!loading && error ? (
  <Card className="grid">
    <p>{error}</p>
  </Card>
) : null}
```
O `error` vem de:
```ts
.catch((err: unknown) => {
  setError(err instanceof Error ? err.message : "Falha ao carregar eficiência do clube.");
})
```
`err.message` pode conter texto técnico da API (ex: "Not Found", "Internal Server Error", texto do corpo HTTP). Isso expõe mensagem interna ao usuário e é inconsistente com `EmptyState`.

**`apps/web/app/user/career/[athleteKey]/page.tsx` (linha 531-540):**
```tsx
{error ? (
  <Card className="grid">
    <h2>Carreira</h2>
    <p>{error}</p>
  </Card>
) : null}
```
O `error` é sempre a string hardcoded `"Carreira não encontrada para o atleta informado."` — não expõe texto da API. Mas o layout (`<h2>` + `<p>` ad-hoc) é inconsistente com o componente `EmptyState` usado no restante do produto.

`apps/web/app/user/eficiencia/[clubId]/page.tsx` (linha 60-64) é cópia quase idêntica da canonical — mesmo padrão de `err.message`, mesma ausência de `EmptyState`.

Nenhuma das três páginas importa `EmptyState` atualmente.

## Causa raiz
- **Causa imediata:** páginas de detalhe criadas antes da adoção do padrão `EmptyState` nas páginas hub (PP-002).
- **Causa sistêmica:** ausência de convenção documentada para páginas de detalhe — PP-002 corrigiu apenas as páginas hub.
- **Padrão:** inconsistência de UI pós-PP-002.

## Cenários funcionais

**DADO** que `eficiencia/[clubId]` recebe erro de API (404, 500, timeout)  
**QUANDO** o usuário acessa `/eficiencia/99999`  
**ENTÃO** vê `EmptyState` com "Serviço indisponível" — não texto interno da API

**DADO** que `career/[athleteKey]` não encontra o atleta  
**QUANDO** o usuário acessa `/career/ATLETA_INEXISTENTE`  
**ENTÃO** vê `EmptyState` com "Atleta não encontrado" — layout consistente com restante do produto

**DADO** que a API responde normalmente  
**QUANDO** o usuário acessa qualquer uma das páginas  
**ENTÃO** comportamento idêntico ao atual — nenhuma regressão

## Critérios de aceitação

### `eficiencia/[clubId]/page.tsx` (canonical — `/eficiencia/[clubId]`)
1. `import { EmptyState }` adicionado (de `"../../../components/ui/EmptyState"`)
2. Estado `error` muda de `string | null` para `boolean` — o catch seta `setError(true)` sem capturar `err.message`
3. Renderização condicional substitui o `<Card><p>{error}</p></Card>` por:
   ```tsx
   {!loading && error ? (
     <EmptyState
       title="Serviço indisponível"
       description="Não foi possível carregar a eficiência deste clube. Tente novamente em instantes."
     />
   ) : null}
   ```
4. A validação de `clubId` inválido mantém `setError(true)` — não exibe "Serviço indisponível" para ID inválido; em vez disso, mantém uma mensagem específica. **Detalhe:** o bloco `if (!Number.isFinite(clubId) || clubId <= 0)` atualmente seta `setError("Clube inválido.")` — neste caso específico, renderizar `<EmptyState title="Clube não encontrado" description="O identificador informado não é válido." />` (tratamento separado por flag ou segundo estado)
5. O estado de erro é `false` quando a chamada bem-sucedida ocorre (`.then()` existente mantido, `setError(false)` adicionado implicitamente ao não setar)

### `user/eficiencia/[clubId]/page.tsx` (rota `/user/eficiencia/[clubId]`)
6. Mesmo padrão do item 1-5 acima — `import { EmptyState }` (de `"../../../../components/ui/EmptyState"`); estado `error` boolean; catch sem `err.message`; renderização via `EmptyState`; caso ID inválido separado

### `user/career/[athleteKey]/page.tsx`
7. `import { EmptyState }` adicionado (de `"../../../../components/ui/EmptyState"`)
8. O bloco de erro (linhas 531-540) substituído por:
   ```tsx
   {error ? (
     <EmptyState
       title="Atleta não encontrado"
       description="Carreira não encontrada para o atleta informado."
     />
   ) : null}
   ```
9. O botão "← Voltar" do bloco original é removido — `EmptyState` não tem ação; a navegação de volta está disponível via `PageHeader` (já renderizado acima)
10. Estado `error` permanece `string | null` — o valor da string não é exibido ao usuário, apenas sua presença é testada

## Fora de escopo
- Alterar `EmptyState.tsx` — usar como está
- Alterar `apps/web/app/eficiencia/page.tsx` (hub) — já correto
- Alterar `apps/web/app/user/eficiencia/[clubId]/page.tsx` (rota `/user/...`) — verificar se existe e se é alias; se sim, não tocar
- Botão "Tentar novamente" — não implementar
- Alterar `apps/web/lib/auth.ts` ou `user-api.ts`
- Alterar páginas de listagem hub já corrigidas em PP-002

## Impacto técnico

**Arquivos a modificar:**
- `apps/web/app/eficiencia/[clubId]/page.tsx` — adicionar import EmptyState; refatorar estado `error` de string para boolean; ajustar catch; substituir renderização de erro; separar caso de ID inválido
- `apps/web/app/user/eficiencia/[clubId]/page.tsx` — mesmo padrão da canonical acima
- `apps/web/app/user/career/[athleteKey]/page.tsx` — adicionar import EmptyState; substituir bloco de erro

**Arquivos a criar:**
- Nenhum arquivo novo de produção

**Arquivos que NÃO devem ser tocados:**
- `apps/web/components/ui/EmptyState.tsx`
- `apps/web/app/eficiencia/page.tsx` (hub)
- `apps/web/app/atletas/page.tsx`
- `apps/web/app/events/page.tsx`
- `apps/web/app/page.tsx`
- `apps/web/lib/auth.ts`
- `apps/web/lib/user-api.ts`
- `apps/web/app/user/events/[id]/page.tsx`
- `apps/web/app/user/eficiencia/page.tsx` — rota de eficiência hub do user, se existir

**DDL / migração:** não aplicável  
**Contrato de API alterado:** não  
**Dependências novas:** nenhuma

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: componente (renderToStaticMarkup) — mesmo padrão de PP-002
- Arquivos de teste a criar: adicionar casos ao arquivo existente `apps/web/tests/ui-snapshots.test.tsx`
- Fixtures/mocks: leitura de source via `readFileSync` — mesmo padrão de PP-002

### T-U-01 — eficiencia/[clubId]: EmptyState "Serviço indisponível" renderiza quando error=true
Camada: componente EmptyState renderizado estaticamente  
DADO: `error=true` (API falhou), `loading=false`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Serviço indisponível"  
E NÃO contém texto técnico da API (ex: "Not Found", "Internal Server Error")

### T-U-02 — eficiencia/[clubId]: EmptyState "Clube não encontrado" renderiza para ID inválido
Camada: componente EmptyState renderizado estaticamente  
DADO: `clubId` inválido (NaN ou ≤ 0), `loading=false`  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Clube não encontrado"

### T-U-03 — eficiencia/[clubId]: catch não captura err.message
Camada: análise de source  
DADO: arquivo `eficiencia/[clubId]/page.tsx` lido  
QUANDO: grep por `err.message` ou `err instanceof Error`  
ENTÃO: padrão ausente no catch — estado de erro é boolean, não string de mensagem da API

### T-U-04 — career/[athleteKey]: EmptyState "Atleta não encontrado" renderiza quando error presente
Camada: componente EmptyState renderizado estaticamente  
DADO: `error` não-nulo  
QUANDO: componente renderizado  
ENTÃO: HTML contém "Atleta não encontrado"  
E NÃO contém `<h2>Carreira</h2>` isolado (layout ad-hoc anterior removido)

### T-U-05 — career/[athleteKey]: source não exibe error como string na UI
Camada: análise de source  
DADO: arquivo `career/[athleteKey]/page.tsx` lido  
QUANDO: verificação de ausência de `<p>{error}</p>` ou similar  
ENTÃO: padrão de interpolação direta de error na UI ausente

### Cobertura de falhas silenciosas
- UI/Componente: T-U-01 a T-U-04 verificam HTML gerado — não apenas existência do bloco condicional
- Formulário: não aplicável
- Persistência: não aplicável — páginas de leitura
- Autenticação: não aplicável
- Exposição de texto de API: T-U-03 garante que `err.message` não é passado para estado de UI

### Comando para rodar a suite
```bash
npm run test --workspace apps/web
```

---

## Correções obrigatórias — (reservado para parecer)
