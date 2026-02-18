# Responsive UI Notes

## Breakpoints padrão
- `mobile`: `< 640px`
- `tablet`: `640px - 1023px`
- `desktop`: `>= 1024px`

## Container global
- Classe: `.container`
- `max-width: 1200px`
- Padding:
  - mobile: `16px`
  - tablet: `24px`
  - desktop: `32px`

## Componentes novos
- `apps/web/components/ui/SegmentedControl.tsx`
  - Controle segmentado para filtros/tabs consistentes.
- `apps/web/components/ui/SearchInput.tsx`
  - Busca com debounce opcional e ícone padronizado.
- `apps/web/components/ui/FilterDrawer.tsx`
  - Filtros colapsáveis no mobile.
- `apps/web/components/ui/EmptyState.tsx`
  - Estado vazio consistente com título + descrição.
- `apps/web/components/ui/DataTableResponsive.tsx`
  - Estrutura table-to-cards (desktop tabela, mobile cards).

## Padrões aplicados
- Filtros mobile com drawer em `Home` e `Eventos`.
- Busca padronizada em `Atletas`, `Eficiência` e `Evento > Atletas/Clubes`.
- Segmented control padronizado em:
  - `Home` (filtros)
  - `Eventos` (filtros)
  - `Evento/[id]` (tabs e eficiência)
  - `Group Simulator` (escopo)
  - `Resumo do atleta do evento` (agrupamento de jogos)
- Empty states padronizados nas listagens filtráveis.

## Como usar DataTableResponsive
- Passe `columns`, `rows`, `mobileCard` e `empty`.
- Exemplo:
  - desktop: colunas em `<table className="data-table">`
  - mobile: renderização em cards via `mobileCard`.

## Como usar FilterDrawer e FilterBar
- `FilterDrawer` é focado em mobile; aciona painel colapsável.
- Para desktop, mantenha controles em linha (ex.: `SegmentedControl`) dentro do card.
- Regra geral:
  - mobile: drawer/colapsável
  - desktop: inline

## Decisões principais
- Mantida arquitetura atual (rotas canônicas consumindo páginas de `app/user/*` quando necessário).
- Não alterados contratos de API.
- Prioridade em componentes reutilizáveis e consistência de interação mobile-first.
