# Parser offline com fixture real

Fixture principal: `fixtures/results.txt`.

## Fluxo
1. `extractDxPayloads(raw)` extrai callbacks DX (`0|/*DX*/({...})`).
2. `parseResultsText(eventId, raw)` produz:
- `registrations[]`
- `matches[]`
- `warnings[]`

## Testes
- `packages/parser/test/parser.test.ts`
- `packages/parser/test/athlete-matching.test.ts`

## Smoke
- `npm run smoke:fixture`
- imprime contagens de payloads, inscrições, jogos, warnings e conflitos do matching.
