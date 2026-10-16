# Sessão 2026-09-22 — PP-063 — Auditoria Troféu Eficiência 4TMB26 (evento 59/6054)

## Estado atual
Sessão de investigação/auditoria, sem código de produção editado e sem merge. Branch de trabalho não
alterada (`fix/pp-062-backfill-normalizacao-clubes` era a branch ativa no início, não tocada nesta sessão —
todo trabalho foi leitura, consulta ao banco local `cbtm_homolog`, e escrita apenas em `docs/specs/` e
`docs/evidence/`).

## Concluído nesta sessão
- Ciclo tripartite completo (CAT, 14 rodadas) documentado em `docs/specs/PP-063-auditoria-eficiencia-4tmb26.md`.
- Comparação do ranking por clube (Troféu Eficiência) do evento 4TMB26 contra os dados oficiais fornecidos
  por Leo (duas imagens da federação FTMPA) e a fonte pública do evento (`app.cbtm.org.br`).
- Rebuild da imagem Docker do worker local (estava desatualizada desde 18/09, sem o fix da PP-056).
- Diagnóstico dry-run de duplicação de `Match` (script PP-055) — 941 candidatos elegíveis identificados,
  confirmados como inofensivos ao ranking por clube (verificação com componentes reais de produção,
  cenário A vs. B, zero diferença de posição/medalha em 593 pares atleta/categoria).
- **Causa raiz confirmada nominalmente** das 3 divergências de clube (Pará Clube -150, APTM -150, BEL.TT
  -840 pontos): 7 atletas classificados em posição de pódio pela fonte oficial (GRUPOS/RESULTADOS via
  Chromium real) estão ausentes do nosso banco, em 5 categorias de "grupo único" pequeno.
- 10 de 13 clubes confirmados com ranking exato (zero divergência) — pipeline de cálculo de pontuação
  validado como correto.
- Manual do Tênis de Mesa CBTM 2026 e Regimento Interno CBTM indexados (poppler/pdftotext instalado via
  winget nesta sessão) como fonte normativa para as regras de formato de disputa/W.O./grupos.
- Spec corretiva aberta: `docs/specs/PP-068-fix-atletas-ausentes-grupo-unico.md` (CAT Rodada 1, sintoma
  confirmado, causa técnica exata ainda não isolada — próxima sessão).
- Aprendizado registrado em `docs/knowledge/CLAUDE.md` (entrada `[analista] 2026-09-22 — PP-063`).

## Pendente — próximo passo concreto por item
- **PP-068** (nova sessão, conforme Leo): investigar em qual etapa do pipeline (captura/parse/resolução de
  atleta/persistência) os 7 atletas se perdem, para as 5 categorias identificadas. Ver CAT Rodada 1 da
  própria PP-068 para os `[PENDENTE]` já mapeados.
- Saneamento da duplicação de `Match` (941 candidatos elegíveis, script `pp-055-saneamento-matches-duplicados.ts
  --execute`) — autorizado tecnicamente (inofensivo ao ranking), mas `--execute` não foi rodado; decisão de
  quando sanear fica com Leo.
- Saneamento dos 3 pares de `clubId` duplicados (Academia Ping Drive 136/265, Yoshida TT 170/266, Salinas
  171/267) — mesma classe de causa da PP-053/057/058/060/062, não investigado a fundo nesta sessão.
- Divergência de badges do resumo do evento (`/events/59`) entre local (pós-scrape desta sessão) e
  produção (pré-fix) — Leo decidirá quando tratar, registrado só como pendência.
- Investigação de mesma classe para as outras 3 etapas (1TMB26, 2TMB26, 3TMB26), fora do escopo desta
  sessão (Leo já sinalizou isso como próxima rodada de auditoria, ainda não iniciada).

## Decisões tomadas
- Rigor máximo: só corrigir/ajustar aquilo que for certeza de problema, com prova rastreável por item —
  divergência numérica sozinha não é suficiente. Válida para toda auditoria futura similar.
- Exploração feita em ambiente Docker local (`cbtm_homolog`), nunca produção.
- Autoridade normativa da auditoria é o Manual CBTM 2026 + Regimento Interno, não a comparação isolada
  entre nosso sistema e o site da federação.
- Rota 2 aceita para as 3 categorias residuais da Rodada 9 (ABSOLUTO F MAS, MASTER 45MAS, RLM — diferença
  pequena de contagem de partidas, não investigada a fundo) — válida só para esta rodada de auditoria.
- Investigação de causa raiz técnica exaustiva antes de qualquer correção de código — nenhuma linha de
  código alterada nesta sessão.

## Dúvidas em aberto
- Causa raiz técnica exata da ausência dos 7 atletas (capture/parse/resolution/persistence) — endereçada
  na PP-068, próxima sessão.
- Se o padrão "atleta ausente em grupo único pequeno" é isolado a este evento ou sistêmico — verificar em
  PP-068.

## Arquivos relevantes
- `docs/specs/PP-063-auditoria-eficiencia-4tmb26.md` — CAT completo, 14 rodadas, encerrado.
- `docs/specs/PP-068-fix-atletas-ausentes-grupo-unico.md` — Spec corretiva aberta, Rodada 1.
- `docs/evidence/PP-063/` — todos os dumps/relatórios de evidência (JSON/CSV/MD com hashes de integridade).
- `docs/knowledge/CLAUDE.md` — entrada de aprendizado adicionada, contador incrementado (4→5).
- `docs/Manual_TM_2026(2).pdf`, `docs/regimento_interno_cbtm.pdf` — fontes normativas usadas.

## Score da sessão
Sem parecer formal — sessão de investigação/auditoria, sem entrega de código para homologar.
