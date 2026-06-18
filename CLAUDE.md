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
| DEC-CBTM-001 | TLS renovado via Certbot no nginx da VM Oracle. | Certificado expirado em produção; renovação manual documentada. | 2026-05-21 |
| DEC-CBTM-002 | CORS configurado na API NestJS, não no nginx. | O nginx fazia double-CORS; CORS foi centralizado na API. | 2026-05-21 |
| DEC-CBTM-003 | Pre-commit hook versionado em `.githooks/pre-commit`; ativado com `git config core.hooksPath .githooks`. | Garante hook versionado e portátil; `--no-verify` é proibido, exceto em commit RED de Red-Green quando o hook executa a suite que deve falhar por design. | 2026-06-10 |
| DEC-CBTM-004 | O filtro `nameDisplay: { not: { contains: '#' } }` pertence apenas ao diretório global de atletas (`listAthleteDirectory`), nunca às listagens por evento. | Pares de duplas usam `nameDisplay = "A # B"`; filtrar `#` em contexto de evento exclui duplas por erro. | 2026-06-10 |
| DEC-CBTM-005 | `TECHNICIAN_CATEGORY_ID = "88888888"` (TÉCNICOS) e `GENERAL_TOTALIZER_CATEGORY_ID = "99999999"` (Totalizador Geral); ambos seguem em `IGNORED_CATEGORY_IDS` por enquanto. | IDs estavam invertidos no código e foram corrigidos na PP-005. Futuramente `88888888` será usado para listar técnicos separadamente. | 2026-06-10 |

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
