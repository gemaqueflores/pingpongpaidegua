# Contexto de Agente: pingpongpaidegua (appcbtmeventos)

## 1. Papel deste arquivo
- Este arquivo define o contexto permanente do projeto para agentes.
- A documentacao funcional e arquitetural detalhada fica no `README.md`.
- Em caso de divergencia:
  1. regras oficiais CBTM explicitamente validadas no projeto ou no manual
  2. decisoes de negocio registradas no projeto
  3. `README.md`
  4. codigo atual, sujeito a correcao

## 2. Arquitetura e Stack
- Monorepo estruturado em `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/parser`, `prisma`, `scripts`.
- API: NestJS + Prisma + PostgreSQL.
- Worker: BullMQ + Playwright + parser compartilhado.
- Web: Next.js.
- Compartilhado: `packages/shared` e `packages/parser`.
- Infra local e producao: Docker Compose.
- Infra alvo: Oracle Cloud Always Free, com foco em baixo consumo, recuperacao autonoma e resiliencia.

## 3. Glossario de dominio
- `Event`: torneio/evento CBTM.
- `Category`: divisao competitiva por idade, nivel, classe ou formato.
- `Match`: partida entre dois lados competitivos.
- `Athlete`: competidor persistido no sistema.
- `Read Model`: projecao otimizada para leitura publica ou administrativa.
- `Scrape Run`: execucao de captura, parse, persistencia e auditoria de um evento.

## 4. Hierarquia da verdade
1. Regras oficiais CBTM explicitamente validadas no projeto ou no manual.
2. Decisoes de negocio registradas e acordadas no projeto.
3. Documentacao arquitetural e operacional do repositorio.
4. Codigo atual, que pode conter bug, interpretacao incompleta ou legado.

## 5. Guardrails permanentes
- Nao recriar a arquitetura do projeto.
- Nao gerar um novo `schema.prisma` do zero.
- Toda mudanca deve ser incremental, com minimo risco e validacao objetiva.
- Nao inventar regras esportivas.
- Regra ausente ou ambigua deve ser tratada como `parametrizavel`.
- Nao usar dados ficticios para "fechar numeros".
- Divergencias com baseline externa devem ser explicadas com evidencia.

## 6. Contexto operacional
- O sistema processa eventos CBTM por `cbtmEventId`, com isolamento por evento.
- Um evento pode ser simples ou agregado, conforme configuracao administrativa.
- Fontes operacionais validas de dados: `INSCRICOES`, `GRUPOS` e `RESULTADOS`.
- A aba `Fase Eliminatoria` do site oficial nao e fonte primaria de scraping.
- Playwright e parte central do worker, mas a captura pode combinar estrategias HTTP e browser.
- Redis e usado para cache, filas e suporte operacional, sem substituir a verdade persistida no PostgreSQL.

## 7. Regras de dominio (tenis de mesa)
- Nao inferir chaveamento por heuristica solta quando houver dado oficial publicado.
- Formato base por categoria:
  - ate 5 inscritos: grupo unico (round-robin)
  - acima de 5: fase de grupos + eliminatoria simples (k1), conforme configuracao do evento
- Distribuicao de grupos, quando aplicavel:
  - grupos de 3
  - excedente distribuido nos ultimos grupos
  - podem existir ate 2 grupos de 4
- WO:
  - placar `3-0` ou `0-3` com sets `11-0` em todas as parciais caracteriza WO
  - WO duplo nao soma sets ou pontos de carreira
  - WO duplo nao conta como partida jogada
  - contagem de WO e por categoria e nao propaga para outras categorias do atleta
  - elegibilidade de podio por WO segue a regra de negocio vigente e explicitamente validada
- Bye:
  - bye avanca o atleta ou dupla na chave
  - bye nao conta como partida jogada
- Podio:
  - padrao: 1 ouro, 1 prata, ate 2 bronzes
  - excecoes devem seguir regra oficial ou configuracao explicitamente validada
- Auditoria:
  - separar `partidasPublicadas`, `partidasPrevistas`, `partidasJogadas` e `wo`
  - nao mascarar divergencias entre valores calculados e valores publicados

## 8. Padroes de codigo
- Fazer a menor mudanca correta.
- Preferir funcoes puras para regra de negocio.
- Deixar servicos grandes cada vez mais proximos de orquestradores.
- Se alterar contrato de API, alinhar consumidor web e testes.
- Erros devem ser acionaveis, com contexto suficiente para auditoria.
- Evitar hardcode de regra de negocio quando ela ja puder ser configurada por evento.
- Preservar textos e labels em portugues nas interfaces.

## 9. Fluxo recomendado para agentes
1. Auditar a implementacao atual antes de propor mudanca.
2. Localizar a camada do problema:
   - parser
   - worker
   - persistencia/upsert
   - read model
   - API
   - frontend
3. Aplicar a menor correcao auditavel.
4. Adicionar ou ajustar testes automatizados.
5. Validar build e testes do workspace afetado.

## 10. Comandos uteis
- Instalar dependencias: `npm install`
- Build API: `npm run build --workspace apps-api`
- Build Worker: `npm run build --workspace apps-worker`
- Build Web: `npm run build --workspace apps-web`
- Testes API: `npm run test --workspace apps-api`
- Testes Worker: `npm run test --workspace apps-worker`
- Subir stack local: `docker compose up --build -d`

## 11. Limites de infraestrutura
- Considerar sempre os limites da Oracle Cloud Always Free.
- Evitar loops agressivos de recuperacao.
- Evitar estrategias que aumentem desnecessariamente consumo de CPU, RAM, disco ou conexoes ao banco.
- Toda automacao deve privilegiar disponibilidade e degradacao controlada.
