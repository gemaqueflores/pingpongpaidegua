# Matching de atleta (nome completo x nome reduzido)

## Problema
- `Inscrições`: nome completo do atleta + clube + ranking + rating.
- `Jogos`: nome reduzido/abreviado.

## Estratégia implementada
1. **Alias exato**
- busca em `athlete_aliases.alias_normalized`.

2. **Match forte (ranking + rating + compatibilidade de nome)**
- exige pontos iguais e compatibilidade do nome curto com o nome completo.

3. **Heurística controlada**
- quando não há pontos do jogo, restringe por clube (quando disponível) + compatibilidade de nome;
- score determinístico e limiar alto (`>= 80` e diferença para o 2º >= 15).

## Auditoria
- conflitos vão para `athlete_match_conflicts` com candidatos e contexto (`match_key:side`).
- API Admin:
  - `GET /admin/events/{id}/athlete-conflicts`
  - `POST /admin/events/{id}/athlete-conflicts/{conflictId}/resolve`

## Placeholder
- quando não resolve automaticamente, cria atleta placeholder (`created_from_warning=true`) em clube `SEM CLUBE`.
- ao resolver conflito, o vínculo do jogo é ajustado para o atleta correto.
