# Hospedagem gratuita (scrape a cada 2h)

Este projeto pode operar com custo zero no modo de atualizacao periodica (nao real-time), priorizando:
- simulador de grupos;
- carreira e compartilhamento social.

## Ajustes aplicados no projeto
- Worker com intervalo padrao de 2 horas:
  - `apps/worker/src/config.ts` (`SCRAPER_REFRESH_CRON_MS=7200000`)
- Labels de job ajustadas para refletir intervalo dinamico:
  - `apps/worker/src/main.ts`
- Execucao one-shot para agendamento externo:
  - `apps/worker/src/run-once.ts`
  - script: `npm run scrape:once --workspace apps/worker`
- Workflow do GitHub Actions para rodar a cada 2h:
  - `.github/workflows/scrape-every-2h.yml`

## Arquitetura recomendada (zero custo)
1. Frontend (`apps/web`): Vercel (Hobby).
2. API (`apps/api`): Oracle Cloud Always Free (VM) com Docker.
3. Banco: Postgres na mesma VM (Docker) ou servico externo gratuito.
4. Scraping: GitHub Actions a cada 2h executando `scrape:once`.
5. Redis: opcional nesse perfil (necessario apenas para fila BullMQ em tempo real).

## Passo a passo

### 1) Banco e API (Oracle Always Free)
1. Crie uma VM Always Free (Ubuntu).
2. Instale Docker e Docker Compose plugin.
3. Suba API + Postgres (e Redis se quiser manter fila admin):
   - `docker compose up -d postgres redis api`
4. Rode migrations Prisma:
   - `npm run prisma:deploy`
5. Garanta acesso HTTPS na API (Nginx/Caddy + certificado).

### 2) Frontend na Vercel
1. Conecte o repositório na Vercel.
2. Configure:
   - Root/Workspace de web: `apps/web`
   - Build command: `npm run build --workspace apps/web`
   - Output: padrao Next.js.
3. Defina env:
   - `NEXT_PUBLIC_API_URL=https://SEU_DOMINIO_API`
4. Deploy.

### 3) Scrape automatico a cada 2h (GitHub Actions)
1. No GitHub, configure segredo:
   - `DATABASE_URL`
2. (Opcional) adicione:
   - `SCRAPER_EVENT_URL` se precisar customizar.
3. Habilite workflow:
   - `.github/workflows/scrape-every-2h.yml`
4. Teste manual via `Run workflow` com `event_ids` opcional.

### 4) Operacao sugerida
- Durante evento: scrape automatico a cada 2h.
- Usuario acompanha placar real-time no site oficial CBTM.
- Seu sistema entrega os diferenciais:
  - simulador de grupos;
  - carreira;
  - artes de compartilhamento.

## Observacoes
- Sem worker 24/7, o botao `scrape-now` depende de execucao manual (workflow dispatch ou rotina equivalente).
- Se quiser manter `scrape-now` imediato, mantenha worker online com Redis.

