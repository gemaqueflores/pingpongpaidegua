# PP-013 — Retry com Backoff para Browser Fallback

**Aprovação Leo:** _pendente_

---

## Objetivo

Tornar o pipeline resiliente a indisponibilidades momentâneas do CBTM durante eventos ao vivo: em vez de jogar o job direto para `failed` quando o browser fallback não consegue abrir a página, tentar novamente com backoff exponencial antes de desistir.

---

## Contexto

A análise do 3TMB26 identificou 24 falhas do tipo `Nao foi possivel abrir a pagina do evento ... no browser fallback` em uma janela de 10 minutos (2026-06-14 12:40–12:50 UTC) — o pico de scrape simultâneo do evento ao vivo. O CBTM não conseguiu servir as páginas 5680/5688/5691 a todos os requests simultâneos.

O mecanismo atual em `captureLiveBrowser` (arquivo `apps/worker/src/scraper/capture.service.ts`, linha ~527) já faz 2 tentativas de `page.goto` com timeouts crescentes (`domcontentloaded` 90s → `networkidle` 120s). Mas essas duas tentativas são **consecutivas e imediatas** — se o CBTM está temporariamente sobrecarregado, tentar de novo 1ms depois tem a mesma chance de falhar.

O que falta é **esperar** entre tentativas — backoff exponencial com jitter — e tentar mais vezes antes de desistir. BullMQ suporta `attempts` e `backoff` nativamente nas options do job, mas isso refaz o job inteiro (novo `scrapeRun`). A alternativa é implementar retry dentro do próprio `captureLiveBrowser`, que é mais cirúrgica e não cria runs desnecessários.

---

## Causa raiz

**Imediata:** `captureLiveBrowser` lança `throw new Error("Nao foi possivel abrir a pagina...")` após 2 tentativas imediatas sem espera entre elas.

**Sistêmica:** o pipeline não tem estratégia de backoff para falhas transitórias de conectividade com o CBTM. Qualquer pico de carga no CBTM converte todos os scrapes simultâneos em ERRORs ou jobs `failed`.

---

## Cenários funcionais

**DADO** o CBTM indisponível na primeira tentativa de `page.goto`  
**QUANDO** `captureLiveBrowser` tenta abrir a página  
**ENTÃO** aguarda com backoff e tenta novamente até `MAX_BROWSER_OPEN_ATTEMPTS` vezes antes de lançar exceção

**DADO** o CBTM disponível na segunda ou terceira tentativa  
**QUANDO** `page.goto` tem sucesso após falha inicial  
**ENTÃO** o scrape prossegue normalmente; o warning registra as tentativas anteriores mas o run termina como SUCCESS ou PARTIAL

**DADO** o CBTM indisponível em todas as tentativas  
**QUANDO** `MAX_BROWSER_OPEN_ATTEMPTS` é atingido  
**ENTÃO** lança exceção com mensagem que inclui número de tentativas realizadas; run termina como ERROR (comportamento atual preservado)

---

## Critérios de aceitação

1. `captureLiveBrowser` tenta abrir a página até `MAX_BROWSER_OPEN_ATTEMPTS` vezes (padrão: 4, configurável via env)
2. Entre tentativas: backoff exponencial com base 2s e jitter aleatório de ±20%, para não concentrar retries simultâneos
3. Cada tentativa falha é registrada como warning com tentativa/total e mensagem de erro
4. Sucesso em tentativa N>1 é registrado como warning informativo
5. Suite verde; hook ativo

---

## Fora de escopo

- Retry no nível do BullMQ (não alterar `attempts` nos jobs — isso criaria `scrapeRun` duplicados)
- Alteração do path HTTP (`captureLiveHttp`) — apenas o fallback de browser é afetado
- Alteração de `removeOnFail` ou limpeza da fila (PP-012)
- Frontend, API, pipeline, Prisma

---

## Impacto técnico

### Arquivos a modificar

**`apps/worker/src/config.ts`**
- Adicionar:
  ```ts
  browserOpenMaxAttempts: Number(process.env.BROWSER_OPEN_MAX_ATTEMPTS ?? "4"),
  browserOpenRetryBaseMs: Number(process.env.BROWSER_OPEN_RETRY_BASE_MS ?? "2000"),
  ```

**`apps/worker/src/scraper/capture.service.ts`**
- No método `captureLiveBrowser`, substituir o loop de 2 tentativas imediatas (linhas ~527–544) por loop com backoff:

  ```ts
  // Antes (2 tentativas imediatas):
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const waitUntil = attempt === 1 ? "domcontentloaded" : "networkidle";
    const timeout = attempt === 1 ? 90000 : 120000;
    try {
      await page.goto(eventUrl, { waitUntil, timeout });
      await page.waitForTimeout(1500);
      navigated = true;
      break;
    } catch (error) {
      warnings.push(`Falha ao abrir pagina do evento (tentativa ${attempt}/2, ...)`);
    }
  }
  if (!navigated) throw new Error(`Nao foi possivel abrir a pagina...`);

  // Depois (N tentativas com backoff):
  const maxAttempts = config.browserOpenMaxAttempts;   // padrão: 4
  const baseMs = config.browserOpenRetryBaseMs;        // padrão: 2000
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const waitUntil = attempt <= 2 ? "domcontentloaded" : "networkidle";
    const timeout = attempt <= 2 ? 90000 : 120000;
    try {
      await page.goto(eventUrl, { waitUntil, timeout });
      await page.waitForTimeout(1500);
      if (attempt > 1) {
        warnings.push(`Pagina aberta na tentativa ${attempt}/${maxAttempts} apos ${attempt - 1} falha(s).`);
      }
      navigated = true;
      break;
    } catch (error) {
      warnings.push(`Falha ao abrir pagina do evento (tentativa ${attempt}/${maxAttempts}, waitUntil=${waitUntil}): ${String(error ?? "")}`);
      if (attempt < maxAttempts) {
        const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
        const delay = baseMs * Math.pow(2, attempt - 1) * jitter;
        await new Promise((resolve) => setTimeout(resolve, Math.round(delay)));
      }
    }
  }
  if (!navigated) {
    throw new Error(`Nao foi possivel abrir a pagina do evento ${eventId} no browser fallback apos ${maxAttempts} tentativa(s).`);
  }
  ```

### Arquivos que NÃO devem ser tocados

- `apps/worker/src/main.ts` — PP-012 é responsável pelas mudanças de queue; PP-013 não toca queue
- `apps/worker/src/pipeline/` (qualquer arquivo)
- `apps/api/`, `apps/web/`, `packages/`, `prisma/`

---

## Plano de testes

### Cobertura geral

- Camadas: unitário (lógica de backoff isolada) + source-inspection (invariante de tentativas)
- Arquivo de teste: conforme padrão encontrado em `apps/worker/`

### T-U-01 — invariante de tentativas no source

Camada: source-inspection  
DADO: `apps/worker/src/scraper/capture.service.ts`  
QUANDO: inspecionado  
ENTÃO:
- Contém `config.browserOpenMaxAttempts` (não hardcoded `<= 2`)
- Contém `config.browserOpenRetryBaseMs`
- Contém `Math.pow(2,` (backoff exponencial)

### T-U-02 — backoff cresce exponencialmente

Camada: unitário (função de cálculo de delay isolada ou verificação de valores)  
DADO: `baseMs = 1000`, tentativas 1, 2, 3  
QUANDO: delay calculado (sem jitter para teste determinístico)  
ENTÃO: delay(1) = 1000ms, delay(2) = 2000ms, delay(3) = 4000ms

### T-U-03 — sucesso na tentativa N>1 registra warning informativo

Camada: unitário (mock de page.goto que falha nas primeiras N-1 tentativas)  
DADO: `page.goto` falha nas tentativas 1 e 2, sucesso na 3  
QUANDO: `captureLiveBrowser` executa  
ENTÃO: `warnings` contém mensagem de sucesso na tentativa 3; `navigated = true`; sem exceção lançada

### T-U-04 — após MAX_ATTEMPTS falhas, lança exceção com contagem

DADO: `page.goto` falha em todas as `maxAttempts` tentativas  
QUANDO: `captureLiveBrowser` executa  
ENTÃO: lança `Error` com `maxAttempts` na mensagem

### Cobertura de falhas silenciosas

- T-U-03 garante que scrapes bem-sucedidos na N-ésima tentativa não são descartados
- T-U-04 garante que o comportamento de ERROR ainda existe após esgotar tentativas

### Comando para rodar a suite

```
npm --prefix apps/worker test
```

---

## Orientação para o Codex

```
## Orientação para o Codex — PP-013

### Spec aprovada
caminho: docs/specs/PP-013-retry-backoff-browser-fallback.md
aprovação Leo: _aguardando_

### Plano de testes (resumo)
IDs: T-U-01, T-U-02, T-U-03, T-U-04
arquivo de teste: conforme padrão existente em apps/worker/
comando: npm --prefix apps/worker test

### Contexto
branch base: main (b454f49) — ou branch de PP-012 se implementadas em sequência
branch a criar: fix/pp-013-retry-backoff-browser-fallback

### Pré-condições
- git config user.email = gemaqueflores@gmail.com
- PP-012 não precisa estar merged — as mudanças são em arquivos distintos
- Sem DDL

### Arquivos a modificar

1. apps/worker/src/config.ts
   - Adicionar:
     browserOpenMaxAttempts: Number(process.env.BROWSER_OPEN_MAX_ATTEMPTS ?? "4")
     browserOpenRetryBaseMs: Number(process.env.BROWSER_OPEN_RETRY_BASE_MS ?? "2000")

2. apps/worker/src/scraper/capture.service.ts
   - Localizar o loop de tentativas de page.goto em captureLiveBrowser (~linha 527)
   - Substituir pelo loop com backoff exponencial descrito na seção "Impacto técnico" da spec
   - Preservar: lógica de waitUntil, timeouts, warnings de falha, flag navigated, throw final
   - Adicionar: config.browserOpenMaxAttempts, backoff com jitter, warning de sucesso tardio

### Arquivos que NÃO devem ser tocados
- apps/worker/src/main.ts (PP-012 é responsável)
- apps/worker/src/pipeline/ (qualquer arquivo)
- apps/api/, apps/web/, packages/, prisma/

### Ordem de implementação (Red-Green por T-*)
T-U-01: red (source-inspection falha por hardcode de 2 tentativas) → green (implementar loop com config)
T-U-02: red (função de backoff não existe isolada OU source não contém Math.pow) → green
T-U-03: red (mock de page.goto não existe) → green (warning de sucesso tardio implementado)
T-U-04: red (mensagem sem maxAttempts) → green

### Validação antes de reportar
- npm --prefix apps/worker test → T-U-01 a T-U-04 verdes
- npm run verify:encoding → ok
- Confirmar que a mensagem de erro final inclui o número de tentativas realizadas
```
