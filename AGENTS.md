# Codex / GPT — Contrato operacional: PingPong PaiDegua

Projeto FloresTech. Este arquivo complementa o contrato institucional em:
`C:\Users\LeonardoMuriloGemaqu\.codex\AGENTS.md`

Em caso de conflito: o contrato institucional prevalece.

---

## 1. Roteamento

Este projeto é FloresTech. Orquestrador geral:
`C:\Users\LeonardoMuriloGemaqu\Documents\estudos\CLAUDE.md`

Hierarquia de leitura:
1. `~/.claude/CLAUDE.md` — roteador mestre
2. `Documents\estudos\CLAUDE.md` — orquestrador FloresTech
3. `~/.codex/AGENTS.md` — contrato institucional Codex
4. Este arquivo — contrato do projeto
5. Orientação específica da tarefa

---

## 2. Papéis fixos

| Papel | Quem |
|---|---|
| Orquestrador | Leo — define escopo, aprova, autoriza |
| Implementador | Codex / GPT — escreve e entrega código |
| Revisor | Claude — analisa spec, revisa código, emite parecer |

Codex não emite parecer de revisão. Se receber pedido de aprovação ou análise de risco, recusar e informar que o parecer é responsabilidade do Claude.

---

## 3. Autoconfiguração obrigatória em sessão nova

```powershell
git config user.email   # deve retornar gemaqueflores@gmail.com
# Se errado: git config user.email "gemaqueflores@gmail.com" — NUNCA --global
$env:GH_TOKEN = $env:GITHUB_TOKEN
```

---

## 4. Fluxo de implementação

### Tipo A (sem DDL, sem módulo novo)

```
Codex implementa → reporta → Claude revisa → corrige se necessário → commit
```

### Tipo B (DDL novo, módulo novo, regra de negócio, impacto > 3 arquivos)

```
Claude revisa spec → Codex implementa → reporta → Claude revisa → commit após ✅
```

Nunca mergear antes do ✅ do Claude em Tipo B.

### Ao iniciar implementação

1. Verificar email e token via ambiente (`$env:GITHUB_TOKEN` ou `$env:GH_TOKEN`)
2. Partir da branch base indicada na orientação
3. Criar branch: `<prefixo>/<contexto-em-kebab-case>`
4. Implementar → validar → reportar

### Ao concluir

Reportar: branch, commit hash, PR URL, assunções feitas, arquivos deixados fora intencionalmente, resultado da validação.

---

## 5. Stack e domínio do projeto

### Papel deste contexto

- Este arquivo define o contexto permanente do projeto para agentes.
- A documentação funcional e arquitetural detalhada fica no `README.md`.
- O catálogo de prompts operacionais fica no `PROMPTS.md`.
- Em caso de divergência:
  1. regras oficiais CBTM explicitamente validadas no projeto ou no manual
  2. decisões de negócio registradas no projeto
  3. `README.md`
  4. código atual, sujeito a correção

### Arquitetura e stack

- Monorepo estruturado em `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/parser`, `prisma`, `scripts`.
- API: NestJS + Prisma + PostgreSQL.
- Worker: BullMQ + Playwright + parser compartilhado.
- Web: Next.js.
- Compartilhado: `packages/shared` e `packages/parser`.
- Infra local e produção: Docker Compose.
- Infra alvo: Oracle Cloud Always Free, com foco em baixo consumo, recuperação autônoma e resiliência.

### Glossário de domínio

- `Event`: torneio/evento CBTM.
- `Category`: divisão competitiva por idade, nível, classe ou formato.
- `Match`: partida entre dois lados competitivos.
- `Athlete`: competidor persistido no sistema.
- `Read Model`: projeção otimizada para leitura pública ou administrativa.
- `Scrape Run`: execução de captura, parse, persistência e auditoria de um evento.

### Hierarquia da verdade

1. Regras oficiais CBTM explicitamente validadas no projeto ou no manual.
2. Decisões de negócio registradas e acordadas no projeto.
3. Documentação arquitetural e operacional do repositório.
4. Código atual, que pode conter bug, interpretação incompleta ou legado.

### Guardrails permanentes

- Não recriar a arquitetura do projeto.
- Não gerar um novo `schema.prisma` do zero.
- Toda mudança deve ser incremental, com mínimo risco e validação objetiva.
- Não inventar regras esportivas.
- Regra ausente ou ambígua deve ser tratada como `parametrizável`.
- Não usar dados fictícios para fechar números.
- Divergências com baseline externa devem ser explicadas com evidência.

### Contexto operacional

- O sistema processa eventos CBTM por `cbtmEventId`, com isolamento por evento.
- Um evento pode ser simples ou agregado, conforme configuração administrativa.
- Fontes operacionais válidas de dados: `INSCRICOES`, `GRUPOS` e `RESULTADOS`.
- A aba `Fase Eliminatoria` do site oficial não é fonte primária de scraping.
- Playwright é parte central do worker, mas a captura pode combinar estratégias HTTP e browser.
- Redis é usado para cache, filas e suporte operacional, sem substituir a verdade persistida no PostgreSQL.

### Regras de domínio (tênis de mesa)

- Não inferir chaveamento por heurística solta quando houver dado oficial publicado.
- Formato base por categoria:
  - até 5 inscritos: grupo único (round-robin)
  - acima de 5: fase de grupos + eliminatória simples (k1), conforme configuração do evento
- Distribuição de grupos, quando aplicável:
  - grupos de 3
  - excedente distribuído nos últimos grupos
  - podem existir até 2 grupos de 4
- WO:
  - placar `3-0` ou `0-3` com sets `11-0` em todas as parciais caracteriza WO
  - WO duplo não soma sets ou pontos de carreira
  - WO duplo não conta como partida jogada
  - contagem de WO é por categoria e não propaga para outras categorias do atleta
  - elegibilidade de pódio por WO segue a regra de negócio vigente e explicitamente validada
- Bye:
  - bye avança o atleta ou dupla na chave
  - bye não conta como partida jogada
- Pódio:
  - padrão: 1 ouro, 1 prata, até 2 bronzes
  - exceções devem seguir regra oficial ou configuração explicitamente validada
- Quadro de medalhas e eficiência do site:
  - contabiliza categorias `Rating (R*)`
  - usa unidade competitiva em duplas e duplas mistas
  - pontuação segue `quantidade x peso_da_medalha x peso_do_evento`
  - desempate segue `pontuacao > ouro > prata > bronze`
- Auditoria:
  - separar `partidasPublicadas`, `partidasPrevistas`, `partidasJogadas` e `wo`
  - não mascarar divergências entre valores calculados e valores publicados

### Padrões de código

- Fazer a menor mudança correta.
- Preferir funções puras para regra de negócio.
- Deixar serviços grandes cada vez mais próximos de orquestradores.
- Se alterar contrato de API, alinhar consumidor web e testes.
- Erros devem ser acionáveis, com contexto suficiente para auditoria.
- Evitar hardcode de regra de negócio quando ela já puder ser configurada por evento.
- Preservar textos e labels em português nas interfaces.

### Fluxo recomendado para agentes

1. Auditar a implementação atual antes de propor mudança.
2. Localizar a camada do problema:
   - parser
   - worker
   - persistência/upsert
   - read model
   - API
   - frontend
3. Aplicar a menor correção auditável.
4. Adicionar ou ajustar testes automatizados.
5. Validar build e testes do workspace afetado.

### Comandos úteis

- Instalar dependências: `npm install`
- Build API: `npm run build --workspace apps-api`
- Build Worker: `npm run build --workspace apps-worker`
- Build Web: `npm run build --workspace apps-web`
- Validação por arquivos alterados: `npm run verify:changed`
- Listar validação por arquivos alterados sem executar: `npm run verify:changed:list`
- Encoding/segredos em arquivos alterados: `npm run verify:encoding`
- Segurança em arquivos alterados: `npm run verify:security`
- Testes API: `npm run test --workspace apps-api`
- Testes Worker: `npm run test --workspace apps-worker`
- Cerca crítica: `npm run test:regression:critical`
- Subir stack local: `docker compose up --build -d`

### Limites de infraestrutura

- Considerar sempre os limites da Oracle Cloud Always Free.
- Evitar loops agressivos de recuperação.
- Evitar estratégias que aumentem desnecessariamente consumo de CPU, RAM, disco ou conexões ao banco.
- Toda automação deve privilegiar disponibilidade e degradação controlada.

---

## 6. Validação mínima antes de reportar

- Rodar testes existentes do projeto conforme workspace afetado.
- API: `npm run test --workspace apps-api`
- Worker: `npm run test --workspace apps-worker`
- Cerca crítica: `npm run test:regression:critical` em mudanças de parser ou regra de domínio
- Build API: `npm run build --workspace apps-api`
- Build Worker: `npm run build --workspace apps-worker`
- Build Web: `npm run build --workspace apps-web`
- Validar auditoria de dados quando a mudança afetar cálculos ou scraping
- Confirmar que mudanças de contrato de API foram refletidas nos consumidores
- Verificar que não há dados fictícios, prints de debug ou regras inventadas
- Verificar encoding PT-BR nos arquivos tocados
- Rodar `npm run verify:security` quando houver superfície de auth, API, SQL/ORM, segredo, infra, shell, integração externa ou frontend com input de usuário

---

## 7. Encoding PT-BR

Ver detector completo em `~/.codex/AGENTS.md` seção 7.

Mojibake detectado = correção obrigatória antes do commit.

---

## 8. Formato de orientação Claude → Codex

Quando o Claude gerar uma orientação, ela seguirá o formato do `~/.codex/AGENTS.md` seção 10.

Seguir à risca.
