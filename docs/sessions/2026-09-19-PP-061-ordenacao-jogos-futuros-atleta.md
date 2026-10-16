## Encerramento — PP-061 — 2026-09-19

### Decisões tomadas
- "Mais recentes"/"Mais antigos" em jogos futuros passam a ordenar por proximidade do momento atual (mais próximo primeiro em "recent", mais distante primeiro em "oldest"), enquanto jogos passados mantêm o comportamento pré-existente (mais recente primeiro em "recent"). | Confirmado com Leo via `AskUserQuestion` antes da Spec — ambiguidade de UX que não estava no relatado original ("não obedece ordem de horário"), mas era a causa raiz real. | válida próxima sessão: S — regra de UX específica desta tela, não generalizável sem novo pedido.
- Comparador extraído para função pura `compareSummaryMatches(left, right, sortMode, now)` testável isoladamente, com `now = Date.now()` capturado uma vez por render dentro do `useMemo`. | Necessário para permitir T-U-01–06 com fixtures determinísticas sem mockar relógio global. | válida próxima sessão: S — padrão replicável se outra tela precisar de ordenação sensível a "agora".
- Fast track (CAT compacto) foi suficiente para esta entrega: único arquivo de produção, sem DDL, sem mudança de contrato de API, domínio não marcado Instável. | Critério do orquestrador v7 aplicado corretamente. | válida próxima sessão: S.

### Candidatos a nova regra de contrato
- Nenhum candidato de regra de contrato nesta sessão. O único desvio observado (nomenclatura do commit `2541ac5` rotulado "refactor" quando na prática foi um "green" que fez T-U-05/T-U-06 passarem) é ocorrência única conhecida — sem 2ª ocorrência confirmada, não atinge o critério de promoção (observado 2× no mesmo tipo de entrega). Fica registrado como candidato a observação futura, não como regra.

### Padrões que funcionaram (reforço)
- Extrair a função de comparação para fora do `useMemo` e anexá-la via `__testables` ao componente exportado permitiu testar a lógica pura sem framework de renderização nem mock de `Date.now()` global — parâmetro `now` explícito é suficiente. | Reforçar no contrato: N — é uma técnica de implementação (decisão do Codex), não uma regra de processo; não precisa virar prescrição formal, mas vale como referência se um caso análogo aparecer.
- AskUserQuestion usado antes da Spec para resolver ambiguidade de UX ("recente" para jogos futuros vs. passados) evitou uma Spec ambígua e um possível parecer incorreto depois. | Reforçar no contrato: N — já é prática coberta pelo fluxo "VALIDAR pedido" existente; não é padrão novo, é o fluxo funcionando como desenhado.

### Padrões emergentes observados nesta sessão
- Tipo de entrega: bug de ordenação relatado com evidência visual (2 screenshots) sem repro escrito. Comportamento observado: a causa raiz real (ambiguidade semântica de "recente" para eventos futuros) só ficou clara após leitura do código e comparação com o horário relatado por Leo — o sintoma descrito ("não obedece ordem de horário") não era literalmente o bug. Hipótese de padrão: screenshots + relato textual podem descrever o sintoma superficial mas não a causa; vale sempre reproduzir o raciocínio (ler o comparador, comparar com o "agora" declarado) antes de assumir que é bug de implementação simples. Confirmado / sinal único: sinal único nesta sessão — não promover ainda.

### Estado para próxima sessão
- Domínios que precisam de atenção extra: nenhum diretamente ligado a PP-061. Tela de resumo do atleta (`athletes/[athleteId]/page.tsx`) não está marcada Instável em `DOMAIN_MATURITY.md`; sem necessidade de revisão adicional motivada por esta entrega.
- T-* não auditados completamente: nenhum — T-U-01 a T-U-06 todos executados e verificados por mim (rótulo `EXECUTADA`), não apenas por leitura estática.
- Dúvidas técnicas em aberto: nenhuma.
- Score da sessão: ✅ 8 | ⚠️ 1 | ❌ 0 itens no parecer (PP-061, Rodada 1, 2026-09-19).
