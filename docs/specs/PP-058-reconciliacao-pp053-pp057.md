## Rascunho — PP-058 — reconciliação de escopo PP-053 Item 2 vs PP-057

### CAT — Rodada 1 (2026-09-19, Claude)

## Contexto / evidência

Leo pediu verificação de necessidade real de PP-053 Item 2 (PR #56, aberto) e PP-057 (Spec pronta,
não implementada) antes de prosseguir. Leitura direta de ambos os artefatos revelou sobreposição
parcial de domínio (mesmos clubes físicos "vencedores"), mas com **IDs de clube perdedor diferentes**:

| Clube físico | Vencedor (comum às duas Specs) | Perdedor — PP-053 Item 2 | Perdedor — PP-057 |
|---|---|---|---|
| ACADEMIA PING DRIVE LTDA | `136` | `205` | `207` |
| TENIS DE MESA SALINAS -TDMS | `171` | `198` | `209` |
| YOSHIDA TT (...) | `170` | `206` | `208` |
| MARDEY TT / APANB | `204` | `187` | — (não aparece em PP-057) |

PP-053 Item 2 (`scripts/pp-053-merge-clubs.ts`, commit `de6cfed`, PR #56): escopo **global**, sem
filtro de evento — consolida os 4 pares em qualquer evento onde aparecem, com tratamento completo de
`match_participants`, `athlete_aliases`, `event_athlete_links` (FK real confirmada por query contra
`cbtm_homolog` nesta mesma sessão).

PP-057 (`docs/specs/PP-057-saneamento-clubes-atletas-duplicados-evento59.md`): escopo **restrito ao
evento 59**, 3 pares, clubes perdedores **criados em 2026-09-18** (mesmo dia da investigação do P0
PP-056) — ou seja, posteriores ao mapeamento original da PP-053, que foi feito antes dessa data.

## Hipótese técnica

Os clubes perdedores da PP-057 (`207`, `208`, `209`) provavelmente **não existiam** quando a Spec
PP-053 foi escrita — são duplicatas novas, geradas pelo mesmo bug de causa raiz (sufixo de UF variando
entre capturas), no mesmo dia em que o P0 da PP-056 ocorreu. Isso é consistente com a cronologia: a
correção de causa raiz da PP-053 (PR #52, `normalizeClubName` unificando sufixo) só foi mergeada às
23:53 de 18/09 — qualquer captura do worker **antes** desse horário, no evento 59, podia ainda gerar
clube duplicado pelo bug antigo. Os clubes `207/208/209` são candidatos a serem exatamente esse
subproduto: duplicatas geradas entre a captura que criou o problema original e o merge da correção.

**Não confirmado ainda por query** — é hipótese, não fato. Precisa validação antes de qualquer decisão
de execução.

## Ambiguidades

**[PENDENTE: A] Os pares da PP-057 são um subconjunto novo (gerado depois do mapeamento da PP-053) ou
há erro de mapeamento em uma das duas Specs?**
Verificação proposta: query `SELECT id, name, normalized_name, created_at FROM clubs WHERE id IN
(205,206,187,198,207,208,209)` contra produção — comparar `created_at` de cada perdedor com o horário
do merge da PP-053 (2026-09-18 23:53:26) e com os timestamps dos runs ERROR do P0 (18:30–23:24).

**[PENDENTE: B] Se PP-053 Item 2 rodar primeiro (escopo global, 4 pares) e depois PP-057 rodar
(escopo evento 59, 3 pares diferentes), há dependência de ordem ou conflito de dado?**
Como os IDs perdedores não se sobrepõem entre as duas Specs, rodar as duas em sequência não parece
colidir diretamente — mas ambas escrevem em `match_participants`/`athlete_aliases`/
`event_athlete_links` para o mesmo conjunto de clubes vencedores (`136`, `170`, `171`), o que pode
gerar corrida se rodadas em paralelo ou fora de ordem.

**[PENDENTE: C] MARDEY TT/APANB (par 204/187) da PP-053 não aparece na varredura da PP-057 — a
varredura da PP-057 (restrita ao evento 59) simplesmente não encontrou esse par no evento 59, ou é um
sinal de que a varredura de um dos dois documentos está incompleta?**

## Proposta de abordagem

1. Rodar query de diagnóstico (item A) antes de qualquer `--execute` de qualquer uma das duas Specs.
2. Se confirmado que são gerações diferentes (PP-053 = duplicatas antigas/globais, PP-057 = duplicatas
   novas geradas no dia do incidente, restritas ao evento 59): as duas Specs são complementares, não
   conflitantes — mas a ORDEM importa. Recomendação técnica preliminar: rodar PP-053 Item 2 primeiro
   (já tem PR aberto, dry-run validado, escopo mais amplo e mais antigo), confirmar produção estável,
   só depois implementar e rodar PP-057 (que hoje só existe como Spec, sem script ainda).
3. Se qualquer coincidência de ID aparecer entre as duas listas (não há hoje, mas confirmar de novo
   após re-consolidação), interromper e escalar antes de qualquer `--execute`.

## Impacto técnico hipotético
- Nenhuma mudança de código nesta rodada — é reconciliação de escopo entre duas Specs de dado.
- PP-057 ainda não tem script implementado; PP-053 Item 2 já tem (PR #56, aguardando homologação/merge).

## DoD preliminar
- Query de diagnóstico executada e resultado documentado nesta seção.
- Decisão de ordem de execução registrada e aprovada por Leo.
- Nenhum `--execute` roda até esta reconciliação fechar.

---

### CAT — Rodada 3 (2026-09-19, Claude) — fechamento da reconciliação

## Resolução dos PENDENTE

**[RESOLVIDO: A]** Os 7 IDs perdedores originais de PP-053 Item 2 (205,187,198,206) e PP-057
(208,209,207) foram confirmados removidos de `clubs` por leitura direta (0 linhas) — merges já
executados em produção por via não documentada nesta sessão (fora do gate formal de `--execute`
autorizado até aqui). Verificação subsequente confirmou que **10 pares de clube duplicado diferentes**
seguem ativos em produção hoje: `132/211, 133/214, 134/212, 137/216, 138/215, 139/210, 144/219,
146/218, 170/213, 204/217` — nenhum desses IDs coincide com as listas originais de PP-053/PP-057.

**[RESOLVIDO: novo] Os 10 pares são resíduo antigo ou lacuna ativa de causa raiz?**
Verificado por `created_at` de todos os 20 IDs: os 10 "novos" de cada par foram criados em
2026-09-19 00:52:56–00:52:57 UTC — **2 horas antes** do merge da correção PP-053 (02:53:26 UTC).
Guarda `SELECT * FROM clubs WHERE created_at > '2026-09-19 02:53:26'` retornou 0 linhas — nenhum
clube foi criado em produção depois da correção. **Conclusão: resíduo antigo, causa raiz já corrigida
e eficaz. Não precisa de nova investigação de causa raiz — só saneamento retroativo.**

**[RESOLVIDO: B]** Sem coincidência de ID entre as duas listas originais nem com os 10 pares atuais —
não há risco de dupla-execução entre PP-053 Item 2 (PR #56) e o novo saneamento, mas ambos os targets
de PP-053/PP-057 já não existem mais fisicamente, então **as duas Specs originais estão obsoletas**
(alvo já consolidado por via não rastreada) e devem ser fechadas sem merge/implementação adicional.

**[RESOLVIDO: C]** MARDEY TT/APANB (par 204/187 da PP-053) não aparecia na varredura da PP-057 porque
essa é restrita ao evento 59 — não é inconsistência, é escopo diferente por design.

## Decisão final

1. **PP-053 Item 2 (PR #56)**: fechar sem merge — os 4 pares que mapeava não existem mais (já
   consolidados). Script `scripts/pp-053-merge-clubs.ts` fica de referência, não será executado.
2. **PP-057**: fechar sem implementação — os 3 pares que mapeava (evento 59) não existem mais.
3. **Nova Spec necessária**: saneamento retroativo dos 10 pares atuais, escopo global (não restrito a
   evento 59 — verificar se os 10 pares aparecem em outros eventos além do 59 antes de fechar escopo).
   Variações de sufixo a cobrir no matching: `-PA`, `- PA`, `(PA)`, ausente — mais amplo que o padrão
   original tratado por `CLUB_UF_SUFFIX_PATTERN`/`normalizeClubName`, que já é aplicado corretamente
   nos dois pontos de criação de clube (`ensureClub`, verificado em `upsert.service.ts:1113,4406` —
   sem lacuna de código encontrada).
4. Causa raiz não precisa de nova correção — já está ativa e eficaz desde 2026-09-18 23:53:26 (Belém).

**Fechamento do ciclo:** ✅ aguardando aprovação explícita de Leo para: (a) fechar PR #56 e a Spec
PP-057 sem merge/implementação, (b) abrir nova Spec (PP-059) de saneamento retroativo dos 10 pares
atuais.


