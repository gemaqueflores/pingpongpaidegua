# PP-028 — Rotação emergencial: senha default do PostgreSQL em produção (P0)

## Status: v2 — R1 relatada como concluída; R2 revelou divergência de topologia real

## Parecer operacional (Claude) — nota de proveniência obrigatória

**Esta seção registra o que foi relatado pelo Codex, não uma verificação independente.** Claude não tem
acesso direto a produção (sem MCP `ssh-oracle` nesta sessão, sem SSH próprio) — diferente das
homologações de código (PP-022, PP-027), onde `git diff`/suite/build foram reexecutados pessoalmente,
aqui a única verificação possível por mim é de coerência lógica e cruzamento contra o que já está no
repositório (ex.: `docker-compose.yml`), não confirmação direta do estado do servidor.

### R1 — relatado como concluído e validado
Senha rotacionada; 3 connection strings atualizadas; restart em ordem `postgres → api → worker`; senha
antiga rejeitada (evidência citada: 2 ocorrências de `FATAL: password authentication failed` nos logs,
antes e depois da recriação do Postgres); API respondendo `200`; volume `postgres_data` preservado com
23 eventos/25 tabelas intactos; credencial isolada em arquivo `600` fora do versionamento.

**Avaliação de coerência:** o relato é consistente com o método de validação já usado em PP-027 (prova
negativa — credencial antiga rejeitada — não só prova positiva de que a nova funciona), o que é o padrão
correto para esse tipo de rotação. Sem acesso direto, não posso confirmar os `200`/logs por mim mesmo.

### R2 — divergência real encontrada (aceita, não é falha do Codex — R2 pediu confirmação, e ela veio negativa)

**Achado real, não hipotético:** a rede `pingpongpaidegua_default` tem **4 containers** (api, worker,
postgres, redis), não os 3 que R2 assumia como esperados. A expectativa original da Spec estava incompleta
— não considerou que o Redis, por desenho do `docker-compose.yml`, já compartilha rede com os demais
serviços (todos os serviços do compose ficam na rede default do projeto, salvo configuração explícita em
contrário, que não existe aqui).

**Gravidade reavaliada:** confirmei por leitura do `docker-compose.yml` que o serviço `redis` **não tem
`requirepass` configurado** — roda sem autenticação. Isso significa que a rotação de senha do Postgres
(R1) protege contra acesso com credencial conhecida, mas **não muda o fato de que qualquer processo que
comprometa o Redis (sem senha) já está na mesma rede Docker que o Postgres** — a segmentação de rede que
R2 esperava confirmar (isolar o Postgres de serviços não essenciais) não existe hoje. Isto não anula o
valor de R1 (a senha default era o problema mais grave e mais fácil de explorar), mas mostra que a defesa
em profundidade da rede ainda tem uma lacuna.

### Desvios técnicos declarados pelo Codex — aceitos, geram pendência de Spec futura
1. `docker-compose.yml` versionado ainda contém o literal `postgres` como default — a parametrização
   definitiva (trocar para placeholder sem valor funcional, força obrigar configuração explícita em
   produção) não foi feita nesta Spec operacional; ficou como patch via `docker-compose.override.yml`
   local ao servidor (mesmo padrão já usado em PP-027, isolado via `.git/info/exclude` do servidor —
   comportamento correto, evita commit acidental de configuração operacional).
2. Isolamento de rede do Redis (segregar de forma que só `api`/`worker` acessem `postgres`, sem `redis`
   na mesma sub-rede) não foi implementado — R2 era estritamente read-only, corretamente não alterou
   nada.

**Candidatos a Spec futura (não formulados nesta sessão, aguardando priorização de Leo):**
- Parametrização definitiva do `docker-compose.yml` (remover o literal `postgres`, exigir variável de
  ambiente sem fallback funcional em produção).
- Segmentação de rede Docker (isolar Postgres numa rede que só `api`/`worker` alcançam).
- `requirepass` no Redis (fecha a lacuna de "serviço sem autenticação na mesma rede").

## Skills Codex a ativar
- florestech-implementacao: não aplicável no sentido usual — não há código de produção a alterar; Codex
  executa como operação de infraestrutura.
- security-review-agent: sim — natureza da própria Spec.
- report-builder-agent: sim — confirmar item a item que a rotação foi concluída e validada.

## Objetivo

Eliminar a credencial default (`postgres`/`postgres`) do banco PostgreSQL em produção, mesma classe de
risco já corrigida em PP-027 (credencial default ativa em produção), desta vez na camada de banco de
dados.

## Contexto

CAT PP-026, achado I1, confirmado por consulta read-only do Codex em produção (Rodada 3): tanto o
container PostgreSQL quanto a `DATABASE_URL_WRITE`/`DATABASE_URL_READ` efetivas da API usam a senha
default definida em `docker-compose.yml:23` (`POSTGRES_PASSWORD: postgres`) — o mesmo valor documentado
publicamente no repositório como exemplo de desenvolvimento local.

**Mitigação parcial já existente:** porta 5432 vinculada a `127.0.0.1:5432` (`docker-compose.yml:32`) —
sem exposição direta à internet pública através do compose. **Isso não elimina o risco:** qualquer
processo com execução na própria VM Oracle, ou qualquer outro container na mesma rede Docker (se algum
serviço adicional for adicionado no futuro, ou se a rede for reconfigurada), teria acesso trivial ao
banco completo com uma senha conhecida publicamente.

**Diferença em relação a PP-027:** esta rotação **não exige mudança de código** — é puramente
operacional (trocar valor de variável de ambiente + reiniciar serviços). Não há Cenário de código a
implementar nesta Spec.

## Ação de contenção — requer autorização explícita de Leo antes da execução

### R1 — Rotacionar a senha do PostgreSQL em produção

1. Gerar senha nova e imprevisível (ex.: `openssl rand -base64 32`, sem caracteres que exijam escaping
   complexo em connection string — evitar `@`, `/`, espaços; Codex normaliza/URL-encode se necessário).
2. Atualizar a senha do usuário `postgres` no container PostgreSQL (`ALTER USER postgres WITH PASSWORD
   '<nova senha>';` executado dentro do container, ou via variável de ambiente + recriação do container,
   conforme o mecanismo que o Codex confirmar como correto para não perder o volume de dados
   `postgres_data`).
3. Atualizar `DATABASE_URL_WRITE`, `DATABASE_URL_READ`, `DATABASE_URL` (e `POSTGRES_PASSWORD` se aplicável
   ao processo de restart) na configuração de produção real (fora do `docker-compose.yml` versionado, que
   deve continuar usando `${VAR}` com fallback de exemplo, nunca a senha real).
4. Reiniciar `postgres`, depois `api` e `worker` (nessa ordem, aguardando healthcheck do Postgres antes
   de subir os consumidores) — mesma disciplina de `wait_service` já usada em `deploy-backend.yml`.
5. Validar: conexão com a nova senha funciona (API healthy, worker healthy); conexão com a senha antiga
   falha (`psql` com credencial antiga deve ser rejeitado).

**Efeito colateral esperado e aceito:** breve indisponibilidade da API/worker durante o restart
sequencial (mesma janela de manutenção de PP-027, se executado em conjunto ou logo em seguida).

**Nenhuma senha/segredo aparece em log, chat ou código versionado** — apenas confirmação de que a
rotação foi concluída e validada.

### R2 — Confirmar rede Docker não expõe o Postgres a outros containers além dos esperados (read-only)

Antes ou depois de R1: Codex confirma via `docker network inspect` (ou equivalente) que apenas
`api`/`worker`/`postgres` compartilham a rede onde o Postgres está acessível — sem outro serviço
inesperado com acesso à mesma rede.

## Critérios de aceitação

- Senha do usuário `postgres` em produção não é mais `postgres` (nem qualquer valor default documentado
  publicamente no repositório).
- `DATABASE_URL_WRITE`/`DATABASE_URL_READ`/`DATABASE_URL` de produção refletem a nova credencial.
- Conexão com a credencial antiga é rejeitada (validado, não assumido).
- API e worker operacionais após o restart, sem perda de dado (volume `postgres_data` preservado).
- `docker-compose.yml` versionado não é alterado com a senha real — continua usando placeholder/`${VAR}`.

## Fora de escopo

- Não migrar de usuário `postgres` (superusuário) para um usuário de aplicação com privilégios reduzidos
  — é melhoria válida, mas escopo maior; candidata a Spec separada se Leo priorizar.
- Não alterar a estrutura de rede Docker além de confirmar (R2 é read-only nesta Spec).
- Não expor a porta 5432 publicamente — o binding a `127.0.0.1` permanece como está (é mitigação
  correta, não o problema).

## Validação

Não há T-* de código (sem mudança de código). Validação é operacional, conforme "Critérios de aceitação"
— Codex reporta confirmação item a item, incluindo teste real de rejeição da credencial antiga.

## Encaminhamento imediato

Aguardando autorização explícita de Leo para R1 (rotação) e R2 (confirmação de rede, pode ser autorizada
junto).
