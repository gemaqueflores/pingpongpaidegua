# PP-001 — Corrigir FRONTEND_URL para URL de produção do Vercel

## Objetivo
Eliminar o risco latente de bloqueio de CORS quando `FRONTEND_ALLOW_VERCEL_PREVIEWS` for desabilitado, e tornar a configuração de produção explícita e auditável.

## Contexto
`docker-compose.yml` linha 87 define `FRONTEND_URL: http://localhost:3000` hardcoded no serviço `api`. Em produção na VM a variável não é sobrescrita por arquivo `.env` (o arquivo não existe). O CORS funciona hoje apenas porque `FRONTEND_ALLOW_VERCEL_PREVIEWS: "true"` aceita qualquer `*.vercel.app`. Se esse flag for desabilitado, o domínio de produção `https://pingpongpaidegua.vercel.app` será bloqueado.

## Causa raiz
- **Causa imediata:** `FRONTEND_URL` hardcoded como `localhost:3000` no compose; nenhum `.env` de produção na VM sobrescreve o valor.
- **Causa sistêmica:** ausência de convenção de `.env` de produção — o compose usa defaults de dev para todas as variáveis que não têm `${VAR:-default}`.
- **Padrão:** primeira ocorrência registrada.

## Cenários funcionais

**DADO** que a API sobe em produção com `FRONTEND_URL=https://pingpongpaidegua.vercel.app`  
**QUANDO** o frontend Vercel envia `Origin: https://pingpongpaidegua.vercel.app`  
**ENTÃO** a resposta contém `Access-Control-Allow-Origin: https://pingpongpaidegua.vercel.app`

**DADO** que `FRONTEND_ALLOW_VERCEL_PREVIEWS=false` (cenário de segurança reforçada)  
**QUANDO** o frontend Vercel envia `Origin: https://pingpongpaidegua.vercel.app`  
**ENTÃO** a resposta ainda contém `Access-Control-Allow-Origin: https://pingpongpaidegua.vercel.app` (via `FRONTEND_URL` explícito)

**DADO** que uma origem não autorizada envia request  
**QUANDO** `Origin: https://site-malicioso.com`  
**ENTÃO** a resposta NÃO contém `Access-Control-Allow-Origin`

## Critérios de aceitação
1. `docker-compose.yml` serviço `api`: `FRONTEND_URL` usa substituição de variável de ambiente com fallback de dev — `${FRONTEND_URL:-http://localhost:3000}`
2. Arquivo `.env.production.example` criado na raiz do repo documentando as variáveis obrigatórias de produção, incluindo `FRONTEND_URL=https://pingpongpaidegua.vercel.app`
3. VM de produção: arquivo `/home/ubuntu/pingpongpaidegua/.env` criado com `FRONTEND_URL=https://pingpongpaidegua.vercel.app` e container `api` reiniciado para aplicar

## Fora de escopo
- Alterar a lógica de CORS em `apps/api/src/main.ts` — não tocar
- Alterar `FRONTEND_ALLOW_VERCEL_PREVIEWS` — manter `true`
- Qualquer outra variável de ambiente do compose
- `.env` das outras variáveis de produção (JWT_SECRET, ADMIN_PASSWORD_HASH etc.) — já gerenciadas fora do repo

## Impacto técnico

**Arquivos a modificar:**
- `docker-compose.yml` — linha 87: substituir `FRONTEND_URL: http://localhost:3000` por `FRONTEND_URL: ${FRONTEND_URL:-http://localhost:3000}`

**Arquivos a criar:**
- `.env.production.example` — na raiz do repositório, documentando variáveis de produção obrigatórias

**Arquivos que NÃO devem ser tocados:**
- `apps/api/src/main.ts` — lógica de CORS intacta
- `apps/api/src/main.ts` — qualquer outro serviço ou arquivo
- Qualquer arquivo em `apps/web/`, `apps/worker/`, `packages/`

**DDL / migração:** não aplicável  
**Contrato de API alterado:** não  
**Dependências novas:** nenhuma

**Operação de VM (Codex executa via SSH):**
```bash
# Na VM ubuntu@api-pingpongpaidegua.duckdns.org
# Chave: ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key
echo 'FRONTEND_URL=https://pingpongpaidegua.vercel.app' >> /home/ubuntu/pingpongpaidegua/.env
cd /home/ubuntu/pingpongpaidegua
docker compose up -d --no-deps api
docker compose exec -T api env | grep FRONTEND_URL  # deve retornar a URL do Vercel
```

## Plano de testes

### Cobertura geral
- Camadas obrigatórias: unitário (mock de env) + verificação manual pós-deploy na VM
- Arquivos de teste a criar: nenhum arquivo novo — adicionar caso ao teste existente de CORS se houver, ou verificação manual documentada no relatório
- Fixtures/mocks: não aplicável para verificação de compose; verificação de integração via curl na VM

### T-U-01 — CORS aceita origem Vercel produção via FRONTEND_URL explícito
Camada: lógica de CORS em `apps/api/src/main.ts` — função `isOriginAllowed`  
DADO: `FRONTEND_URL=https://pingpongpaidegua.vercel.app` e `FRONTEND_ALLOW_VERCEL_PREVIEWS=false`  
QUANDO: `isOriginAllowed("https://pingpongpaidegua.vercel.app")` chamado  
ENTÃO: retorna `true`

### T-U-02 — CORS bloqueia origem não autorizada quando previews desabilitado
Camada: lógica de CORS em `apps/api/src/main.ts` — função `isOriginAllowed`  
DADO: `FRONTEND_URL=https://pingpongpaidegua.vercel.app` e `FRONTEND_ALLOW_VERCEL_PREVIEWS=false`  
QUANDO: `isOriginAllowed("https://site-malicioso.com")` chamado  
ENTÃO: retorna `false`

### T-I-01 — Verificação de integração pós-deploy na VM (manual, documentar no relatório)
DADO: container `api` reiniciado com `.env` contendo `FRONTEND_URL=https://pingpongpaidegua.vercel.app`  
QUANDO: `curl -s -o /dev/null -w "%{http_code}" -H "Origin: https://pingpongpaidegua.vercel.app" https://api-pingpongpaidegua.duckdns.org/events`  
ENTÃO: HTTP 200 e header `Access-Control-Allow-Origin: https://pingpongpaidegua.vercel.app` presente na resposta

### Cobertura de falhas silenciosas
- Formulário/Cadastro: não aplicável
- Edição/Atualização: não aplicável — mudança de configuração
- Listagem/Busca: não aplicável
- Autenticação/Autorização: não aplicável
- Integração externa: T-I-01 cobre o cenário pós-deploy
- Regra de negócio: T-U-01 e T-U-02 cobrem os dois casos críticos da regra de CORS
- UI/Componente: não aplicável

### Comando para rodar a suite
```bash
npm run test --workspace apps/api
```

---

## Correções obrigatórias — (reservado para parecer)
