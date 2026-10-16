## SPEC ATIVA — PP-057 — v1
<!-- Única seção de instrução. Codex/Claude implementador implementa exclusivamente contra este bloco. -->
ID: PP-057 | Projeto: PingPong PaiD'egua | Branch: chore/pp-057-saneamento-clubes-atletas-evento59
Criada por: Claude | Data: 2026-09-18 | Versão da Spec: v1

**✅ Aprovada por extensão da autorização de operação autônoma de Leo em 2026-09-18** ("prossiga de forma
autônoma e decida sempre com base em evidências sólidas... você precisa concluir") — Spec decorrente
direta da causa raiz completa investigada e documentada em `PP-056-fix-event-athlete-links-constraint.md`.
Implementação e dry-run liberados; **execução real (`--execute`) em produção permanece bloqueada**,
exigindo autorização explícita e separada de Leo, conforme seção "Autorização de execução" abaixo — essa
exigência não é coberta pela autorização de operação autônoma.

**Dependência: PP-056 v2 mergeada e deployada antes desta Spec ser implementada.** Sem a correção de
normalização em `upsert.service.ts:1559/1585`, qualquer saneamento manual seria vulnerável a nova
duplicação na próxima captura do worker que processar um jogo com o formato de sufixo divergente.

**Execução em produção requer autorização explícita e separada de Leo, distinta da aprovação desta
Spec.** Aprovar esta Spec autoriza implementar a ferramenta de saneamento (script + dry-run) e rodá-la em
dry-run; não autoriza a fusão real de clubes/atletas em produção. Ver seção "Autorização de execução".

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — script opera fusão/remoção transacional de dados em produção (clubes,
  atletas, e todas as tabelas com FK para `athletes.id`); revisar controle de acesso, ausência de SQL
  cru concatenado, dry-run como padrão real.
- e2e-playwright-agent: não — não há fluxo de UI.
- report-builder-agent: sim — critério de aceitação exige relatório antes/depois estruturado.

## Objetivo
Fundir, no evento 59, **todos** os pares de clube duplicado detectados (mesmo clube físico, registros
divergindo só por sufixo de UF no nome) de volta ao clube original de cada par, e consolidar os atletas
duplicados correspondentes (mesma pessoa, `athlete_id` novo sob o clube duplicado) de volta aos seus
registros originais — preservando todo o histórico de jogos, inscrições e vínculos já associados a cada
`athlete_id`, sem perder dado de nenhum dos lados.

## Contexto
Investigação read-only em produção (evidência dinâmica, `docs/specs/PP-056-fix-event-athlete-links-constraint.md`,
seção `## HISTÓRICO`, mais varredura complementar desta sessão) confirmou **3 pares** de clube duplicado
no evento 59, todos com o mesmo padrão (sufixo de UF ausente vs. presente no nome normalizado):

| Par | Clube original | Clube duplicado | Atletas originais | Atletas duplicados |
|---|---|---|---|---|
| 1 | `id=170` "YOSHIDA TT ... (PA)" (desde 2026-02-24) | `id=208` "YOSHIDA TT ... - PA" (criado 2026-09-18) | 17 | 15 |
| 2 | `id=171` "TENIS DE MESA SALINAS -TDMS" | `id=209` "TENIS DE MESA SALINAS -TDMS - PA" | 7 | 7 |
| 3 | `id=136` "ACADEMIA PING DRIVE LTDA" | `id=207` "ACADEMIA PING DRIVE LTDA - PA" | 36 | 36 |

Total: 68 atletas duplicados no evento 59. Confirmado por `SELECT` direto comparando `name_normalized`
idêntico entre os dois `club_id` de cada par — 100% de correspondência 1:1 em todos os 3 pares (nenhum
"órfão" sem duplicata correspondente). Varredura feita agrupando `clubs.normalized_name` (dos clubes com
pelo menos 1 atleta no evento 59) pelo valor obtido após aplicar a mesma remoção de sufixo UF de
`normalizeClubName` — nenhum outro clube do evento 59 tem par duplicado além destes 3.

A PP-056 v2 corrige a causa (evita nova duplicação), mas não desfaz a duplicação já existente — esta Spec
é o saneamento correspondente, **generalizado para tratar qualquer par de clube duplicado detectado no
evento**, não apenas o par Yoshida usado como exemplo original da investigação.

Diferente da PP-055 (que apagava linhas de `matches` órfãs, sem consumidor externo), aqui a fusão é mais
delicada: **atletas têm relações em múltiplas tabelas** (`match_participants`, `athlete_categories`,
`athlete_aliases`, `event_athlete_links`) que precisam ser realocadas do `athlete_id` duplicado para o
`athlete_id` original antes do duplicado poder ser removido, sem violar nenhuma constraint única dessas
tabelas.

## Causa raiz
Não aplicável no formato "imediata/sistêmica" — esta Spec não corrige um bug de código (isso é a PP-056),
é uma intervenção pontual de limpeza de dado já duplicado por um bug já identificado e corrigido em Spec
separada.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### C1 — Dry-run identifica pares clube/atleta duplicados sem alterar nada
DADO o evento 59 com o clube 170/208 e os 15 pares de atletas duplicados
QUANDO o script roda em modo dry-run (padrão, sem flag de execução real)
ENTÃO produz relatório listando: o par de clubes identificado como duplicata, os 15 pares de atletas
(qual `athlete_id` seria mantido — o mais antigo por `created_at` — e qual seria fundido/removido), e
quantas linhas em cada tabela dependente (`match_participants`, `athlete_categories`, `athlete_aliases`,
`event_athlete_links`) seriam realocadas — nenhuma linha é alterada no banco.

### C2 — Identificação de clubes duplicados é determinística, específica ao evento, e cobre múltiplos pares
DADO clubes de outros eventos com nomes parecidos mas não relacionados aos pares duplicados do evento 59,
e múltiplos pares de clube duplicado dentro do mesmo evento (confirmado: 3 pares reais no evento 59 —
Yoshida 170/208, Salinas 171/209, Ping Drive 136/207)
QUANDO o script roda escopado ao evento 59
ENTÃO não considera clubes de outros eventos como candidatos — a comparação de "mesmo clube físico" é
feita apenas entre clubes que têm pelo menos um atleta no evento pedido, comparando
`normalizeClubName(name)` de ambos (reaproveitando a função já corrigida pela PP-056); processa **todos**
os pares detectados no evento na mesma execução, não apenas o primeiro encontrado.

### C3 — Fusão de atleta realoca todas as tabelas dependentes antes de remover o duplicado
DADO um par de atletas duplicados (`kept=6863`, `duplicate=7098`) com registros em
`match_participants`, `athlete_aliases`, `athlete_categories` associados ao `duplicate`
QUANDO o script roda em modo de execução real
ENTÃO todos os registros dessas tabelas que referenciam `duplicate` são realocados para referenciar
`kept` (respeitando constraints únicas — ex.: se `kept` já tem uma linha para a mesma combinação que o
`duplicate` também tem, a linha do `duplicate` é descartada, não duplicada por cima), e só então o
registro `duplicate` em `athletes` é removido.

### C4 — Conflito de dados entre kept e duplicate é reportado, não decidido arbitrariamente
DADO um caso em que `kept` e `duplicate` têm valores diferentes para o mesmo campo relevante (ex.:
`rankingPoints`, `ratingPoints` divergentes; ou ambos têm uma linha para a mesma categoria em
`athlete_categories` com `registrationStatus` diferente)
QUANDO o script avalia esse par
ENTÃO aplica uma regra determinística e documentada (preferir o valor não-nulo mais recente por
`updated_at`; para pontuação, preferir o valor mais alto) e **registra no relatório exatamente qual valor
foi escolhido e por quê** — nunca descarta silenciosamente informação sem relatar.

### C5 — Clube duplicado é removido somente após todos os atletas serem fundidos
DADO todos os 15 atletas do clube 208 já fundidos ao clube 170 (C3 concluído para todos)
QUANDO o script conclui a fusão de atletas
ENTÃO verifica que nenhum atleta restante referencia `club_id=208` antes de remover o registro do clube
208 — nunca remove um clube que ainda tem atletas vinculados (proteção contra remoção prematura).

### C6 — Read-model do evento 59 é invalidado após a fusão
DADO a execução real concluída com fusões efetivas
QUANDO o script termina
ENTÃO invoca `clearEventReadModelCaches` (já exportado pela PP-055, `apps/worker/src/pipeline/read-model-cache.ts`)
para o evento 59, para que a próxima leitura pública reflita o estado já saneado.

## Critérios de aceitação
- Modo dry-run é o padrão; execução real exige flag explícita adicional.
- Escopo sempre restrito a um `eventId` passado explicitamente como parâmetro.
- Identificação de clube duplicado usa `normalizeClubName` (mesma função corrigida pela PP-056), nunca
  comparação de string exata do nome bruto.
- Nenhum dado de `match_participants`/`athlete_categories`/`athlete_aliases`/`event_athlete_links` é
  perdido na fusão — tudo que apontava para o `athlete_id` duplicado passa a apontar para o `athlete_id`
  mantido (C3).
- Conflito de valores entre kept/duplicate nunca é resolvido silenciosamente (C4).
- Clube duplicado só é removido depois que todos os atletas dependentes dele foram fundidos (C5).
- Read-model cache do evento é invalidado após fusões efetivas (C6).
- Relatório antes/depois é produzido em toda execução, dry-run ou real.
- Nenhum dado de outro evento é tocado.

## Fora de escopo
- Qualquer outro evento além do 59 nesta execução.
- Detecção automática/periódica de duplicatas futuras — Spec futura, registrada como pendência na
  PP-056.
- Mudança de comportamento do worker (já coberta pela PP-056).
- Fusão de duplicatas que não sejam do padrão clube-com-sufixo-UF-divergente identificado nesta
  investigação — se houver outro tipo de duplicata no evento 59 não relacionado a este padrão, fica fora
  do escopo desta Spec.

## Impacto técnico

### Arquivos a criar/modificar
- `scripts/pp-057-saneamento-clubes-atletas-duplicados.ts` (novo) — script standalone, aceita
  `--event-id` (obrigatório), `--execute` (opcional; ausência = dry-run), reaproveita `normalizeClubName`
  (`packages/shared/src/index.ts`) e `clearEventReadModelCaches` (`apps/worker/src/pipeline/read-model-cache.ts`,
  já exportado pela PP-055).
- Novo arquivo de teste: `apps/worker/test/pp-057-saneamento-clubes-atletas-duplicados.test.ts` (seguir
  padrão de `apps/worker/test/pp-055-saneamento-matches-duplicados.test.ts`).

### Arquivos que NÃO devem ser tocados
- Qualquer arquivo de `apps/api` ou `apps/web`.
- `apps/worker/src/pipeline/upsert.service.ts` — já corrigido pela PP-056; esta Spec não altera lógica
  de captura/upsert, só limpa dado histórico já persistido.

### DDL / migração
Nenhuma — todas as tabelas envolvidas já suportam a realocação via `UPDATE` simples de FK.

### Autorização de execução
1. Implementação do script + testes: autorizada por esta Spec após aprovação de Leo, como qualquer outra
   entrega.
2. Execução em modo dry-run contra o banco de produção: permitida como parte da homologação.
3. Execução real (`--execute`) contra o banco de produção: **exige mensagem explícita e separada de Leo
   autorizando a execução**, após o parecer ✅ desta Spec. Codex/agent implementador não executa
   `--execute` em produção por conta própria mesmo com a Spec aprovada.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: integração (script contra Postgres de teste, populado com cenário de duplicata
  real reproduzindo o caso do evento 59: 2 clubes + pares de atletas com registros em múltiplas tabelas
  dependentes)
- arquivos de teste a criar: `apps/worker/test/pp-057-saneamento-clubes-atletas-duplicados.test.ts`
- fixtures/mocks: nenhum mock de Prisma — banco de teste real
- COBERTURA: regressão=2 corretude=5 (T-I-02 isolamento entre eventos, T-I-06 clube não removido com
  atleta pendente — regressão de "não destruir dado saudável"; T-I-01, T-I-03, T-I-04, T-I-05, T-I-07
  cobrem corretude do comportamento novo)

### T-I-01 — dry-run identifica clube e atletas duplicados sem alterar o banco [corretude]
Camada: integração
DADO: banco de teste com 2 clubes (`normalizedName` diferindo só por sufixo UF) e 3 pares de atletas
duplicados entre eles, com registros em `match_participants` e `athlete_categories` para ambos os lados
QUANDO: script roda sem `--execute`
ENTÃO: nenhuma linha é alterada; relatório identifica corretamente o par de clubes e os 3 pares de
atletas, com o `athlete_id` mais antigo marcado como "seria mantido"

### T-I-02 — isolamento entre eventos [regressão]
Camada: integração
DADO: cenário de duplicata equivalente nos eventos 59 e 60
QUANDO: script roda com `--execute --event-id=59`
ENTÃO: duplicatas do evento 60 permanecem intactas

### T-I-03 — fusão realoca match_participants/athlete_categories/athlete_aliases/event_athlete_links [corretude]
Camada: integração
DADO: um par de atletas duplicados, cada um com pelo menos 1 registro em cada uma das 4 tabelas
dependentes
QUANDO: script roda com `--execute`
ENTÃO: todos os registros que referenciavam o `athlete_id` duplicado agora referenciam o `athlete_id`
mantido; nenhum registro foi perdido (contagem total por tabela antes = depois, somando kept+duplicate);
o registro do atleta duplicado em `athletes` não existe mais

### T-I-04 — conflito de valores é resolvido por regra documentada e relatado [corretude]
Camada: integração
DADO: um par de atletas duplicados com `rankingPoints` divergentes
QUANDO: script roda com `--execute`
ENTÃO: o atleta mantido fica com o valor determinado pela regra documentada (maior valor); o relatório
contém uma entrada explícita citando os dois valores originais e qual foi escolhido

### T-I-05 — clube duplicado é removido só depois de todos os atletas fundidos [corretude]
Camada: integração
DADO: um clube duplicado com múltiplos atletas dependentes
QUANDO: script roda com `--execute` e conclui a fusão de todos os atletas
ENTÃO: o clube duplicado não existe mais em `clubs`; nenhum atleta restante referencia esse `club_id`

### T-I-06 — clube não é removido se restar atleta não fundido (defensivo) [regressão]
Camada: integração
DADO: um cenário simulado onde a fusão de um atleta específico falharia (ex.: violação de constraint não
tratada)
QUANDO: script tenta remover o clube mesmo assim
ENTÃO: a remoção do clube é bloqueada/abortada — nunca remove um clube com atleta pendente vinculado

### T-I-07 — múltiplos pares de clube duplicado no mesmo evento são todos processados [corretude]
Camada: integração
DADO: banco de teste reproduzindo o cenário real do evento 59 — 3 pares de clube duplicado distintos
(ex.: clube A/A-PA, clube B/B-PA, clube C/C-PA), cada par com atletas duplicados próprios
QUANDO: script roda com `--execute --event-id=<evento>`
ENTÃO: os 3 pares são fundidos na mesma execução; `prisma.club.count` para o evento cai de 6 clubes
distintos para 3; nenhum atleta duplicado de nenhum dos 3 pares permanece

### Cobertura de falhas silenciosas
- Persistência: todos os T-I-* leem o estado pós-execução diretamente do Postgres (contagens e ids
  específicos), não confiam apenas no texto do relatório impresso pelo script.

### Categorias de cobertura mínima não aplicáveis
- Formulário/Cadastro, Edição por usuário final, Listagem/Busca, Autenticação/Autorização, Upload/Arquivo,
  Integração externa — [não aplicável — script standalone de manutenção de dados].
- Exclusão — coberta: T-I-05 (remoção de clube) e T-I-06 (bloqueio de remoção prematura).
- Regra de negócio — coberta: C1-C6 e T-I-01..07.

### Comando para rodar a suite
`npm --prefix apps/worker test`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### Origem
Spec derivada da investigação de causa raiz completa da PP-056 v2
(`docs/specs/PP-056-fix-event-athlete-links-constraint.md`, seção `## HISTÓRICO`), motivada pela pergunta
de Leo sobre por que não migrar/consolidar o ID do atleta em vez de só corrigir o sintoma. A investigação
confirmou que a consolidação de fato nunca aconteceu (clube e 15 atletas ficaram duplicados) e que a
correção de código sozinha (PP-056) não desfaz esse dado já existente — daí esta Spec de saneamento.
