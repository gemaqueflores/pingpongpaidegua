# PP-048 — Medição Web Vitals mobile

Data da execução: 2026-09-18

## Resultado

A instrumentação com `@next/bundle-analyzer` foi integrada atrás de `ANALYZE=true` e o build normal continuou concluindo sem ativar o analyzer. As três rotas solicitadas foram medidas em build local de produção com Lighthouse 13.5.0 no perfil mobile.

INP não é produzido por esta medição de laboratório. Conforme previsto na Spec, TBT foi coletado como proxy de responsividade.

| Rota solicitada | Rota final após redirect | Performance | LCP (ms) | TBT (ms) | CLS | JS transferido (bytes) | Maior chunk JS (bytes) |
|---|---|---:|---:|---:|---:|---:|---:|
| `/user` | `/` | 78 | 5.508,9 | 104 | 0,000125 | 122.964 | 55.075 |
| `/user/events/44` | `/events/44` | 77 | 6.035,7 | 62 | 0,000125 | 139.980 | 55.075 |
| `/user/eficiencia` | `/eficiencia` | 80 | 5.413,1 | 57 | 0,000125 | 111.373 | 55.075 |

O maior chunk transferido nas três rotas foi `_next/static/chunks/87c73c54-24122e7b92478d00.js`, com 55.075 bytes. Os bytes acima são os valores brutos de `transferSize` registrados pelo Lighthouse; não são o tamanho descompactado em disco.

## Bundle

O build com `ANALYZE=true` concluiu com exit code 0 e gerou relatórios de client, Node.js e edge. O resumo do Next para as rotas solicitadas foi:

| Rota no manifesto | Size | First Load JS |
|---|---:|---:|
| `/user` | 152 B | 102 kB |
| `/user/events/[id]` | 164 B | 116 kB |
| `/user/eficiencia` | 152 B | 102 kB |

Como essas rotas redirecionam para URLs canônicas, o mesmo build registrou `/` com 118 kB, `/events/[id]` com 117 kB e `/eficiencia` com 107 kB de First Load JS. O JS compartilhado por todas as rotas foi 102 kB; seus dois chunks principais foram reportados pelo Next como 46 kB e 54,2 kB.

Relatórios completos:

- [bundle client](2026-09-18-PP-048-artifacts/bundle-client.html)
- [bundle Node.js](2026-09-18-PP-048-artifacts/bundle-nodejs.html)
- [bundle edge](2026-09-18-PP-048-artifacts/bundle-edge.html)

## Ambiente e método

- Build: Next.js 15.5.12, `next build` seguido de `next start` em `http://localhost:3100`.
- Lighthouse: 13.5.0, `formFactor=mobile`, viewport 412 × 823, device scale factor 1,75.
- Throttling: simulado, RTT 150 ms, throughput 1.638,4 Kbps e CPU slowdown 4×.
- Evento real local: ID interno 44, `2TMB26 - INDIVIDUAL` (`cbtmEventId=5468`), com 185 participantes e 674 partidas publicadas na listagem local.
- API: instância local em `http://localhost:4000`. Como ela aceita CORS apenas da porta 3000 e essa porta já estava ocupada por um container alheio, foi usado um proxy HTTP efêmero em `http://localhost:4002`, restrito à origem `http://localhost:3100`. O proxy foi encerrado após a coleta e não gerou arquivo/configuração persistente.
- Execução: uma coleta por rota, sequencial, sem concorrência entre processos Lighthouse.

As capturas válidas registraram zero requests com falha. A homepage realizou 3 GETs de API e 3 preflights; o evento realizou 5 GETs e 5 preflights; eficiência realizou 1 GET e 1 preflight.

## Artefatos Lighthouse

| Rota | JSON bruto | Relatório HTML |
|---|---|---|
| `/user` | [JSON](2026-09-18-PP-048-artifacts/lighthouse-user.report.json) | [HTML](2026-09-18-PP-048-artifacts/lighthouse-user.report.html) |
| `/user/events/44` | [JSON](2026-09-18-PP-048-artifacts/lighthouse-user-events-44.report.json) | [HTML](2026-09-18-PP-048-artifacts/lighthouse-user-events-44.report.html) |
| `/user/eficiencia` | [JSON](2026-09-18-PP-048-artifacts/lighthouse-user-eficiencia.report.json) | [HTML](2026-09-18-PP-048-artifacts/lighthouse-user-eficiencia.report.html) |

## Observações da medição

- O LCP ficou entre 5,4 s e 6,0 s nas três rotas; `/user/events/44` apresentou o maior valor.
- TBT ficou entre 57 ms e 104 ms.
- CLS ficou praticamente nulo nas três coletas.
- O evento transferiu mais JS entre as rotas medidas: 139.980 bytes.
- Esta é evidência de laboratório de uma execução por rota, não distribuição de campo/RUM. Os números devem ser usados como baseline, sem inferir variância estatística.

## Validação executada

- `npm --prefix apps/api test`: 229 testes aprovados, 0 falhas.
- `npm run build --workspace apps-web`: exit code 0 sem `ANALYZE=true`; nenhum relatório do analyzer foi emitido no log.
- `$env:ANALYZE='true'; $env:NEXT_PUBLIC_API_URL='http://localhost:4002'; npm run build --workspace apps-web`: exit code 0; relatórios client, Node.js e edge gerados.
- Três execuções `npx --yes lighthouse ... --form-factor=mobile --throttling-method=simulate`: exit code 0.
- `npm run verify:encoding`: exit code 0, 93 arquivos candidatos verificados.
- `git diff --check -- apps/web/next.config.js apps/web/package.json package-lock.json`: sem erros.

## Limites da entrega

- Nenhum componente, página, regra de negócio, API ou worker foi alterado.
- Nenhuma correção de performance foi implementada.
- Nenhuma medição foi feita contra o frontend de produção.
- As primeiras tentativas de preparação, sem endpoint/CORS local alinhado, foram descartadas e sobrescritas; somente os JSONs finais referenciados acima compõem o resultado.
- `npm install` informou 4 vulnerabilidades na árvore instalada (3 altas e 1 crítica). `npm audit fix` não foi executado porque atualização corretiva de dependências está fora desta Spec.
- `npm run verify:changed` não foi executado: o seletor incluiu alterações preexistentes de outras sessões e propôs a suíte/build globais. Foram executados os comandos de regressão discriminativos definidos pela PP-048.
- `next start` emitiu o warning conhecido para `output: "standalone"`, mas chegou a `Ready`, serviu as três rotas e todas as coletas Lighthouse terminaram com exit code 0.
- Próximo responsável: Claude, para analisar esta evidência e decidir se uma Spec separada de otimização é necessária.
