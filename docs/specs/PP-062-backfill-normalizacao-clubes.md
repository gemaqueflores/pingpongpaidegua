## SPEC ATIVA — PP-062 — v3
<!-- Única seção de instrução. Codex implementa exclusivamente contra este bloco. -->
ID: PP-062 | Projeto: PingPong PaiD'egua | Branch: fix/pp-062-backfill-normalizacao-clubes
Criada por: Claude | Data: 2026-09-19 | Versão da Spec: v3

**Correção de escopo v2→v3 (2026-09-19).** Homologação formal do PR #60 (agent revisor independente)
bloqueou ❌ o script `scripts/pp-062-backfill-normalizacao-clubes.ts` por Q3 — implementação faz
descoberta dinâmica ampla (57 clubes com normalização pendente: 10 pares + 47 atualizações isoladas
sem colisão), contradizendo o texto v2 abaixo que restringia a lista fixa de 10 pares, sem declaração
de desvio no momento da implementação. Leo decidiu, informado do bloqueio: **aceitar a descoberta
dinâmica como escopo válido** (é tecnicamente mais completa e já tem dry-run real contra produção sem
erros), mas **exigir novo dry-run completo cobrindo os 57 clubes** (não só os 10 já testados) antes de
qualquer `--execute` — o dry-run existente no HISTÓRICO cobre só os 10 pares conhecidos, não valida o
conjunto ampliado que o script atual pode de fato alterar.

**P0 — evento 4TMB26 ao vivo, duplicata visível em `/eficiencia` e `/events/59` confirmada por Leo
via screenshot.** Causa raiz completa investigada e confirmada por evidência direta em produção
(timeline via `.git/logs/HEAD`, `docker history`, `docker inspect`, `journalctl`, comparação de rows
no Postgres — ver `## HISTÓRICO` abaixo).

**Escopo revisado em v2, decisão explícita de Leo em 2026-09-19 (dois ciclos de decisão):**
1. Leo perguntou por que `ensureClub` não considera a possibilidade de o clube já existir com OU sem
   sufixo de UF antes de criar um novo — em vez de só backfill de dado, corrigir também o código para
   evitar recorrência futura.
2. Claude apontou que busca tolerante sozinha (sem backfill) não resolve os 10 pares já existentes,
   porque `/eficiencia` agrega por `club.id` cru (`rowsByClubId`, `apps/api/src/user/user.service.ts:~3148`)
   — a tela continuaria exibindo duplicata para os 10 pares já criados, mesmo após a correção de código.
3. Leo decidiu, com essa informação: fazer **os dois agora** — busca tolerante no `ensureClub`
   (previne duplicata nova) **e** backfill restrito aos 10 pares já conhecidos e validados por dry-run
   real contra produção (`ready=true` em todos, PP-060). **Backfill geral (qualquer clube fora desses
   10, ainda não descoberto) fica para depois do evento 4TMB26 concluir** — não fazer descoberta
   dinâmica ampla nesta rodada, é a v1 desta Spec que foi substituída.

## Skills Codex a ativar
- florestech-implementacao — obrigatória.
- security-review-agent: sim — escrita real em produção durante evento ao vivo, fusão de clube +
  atleta em múltiplas tabelas com FK; revisar controle de acesso, transação única, dry-run obrigatório
  como pré-condição, ausência de SQL cru concatenado.
- e2e-playwright-agent: não — não há fluxo de UI a testar diretamente (efeito é validado via query/
  screenshot pós-execução).
- report-builder-agent: sim — critério de aceitação exige relatório antes/depois estruturado por par,
  e confirmação visual pós-fix das rotas públicas afetadas.

## Causa raiz (confirmada por evidência, não hipótese)

**Causa imediata:** `ensureClub` (`apps/worker/src/pipeline/upsert.service.ts:2099`) busca clube
existente por `normalized_name` exato (`prisma.club.findUnique({ where: { normalizedName } })`). A
PP-053 corrigiu `normalizeClubName` (`packages/shared/src/index.ts:784`) para remover sufixo de UF ao
calcular esse valor em escritas **novas**, mas os clubes já existentes no banco (criados antes da
correção, ex. fevereiro/2026) mantêm o `normalized_name` **antigo** persistido (com o sufixo ainda
dentro do texto, ex. `"para clube - pa"`). Quando o worker roda hoje, calcula corretamente
`"para clube"` (sem sufixo) para o nome capturado, busca por esse valor exato, não encontra o
registro antigo (que tem `"para clube - pa"`) e cria um clube novo. A constraint `UNIQUE(normalized_name)`
nunca impede isso porque os dois valores são strings literalmente diferentes.

**Causa sistêmica:** a PP-053 corrigiu a função de normalização para escrita futura, mas não incluiu
backfill/migração dos dados legados. Mudança de regra de normalização sem backfill é uma classe de
risco genérica — sempre que uma regra de normalização muda, todo dado já persistido sob a regra antiga
precisa ser recalculado, ou o problema volta a cada novo registro que colidir com um antigo.

**Evidência de timing (descarta hipótese de bug de deploy):** o worker que criou os 10 clubes
duplicados em 2026-09-19 00:52:56-57 UTC já rodava a imagem construída a partir do commit da PP-053
(iniciado às 00:02:12 UTC, 51 minutos antes) — o código corrigido já estava ativo havia quase 1 hora.
Não foi atraso de deploy; é lacuna de dado legado não reconciliado.

**Padrão:** mesma classe de PP-055/PP-057/PP-060 (saneamento retroativo pós-correção de causa raiz).
Diferente de uma correção só-de-dado: esta Spec também ataca a causa sistêmica no código (busca
tolerante), reduzindo o risco de recorrência para qualquer clube legado ainda não descoberto, mesmo
sem cobrir todos eles com backfill nesta rodada (isso fica para depois do 4TMB26).

## Objetivo
1. **Busca tolerante em `ensureClub`** (`apps/worker/src/pipeline/upsert.service.ts:2099`): antes de
   criar um clube novo, além da busca exata por `normalized_name`, também buscar por variações
   com/sem sufixo de UF (reaproveitando `CLUB_UF_SUFFIX_PATTERN`/`normalizeClubName`,
   `packages/shared/src/index.ts:782-788`) — se encontrar um clube existente cujo nome, após aplicar a
   mesma normalização, colide com o nome sendo processado, reusar esse clube em vez de criar um novo.
   Isso previne duplicata nova mesmo contra dado legado ainda não corrigido.
2. **Backfill restrito aos 10 pares já conhecidos** (mapeados em `docs/specs/PP-060-saneamento-clubes-duplicados-residuo.md`,
   dry-run já validado contra produção real nesta sessão, `ready=true` em todos): fundir esses 10 pares
   específicos, mesma lógica/transação de `scripts/pp-060-saneamento-clubes-residuo.ts` (lista fixa de
   IDs, não descoberta dinâmica ampla nesta rodada).
3. Confirmar visualmente, após as duas correções, que `/eficiencia`, `/events/59` e `/events/61` não
   exibem mais os 10 pares já conhecidos.

**Fora desta rodada (adiado para depois do 4TMB26):** descoberta dinâmica de outros clubes divergentes
além dos 10 já mapeados — a busca tolerante do item 1 já reduz o risco de recorrência para clubes ainda
não descobertos, tornando essa descoberta ampla menos urgente até o evento concluir.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

### Cenário 1 — Busca tolerante evita duplicata nova (worker)
DADO um clube legado existente com `normalized_name` calculado pela regra antiga (com sufixo de UF)
QUANDO o worker processa um registro (inscrição ou partida) cujo nome de clube, após `normalizeClubName`,
bate com esse clube legado somente depois de também remover/considerar o sufixo na comparação
ENTÃO `ensureClub` reusa o clube legado existente (atualizando seu `name`/`normalized_name` se
necessário) em vez de criar um clube novo

### Cenário 2 — Busca tolerante não quebra o caminho já correto
DADO um clube cujo `normalized_name` já está no formato novo (sem sufixo, calculado pela regra atual)
QUANDO o worker processa um registro para esse mesmo clube
ENTÃO `ensureClub` encontra e reusa o clube pela busca exata já existente, sem alteração de
comportamento

### Cenário 3 — Backfill funde os 10 pares conhecidos
DADO os 10 pares já mapeados e validados por dry-run (PP-060, `ready=true` em todos)
QUANDO o script de backfill roda em modo `--execute`
ENTÃO os atletas/relações do clube duplicado são realocados para o clube vencedor, o clube duplicado é
removido, preservando histórico de partidas, aliases e vínculos (mesmo comportamento de PP-060/PP-057)

### Cenário 4 — Dry-run obrigatório antes de qualquer escrita
DADO o script de backfill rodando sem `--execute`
QUANDO executado contra produção
ENTÃO nenhuma linha é alterada — apenas relatório completo (todos os clubes com normalização
pendente, pares a fundir e atualizações isoladas) e contagens

### Cenário 5 — Confirmação visual pós-fix
DADO a execução real concluída (`--execute` do backfill + deploy da busca tolerante)
QUANDO Leo ou Claude consulta `/eficiencia`, `/events/59` e `/events/61`
ENTÃO nenhum clube duplicado (dos descobertos pelo script) aparece mais nessas rotas

## Critérios de aceitação
- `ensureClub` passa a considerar variação com/sem sufixo de UF antes de decidir criar clube novo
  (busca tolerante), sem alterar o comportamento já correto para clubes já normalizados. **[✅ aprovado
  em homologação independente — PR #60]**
- Script de backfill usa descoberta dinâmica (não lista fixa) — decisão explícita de v3, corrigindo o
  texto v2 anterior. Cobre todos os clubes com `normalized_name` divergente do valor recalculado por
  `normalizeClubName`, incluindo os 10 pares já conhecidos e as atualizações isoladas sem colisão.
- **Novo dry-run completo obrigatório antes de qualquer `--execute`**: o dry-run já realizado nesta
  sessão cobre só os 10 pares conhecidos por evidência anterior — precisa de nova rodada contra
  produção real confirmando os 57 clubes (10 pares + 47 isolados) com o script na versão atual do PR,
  sem erros, sem par `ready=false` inesperado.
- Dry-run executado contra produção real (não homologação — já confirmado neste incidente que
  `cbtm_homolog` diverge e não serve como base de validação) antes de qualquer `--execute`.
- Relatório antes/depois por par/atualização: clube vencedor, clube fundido (quando aplicável),
  contagem de atletas, colisões, linhas reatribuídas em
  `match_participants`/`athlete_aliases`/`athlete_categories`/`event_athlete_links`.
- `--execute` do backfill roda em uma única transação (BEGIN/COMMIT via `$transaction`).
- Após `--execute`: confirmação visual (screenshot ou leitura de API) de que `/eficiencia`,
  `/events/59` e `/events/61` não exibem mais clube duplicado.
- Scanner de segurança sem achados críticos/altos.

## Fora de escopo
- `style-src` da CSP, PP-059, PP-052 — assuntos não relacionados.
- Descoberta de duplicata por critério diferente de sufixo de UF (ex. erro de digitação, abreviação
  distinta) — fora de escopo, é outra classe de problema.

## Impacto técnico
- Arquivos modificados: `apps/worker/src/pipeline/upsert.service.ts` (`ensureClub` + novo método
  `findClubByTolerantNormalization`) — busca tolerante antes da criação de clube novo. **Aprovado em
  homologação independente.**
- Arquivo criado: `scripts/pp-062-backfill-normalizacao-clubes.ts` — descoberta dinâmica de todos os
  clubes com normalização divergente, fusão de pares e atualização isolada sem colisão, tudo dentro de
  transação única no modo `--execute`.
- Arquivos que NÃO devem ser tocados: `packages/shared/src/index.ts` (a função `normalizeClubName` em
  si já está correta — a mudança é em COMO `ensureClub` usa/compara, não na função de normalização).
- DDL: nenhuma — só `UPDATE`/reatribuição de FK em dados existentes (backfill) + lógica de leitura
  adicional no worker (busca tolerante).
- Contrato de API: nenhum alterado.
- **Relação com PP-060 (PR #58)**: PP-060 cobre os mesmos 10 pares com lista fixa e já tem dry-run
  validado contra produção (`ready=true` em todos). PP-062 reaproveita essa mesma lista e lógica de
  fusão, adicionando a correção de código (busca tolerante) que PP-060 não cobria — ao aprovar PP-062,
  fechar PR #58 sem merge (mesmo texto de justificativa dos fechamentos anteriores), referenciando esta
  Spec como sucessora.

## Plano de testes
### Cobertura geral
- camadas: unitário (busca tolerante em `ensureClub` + lógica de fusão do backfill) + script de
  integração (dry-run real contra produção)
- arquivos de teste: `apps/worker/test/ensure-club-tolerant-lookup.test.ts` +
  `scripts/test/pp-062-backfill-clubes-residuo.test.ts`
COBERTURA: regressão=2 corretude=2

### T-U-01 [corretude] — busca tolerante reusa clube legado com sufixo divergente
DADO um clube legado com `normalized_name` no formato antigo (com sufixo de UF)
QUANDO `ensureClub` processa um nome que normaliza para a versão sem sufixo
ENTÃO reusa o `club.id` existente, não cria um novo

### T-U-02 [regressão] — busca tolerante não altera caminho já correto
DADO um clube cujo `normalized_name` já está no formato novo (sem sufixo)
QUANDO `ensureClub` processa um nome para esse mesmo clube
ENTÃO o comportamento é idêntico ao existente antes desta Spec (mesmo `club.id` reusado pela busca
exata, sem side-effect novo)

### T-I-01 [regressão] — dry-run do backfill não escreve nada
DADO o script de backfill rodando sem `--execute` contra o banco de produção
QUANDO concluído
ENTÃO contagem de `clubs`/`athletes` antes e depois é idêntica

### T-I-02 [corretude] — backfill funde exatamente os 10 pares esperados
DADO o script de backfill rodando em `--execute` (ambiente de teste/homologação com fixture
equivalente aos 10 pares reais)
QUANDO concluído
ENTÃO os 10 clubes duplicados são removidos, os 10 vencedores absorvem os atletas/relações
correspondentes, e nenhum outro clube fora da lista é alterado

### Comando para rodar a suite
`npx tsx scripts/pp-062-backfill-clubes-residuo.ts --dry-run` (produção, via container do worker,
mesmo método usado no dry-run de PP-060 nesta sessão — `DATABASE_URL` nativo do container, não
sobrescrito) + `npm --prefix apps/worker test` para a suite de `ensureClub`

---
## HISTÓRICO — informações adicionais (consulta, não instrução)

### Origem (2026-09-19) — P0 escalado durante evento 4TMB26

Leo reportou visualmente (screenshot de `/eficiencia` e `/events/59` em produção) clube duplicado
durante o evento ao vivo. Investigação nesta sessão:

1. Confirmado via SSH que os 10 pares mapeados em PP-060 seguem ativos em **produção** (não só
   homologação) — `docs/specs/PP-058-reconciliacao-pp053-pp057.md` havia concluído erroneamente que
   era resíduo anterior à correção, comparando com o timestamp de merge errado (PP-056 em vez de
   PP-053).
2. Dry-run de `scripts/pp-060-saneamento-clubes-residuo.ts` rodado contra produção real (não
   `cbtm_homolog`, que diverge) confirmou os 10 pares `ready=true`, sem erros — mas Leo perguntou pela
   causa raiz real antes de autorizar `--execute`.
3. Investigação de timeline (git reflog + docker history/inspect + journalctl no host de produção)
   confirmou que o worker que criou os 10 duplicados às 2026-09-19 00:52 UTC **já rodava o código
   corrigido da PP-053** (deployado 51 minutos antes) — não é bug de deploy.
4. Comparação direta das 10 rows novas com clubes de fevereiro/2026 confirmou: cada duplicata nova tem
   um gêmeo antigo com `normalized_name` calculado pela regra pré-PP-053 (sufixo de UF ainda no texto).
   A causa real é ausência de backfill dos dados legados — a função de normalização está correta, mas
   nunca foi reaplicada aos registros já existentes.
5. Leo decidiu: backfill geral agora (não só os 10 pares conhecidos), aceitando risco de escrita em
   produção durante o evento, dado que o problema é estrutural e recorrente sem essa correção.


### Encerramento documental — 2026-10-16

Execução histórica por Leo em 2026-09-19 registrada em `../sessions/2026-09-19-PP058-PP059-PP060-PP062-P0-clubes-duplicados.md`: 10 clubes fundidos, 141 atletas mesclados, 57 normalizações, clubs 73→63 e athletes 2676→2535. Trata-se de evidência documental histórica, não execução realizada pelo Codex nesta rodada.

EXECUTADA em 2026-10-16: consulta SQL em transação READ ONLY na produção cbtm encontrou zero grupos duplicados, 63 clubes e 2747 atletas. Conferência complementar com a normalização JavaScript exata encontrou zero duplicatas e zero clubes com normalized_name divergente. Saída completa em `../sessions/2026-10-16-retorno-codex-pp062-worktrees.md`.

Conforme orientação corrigida, passo 2.1: sem ação de dados necessária; nenhum dry-run ou execute nesta rodada. Encerramento registrado em estudos/SESSION_STATE.md. Codex registra evidência, sem emitir parecer formal.
