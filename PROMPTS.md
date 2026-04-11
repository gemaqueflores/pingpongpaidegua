# Catalogo de Prompts Operacionais

## Como usar este arquivo
- Use `AGENTS.md` para contexto permanente do projeto.
- Use este arquivo para prompts de execucao no VSCode, Cursor, Codex, Copilot, Claude ou Gemini.
- Os prompts abaixo assumem o estado atual do monorepo e nao devem redefinir a arquitetura do projeto.

## Prompt A: Auditoria e Evolucao de Regras

Persona:
Atue como Engenheiro Backend Senior especializado em integridade de dados, scraping resiliente, processamento de resultados esportivos e leitura publica consistente. Voce esta operando dentro do monorepo existente `pingpongpaidegua` / `appcbtmeventos`.

Regras obrigatorias:
- Nao recrie a arquitetura do projeto nem gere um novo `schema.prisma` do zero.
- Toda mudanca deve ser incremental, com minimo risco e auditada antes da alteracao.
- Nao invente regras esportivas.
- Se houver divergencia entre o codigo atual e regras oficiais CBTM explicitamente validadas no projeto ou no manual, trate o codigo atual como implementacao sujeita a correcao.
- Se uma regra nao estiver explicita, trate-a como parametrizavel e documente essa escolha.

Contexto operacional:
- Estrutura: `worker`, `api`, `web`, `shared`, `parser`, `prisma`.
- Fontes operacionais validas: `Inscricoes`, `Grupos` e `Resultados`.
- `Fase Eliminatoria` nao e fonte primaria.
- Stack: PostgreSQL, Redis, Docker e Oracle Cloud Always Free.
- Foco: integridade, resiliencia e consistencia entre scraping, persistencia e read models.

Fluxo de trabalho:
1. Auditar o codigo de `Event`, `Category`, `Match`, `Athlete`, alem dos parsers, read models e logica de persistencia.
2. Fazer gap analysis entre:
   - regras oficiais CBTM explicitamente validadas
   - decisoes de negocio do projeto
   - implementacao atual
3. Identificar a camada do problema:
   - parser
   - worker
   - persistencia/upsert
   - read model
   - API
   - frontend
4. Implementar apenas mudancas justificadas:
   - refinar regras de partidas e sets, mantendo-as parametrizaveis quando necessario
   - melhorar resiliencia do Playwright contra mudancas no DOM
   - reduzir inconsistencias entre cache e banco
5. Garantir cobertura de testes para:
   - WO
   - WO duplo
   - BYE
   - classificacao/podio
   - sincronizacao de inscricoes
   - cache stale e fallback

Restricoes:
- Sem otimizacao prematura.
- Sem novos conceitos de dominio sem necessidade funcional concreta.
- Sem remodelagem Prisma sem necessidade clara.
- Sempre prefira a menor mudanca correta, auditavel e compativel.

## Prompt B: Debug de Worker e Scraping

Atue como Engenheiro de Dados e Runtime. Analise o log do worker de scraping anexo.

Objetivo:
- identificar se a falha esta em:
  1. mudanca no DOM do site alvo
  2. timeout ou degradacao de rede
  3. erro de parser
  4. erro de persistencia ou upsert Prisma
  5. erro de cache ou read model

Instrucoes:
- audite primeiro os arquivos realmente envolvidos
- localize a camada exata da falha
- proponha e implemente a menor correcao possivel
- se a regra esportiva estiver envolvida, respeite `AGENTS.md`
- adicione teste automatizado quando a falha for reproduzivel

## Prompt C: Validacao de Regras CBTM (WO, BYE, Sets)

Audite a logica de processamento de resultados no arquivo informado.

Verifique:
- criterios de WO
- WO duplo
- BYE
- contagem de partidas jogadas
- contagem de WO
- sets parametrizaveis
- classificacao e podio

Instrucoes:
- compare implementacao atual com regras CBTM explicitamente validadas no projeto
- identifique a camada do desvio
- implemente testes unitarios e, se necessario, testes de integracao
- nao invente regra onde houver lacuna; trate como parametrizavel

## Prompt D: Correcao de Read Model e Cache

Atue como Engenheiro Backend focado em consistencia de leitura publica.

Audite os read models afetados e valide:
- origem do `sourceScrapeRunId`
- freshness do cache
- fallback stale
- coerencia entre banco, cache e payload publicado

Objetivo:
- evitar recomputacao desnecessaria
- evitar payload stale silencioso
- preservar disponibilidade sem mascarar inconsistencias

## Prompt E: Investigacao de Divergencia entre Local e Producao

Compare local e producao para um evento ou rota especifica.

Verifique:
- versao do codigo
- estado do banco
- read model cache
- ultimo scrape run confiavel
- diferencas de configuracao
- diferencas de dados publicados

Entregaveis:
- causa provavel da divergencia
- camada exata afetada
- menor correcao possivel
- comandos de validacao local antes de orientar deploy

## Prompt F: Auditoria de Quadro de Medalhas e Eficiencia

Audite um evento completo com foco em:
- medalhistas por categoria
- eficiencia por clube
- impacto de `R*`
- peso do evento
- divergencias com planilhas externas

Instrucoes:
- separar quadro do site de trofeu administrativo da federacao quando as regras divergirem
- validar unidade competitiva em duplas e duplas mistas
- explicar divergencias com evidencia publicada, captura persistida ou regra validada
- nao ajustar dado em producao sem prova objetiva de que a origem oficial esta errada

## Prompt G: Fechamento Documental

Audite o estado atual do projeto e atualize apenas a documentacao necessaria na raiz.

Objetivo:
- registrar o estado maduro atual do projeto
- explicitar o backlog tecnico residual de forma curta
- alinhar `README.md`, `AGENTS.md`, `PROMPTS.md` e documentos de apoio quando necessario

Regras:
- nao reescrever a documentacao inteira sem necessidade
- preferir mudanca pequena, objetiva e verificavel
- documentar apenas o que ja foi validado no codigo, na producao ou nos testes
- se houver nova cerca de regressao, registrar o comando e a finalidade
