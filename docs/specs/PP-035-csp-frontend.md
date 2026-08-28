# PP-035 — Content-Security-Policy no frontend (Next.js/Vercel)

## Prioridade: 2 de 4 (S5 do CAT PP-026) — segurança, sem dependência de outra Spec em andamento

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim.
- e2e-playwright-agent: sim — CSP mal calibrado quebra funcionalidade visualmente (fontes, chamadas de
  API, imagens); precisa de verificação manual/e2e de que o app carrega e funciona normalmente após a
  mudança, não só que os headers estão presentes.
- report-builder-agent: não.

## Objetivo

Adicionar `Content-Security-Policy` ao frontend (`apps/web`), hoje sem nenhuma política — achado do CAT
PP-026 (S5), corrigido de escopo do achado original (API não é onde CSP se aplica; é o frontend que serve
HTML).

## Contexto

`apps/web/next.config.js` não define `headers()` — nenhum CSP, nem outros headers de segurança
específicos do frontend hoje (a API já tem `X-Content-Type-Options`, `X-Frame-Options`, HSTS, etc. em
`apps/api/src/main.ts:81-91`, mas isso não cobre o HTML servido pelo Next.js/Vercel).

**Confirmado por leitura:** o app usa `next/font` (self-hosted pelo Next.js no build, sem CDN de fonte
externa em runtime) e consome a API via `NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL`
(`apps/web/lib/auth.ts:1-3`, `apps/web/lib/seo.ts:4-5`) — em produção,
`https://api-pingpongpaidegua.duckdns.org`. Nenhum outro domínio externo (analytics, CDN de terceiro)
identificado nesta leitura — Codex confirma antes de fechar a política final, já que uma CSP restritiva
demais quebra a aplicação visualmente sem erro claro no console às vezes só percebido pelo usuário.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — CSP presente no HTML servido**
DADO o frontend em produção
QUANDO uma página é carregada
ENTÃO o response inclui header `Content-Security-Policy` com política restritiva (sem `unsafe-inline`/
`unsafe-eval` desnecessários, salvo se Next.js exigir para hidratação — Codex confirma e documenta se
algum `unsafe-*` for estritamente necessário).

**Cenário 2 — aplicação continua funcionando normalmente (não regressão visual)**
DADO a CSP aplicada
QUANDO o app é usado normalmente (navegação, chamadas à API, carregamento de fontes/imagens)
ENTÃO nenhuma funcionalidade quebra — sem erros de CSP no console do navegador.

**Cenário 3 — chamadas à API são permitidas**
DADO `connect-src` restrito ao(s) domínio(s) da API
QUANDO o frontend faz fetch para a API (`NEXT_PUBLIC_API_URL`)
ENTÃO a chamada é permitida pela CSP.

## Critérios de aceitação

- `Content-Security-Policy` presente em todas as respostas HTML do frontend, via `headers()` em
  `next.config.js` (mecanismo nativo do Next.js, sem middleware adicional necessário salvo se Codex
  identificar razão técnica para preferir middleware).
- Política mínima cobrindo: `default-src 'self'`, `script-src` (Next.js exige `'self'` + possivelmente
  hash/nonce para scripts inline gerados pelo próprio framework — Codex confirma o mínimo necessário sem
  usar `unsafe-inline` se evitável), `style-src`, `img-src`, `font-src 'self'` (fontes self-hosted via
  `next/font`), `connect-src` incluindo o domínio real da API de produção.
- Testado manualmente (ou via Playwright, se o e2e-playwright-agent for acionado) que a aplicação carrega
  sem erro de CSP no console, com o app rodando localmente contra o build de produção
  (`next build && next start`, não `next dev`, já que CSP pode se comportar diferente em dev).
- Nenhuma quebra de fonte/imagem/chamada de API observada.

## Fora de escopo

- Não adicionar CSP à API (`apps/api`) — API não serve HTML, headers de segurança já cobertos
  separadamente em `main.ts`.
- Não implementar nonce/hash dinâmico por request nesta Spec, salvo se for estritamente necessário para
  evitar `unsafe-inline` — Codex avalia e declara a decisão tomada no relatório de entrega.
- Não alterar `redirects()` nem outras configurações já existentes em `next.config.js`.

## Impacto técnico

- Arquivo a modificar: `apps/web/next.config.js` — adicionar `headers()`.
- Arquivos que NÃO devem ser tocados: `apps/api/src/main.ts` (CSP não se aplica à API).
- DDL: nenhuma.
- Deploy: Vercel aplica automaticamente ao rebuildar a partir do merge — sem janela de produção manual
  necessária (diferente das Specs anteriores que tocavam a VM Oracle via Docker Compose).

## Plano de testes

### T-U-01 — Header CSP presente na resposta
DADO: o frontend buildado (`next build`) e servido (`next start`)
QUANDO: uma requisição é feita à página inicial
ENTÃO: a resposta inclui header `Content-Security-Policy` com a política definida.

### T-E-01 — Aplicação funciona normalmente com CSP ativa (e2e ou manual documentado)
DADO: o frontend rodando com CSP ativa, apontando para a API real (local ou produção)
QUANDO: um usuário navega pelas páginas principais (lista de eventos, detalhe de evento, atletas)
ENTÃO: nenhum erro de CSP aparece no console do navegador; conteúdo carrega normalmente (fontes,
imagens, dados da API).

### T-E-02 — Chamada à API não é bloqueada pela CSP
DADO: `connect-src` configurado com o domínio real da API
QUANDO: o frontend faz fetch para um endpoint da API
ENTÃO: a chamada é bem-sucedida, sem erro de CSP.

### Comando para rodar a suite
`npm run test --workspace apps-web` (se houver suite existente) + verificação manual/e2e conforme
Cenário 2/3, documentada no relatório de entrega com screenshot ou log do console sem erro de CSP.
