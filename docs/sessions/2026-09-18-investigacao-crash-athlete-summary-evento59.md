# Investigação — crash client-side em /events/59/athletes/7061 (2026-09-18)

## Sintoma reportado por Leo
`pingpongpaidegua.vercel.app/events/59/athletes/7061` retorna:
"Application error: a client-side exception has occurred while loading pingpongpaidegua.vercel.app
(see the browser console for more information)."
Descrito como erro intermitente (não reproduz sempre).

## Análise estática realizada (Claude, leitura de código)

- Página: `apps/web/app/user/events/[id]/athletes/[athleteId]/page.tsx`
- Fetch: `apiGetAthleteSummary` (`apps/web/lib/user-api.ts:458-471`) → `GET /events/:id/athletes/:athleteId/summary`
- `handleResponse` (`apps/web/lib/auth.ts:117-124`) lança `Error` se `!response.ok`; o `useEffect` da
  página (linha 357-361) chama `apiGetAthleteSummary(...).then(...)` **sem `.catch`** — gera unhandled
  promise rejection em caso de 404/500, mas isso sozinho não deveria travar a renderização React (o
  skeleton `!summary ?` permanece visível). Não é o suspeito mais forte para "client-side exception".

- Suspeito principal: `formatDatetime()` (`page.tsx:98-116`) faz
  `new Intl.DateTimeFormat("pt-BR", {...}).formatToParts(new Date(value))` para qualquer
  `match.matchDatetime` não-null. Se `value` for uma string não vazia porém **inválida** como data
  (`new Date(value)` → `Invalid Date`), `formatToParts` lança `RangeError: Invalid time value` de forma
  síncrona durante o render — isso sim derruba a árvore React inteira com exatamente esse tipo de erro
  genérico "client-side exception".

- Contexto relevante já mapeado nesta sessão: evento 59 tem matches duplicados por reagendamento (mesmo
  `cbtmMatchId`, múltiplas linhas de mesa/horário coexistindo — ver
  `docs/sessions/2026-09-18-investigacao-horarios-evento59.md` e Specs PP-054/PP-055, ambas ✅ aprovadas
  por Leo mas **ainda não implementadas/executadas**). Hipótese: alguma dessas linhas duplicadas do
  atleta 7061 tem `matchDatetime` malformado (não `null`, mas string que `new Date()` não parseia), o que
  explicaria o caráter intermitente — só quebra quando esse `match` específico entra no `summary.matches`
  retornado pela API (ordem/cache podem variar).

- Suspeito secundário, menor probabilidade: `match.category` em `buildAthleteSummaryMatch`
  (`apps/api/src/user/user.service.ts:5458-5462`) assume relação Prisma sempre presente
  (`match.category.id`); se alguma linha de `matches` no evento 59 estiver com FK de categoria órfã
  (inconsistência de dado, não deveria ser possível com FK válida, mas duplicação manual/parcial poderia
  ter deixado dado inconsistente), o `select` do Prisma retornaria a query inteira falhando no backend
  (500), não um crash client-side — portanto downgrade de prioridade frente ao suspeito principal.

**Nenhuma causa raiz confirmada por leitura de código isolada — é necessário evidência dinâmica (dado real
em produção) antes de formular Spec de correção.**

## Instrução para o Codex — investigação via ssh-oracle (read-only)

Objetivo: obter o payload real de `GET /events/59/athletes/7061/summary` (ou os dados brutos em `matches`
equivalentes) para inspecionar `matchDatetime` de cada linha e confirmar se algum valor é uma string não
vazia que falha ao ser parseada por `new Date(valor)` (`Number.isNaN(new Date(valor).getTime())`).

Executar via MCP `ssh-oracle` (`ssh_connect` host `129.213.86.180`, user `ubuntu`, chave
`.../ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`):

### 1. Chamar o endpoint real (mais direto — reproduz exatamente o que o front recebeu)
```bash
curl -s "https://api-pingpongpaidegua.duckdns.org/events/59/athletes/7061/summary?orderBy=phase_hierarchy_datetime" \
  -H "Content-Type: application/json" | tee /tmp/athlete-7061-summary.json | head -c 2000
```
(ajustar host/porta se a API não estiver exposta nesse domínio publicamente — confirmar via
`docker compose ps` / nginx config se necessário; sem autenticação deveria bastar pois é rota pública)

Depois, extrair especificamente os campos de data para inspeção manual:
```bash
node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("/tmp/athlete-7061-summary.json", "utf8"));
for (const m of data.matches ?? []) {
  const v = m.matchDatetime;
  if (v === null) continue;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) {
    console.log("INVALIDO:", JSON.stringify({ id: m.id, matchKey: m.matchKey, matchDatetime: v }));
  }
}
console.log("total matches:", (data.matches ?? []).length);
'
```

### 2. Se o endpoint não estiver acessível externamente, consultar direto no Postgres (dentro do container)
```sql
SELECT m.id, m.event_id, m.category_id, m.cbtm_match_id, m.match_key, m.match_datetime,
       m.table_number, m.round, m.fetched_at, m.updated_at
FROM matches m
JOIN match_participants mp ON mp.match_id = m.id
WHERE m.event_id = 59
  AND mp.athlete_id = 7061
ORDER BY m.cbtm_match_id, m.fetched_at;
```
Reportar quaisquer valores de `match_datetime` que não sejam `NULL` e não sigam formato ISO 8601 válido, e
quaisquer grupos com o mesmo `cbtm_match_id` tendo mais de uma linha (duplicata de reagendamento — já
mapeado, mas confirmar se o atleta 7061 está entre os afetados).

## Não fazer nesta investigação
- Somente leitura (SELECT / curl GET) — nenhuma escrita em produção.
- Não expor senha do usuário postgres nem qualquer segredo no chat/log.
- Não concluir causa raiz sem essa evidência — Claude retoma a análise após receber a saída bruta (JSON
  do endpoint ou linhas do SELECT).

## Evidência coletada (2026-09-18, execução direta via ssh-oracle — Codex indisponível, Claude executou
com autorização explícita de Leo, excepcionalmente, nesta sessão)

`curl` a `GET https://api-pingpongpaidegua.duckdns.org/events/59/athletes/7061/summary?orderBy=phase_hierarchy_datetime`
retornou **HTTP 200** com payload válido (rótulo: `EXECUTADA`). Achados:

- 6 matches retornados para o atleta 7061 (ANDREZA DA SILVA MOTA) no evento 59.
- Todos os `matchDatetime` são ISO 8601 válidos (`2026-09-19T2{1,2,3}:{00,30}:00.000Z`) — nenhum inválido.
- Todo `match.category` está presente (`{id, name, cbtmCategoryId}`) — nenhuma FK órfã.
- Todo `match.players` tem exatamente 2 elementos com `id`/`name`/`club` presentes.
- **Hipóteses de causa raiz por análise estática (matchDatetime inválido, categoria órfã) refutadas por
  evidência dinâmica** — o payload real que o frontend recebeu está estruturalmente saudável.
- Achado colateral, não relacionado ao crash: `deduplicatedMatchesRemoved: 6` no payload — o backend
  removeu 6 matches duplicados antes de devolver os 6 finais, ou seja, existiam 12 linhas brutas para
  este atleta/evento antes da deduplicação em memória. Consistente com o problema mapeado do evento 59
  (duplicação de matches por reagendamento, PP-054/PP-055) mas o mecanismo de dedup do backend já está
  neutralizando isso para este atleta especificamente — não é a causa do crash observado.

### Conclusão desta rodada
Não foi possível confirmar a causa raiz do "client-side exception" a partir do dado de produção — ele está
correto. O crash provavelmente está em outro ponto: bug de runtime no bundle Next.js/React na Vercel não
relacionado ao conteúdo do payload (ex.: erro de hidratação, versão de build divergente, exception em
outro componente da árvore — `UserShell`, `MatchCard`, etc.), ou foi transiente e específico daquele
carregamento (extensão de navegador, cache de build antigo da Vercel, etc.).

### Próximo passo necessário
Sem o texto real do erro do console do navegador ("see the browser console for more information"), não é
possível avançar por leitura de código com segurança — evidência estática já foi esgotada e refutada.
Pedir a Leo para reabrir a URL, abrir o DevTools (F12) → aba Console, e colar o stack trace completo do
erro (nome da exception + arquivo/linha do source map, se disponível). Isso é o único caminho restante
para identificar a causa raiz real.
