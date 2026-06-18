# Sessão 2026-05-21 — infra — Renovação de certificado TLS expirado

## Estado atual
- Branch: `fix/drift-check-and-event-aggregation` (sem mudança de código — operação de infra)
- Commit topo: `70e7333`
- API: online, saudável, todos os containers Docker up há 12 dias
- Certificado: válido até 2026-08-19 (renovado nesta sessão)
- Frontend Vercel: dados sendo exibidos normalmente após renovação

## Concluído nesta sessão

1. **Diagnóstico completo da VM e da API**
   - API respondendo dados ricos via IP direto (`curl -k https://129.213.86.180/events`) — serviços Docker intactos
   - Certificado TLS expirado em 2026-05-16 confirmado via `openssl s_client` e `certbot certificates`
   - SSH funcionando com `ubuntu@129.213.86.180` (não `opc`) usando chave `ssh-key-2026-04-02.key`
   - CORS correto: `FRONTEND_ALLOW_VERCEL_PREVIEWS=true` aceita `*.vercel.app` sem precisar de `FRONTEND_URL` configurado

2. **Renovação do certificado**
   - `sudo mkdir -p /var/www/letsencrypt` (diretório webroot ausente)
   - `sudo certbot certonly --webroot -w /var/www/letsencrypt -d api-pingpongpaidegua.duckdns.org --non-interactive --agree-tos --email gemaqueflores@gmail.com --force-renewal`
   - Novo certificado: válido de 2026-05-21 a 2026-08-19 (89 dias)
   - `sudo nginx -t && sudo systemctl reload nginx` — nginx recarregado com o novo cert
   - `certbot.timer` systemd reconfigurado automaticamente pelo certbot

3. **Verificação pós-correção**
   - `https://api-pingpongpaidegua.duckdns.org/events` → HTTP 200, JSON com 15+ eventos
   - CORS com origem `https://pingpongpaidegua.vercel.app` → `Access-Control-Allow-Origin: https://pingpongpaidegua.vercel.app` ✅

## Pendente — próximo passo concreto

1. **[CRÍTICO] Adicionar script de reemissão de certificado ao repositório**
   - Quando a VM é recriada, a conta ACME é perdida e o certbot não consegue renovar
   - Criar `scripts/vm/renew-cert.sh` com os comandos de reemissão documentados
   - Adicionar ao README de operações da VM

2. **[IMPORTANTE] SSH user documentado incorretamente**
   - Múltiplos scripts VM usam `ubuntu` no `AllowUsers` do sshd_config
   - O `CLAUDE.md` do projeto e o contrato dizem `opc` (padrão Oracle) — mas a VM usa `ubuntu`
   - Atualizar CLAUDE.md: usuário SSH é `ubuntu`, não `opc`
   - Chave ativa: `ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`

3. **[MELHORIA] `FRONTEND_URL` em docker-compose.yml**
   - Está como `http://localhost:3000` em produção
   - Funciona porque `FRONTEND_ALLOW_VERCEL_PREVIEWS=true`, mas deve ser corrigido para a URL de produção do Vercel
   - Risco: se `FRONTEND_ALLOW_VERCEL_PREVIEWS` for desabilitado, CORS vai bloquear

4. **[MELHORIA] Silêncio de falha no frontend**
   - `apiGetEvents()` com `.catch(() => setEvents([]))` silencia completamente erros de rede/TLS
   - Usuário vê tela vazia sem mensagem — impossível distinguir "sem dados" de "API offline"
   - Candidato a melhoria de UX: estado de erro explícito

## Decisões tomadas

- Renovação via webroot (`--webroot -w /var/www/letsencrypt`) em vez de standalone (nginx deve ficar up) | certbot precisa do diretório webroot que estava ausente | válida para próximas sessões: S
- Usuário SSH é `ubuntu` | confirmado via `AllowUsers ubuntu` no sshd_config instalado pelo `install-ssh-hardening.sh` | válido: S

## Candidatos a nova regra de contrato

1. **Usuário SSH incorreto** | ocorrência: tentativas com `opc` falharam; `ubuntu` funcionou | regra proposta: "Usuário SSH da VM PingPong: `ubuntu`. Chave: `ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`" | seção: CLAUDE.md §Stack ou novo §Acesso à VM

2. **Renovação de certificado após recriação de VM** | ocorrência: conta ACME perdida; certbot falhou silenciosamente | regra proposta: "Após recriação de VM: executar `scripts/vm/renew-cert.sh` antes de qualquer outra operação de infra" | seção: CLAUDE.md §Decisões ativas

## Padrões que funcionaram

- Diagnóstico por camadas (frontend → DNS → TLS → API via IP direto → SSH) identificou a causa raiz sem ambiguidade — confirmar o mesmo padrão em diagnósticos futuros de "site sem dados"

## Dúvidas em aberto

- Qual é a URL de produção do Vercel para o PingPong? (para corrigir `FRONTEND_URL` no docker-compose)
- A VM foi recriada intencionalmente ou sofreu um evento não planejado? (para avaliar se há outras configurações perdidas)

## Score
✅ 1 (API restaurada) | ⚠️ 0 | ❌ 0 — operação de infra, não revisão de entrega
