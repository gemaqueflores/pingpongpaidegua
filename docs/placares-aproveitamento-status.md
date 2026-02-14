# Placares, Aproveitamento e Status

## Como funciona a extracao de placares por set
- O parser de resultados (`packages/parser/src/index.ts`) captura os cards DX de jogos.
- Para cada card, os jogadores sao identificados no texto e os tokens numericos seguintes sao interpretados como:
  - total de sets por jogador (`setsResult`)
  - lista de sets (`sets`) no mesmo ordenamento dos jogadores do jogo (`p1`, `p2`).
- O modelo normalizado de cada partida passa a incluir:
  - `sets: [{ p1, p2 }, ...]`
  - `setsResult: { p1Sets, p2Sets }`
  - `winnerIndex` (`0`, `1` ou `null`).
- Quando nao houver sets validos (ex.: WO, dados incompletos), `sets` fica vazio.

## Como calculamos aproveitamento
- A funcao utilitaria esta em `packages/shared/src/index.ts`:
  - `calculateAthletePointPerformance(matches, athlete)`
- Regra:
  - `pointsWon`: soma dos pontos do atleta em todos os sets validos.
  - `pointsPlayed`: soma de `p1 + p2` dos sets validos.
  - `ratio`: `pointsWon / pointsPlayed` (ou `null` quando nao ha pontos disputados).
- Regras de consistencia:
  - sets com valores invalidos, negativos ou `0-0` sao ignorados.
  - rounds sem sets nao quebram o calculo e mantem `ratio = null`.

## Como definimos status do evento
- A homepage classifica os eventos em 3 abas:
  - `Concluidos`: `concluido = true`.
  - `Inscricoes abertas`: evento nao concluido e `dataInicio` no futuro.
  - `Inscricoes encerradas`: fallback para eventos nao concluidos sem `dataInicio` futura.
- Fallback para dados ausentes:
  - quando datas faltam, o evento vai para `Inscricoes encerradas` (aba mais provavel), mantendo compatibilidade com base legada.
