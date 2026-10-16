## SPEC ATIVA — PP-056 — v2
<!-- Única seção de instrução. Codex/Claude implementador implementa exclusivamente contra este bloco. -->
ID: PP-056 | Projeto: PingPong PaiD'egua | Branch: fix/pp-056-event-athlete-links-constraint
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v2

**v2 — escopo ampliado após investigação de causa raiz completa (ver `## HISTÓRICO`).** v1 corrigia
apenas o sintoma (`syncStableEventAthleteLinks` travando); v2 adiciona a correção da causa estrutural
(normalização de clube incompleta no fluxo de partidas) que gera clubes/atletas duplicados. Saneamento
retroativo dos dados já duplicados no evento 59 vira Spec separada PP-057 (mesmo padrão da relação
PP-054/PP-055), dependente de autorização própria para execução em produção.

**P0 — bloqueio ativo em produção.** Worker travado no evento 59 desde 2026-09-18 18:30 (Belém): 5
execuções consecutivas em `ERROR`, nenhuma atualização de matches/atletas/inscrições desde então.
Implementação autorizada via agent Claude implementador (Codex indisponível — limite de uso atingido).
CAT compacto (fast track) — sem DDL, sem mudança de contrato de API, componente único.

**✅ Aprovado por Leo em 2026-09-18** — "prossiga de forma autônoma, autorizado por Leo até concluir as
pendências, pare apenas em caso de dúvida sem dados suficientes para tomar decisão ou impossibilidade de
coletar evidências pra decidir". Liberada para implementação via agent Claude implementador
(`florestech-claude-code-implementer`), seguida de homologação independente por este mesmo chat.

**v2 aprovada por extensão da mesma autorização** — Leo reiterou em 2026-09-18 (mensagem seguinte):
"siga de forma autônoma e decida sempre com base em evidências sólidas... você precisa concluir" — v2
amplia o escopo já autorizado (mesma pendência P0/causa raiz), decisão de ampliar tomada com evidência
sólida (investigação read-only registrada em `## HISTÓRICO`), sem ambiguidade que exigisse nova pausa.

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: não — correção interna de resolução de linha em pipeline de worker, sem input
  externo novo, sem query concatenada, sem exposição de dado.
- e2e-playwright-agent: não — mudança é backend puro, sem fluxo de UI.
- report-builder-agent: não — não há relatório estruturado de evidências exigido.

## Objetivo
Impedir que o worker trave a persistência inteira de um evento quando o nome normalizado de um clube
muda (ex.: correção de grafia, remoção/adição de sufixo de UF). A sincronização de `event_athlete_links`
deve atualizar a linha existente do atleta, em vez de tentar criar uma linha nova que colide com a
constraint única `(event_id, athlete_id)`.

## Contexto
Investigação read-only em produção (evidência dinâmica, via SSH direto — Codex indisponível nesta
sessão) confirmou: `event_athlete_links` tem 60 atletas do evento 59 cuja `athlete_key` salva (calculada
no momento da criação do link, a partir do nome do atleta + nome normalizado do clube) diverge da chave
que seria calculada hoje a partir do estado atual de `athletes`/`clubs` — porque o `normalized_name` de
pelo menos 2 clubes mudou (ex.: "Yoshida TT — ... (PA)" → "...- PA"; "Tênis de Mesa Salinas -TDMS" →
"...- PA"). `event_athlete_links` não tem hoje nenhum consumidor de leitura na API/web (confirmado por
`Grep` em todo o monorepo) — o dano imediato não é dado incorreto exibido ao usuário, é a **falha da
transação inteira de upsert do evento**, que impede matches, atletas e inscrições de serem atualizados.

Cadeia de causa confirmada por evidência real (`scrape_runs.error_message`, evento 59, 5 execuções
consecutivas desde 2026-09-18 18:30 Belém):
```
PrismaClientKnownRequestError: Invalid `eventAthleteLinks.upsert()` invocation
Unique constraint failed on the fields: (`event_id`,`athlete_id`)
```

Confirmado por leitura direta do código na VM de produção (commit `78762d1`, PR #38, 28/08) que **não é
regressão da PP-054** — o worker de produção nem tem o código da PP-054 (deploy é manual via
`workflow_dispatch`, nunca acionado após o merge do PR #53).

## Causa raiz

### Causa imediata (sintoma corrigido em v1, mantido em v2)
`syncStableEventAthleteLinks()` (`apps/worker/src/pipeline/upsert.service.ts:1926-2004`) calcula
`athleteKey` a partir do estado **atual** de nome+clube do atleta e faz
`eventAthleteLinks.upsert({ where: { eventId_athleteKey: { eventId, athleteKey } }, ... })`
(`:1966-1983`). Quando essa `athleteKey` recém-calculada não bate com nenhuma linha existente, o Prisma
interpreta como "não existe" e tenta o ramo `create`. Esse `create` grava `athleteId: athlete.id`, que já
está vinculado a uma linha existente (com a chave antiga) para o mesmo `eventId` — violando a constraint
única `(event_id, athlete_id)` (`prisma/schema.prisma:182`, `@@unique([eventId, athleteId])`).

### Causa raiz completa (nova em v2, investigação read-only confirmada por evidência real)
O verdadeiro problema não é "o nome do clube mudou" — é que **existem dois registros de `clubs` para o
mesmo clube físico** (`id=170`, nome com sufixo `"(PA)"`, existente desde 2026-02-24; `id=208`, nome com
sufixo `"- PA"`, criado em 2026-09-18 18:35 Belém), e por consequência **15 atletas duplicados** (mesma
pessoa, `athlete_id` novo, vinculada ao clube 208) — confirmado por `SELECT` direto em produção
comparando nomes idênticos sob os dois `club_id` (ex.: `ADRIANO JUDÁ MORAES DE OLIVEIRA` existe como
`athletes.id=6863` sob `club_id=170` e como `athletes.id=7098` sob `club_id=208`, ambos criados a partir
do mesmo texto de origem do CBTM).

`ensureClub()` (`upsert.service.ts:2099-2164`, único ponto de criação de `Club` em todo `apps/worker/src`)
busca por `prisma.club.findUnique({ where: { normalizedName } })` — comparação exata de string. O texto de
origem do clube no HTML/JSON do CBTM já contém `"- PA"` desde pelo menos 2026-08-27 (confirmado por
`raw_captures.raw_body`, evento 59, sem alteração no formato entre 27/08 e hoje). O fluxo de **inscrições**
(`upsert.service.ts:1112-1115`) já foi corrigido pela PP-053 (commit `79a91b9`, mergeado hoje,
**ainda não deployado em produção** — confirmado por leitura direta do commit ativo na VM) para usar
`normalizeClubName()` (`packages/shared/src/index.ts:784-788`), que remove sufixos de UF e colapsaria
`"(PA)"`/`"- PA"` no mesmo valor normalizado. **Porém o fluxo de partidas continua usando `normalizeText`
puro**, sem remoção de sufixo:
```
apps/worker/src/pipeline/upsert.service.ts:1559: clubNormalizedName: normalizeText(parsedMatch.athleteAClubNormalizedName ?? "") || null,
apps/worker/src/pipeline/upsert.service.ts:1585: clubNormalizedName: normalizeText(parsedMatch.athleteBClubNormalizedName ?? "") || null,
```
Esse valor não passa por `ensureClub` diretamente (matches usam `clubNormalizedName` só como critério de
comparação/matching de candidato em `resolveMatchAthlete`), mas ilustra que a mesma lacuna estrutural
(comparação de clube sem tratamento de sufixo UF) existe em mais de um lugar do pipeline — qualquer
caminho de resolução de atleta/clube que não passe por `normalizeClubName` fica vulnerável a criar
duplicatas quando o texto de origem do CBTM varia entre "(UF)" e "- UF" (ou qualquer outra variação
coberta pelo `CLUB_UF_SUFFIX_PATTERN`).

**Por que o clube 170 existe desde fevereiro com formato diferente do texto de origem atual**: não
determinado — sem dados de captura retidos de antes de 2026-08-27 (janela de retenção de
`raw_captures`), não é possível reconstruir o texto de origem exato daquela época. Não é acionável hoje;
tratado como fora de escopo desta Spec (ver "Fora de escopo").

### Causa sistêmica
O desenho de `event_athlete_links` já previa desvinculação de chaves obsoletas (rotina de `unbound`,
`:1987-1998`), mas roda **depois** do loop de upsert — que nunca chega ao fim quando a constraint é
violada no meio. Mais amplamente: o sistema não tem, em nenhum ponto, uma rotina de deduplicação de
`Club`/`Athlete` que rode *depois* da criação — cada resolução decide "existe ou não" no momento do
processamento, sem revisão posterior. Quando duas variações de texto da mesma fonte externa (CBTM)
escapam à normalização usada naquele caminho específico, o sistema cria duas entidades permanentemente
divergentes, sem nenhum mecanismo de correção automática.

**Padrão:** não há registro prévio desse padrão em `EPISODIC_MEMORY.md`/`knowledge/claude.md` do
projeto — primeira ocorrência conhecida. Candidato a classe episódica: "normalização de campo de texto
vindo de fonte externa aplicada de forma inconsistente entre caminhos de código gera duplicação de
entidade" — propor ao Leo ao encerrar a sessão se o padrão se repetir.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### C1 — Chave de link desatualizada é migrada para a nova chave, sem violar constraint
DADO um atleta já vinculado em `event_athlete_links` sob uma `athleteKey` antiga (`eventId=E`,
`athleteId=A`, `athleteKey="nome|clube-antigo"`)
QUANDO `syncStableEventAthleteLinks` roda de novo e a `athleteKey` calculada para esse atleta agora é
diferente (`"nome|clube-novo"`, porque `clubs.normalized_name` mudou)
ENTÃO a linha existente (`athleteId=A`) é atualizada com a nova `athleteKey` — nenhuma linha nova é
criada, nenhuma constraint é violada, a sincronização do evento continua até o fim.

### C2 — Comportamento existente (atleta novo, chave nunca vista) preservado
DADO um atleta que ainda não tem nenhuma linha em `event_athlete_links` para este evento
QUANDO `syncStableEventAthleteLinks` processa esse atleta
ENTÃO uma linha nova é criada normalmente (comportamento idêntico ao atual) — sem regressão.

### C3 — Duas `athleteKey` diferentes colidindo no mesmo atleta em um único run (defensivo)
DADO um cenário onde, dentro do mesmo `dataset` processado, o mesmo `athleteId` apareceria associado a
duas `athleteKey` distintas (situação anômala, não deveria ocorrer pela unicidade de `athletes.id` na
query de origem, mas o código deve permanecer seguro)
QUANDO o loop processa a segunda ocorrência
ENTÃO não deve gerar uma segunda tentativa de `create` para o mesmo `athleteId` — o comportamento correto
é sempre resolver para update da única linha ativa daquele `athleteId`.

### C4 — Warning de "link estável duplicado" continua funcionando (preservação)
DADO dois atletas diferentes (`athleteId` distintos) cuja `athleteKey` calculada colide entre si (mesmo
nome normalizado + mesmo clube normalizado)
QUANDO `syncStableEventAthleteLinks` processa ambos
ENTÃO o warning existente (`:1958-1962`, "Link estavel duplicado detectado...") continua sendo emitido
exatamente como hoje — este cenário não é alterado por esta Spec.

### C5 — Fluxo de partidas usa a mesma normalização de clube que o fluxo de inscrições (novo em v2)
DADO um jogo (`ParsedMatch`) cujo `athleteAClubNormalizedName`/`athleteBClubNormalizedName` contém um
sufixo de UF em formato diferente do já usado para o mesmo clube em `clubs.normalizedName` (ex.: partida
traz `"clube x - pa"`, clube já existe como `"clube x (pa)"`)
QUANDO `resolveMatchAthlete` processa esse jogo (`upsert.service.ts:1549-1600`, chamadas que hoje
constroem `clubNormalizedName` via `normalizeText` puro nas linhas 1559/1585)
ENTÃO o valor de `clubNormalizedName` usado para matching de candidato é equivalente ao que seria
produzido por `normalizeClubName` — não cria uma nova ambiguidade de clube só por causa da variação de
sufixo, alinhado ao comportamento já corrigido no fluxo de inscrições pela PP-053.

## Critérios de aceitação
- Mudança no nome normalizado de um clube não derruba a sincronização de `event_athlete_links` do evento.
- Nenhuma linha duplicada (mesmo `athleteId`, mesmo `eventId`) é criada pelo fluxo corrigido.
- O comportamento de criação de linha nova para atleta inédito no link permanece idêntico (C2).
- O warning de "link estável duplicado" (C4) não é alterado.
- `syncStableEventAthleteLinks` completa sem lançar exceção para o cenário reproduzido (C1), permitindo
  que `upsert()` continue e persista matches/atletas/inscrições normalmente.
- O fluxo de resolução de atleta via partidas usa a mesma normalização de sufixo de UF que o fluxo de
  inscrições (C5), fechando a lacuna estrutural identificada na causa raiz.

## Fora de escopo
- Reconstruir por que o clube 170 foi criado em fevereiro com formato diferente do texto de origem atual
  do CBTM — sem dados de captura retidos daquela época, não é investigável; registrar como observação,
  não como pendência acionável.
- Qualquer consumidor de leitura de `event_athlete_links` — a tabela não tem consumidor hoje; esta Spec
  não adiciona um.
- **Saneamento retroativo dos clubes/atletas já duplicados no evento 59 (clube 170 vs 208, 15 atletas
  duplicados) — Spec separada PP-057**, mesmo padrão da relação PP-054/PP-055: dependente de autorização
  explícita e distinta para execução em produção, a rodar depois desta Spec (PP-056 v2) estar mergeada e
  deployada. Diferente da avaliação em v1 desta Spec: a correção de código sozinha **não** resolve o
  clube/atletas já duplicados (eles não serão automaticamente re-fundidos só porque a normalização
  melhorou) — motivo pelo qual o saneamento agora é necessário, ao contrário do que v1 havia concluído.
- Deploy manual em produção do PR resultante — decisão/execução de Leo, fora do escopo de implementação.

## Impacto técnico

### Arquivos a criar/modificar
- `apps/worker/src/pipeline/upsert.service.ts`:
  - Método `syncStableEventAthleteLinks` (`:1926-2004`, **já implementado em v1**, PR #55 aberto): antes
    do `eventAthleteLinks.upsert()` por `athleteKey` (`:1966`), busca por linha existente com
    `athleteId: athlete.id, eventId: input.eventId` (a própria constraint única `(eventId, athleteId)`
    garante no máximo 1 resultado); se encontrada e sua `athleteKey` diverge da recém-calculada, faz
    `update` direto por `id`. Manter como está — já homologado por evidência de execução real nesta
    sessão (94 testes locais incluindo os 4 T-I-* específicos).
  - **Novo em v2:** linhas 1559 e 1585 — trocar `normalizeText(parsedMatch.athleteAClubNormalizedName ?? "")`
    e `normalizeText(parsedMatch.athleteBClubNormalizedName ?? "")` por `normalizeClubName(...)` (já
    importado no topo do arquivo, linha 12, usado pelo fluxo de inscrições desde a PP-053). Import já
    presente — não precisa adicionar novo import.
- Novo arquivo de teste: `apps/worker/test/sync-stable-event-athlete-links.test.ts` (**já criado em v1**).
- Novo teste (ou extensão do mesmo arquivo, a critério do implementador) cobrindo C5: dois jogos com
  `athleteAClubNormalizedName` em formatos diferentes de sufixo UF para o mesmo clube não devem gerar
  candidatos de clube divergentes no matching de `resolveMatchAthlete`.

### Arquivos que NÃO devem ser tocados
- `prisma/schema.prisma` (`EventAthleteLink`, `Club`) — motivo: sem DDL, constraints atuais já suportam a
  correção via lógica de aplicação; saneamento de dados já duplicados fica na PP-057.
- Qualquer arquivo de `apps/api` ou `apps/web` — motivo: tabela sem consumidor de leitura, fora de escopo.
- Bloco de `unbound` (`:1987-1998`) — motivo: continua funcionando exatamente como hoje, não precisa de
  mudança para este bug.
- `ensureClub()` (`:2099-2164`) — motivo: a função em si está correta (busca por `normalizedName` exato);
  o problema é o valor que chega até ela em alguns caminhos, não a função.
- Qualquer arquivo relacionado a PP-054/PP-055 (`match-merge.ts`, resolução de `matches` por
  `cbtmMatchId`) — motivo: bug não relacionado, confirmado por investigação.
- Dados já persistidos em `clubs`/`athletes`/`event_athlete_links` para o evento 59 — nenhuma remoção ou
  fusão nesta Spec; isso é a PP-057.

### DDL / migração
Nenhuma.

### Contrato de API alterado
Nenhum.

### Dependências novas
Nenhuma.

### Pendências rastreáveis (backlog, registrar ao encerrar sessão)
- Por que o clube 170 nasceu em fevereiro com formato diferente do texto de origem atual do CBTM — sem
  dados de captura retidos daquela época para investigar; registrar como observação histórica, não como
  ação pendente.
- Considerar, em Spec futura, uma rotina periódica de detecção de clubes com `normalizedName` "quase
  iguais" (ex.: mesmo valor após aplicar `normalizeClubName` de novo em cima do já normalizado, ou
  distância de edição pequena) — mitigaria recorrência do mesmo padrão para outras variações de texto
  não cobertas pelo `CLUB_UF_SUFFIX_PATTERN` atual. Fora de escopo desta Spec.
- Origem da mudança de `clubs.normalized_name` para pelo menos 2 clubes do evento 59 não identificada —
  se o padrão se repetir, pode indicar rotina de normalização de clube sem proteção equivalente em outras
  tabelas dependentes de chave derivada de nome de clube.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: integração (`syncStableEventAthleteLinks` contra Postgres de teste real, seguindo
  o padrão já usado em `apps/worker/test/upsert-match-reschedule.test.ts` e `upsert-dedup.test.ts`) +
  unitário para C5 (normalização de clube em matching de candidato)
- arquivos de teste a criar: `apps/worker/test/sync-stable-event-athlete-links.test.ts` (já criado em v1);
  T-U-01 (novo em v2) pode ir no mesmo arquivo ou em `apps/worker/test/upsert-dedup.test.ts` — a critério
  do implementador, desde que exercite o comportamento real de `resolveMatchAthlete`/matching de clube
- fixtures/mocks: nenhum mock de Prisma — banco de teste real
- COBERTURA: regressão=2 corretude=3 (C2 e C4 cobrem regressão do comportamento existente; C1, C3 e C5
  cobrem corretude do comportamento novo, com leitura direta do estado pós-operação no Postgres ou
  asserção direta sobre o valor normalizado calculado)

### T-I-01 — mudança de clube normalizado migra a linha existente sem lançar exceção [corretude]
Camada: integração
DADO: um evento de teste com um atleta e um clube; `syncStableEventAthleteLinks` executado uma primeira
vez (cria a linha com `athleteKey` inicial); em seguida, o `club.normalizedName` é alterado diretamente
no banco de teste (simulando a renormalização)
QUANDO: `syncStableEventAthleteLinks` é chamado novamente para o mesmo evento
ENTÃO: não lança exceção; `prisma.eventAthleteLink.count({ where: { eventId, athleteId } })` é 1 (não 2);
a linha lida tem a `athleteKey` nova

### T-I-02 — atleta inédito continua criando linha normalmente [regressão]
Camada: integração
DADO: um evento de teste sem nenhuma linha prévia em `event_athlete_links`
QUANDO: `syncStableEventAthleteLinks` processa um atleta desse evento pela primeira vez
ENTÃO: uma linha é criada com `athleteId` e `athleteKey` corretos (idêntico ao comportamento hoje)

### T-I-03 — dois atletas com mesma chave continuam gerando warning [regressão]
Camada: integração
DADO: dois atletas distintos (`athleteId` diferentes) no mesmo evento, cujo nome normalizado + clube
normalizado produzem a mesma `athleteKey`
QUANDO: `syncStableEventAthleteLinks` processa ambos
ENTÃO: o array de `warnings` retornado contém uma mensagem "Link estavel duplicado detectado" citando os
dois `athleteId` — mesmo comportamento de hoje, sem alteração

### T-I-04 — reprodução do cenário real do evento 59 (múltiplos atletas, múltiplos clubes renomeados) [corretude]
Camada: integração
DADO: um evento de teste com ao menos 3 atletas em 2 clubes distintos, todos já vinculados; os
`normalizedName` dos 2 clubes são alterados diretamente no banco (simulando o cenário real)
QUANDO: `syncStableEventAthleteLinks` roda novamente
ENTÃO: nenhuma exceção é lançada; todas as linhas são atualizadas com as novas chaves; contagem final de
linhas em `event_athlete_links` para o evento permanece igual à contagem inicial (nenhuma duplicata criada)

### T-U-01 — matching de clube via partida ignora variação de sufixo UF [corretude] (novo em v2)
Camada: unitário/integração leve
DADO: um `clubNormalizedName` calculado a partir de `athleteAClubNormalizedName="clube x - pa"` e outro a
partir de `"clube x (pa)"`
QUANDO: ambos passam pelo trecho de normalização hoje em `upsert.service.ts:1559`/`:1585`
ENTÃO: os dois produzem o mesmo valor normalizado (equivalente ao resultado de `normalizeClubName`) —
não haveria criação de clube duplicado se esses dois valores fossem usados para buscar/criar um `Club`

### Cobertura de falhas silenciosas
- Persistência: todos os T-I-* leem o estado pós-operação diretamente do Postgres (contagens e valores de
  `athleteKey`), não confiam apenas em ausência de exceção lançada.
- T-U-01 lê o valor normalizado calculado diretamente (não apenas ausência de erro).

### Categorias de cobertura mínima não aplicáveis
- Formulário/Cadastro, Edição por usuário final, Exclusão, Listagem/Busca, Autenticação/Autorização,
  Upload/Arquivo, Integração externa — [não aplicável — correção interna de pipeline de worker, sem
  input de usuário final, sem endpoint HTTP, sem UI].
- Regra de negócio — coberta: C1-C5 e T-U-01, T-I-01..04.

### Comando para rodar a suite
`npm --prefix apps/worker test`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### v1 (2026-09-18) — fast track, sintoma corrigido
CAT compacto (fast track, sem Rodada 2 Codex — indisponível). Causa raiz identificada como "mudança de
`clubs.normalized_name`" (impreciso — ver v2). Aprovado por Leo ("prossiga de forma autônoma..."),
implementado via agent `florestech-claude-code-implementer` (PR #55, branch
`fix/pp-056-event-athlete-links-constraint`, commit `4042aa1`, worktree `appcbtmeventos-pp056`). 4/4 T-I-*
verdes localmente pelo agente implementador.

### Pergunta de Leo que motivou a investigação de causa raiz completa (2026-09-18)
Leo perguntou: "se o problema foi causado por ID do atleta devido a consolidação das duplicações, por
que não migrar as informações de ID migrado para o ID consolidado?" — questionamento correto que expôs
que a v1 desta Spec (e a investigação original do sintoma no evento 59) tinha descrito a causa como
"renomeação de clube" sem verificar se havia de fato duplicação de entidade (clube e/ou atleta) por trás
disso.

### Investigação de causa raiz completa (2026-09-18, read-only via SSH direto + agent Explore)
Confirmado por evidência real em produção (`clubs`, `athletes`, `event_athlete_links`, `raw_captures`):
- Não há migração de `athlete_id` envolvida — cada atleta manteve o mesmo `id` desde a criação original.
- Existem 2 registros de `Club` para o mesmo clube físico (`170` desde 2026-02-24, formato `"(PA)"`;
  `208` criado 2026-09-18 18:35 Belém, formato `"- PA"`) e 15 `Athlete` duplicados (mesma pessoa, `id`
  novo, vinculada ao clube 208) — confirmado comparando nomes idênticos sob os dois `club_id`.
- O texto de origem do CBTM (`raw_captures.raw_body`) já usa o formato `"- PA"` desde pelo menos
  2026-08-27 (mesmo dia em que o atleta original 6863 foi criado, vinculado corretamente ao clube 170
  antigo) — descartada a hipótese de "o CBTM mudou o formato recentemente".
- `ensureClub()` é o único criador de `Club` em todo `apps/worker/src`; suas 2 chamadas conhecidas
  (fluxo de inscrições e `ensureWarningAthleteForConflict`) já usam `normalizeClubName()` desde a
  PP-053 (commit `79a91b9`, mergeado 2026-09-18 17:37 Belém — **ainda não deployado em produção**,
  confirmado por leitura direta do commit ativo na VM, `78762d1`/28-08).
- O agent de investigação inicialmente hipotetizou que o deploy da PP-053 já estava em produção e teria
  causado a duplicação — **hipótese refutada** por reverificação direta do commit ativo na VM (ainda
  `78762d1`). A causa exata de por que o clube 170 nasceu com formato diferente em fevereiro/2026
  permanece não determinada (sem dados de captura retidos de antes de 2026-08-27) — não investigável,
  não acionável, registrada como observação em "Pendências rastreáveis".
- Conclusão acionável: o fluxo de **partidas** (`upsert.service.ts:1559`/`:1585`) ainda usa
  `normalizeText` puro (sem `normalizeClubName`), diferente do fluxo de inscrições já corrigido — mesma
  classe de lacuna que permite duplicação de clube quando o texto de origem varia em formato de sufixo
  UF entre capturas. v2 desta Spec fecha essa lacuna e recategoriza o saneamento retroativo (antes
  descartado como desnecessário em v1) como Spec separada obrigatória, PP-057.
