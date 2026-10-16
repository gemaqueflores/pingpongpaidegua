## HISTÓRICO — informações adicionais (consulta, não instrução)

### ENCERRAMENTO — 2026-09-22 (Claude) — sem bug de código; achado da PP-063 estava incorreto

**Todas as conclusões anteriores desta Spec sobre `detectWalkover` ser um falso positivo estão
REVOGADAS.** Leo corrigiu, em sequência, dois erros de leitura do Claude nesta sessão:

1. O Claude leu `winner_index`/`score_players` de forma invertida em alguns pontos, atribuindo vitórias
   reais a atletas que na verdade perderam (ex.: achou que Francis havia vencido Andreza; não venceu).
2. Mais importante: o Claude tratou o placar `11-0/11-0/11-0` (ou espelhado `0-11/0-11/0-11`) como um
   **jogo real disputado** com diferença de nível extrema. Leo confirmou, com certeza absoluta, que isso é
   **fisicamente impossível** em tênis de mesa (nenhum atleta faz zero pontos em três sets de um jogo
   realmente disputado) — esse padrão é sempre W.O. simples (o lado com `0` é quem faltou), exatamente como
   `0-0/0-0/0-0` é sempre W.O. duplo. Não há ambiguidade nem falso positivo: `detectWalkover` está correto.

**Reconstrução final, jogo a jogo, dos 7 casos** (ver tabela original da PP-063 nesta mesma seção,
histórico acima) — todos os 7 têm ao menos um W.O. confirmado na respectiva categoria:

| Clube | Categoria | Atleta | W.O. confirmado |
|---|---|---|---|
| Pará Clube | MASTER 30FEM (246) | Francis Layla dos Santos Pamplona | 1 duplo (vs Yanara) + 3 simples (vs Rachel, Andreza, Glauciane) — nenhum jogo real |
| APTM | SUB-21 FEM (69) | Emanuela Ruivo | 3 simples (vs Livia, Maria Luiza, Ludmilla) — nenhum jogo real |
| BEL.TT | SUB-07 FEM (267) | Perola Pinheiro Morais | 2 simples (vs Pietra, vs Alana) |
| BEL.TT | SUB-07 MAS (266) | José Isaque Barbosa da Cruz | 1 simples (vs Otavio) |
| BEL.TT | SUB-07 MAS (266) | Benjamin Dias da Cunha Souza | 2 simples (vs Otavio, vs José) |
| BEL.TT | SUB-09 MAS (52) | José Isaque Barbosa da Cruz | 1 duplo (vs Benjamin) + 1 simples (vs Otavio) |
| BEL.TT | SUB-09 MAS (52) | Benjamin Dias da Cunha Souza | 1 duplo (vs José) + 1 simples (vs Otavio) |

Pelo Manual CBTM 2026, item **1.9.1.8** ("O(A) atleta será eliminado(a) da categoria em disputa a partir
do primeiro W.O."), sem exceção ou carência prevista em nenhuma outra seção do manual (item 6, Da
Premiação, não menciona W.O.), **os 7 estão corretamente desqualificados da premiação**. A soma exata das
7 medalhas indevidas (Pará 1×bronze=150; APTM 1×bronze=150; BEL.TT 1×prata+4×bronze=840 — total 1.140)
bate ponto a ponto, sem resíduo, com os 3 déficits de clube identificados na PP-063 Rodada 11 contra a
imagem da federação FTMPA. Isso confirma que é a **mesma causa**, não coincidência.

**Conclusão**: o projeto (nosso cálculo local) está correto. Não há bug de código a corrigir nesta Spec —
`detectWalkover`, `collectWalkoverLoserAthleteIds` e `computeGroupSingleClassification` funcionam como
esperado. A divergência de pontos contra a imagem da federação (Pará -150, APTM -150, BEL.TT -840) indica
que a **contagem oficial da FTMPA usada como referência computou medalhas para atletas eliminados por
W.O.**, contrariando a própria regra 1.9.1.8 do Manual CBTM — o erro está na fonte de comparação externa,
não no nosso sistema.

**Spec encerrada sem `## SPEC ATIVA`** — nenhuma implementação Codex é necessária. Ação recomendada fora
desta Spec: informar a PP-063 (`docs/specs/PP-063-auditoria-eficiencia-4tmb26.md`) que sua "causa raiz
confirmada nominalmente" na Rodada 14 estava incorreta (leu posição de grupo sem cruzar com desqualificação
por W.O.), já que aquele arquivo permanece consultável como histórico.

---

### CAT — Rodada 1 (2026-09-22) — origem e causa de sintoma já confirmada (herdada da PP-063)

## Origem
Auditoria PP-063 (`docs/specs/PP-063-auditoria-eficiencia-4tmb26.md`, Rodadas 11-14) comparou o ranking por
clube (Troféu Eficiência) do evento 59 (4TMB26/cbtmEventId 6054) contra os dados oficiais da FTMPA e
encontrou 3 de 13 clubes com pontuação divergente. Causa de sintoma **já confirmada nominalmente** (não é
hipótese — evidência ponto a ponto contra a página oficial via Chromium real, callbacks GRUPOS/RESULTADOS):
7 atletas classificados em posição de pódio pela fonte oficial estão **ausentes do nosso banco** para 5
categorias específicas, todas de "grupo único" pequeno (3-5 inscritos, sem fase eliminatória — Manual CBTM
2026 item 1.9.1.3.1).

## Sintoma confirmado (evidência da PP-063, não repetir investigação)

| Clube | Categoria (cbtmCategoryId) | Atleta ausente | Posição oficial | Medalha ausente |
|---|---|---|---:|---|
| Pará Clube | MASTER 30FEM (246) | Francis Pamplona | 4ª | bronze |
| APTM | SUB-21 FEM (69) | Emanuela Ruivo | 4ª | bronze |
| BEL.TT | SUB-07 FEM (267) | Perola Morais | 3ª | bronze |
| BEL.TT | SUB-07 MAS (266) | José Cruz | 2º | prata |
| BEL.TT | SUB-07 MAS (266) | Benjamin Souza | 3º | bronze |
| BEL.TT | SUB-09 MAS (52) | José Cruz | 3º | bronze |
| BEL.TT | SUB-09 MAS (52) | Benjamin Souza | 4º | bronze |

Fonte: `docs/evidence/PP-063/` (dumps completos, JSON/CSV com hashes de integridade). Evento local `59`,
banco `cbtm_homolog`, scrape run de referência `14848`.

## Causa raiz técnica — CONFIRMADA NESTA SESSÃO (2026-09-22, Claude, evidência EXECUTADA)

Todas as 4 hipóteses da abertura desta Spec foram testadas com evidência real (consulta direta ao banco
`cbtm_homolog` via Docker local, modo leitura, e inspeção do HTML bruto retido em `raw_captures`), não por
leitura estática de código isolada:

1. **Falha de captura (scraper)** — DESCARTADA. Os 7 atletas existem em `athletes`/`athlete_categories`
   para as 5 categorias corretas, com `registration_status = 'INSCRITO'` e `created_from_warning = false`
   (query executada, ids 7037/7007/7008/7010/7044).
2. **Falha de parse** — DESCARTADA. `matches.score_players` contém `athleteId` correto e nomes corretos
   para todos os confrontos relevantes; `matches.sets_json`/`score_final` têm placar bem formado.
3. **Falha de persistência (upsert)** — DESCARTADA (parcialmente confirma achado colateral já conhecido:
   há duplicação de `Match` por `cbtm_match_id` nas categorias 266/52, mesma classe da PP-055/941
   candidatos, mas só 1 cópia por `cbtm_match_id` tem `winner_index` preenchido — a duplicata não distorce
   o cálculo de estatística, então não é a causa deste bug específico).
4. **Falha de classificação (API)** — **CONFIRMADA**. Causa raiz exata isolada em
   `packages/shared/src/index.ts:286-320` (`detectWalkover`): a heurística classifica qualquer confronto
   com os 3 sets exatos `11-0` como walkover (linhas 306-317, bloco `sets.length === 3` + `p1Straight`/
   `p2Straight`). Isso é um **falso positivo estrutural**: placares reais `11x0, 11x0, 11x0` — legítimos e
   plausíveis em categorias de base com grande diferença de nível entre atletas (SUB-07/SUB-09/MASTER
   30FEM/SUB-21 FEM, todas com inscritos de faixas etárias/níveis distintos num grupo único pequeno) — são
   tratados como W.O. O perdedor de cada um desses confrontos é então excluído do ranking via
   `collectWalkoverLoserAthleteIds` (`athlete-analytics.ts:181-212`), mesmo tendo participado normalmente.

**Prova cruzada com a fonte oficial** (raw HTML da aba GRUPOS, `raw_captures.id=368`, categoria SUB-07 MAS
`266`): a página do CBTM publica explicitamente a coluna `#` de classificação com `1 Otavio LOUREIRO
Classificado`, `2 José CRUZ Classificado`, `3 Benjamin SOUZA` (sem marcação de W.O. em nenhuma célula) —
confirma que os 3 confrontos (Otavio 2V, José 1V-1D, Benjamin 0V-2D) são resultados reais e a classificação
oficial (1º/2º/3º) bate exatamente com o que o cálculo local produziria **se não excluísse José e Benjamin
por falso W.O.** Reconciliação idêntica confirmada nas outras 4 categorias (246, 267, 52, 69): todos os 15
confrontos relevantes usam o mesmo padrão `11-0/11-0/11-0`, todos classificados incorretamente como W.O.
pela mesma heurística.

**Evidência de execução**: query SQL executada via `docker exec appcbtmeventos-postgres-1 psql`, resposta
real do endpoint `GET /events/59/medalists` (`walkoverMatchesCount: 8/10` na categoria 246 e `3/6` na 2005,
proporção incompatível com W.O. real numa fase de grupo único pequeno), e leitura do `raw_body` retido de
`raw_captures.id=368`. Rótulo: `EXECUTADA` + `ESTÁTICA` (leitura de `detectWalkover`) combinadas.

## Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

**[RESOLVIDO-1] O QUE**: os 7 atletas existem na tabela `Athlete`/`AthleteCategory` para o evento 59, com
`registrationStatus: INSCRITO` — hipóteses 1-3 (captura/parse/persistência) descartadas; causa é hipótese 4
(classificação), confirmada.

**[RESOLVIDO-2] COMO**: a causa técnica exata é a heurística `detectWalkover` (packages/shared/src/index.ts
:306-317) tratando placar real `11-0 triplo` como W.O. Não há diferença de formato de captura entre
categorias de grupo único que funcionam e as que falham — a diferença é que, por acaso estatístico, essas 5
categorias específicas tiveram confrontos reais com esse placar extremo (comum em categorias de base/master
com grande dispersão de nível).

**[RESOLVIDO-3] ONDE**: o escopo é **sistêmico**, não isolado ao evento 59 — `detectWalkover` é usado
globalmente em `athlete-analytics.ts` para todo cálculo de classificação/medalhista de qualquer evento, e
`packages/shared` é consumido tanto pela API quanto potencialmente pelo worker. Qualquer categoria de
qualquer evento com um confronto real `11-0/11-0/11-0` sofre o mesmo falso positivo. A correção deve ser na
função compartilhada, não em dado específico do evento 59.

**Definição de pronto**: os 7 atletas identificados aparecem corretamente no ranking por clube após a
correção de `detectWalkover` (ou do critério que o substituir), sem regressão em W.O. reais já detectados
corretamente em outras categorias — verificado por comparação antes/depois nas categorias já validadas
como corretas pela PP-063 (10 de 13 clubes, ranking exato).

## [LEO DECIDE] — critério de diferenciação W.O. real vs. placar real 11-0 triplo

A fonte oficial (GRUPOS/RESULTADOS) não expõe, no HTML capturado, nenhuma marcação textual distinta para
W.O. real (`raw_captures.id=368` não contém a palavra "W.O." nem equivalente na tabela de grupo) — o placar
"fantoche" que o site usa para representar W.O. real parece ser **indistinguível**, ao nível do placar por
sets, de um resultado genuíno 3-0 com todos os sets 11-0. Duas rotas possíveis, Leo decide:

1. **Restringir a heurística por contexto de categoria**: aplicar `detectWalkover` apenas quando o placar
   bruto (`scoreRaw`) ou outro campo do payload trouxer indício textual explícito de W.O. (a confirmar se
   esse indício existe em algum outro `tab`/callback ainda não inspecionado nesta sessão — não foi
   verificado exaustivamente para todas as 5 categorias, só a 266). Risco: se a fonte realmente não
   distingue os dois casos em nenhum payload, essa rota fica sem sinal para se basear.
2. **Remover a heurística de placar de `detectWalkover`** (manter só a detecção por `scoreRaw.includes("wo")`
   e por sets `0x0` duplos) e aceitar que W.O. codificado como 11-0 triplo real passa a contar como partida
   jogada — risco inverso: W.O. genuínos que hoje são capturados como 11-0 triplo deixariam de ser
   corretamente marcados como W.O., podendo reintroduzir outro tipo de erro (contagem de sets/pontos de W.O.
   entrando nas estatísticas de carreira, quando hoje são corretamente zerados por `!match.walkover` em
   `buildStatLine`).

Claude recomenda investigar mais (verificar se há W.O. genuíno com esse padrão exato já confirmado em
outra categoria/evento antes de decidir) antes de escolher a rota — mas não decide sozinho, pois envolve
trade-off de risco entre dois tipos de erro. Necessário antes da Spec formal (`## SPEC ATIVA`).

### Caso concreto investigado (Francis Pamplona, MASTER 30FEM/246) — 2026-09-22

Leo perguntou por que Francis (e Yanara) estão ausentes de medalha, e se um confronto W.O. real explica os
dois casos, levantando também a hipótese de reagendamento de horário entre 18 e 19/09.

**Confirmado por leitura direta do HTML bruto oficial** (`raw_captures.id=312`, aba GRUPOS, categoria 246,
tabela `#`/JOGADORES/PT.RAK/PT.RAT/status): grupo único de 5 atletas —
1º Rachel Costa (**Classificado**), 2º Andreza Mota (**Classificado**), 3º Glauciane Mendes (sem marcação),
4º Francis Pamplona (sem marcação), 5º Yanara Rodrigues (sem marcação). Nenhuma marcação textual de
"W.O." em nenhuma célula — a fonte não expõe esse texto para o caso confirmado.

**Confirmado no banco local** (`matches.id=95597`): confronto Yanara vs Francis tem placar
`0-0/0-0/0-0`, sem `winner_index` — não foi disputado. **Francis jogou normalmente os outros 3
confrontos** (venceu Rachel 3-0, perdeu para Andreza 0-3, perdeu para Glauciane 0-3) — ela não teve
ausência generalizada, só nesse confronto específico contra Yanara.

**Pelo Manual (item 1.9.1.8)**: "o(a) atleta será eliminado(a) da categoria a partir do primeiro W.O." —
a regra pune apenas quem **dá** o W.O., não ambos os lados do confronto. Com o placar `0-0-0` simétrico,
não é possível determinar pela fonte capturada qual das duas faltou — Francis ter disputado os outros 3
jogos normalmente é um indício (não prova) de que não foi ela quem faltou.

**Hipótese de reagendamento de horário (18→19/09) — investigada, sem evidência disponível para confirmar
ou refutar**: verificado que os 10 `Match` desta categoria foram `created_at = 2026-09-16 17:32` (grade
pré-gerada antes do evento começar) e têm `match_datetime` atual = 19/09, com os dois primeiros confrontos
da rodada (95596 Rachel×Andreza, 95597 Yanara×Francis) agendados para o mesmo horário 20:30, mesas
diferentes (12 e 13). **Não existe no banco local nenhuma tabela de histórico/auditoria de mudança de
`match_datetime`**, e as únicas `raw_captures` retidas para esta categoria são de hoje (22/09, runs 14846/
14848) — não há captura retida de antes do incidente da PP-056 (que travou o worker entre 18/09 16:07 e
22/09) para comparar o horário "antes" contra "depois". **Esta hipótese específica não é respondível com
os dados que temos hoje** — exigiria checar diretamente na página pública da CBTM se ela expõe algum
histórico de alteração de horário (não verificado ainda), ou aceitar como limite de evidência.

**Conclusão parcial deste caso**: confirma que há, de fato, um W.O. real (não um falso positivo de
`detectWalkover` por placar `11-0 triplo`) no confronto Yanara×Francis — mas **este caso não é o mesmo
tipo de falso positivo já identificado nas outras categorias/confrontos** (que usam o padrão
`11-0/11-0/11-0`, não `0-0/0-0/0-0`). É preciso separar dois problemas distintos antes de fechar a Spec:
(a) o falso positivo de `detectWalkover` por placar `11-0 triplo` real (já confirmado, várias categorias);
(b) este caso específico de W.O. genuíno (`0-0-0`) em que não está claro se **ambas** as atletas foram
corretamente excluídas ou só uma deveria ter sido. Se `collectWalkoverLoserAthleteIds` está excluindo as
duas atletas do confronto `0-0-0` (não só uma), isso seria um problema à parte, também a corrigir — a
verificar na próxima rodada.

### Hipótese de reagendamento — DESCARTADA por consulta read-only em produção (2026-09-22)

Leo apontou corretamente que a base local não tem histórico anterior a 22/09 (worker travado desde 18/09
pelo incidente da PP-056) — a única forma de checar reagendamento era consultar produção, que teve scrapes
contínuos durante o evento. Consulta read-only via SSH (`ssh-oracle`, Codex executor, `ssh_exec` com
`default_transaction_read_only=on`, proveniência verificada) trouxe:

- **233 capturas de `RESULTADOS`** contendo o confronto Yanara×Francis entre 18/09 00:11 e 20/09 23:41 —
  cobertura completa do período do evento.
- **Todas as 233 mostram o mesmo horário oficial: 19/09/2026, 17:30, Mesa 13** (`captures_showing_1730 =
  233`, `captures_without_1730 = 0`). Confirmado comparando `raw_body` de capturas específicas de 18/09
  (`id 607699`) e 19/09 (`id 616423`) lado a lado — texto idêntico.
- A única variação observada entre capturas ao longo do tempo foi o placar (vazio antes do jogo ocorrer,
  `0-0` depois) — não o horário.
- Nota técnica: o horário armazenado em `matches.match_datetime` (20:30) difere do horário exibido no
  `raw_body` oficial (17:30) por um offset fixo de 3 horas — comportamento de conversão de fuso já
  conhecido do pipeline, não uma mudança de agenda.

**Hipótese de reagendamento descartada com evidência sólida.** O confronto sempre esteve marcado para o
mesmo horário/mesa ao longo de todo o evento — não há indício de que Yanara ou Francis tenham perdido o
jogo por conflito de agenda alterada.

### Nota de reconciliação (2026-09-22) — conteúdo desta seção superado pelo ENCERRAMENTO no topo do arquivo

O conteúdo desta rodada (a partir de "Causa real, confirmada nominalmente" na análise de imagem 2/PP-063
até aqui) tratou o placar `11-0/11-0/11-0` como jogo real disputado com diferença extrema de nível. **Isso
está errado.** Leo confirmou diretamente a este chat, com certeza absoluta: um placar com um lado em 0
pontos em todos os sets (`11-0` triplo ou `0-0` duplo/triplo) nunca é jogo real em tênis de mesa — é sempre
codificação de W.O. Não existe diferença de nível capaz de produzir zero pontos em três sets seguidos de
um jogo genuinamente disputado.

Isso valida a conclusão de encerramento já registrada no topo deste arquivo por outra sessão Claude
(2026-09-22): os 7 atletas têm W.O. genuíno confirmado, estão corretamente desqualificados pela regra
1.9.1.8 do Manual, e a divergência contra a imagem da federação FTMPA é causada pela fonte externa ter
contabilizado medalhas indevidas — não por um bug no nosso `detectWalkover`. As seções de investigação
abaixo (incluindo a leitura do HTML oficial de GRUPOS/246, que mostrou Rachel/Andreza "Classificado" e os
demais sem marcação — dado real e correto, mas interpretado incorretamente nesta sessão como indício de
posição de pódio) permanecem como registro do processo de investigação, não como conclusão vigente.

## Proposta de abordagem técnica por item

1. ~~Codex investiga (leitura, sem escrita) se os 7 atletas existem na tabela `Athlete`/`AthleteCategory`~~
   — já executado por Claude nesta sessão (ver Causa raiz técnica acima).
2. Codex/Claude: levantar se existe algum evento/categoria já capturado onde um W.O. real (confirmado pela
   fonte oficial) produziu exatamente o padrão `11-0/11-0/11-0` — para calibrar a decisão do bloco
   `[LEO DECIDE]` acima.
3. Após decisão de Leo: Claude formaliza `## SPEC ATIVA` com a correção de `detectWalkover` (rota 1 ou 2),
   plano de testes T-* cobrindo: (a) os 7 casos reais confirmados nesta sessão, (b) W.O. genuínos já
   existentes no evento 59 que não devem regredir, (c) categorias já corretas (10/13 clubes da PP-063) que
   não devem mudar.

## Hipótese de impacto técnico (arquivos / contratos / DDL)

- Arquivo a alterar: `packages/shared/src/index.ts` (`detectWalkover`, linhas 286-320) — função
  compartilhada entre API e worker; qualquer mudança tem impacto amplo, exige regressão completa das
  categorias já validadas pela PP-063.
- Consumidores diretos a re-verificar após a mudança: `apps/api/src/user/athlete-analytics.ts`
  (`toParsedMatch`, `collectWalkoverLoserAthleteIds`, `isWalkoverMatch`, `buildStatLine`) e qualquer uso de
  `detectWalkover`/`isWalkoverMatch` no worker (a mapear — não verificado exaustivamente nesta sessão).
- Sem DDL — correção de lógica pura de classificação, não de schema nem de dado persistido (os dados no
  banco já estão corretos; o defeito é só na leitura/cálculo).
- Domínio relacionado: este NÃO é da mesma classe de PP-053/057/058/060/062 (resolução de atleta/clube
  duplicado) — confirmado nesta sessão que `clubId` dos 7 atletas já é o correto/ativo. É uma classe nova:
  falso positivo de detecção de W.O. por heurística de placar. Candidato a domínio nomeado em
  `DOMAIN_MATURITY.md` se recorrer (primeira ocorrência conhecida).

## Fora de escopo

- Investigação/correção das outras 12 categorias de grupo único que já batem certo (PP-063 já confirmou
  que a maioria funciona) — só as 5 categorias com atleta ausente confirmado.
- Saneamento de duplicação de `Match` (941 candidatos elegíveis, script PP-055) — achado colateral da
  PP-063, sem impacto no ranking (já comprovado), tratado como pendência separada, não nesta Spec.
- Saneamento dos 3 pares de `clubId` duplicados (Academia Ping Drive, Yoshida TT, Salinas) — achado
  colateral da PP-063, mesma classe de PP-053/057/058/060/062, não nesta Spec.
- Divergência de badges do resumo do evento entre local e produção (Inscrições/Partidas Previstas/WO
  diferentes) — pendência registrada por Leo para tratamento em sequência, Spec própria futura.
- Correção em produção — esta Spec trabalha em ambiente local/homologação; deploy é decisão separada de
  Leo.
