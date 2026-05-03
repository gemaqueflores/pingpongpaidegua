# Fechamento Documental - 2026-04

## Objetivo
Este documento registra o estado de maturidade atual do projeto `pingpongpaidegua` / `appcbtmeventos` apos a rodada de estabilizacao operacional, migracao de VM e endurecimento das superficies derivadas.
Ele deve ser lido junto com o baseline funcional do produto:
- acompanhamento em tempo real de eventos CBTM
- scout historico de atletas
- scout historico de clubes refletindo os resultados dos atletas representantes
- destaque de desempenho anual e acumulado, sem romper os limites da Oracle Always Free

## Estado Atual
Leitura consolidada do projeto:
- infraestrutura de producao: estavel na Oracle A1 (`2 OCPU / 12 GB`)
- operacao autonoma: ativa com `self-heal`, `vm-health`, `event-watch` e housekeeping
- ingestao de dados CBTM: confiavel nas fontes `INSCRICOES`, `GRUPOS` e `RESULTADOS`
- sincronizacao destrutiva: endurecida contra snapshot parcial e payload incidental
- eventos agregados: tratados com cobertura de regressao e correcoes especificas
- camadas derivadas principais: consolidadas
- consumo publico majoritario em mobile considerado nas paginas principais e nas tabelas responsivas mais criticas

## O que foi consolidado

### Infra e operacao
- migracao da producao para a VM Oracle A1 concluida
- stack de producao estabilizada em `api`, `worker`, `postgres` e `redis`
- tuning aplicado para Always Free sem sobrecarga desnecessaria
- hardening de SSH aplicado
- workflows GitHub alinhados com a nova VM

### Ingestao e reconciliacao
- sincronizacao de inscricoes protegida contra captura parcial
- merge e cancelamento de categorias tratados com ordem correta
- ausencia autoritativa nas fontes oficiais passou a remover categorias e atletas ausentes quando a cobertura e confiavel
- `stage-3` ficou mais conservador para evitar prune prematuro

### Read models e leitura publica
- paridade entre `GET /events` e `GET /events/{id}`
- eficiencia por evento e carreira de clube alinhadas a atletas unicos com inscricao confirmada
- carreira individual separada da carreira de pares
- carreira de pares corrigida para alias legado e classificacao por nome quando necessario
- diretorio de pares segue politica de mostrar apenas pares com lastro competitivo publicado
- buscas publicas de atletas e clubes sao acento-insensiveis
- hubs publicos canonicos atuais ficam em `/events`, `/atletas`, `/career/{athleteKey}` e `/eficiencia/{clubId}`

### Eventos agregados
- categorias agregadas recebem sufixo consistente por child event
- medalhistas agregados cobertos por regressao
- eficiencia agregada coberta por regressao
- simulacao agregada nao reaproveita o proprio torneio atual como historico

## Cerca Critica de Regressao
O comando abaixo passou a ser obrigatorio antes de mudancas sensiveis:

```bash
npm run test:regression:critical
```

Essa cerca cobre hoje:
- `summary`
- `medalists`
- `event efficiency`
- `registration queries`
- `athlete pair career`
- `group simulation`
- historico de simulacao em agregado
- worker de inscricoes e politica por situacao do evento

O detalhamento da suite fica em:
- `docs/critical-regression-suite.md`

## Riscos Residuals
O projeto ficou maduro, mas nao "livre de qualquer falha". Os riscos residuais relevantes sao:
- instabilidade ou mudanca do site oficial da CBTM
- publicacao oficial parcial ou retroativa em janelas curtas
- indisponibilidade externa de DNS/rede/cloud
- regras novas da CBTM ainda nao refletidas no projeto

Esses riscos nao sao escondidos pelo sistema. A postura do projeto segue sendo:
- preferir evidencia
- degradar de forma controlada
- evitar heuristica agressiva

## Backlog Tecnico Residual
Backlog residual mantido de forma explicita:
- checklist de migracao de VM continua devendo evoluir conforme novas necessidades operacionais
- canais de notificacao externa continuam opcionais ate definicao operacional
- destaque anual de clubes ainda depende mais de composicao de superficies existentes do que de uma camada dedicada unica
- novas correcoes devem priorizar casos reais com reproducao objetiva antes de expandir heuristicas

## Regra de ouro para evolucao futura
Para manter o projeto maduro:
1. auditar primeiro
2. corrigir a menor camada possivel
3. adicionar teste de regressao
4. validar build e producao
5. nao expandir regra heuristica sem evidencia
