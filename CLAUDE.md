# CLAUDE.md - PingPong PaiD'egua

Complementa o orquestrador FloresTech (`estudos/CLAUDE.md`). Em caso de conflito, o orquestrador prevalece.

---

## Stack

NestJS + Prisma + PostgreSQL (API), Next.js (frontend), BullMQ + Redis (worker).

Monorepo: `apps/api/`, `apps/web/`, `apps/worker/`, `packages/`.

---

## Decisões Ativas

| ID | Decisão | Motivo | Desde |
|---|---|---|---|
| DEC-CBTM-001 | TLS da VM Oracle é renovado pelo Certbot via webroot/HTTP-01; após cada emissão bem-sucedida, o hook `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` executa `nginx -t` e recarrega o Nginx. | Em 21/07/2026 o Certbot renovou corretamente, mas o Nginx não foi recarregado e continuou servindo em memória o certificado anterior, expirado em 19/08/2026. A PP-032 fechou o ciclo automático e validou dry-run, hook, fingerprint e HTTPS externo. | 2026-05-21; corrigida em 2026-08-26 |
| DEC-CBTM-002 | CORS configurado na API NestJS, não no nginx. | O nginx fazia double-CORS; CORS foi centralizado na API. | 2026-05-21 |
| DEC-CBTM-003 | Pre-commit hook versionado em `.githooks/pre-commit`; ativado com `git config core.hooksPath .githooks`. | Garante hook versionado e portátil; `--no-verify` é proibido, exceto em commit RED de Red-Green quando o hook executa a suite que deve falhar por design. | 2026-06-10 |
| DEC-CBTM-004 | O filtro `nameDisplay: { not: { contains: '#' } }` pertence apenas ao diretório global de atletas (`listAthleteDirectory`), nunca às listagens por evento. | Pares de duplas usam `nameDisplay = "A # B"`; filtrar `#` em contexto de evento exclui duplas por erro. | 2026-06-10 |
| DEC-CBTM-005 | `TECHNICIAN_CATEGORY_ID = "88888888"` (TÉCNICOS) e `GENERAL_TOTALIZER_CATEGORY_ID = "99999999"` (Totalizador Geral); ambos seguem em `IGNORED_CATEGORY_IDS` por enquanto. | IDs estavam invertidos no código e foram corrigidos na PP-005. Futuramente `88888888` será usado para listar técnicos separadamente. | 2026-06-10 |
| DEC-CBTM-006 | O card "Atletas" do resumo do evento (`totalInscritos`) conta qualquer `registrationStatus` não nulo (inclui `PRE_INSCRITO`); a aba "Atletas" (`listAthletes`/`buildEventAthletesSnapshot`) só lista quem está `INSCRITO`. Divergência entre os dois números em evento na fase inicial de inscrição é esperada, não bug. | Decisão de negócio confirmada por Leo na PP-019 (evento 5826, Copa Brasil Prata Belém/PA 2026): resumo reflete interesse/movimento de inscrição, aba reflete só confirmados. | 2026-06-19 |

---

## Pendências rastreáveis — segurança/robustez de infra

| ID | Lacuna | Impacto | Bloqueio para correção |
|---|---|---|---|
| PEND-CBTM-001 | API pública (`api-pingpongpaidegua.duckdns.org`) roda sem Cloudflare (proxy/WAF/TLS de borda) porque o domínio pertence à zona `duckdns.org` (terceiro) — Cloudflare Free/Pro exige controle dos nameservers da zona para ativar proxy. TLS depende integralmente do ciclo Certbot→nginx local na VM, que já causou 2 incidentes de certificado expirado (DEC-CBTM-001, PP-032). | Sem WAF/proteção de borda na API; renovação TLS segue com único ponto de falha (reload do nginx na VM). | Requer domínio próprio (ex.: `pingpongpaidegua.com.br`) migrado para nameservers Cloudflare antes de qualquer Spec de proxy. Leo decidiu em 2026-08-28 manter DuckDNS por enquanto — reavaliar quando houver decisão sobre domínio próprio. |
| PEND-CBTM-002 | `apps/web/next.config.js` define CSP com `script-src 'self' 'unsafe-inline'` — anula a proteção da CSP contra XSS via script inline. Não explorável hoje (sem `dangerouslySetInnerHTML`/`innerHTML` no frontend), mas fica sem essa camada se uma entrega futura renderizar conteúdo externo (dado CBTM raspado, nome de atleta) sem sanitização. | Lacuna defensiva latente, não vulnerabilidade ativa. | Migrar para CSP com nonce por request antes de qualquer Spec que renderize conteúdo dinâmico/externo no frontend. Achado da homologação retroativa PP-035, 2026-08-28. |
| PEND-CBTM-003 | `apps/api/src/auth/auth-config.ts` (`resolveJwtSecret`) não valida comprimento mínimo de `JWT_SECRET` configurado — aceita qualquer valor diferente do default de dev, mesmo trivialmente curto. | `JWT_SECRET` fraco em produção enfraqueceria a assinatura HMAC do JWT sem erro no boot. | Adicionar checagem de comprimento mínimo (≥32 caracteres) em `resolveJwtSecret()`. Achado da homologação retroativa PP-027, 2026-08-28. |
| PEND-CBTM-004 | `apps/api/src/auth/jwt.strategy.ts` — campo `role` no payload JWT é assinado em `login()` mas nunca lido de volta no `validate()` (role sempre fixada como `"ADMIN"` a partir do banco). Seguro hoje por design single-admin, mas decorativo. | Se o sistema evoluir para multi-role sem que essa lacuna seja notada, risco de reintroduzir confiança no payload não validado. | Comentário explícito no código, ou remoção do campo `role` do payload assinado. Achado da homologação retroativa PP-034, 2026-08-28. |
| PEND-CBTM-005 | PP-028: rotação da senha default do PostgreSQL em produção. | Confirmado em 2026-08-28: a senha do usuário `postgres` em produção não é mais o valor default (64 caracteres, rotacionada). | Fechada por verificação read-only do Claude via MCP `ssh-oracle`, sem imprimir ou registrar senha, hash ou fragmento do segredo. Exceção de proveniência registrada porque não havia sessão Codex ativa. |

---

## Pre-commit Hook

```bash
# Verificar se o hook está ativo na sessão
git config core.hooksPath

# Ativar em clone ou sessão nova, se necessário
git config core.hooksPath .githooks
```

O hook em `.githooks/pre-commit` executa:

1. Checagem de mojibake PT-BR nos arquivos staged.
2. `npm run test:regression:critical`.

`--no-verify` é proibido. Se o hook bloquear, corrigir a causa.

Exceção única: em ciclo Red-Green formal, um commit RED pode usar `--no-verify` quando o próprio hook executa a suite que deve falhar por design. O commit deve ser declarado como RED, seguido imediatamente por commit GREEN com hook normal, e o relatório deve registrar o hash RED e a justificativa.

---

## DoD Mínimo

- Suite API verde: `npm --prefix apps/api test`.
- Builds verdes: `npm run build --workspace apps-api` e `npm run build --workspace apps-web`.
- Hook ativo e commits sem `--no-verify`, salvo a exceção formal de commit RED descrita acima.
- Encoding PT-BR UTF-8 nos arquivos tocados.

---

## Fonte de Verdade por Tipo de Evidência

| Tipo de evidência | Fonte autoritativa | Nunca usar como fonte |
|---|---|---|
| Código de produção / histórico de PR | GitHub (`gemaqueflores/appcbtmeventos`, `mcp__github__*`) | Memória de sessão, declaração de implementação sem `Read` |
| Estado do servidor de produção (nginx, certbot, containers) | SSH Oracle Cloud (`129.213.86.180`, MCP `ssh-oracle`) — Codex executa, Claude formula comandos | Suposição sobre config de produção sem comando executado |
| Dados oficiais CBTM (categorias, regras, tabelas de torneio) | Site oficial CBTM / documento exportado fornecido por Leo | Inferência por analogia com outro evento ou regra "lembrada" |
| Estado do banco (linhas, schema aplicado) | PostgreSQL/Prisma — query real (local ou produção conforme o que se está validando) | Schema do `.prisma` sem migration aplicada confirmada |
| Dados extraídos por scraping (parser de duplas, resultados) | HTML bruto salvo/logado no momento da extração | Tela renderizada lembrada ou inferida sem o HTML de origem |

Conflito entre fontes (ex.: Git diz uma coisa, Oracle Cloud mostra outra em produção): declarar o conflito a
Leo antes de formar parecer ou Spec — não escolher uma fonte por suposição de qual está "mais atualizada".

---

## Domínios E Arquivos-Chave

| Domínio | Arquivo principal | Observação |
|---|---|---|
| Listagens de evento, clubes, atletas e schedule | `apps/api/src/user/user.service.ts` | Serviço grande; leitura cirúrgica por método. |
| Rotas públicas | `apps/api/src/user/user.controller.ts` | Rotas públicas usam `@PublicCacheTtl`. |
| Evento agregado | `user.service.ts` -> `resolveEventScope()` | Resolve canonical, filhos e sufixos. |
| Cache de read models | `user.service.ts` -> `resolveEventReadModelCache()` | Cache canônico; filhos resolvem para canonical. |
| Página pública de evento | `apps/web/app/user/events/[id]/page.tsx` | Abas: grupos, confrontos, clubes, atletas, eficiência. |
| Cliente API web | `apps/web/lib/user-api.ts` | Funções `apiGet*`. |
| Prewarm de read models | `apps/worker/src/pipeline/read-model-prewarm.service.ts` | Aquece canonical; filhos não têm cache separado. |
