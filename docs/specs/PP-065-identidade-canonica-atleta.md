## HISTÓRICO — informações adicionais (consulta, não instrução)

### Nota de precedente cruzado — PP-067 (2026-09-22, registrado por Leo)

`docs/specs/PP-067-investigacao-event-athlete-links-residual.md` investiga colisão de `athleteKey` em
`EventAthleteLink` **dentro do mesmo evento** (hoje só detectada como warning via `duplicateOwner`, sem
resolução). Mesma classe de problema do PP-065 (chave textual best-effort colidindo sem trilha de
resolução auditável), mas escopo distinto: PP-065 trata o mesmo atleta cross-evento; PP-067 trata
colisão dentro de um único evento. Leo registrou como **precedente útil, não dependência**: quando a
causa raiz do PP-067 for confirmada, a solução pode reaproveitar o padrão `AthleteMatchConflict` que o
PP-065 já está adotando, em vez de inventar mecanismo novo. Não altera ordem nem escopo de nenhuma das
Specs em curso (PP-064/065/066/067).

### CAT — Rodada 1 (2026-09-22)

#### Contexto do pedido (Leo)

Origem: decisão tomada durante o ciclo tripartite do PP-064 (favoritos + push), registrada em
`docs/specs/PP-064-draft.md` §"CAT — Rodada 3b — decisões de Leo", `[LEO DECIDE #1 → RESOLVIDO]`.

Leo decidiu que identidade de atleta cross-evento **não** deve ser resolvida dentro do PP-064. Motivo
declarado: `Club.normalizedName` já é chave global estável (`@unique` sem `eventId`) — clube não é
frágil. `Athlete` é sempre por evento (`@@unique([eventId, nameNormalized, clubId])`) — não existe hoje
entidade "pessoa" cross-evento, então qualquer tentativa de "atleta favorito" ou "histórico de carreira"
que dependa de identidade estável está hoje se apoiando em recomputação textual ad-hoc, não em dado
persistido e auditável.

PP-065 é Spec própria, **anterior** ao PP-064 na ordem de execução (junto com PP-066, que corrige um bug
de duplicação de `Match` não relacionado a este CAT). Objetivo: criar identidade canônica de atleta
(nova tabela, ex. `AthleteIdentity`), com resolução best-effort por nome+clube, seguindo o mesmo padrão
de heurística/conflito já usado em `AthleteAlias`/`AthleteMatchConflict`.

Consumidores conhecidos que dependem desta infraestrutura (não implementados nesta Spec, apenas o
fundamento de dado):
- PP-064 item (a): "atleta favorito" precisa de uma chave estável para sobreviver entre eventos.
- Pedido original de Leo, itens 1 e 3 (fora do escopo de todos os CATs abertos até agora): campeão
  matematicamente definido e notificações de quadro de eficiência também se beneficiariam de identidade
  estável de atleta, mas isso é hipótese de reaproveitamento futuro, não requisito desta Spec.

#### Estado atual do código (lido nesta sessão)

- `prisma/schema.prisma:135-166` — `Athlete` tem `@@unique([eventId, nameNormalized, clubId])`: a
  unicidade é por evento. Não há FK nem tabela que amarre o mesmo ser humano entre dois `Event` diferentes.
- `prisma/schema.prisma:123-133` — `Club` já tem `normalizedName String @unique` (sem `eventId`) — é
  global. Clube não precisa de nova identidade canônica; só atleta precisa.
- `prisma/schema.prisma:169-186` — `EventAthleteLink` tem `athleteKey String` com
  `@@unique([eventId, athleteKey])` — também por evento. `athleteKey` aqui é usado para religar
  atleta↔linha de scrape dentro do mesmo evento (não é identidade cross-evento).
- `prisma/schema.prisma:313-326` — `AthleteAlias`: liga `athleteId` (por evento) a variações de nome
  observadas (`aliasNormalized`), com `source: AliasSource`. É o padrão de heurística mais próximo do que
  PP-065 precisa, mas opera dentro do mesmo `Athlete` (mesmo evento) — resolve grafia, não identidade
  entre eventos.
- `prisma/schema.prisma:328-346` — `AthleteMatchConflict`: registra candidatos ambíguos
  (`candidateAthletes: Json`) quando um nome curto em um contexto (ex. chave de partida) pode apontar
  para mais de um `Athlete` **do mesmo evento**, com `resolvedAthleteId` e `resolvedAt` quando humano/
  heurística resolve. É o padrão de "conflito com resolução auditável" que a nova tabela deve seguir,
  adaptado para o problema cross-evento.
- `apps/worker/src/pipeline/athlete-resolution.ts` — `buildResolverCandidates` +
  `resolveByCategoryHistory`: resolução best-effort **dentro do mesmo evento**, usando contagem de
  histórico de alias por categoria para desambiguar candidatos. Não toca em outro evento.
- `apps/api/src/user/user.service.ts:4967` e `:5011` — `athleteKey` hoje é
  `normalizeAthleteName(athlete.nameDisplay)` computado on-the-fly, sem persistência, sem `clubId` no
  critério, sem histórico de resolução. É exatamente a fragilidade citada por Leo no PP-064: dois atletas
  de clubes diferentes com o mesmo nome normalizado colidem na mesma chave; troca de clube do atleta
  entre eventos não é rastreada; não há registro de quando/como a chave foi atribuída.
- `apps/web/app/user/career/[athleteKey]/page.tsx` e `apps/web/app/career/[athleteKey]/page.tsx` — duas
  rotas de carreira por `athleteKey` textual; consomem a mesma noção frágil de chave.
- Não há hoje nenhuma migração ou tabela chamada `AthleteIdentity`, `AthletePerson`, `CanonicalAthlete`
  ou equivalente no schema.

#### Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**O QUE**

[PENDENTE: A nova identidade canônica é uma tabela nova (`AthleteIdentity`) com FK 1:N a partir de
`Athlete` (cada `Athlete` por evento aponta para uma `AthleteIdentity`), ou o campo entra diretamente em
`Athlete` como uma coluna `identityId` nullable? Table separada preserva histórico de resolução
(quando/como foi vinculado) nо padrão `AthleteMatchConflict`; coluna direta é mais simples mas perde essa
trilha.]

[PENDENTE: Critério de correspondência best-effort — nome normalizado + clube normalizado é suficiente
como chave primária de agrupamento (dois `Athlete` em eventos diferentes com mesmo `nameNormalized` e
mesmo `clubId → Club.normalizedName` são a mesma pessoa), ou precisa de sinal adicional (ex.: overlap de
`stateCode`/`region`, proximidade temporal entre eventos) para reduzir falso-positivo quando o atleta troca
de clube entre eventos — nesse caso o nome bate mas o clube não, e hoje não há sinal para decidir se é a
mesma pessoa com novo clube ou pessoa homônima?]

[PENDENTE: Quando o mesmo nome aparece em clubes diferentes em eventos diferentes (troca de clube real),
o sistema deve: (a) nunca unificar automaticamente — cria identidades separadas e exige revisão manual
futura (mesmo padrão de "resolvedAt" nullable do `AthleteMatchConflict`), ou (b) unificar quando o nome é
suficientemente raro/específico (sem outro caso do mesmo nome em nenhum clube), com fallback para
conflito quando há ambiguidade? Isso decide se a tabela nova tem um fluxo de conflito symétrico ao
`AthleteMatchConflict` ou é sempre 1:1 automático.]

**COMO**

[PENDENTE: A resolução/vinculação ocorre em que momento do pipeline? Candidatas: (a) no momento do
upsert de `Athlete` no worker (`apps/worker/src/pipeline/upsert.service.ts`), imediatamente após
persistir o atleta do evento, calculando a `AthleteIdentity` correspondente; (b) como job de backfill/
reconciliação separado, rodando após o scrape, revisitando todos os `Athlete` sem `identityId` ainda.
Pelo padrão já usado no projeto (upsert já resolve heurísticas de alias no mesmo passo), (a) parece mais
consistente, mas precisa confirmação — impacta se esta Spec tem um script de backfill retroativo para
atletas/eventos já existentes no banco (obrigatório, dado que há eventos históricos) além do fluxo daqui
para frente.]

[PENDENTE: Este projeto já tem entradas na EPISODIC_MEMORY/knowledge sobre resolução textual best-effort
sendo fonte de falso-positivo/negativo (ex. PP-058/PP-062 nesta mesma sessão de knowledge, sobre
duplicação de clube). A Spec deve reaproveitar a mesma função de normalização de nome já usada em
`Athlete.nameNormalized`/`AthleteAlias.aliasNormalized`, ou define uma normalização própria para o
cross-evento? Presumo reaproveitar a existente (`normalizeAthleteName`/`normalizeText`, já usadas em
`user.service.ts`) — confirmar.]

**ONDE**

[PENDENTE: A UI/API expõe a nova identidade canônica nesta Spec (ex. endpoint que lista todos os
`Athlete` de um `AthleteIdentity`, ou substitui `athleteKey` textual pela chave canônica nas rotas de
carreira existentes), ou esta Spec entrega **só o fundamento de dado** (tabela + resolução + backfill),
deixando a migração de consumo (`career/[athleteKey]`, futuro PP-064) para as Specs que de fato
consomem? A decisão de Leo no PP-064 fala em "Spec própria... PP-064 passa a depender dessa Spec" —
sugere que PP-065 é só o alicerce, sem migrar consumidores existentes ainda, mas isso precisa confirmação
explícita porque muda o tamanho da entrega.]

Hipótese de impacto técnico (arquivos/contratos/DDL) — preliminar, sujeita a resolução dos PENDENTEs acima:

- **DDL novo**: tabela `AthleteIdentity` (id, nome canônico normalizado, timestamps) +
  FK/coluna em `Athlete` apontando para ela (`identityId Int?` inicialmente nullable até backfill
  completo, depois avaliar se vira obrigatório). Possível tabela de conflito irmã (ex.
  `AthleteIdentityConflict`) se o critério de resolução (b) acima exigir fluxo de ambiguidade, seguindo o
  padrão de `AthleteMatchConflict` (`candidateAthletes: Json`, `resolvedAthleteId`, `resolvedAt`).
- **apps/worker**: novo módulo de resolução cross-evento (ex.
  `apps/worker/src/pipeline/athlete-identity-resolution.ts`), análogo a
  `athlete-resolution.ts` mas comparando contra `Athlete` de **outros** eventos, não candidatos do mesmo
  evento. Ponto de chamada dentro de `upsert.service.ts` (ou job de backfill separado, conforme
  resolução do PENDENTE de momento de execução).
- **Script de backfill**: necessário para popular `identityId` dos `Athlete` já existentes no banco
  (múltiplos eventos históricos) — sem isso a Spec só cobre atletas novos a partir de agora.
- **apps/api / apps/web**: não tocados nesta Spec se o escopo for só o fundamento de dado (ver PENDENTE
  de "ONDE"); caso contrário, expandir para expor a nova chave.

**Fora de escopo (hipótese, a confirmar na Rodada 3):**
- Migrar `career/[athleteKey]` ou qualquer rota existente para consumir a nova identidade — fica para
  Spec de consumo futura (provavelmente dentro do próprio PP-064 revisitado).
- Resolver PP-064 (favoritos/push) e PP-066 (duplicação de `Match` em ELIMINATORIA) — ambos dependem
  deste fundamento ou são bugs de família distinta, tratados em Specs próprias.
- Unificação retroativa "inteligente" com sinais fracos (proximidade geográfica, similaridade fonética)
  além de nome normalizado + clube — a menos que Leo decida incluir na Rodada 3.

#### Definição de pronto (preliminar — depende dos PENDENTEs)

- Existe uma tabela/coluna que representa identidade canônica de atleta, distinta de `Athlete` (que
  permanece por evento).
- Todo `Athlete` novo persistido pelo worker é vinculado a uma `AthleteIdentity` (criada ou reaproveitada)
  de forma determinística e auditável (é possível saber depois por que dois `Athlete` foram/não foram
  unificados).
- Atletas já existentes no banco (histórico) têm identidade retroativamente atribuída via backfill, sem
  quebrar dado existente.
- Casos ambíguos (nome comum, clube divergente entre eventos) não são silenciosamente unificados errado —
  ficam rastreáveis para revisão, seguindo o padrão já validado de `AthleteMatchConflict`.
