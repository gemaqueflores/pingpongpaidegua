# PP-032 — Investigação e correção da renovação TLS recorrentemente falha (P0)

## Status: v2 — causa raiz confirmada por I1 (read-only); I2 autorizada por Leo

## Causa raiz confirmada (I1, Codex, read-only)

**O Certbot renovou corretamente; o Nginx nunca recarregou para usar o novo arquivo.** Não foi falha de
timer, desafio ACME, firewall, DNS ou path — foi ausência de `deploy_hook`/`renew_hook` no Certbot, então
a renovação de 21/07/2026 (sucesso, HTTP-01/webroot, válido até 18/10/2026, `fullchain3.pem`) nunca chegou
a ser servida: o Nginx (rodando desde 10/06/2026, sem reload) continuou servindo o certificado anterior,
que expirou em 19/08/2026. Confirmado por fingerprint/serial divergentes entre o arquivo gerenciado pelo
Certbot e o que o Nginx tinha carregado em memória.

Isso explica por que o incidente se repetiu desde `DEC-CBTM-001` (maio): a correção anterior tratou o
sintoma (renovação manual) sem fechar o loop automático entre "Certbot renova" e "Nginx serve o novo
arquivo".

## Skills Codex a ativar
- florestech-implementacao: não aplicável no sentido usual — é infraestrutura, não código de aplicação.
- security-review-agent: sim — certificado expirado é degradação de segurança em produção (MITM não
  detectável por clientes que ignoram erro de TLS, que é o comportamento observado).
- report-builder-agent: sim — relatório deve identificar causa raiz da falha de renovação, não apenas
  renovar manualmente de novo (isso já foi feito uma vez, ver histórico).

## Objetivo

Identificar por que a renovação automática de TLS (Certbot) não preveniu a expiração do certificado de
`api-pingpongpaidegua.duckdns.org` — pela segunda vez registrada — e corrigir a causa raiz, não apenas
renovar manualmente de novo.

## Contexto e precedente

**Isto já aconteceu antes.** `CLAUDE.md` do projeto, decisão **DEC-CBTM-001** (2026-05-21): "TLS renovado
via Certbot no nginx da VM Oracle. Certificado expirado em produção; renovação manual documentada." A
decisão registrada na época já presumia que a renovação via Certbot resolveria o problema de forma
permanente.

**Achado atual (relatado pelo Codex durante a janela de produção de PP-030, 19/08/2026):** o certificado
expirou novamente. `certbot.timer` está ativo (`systemctl status` confirmaria isso), mas a renovação não
ocorreu antes da expiração. A API responde `200` porque o cliente de teste (`curl`/smoke test) ignora
validação TLS — **qualquer cliente real que valide o certificado corretamente já está falhando ao
acessar a API**, incluindo potencialmente o próprio frontend em produção (Vercel) se ele validar TLS
estritamente.

**Padrão a investigar (não presumir a causa antes de confirmar):**
- `certbot.timer` ativo não implica que o `certbot renew` está de fato executando com sucesso — pode
  estar falhando silenciosamente (erro de rede, rate limit da Let's Encrypt, mudança de configuração do
  nginx que quebrou o desafio HTTP-01/DNS-01, permissão de arquivo, etc.).
- Pode ser que o timer exista mas nunca tenha sido de fato habilitado (`enabled` vs. apenas presente).
- Pode ser que o certificado gerenciado pelo Certbot não seja o mesmo que o nginx está servindo
  (divergência de path/configuração).

## Ação — investigação primeiro, correção depois (ambas requerem autorização de Leo, mas a investigação é read-only)

### I1 — Investigação read-only (autorizar primeiro, determina o que I2 precisa fazer)

Codex confirma via SSH, sem alterar nada:
1. `systemctl status certbot.timer` — confirma se está `active`/`enabled`, e o horário da última execução
   (`systemctl show certbot.timer -p LastTriggerUSec` ou equivalente).
2. `journalctl -u certbot` (ou `certbot.service`) — logs das últimas tentativas de renovação, procurando
   erro específico (rate limit, falha de desafio, permissão, DNS).
3. `certbot certificates` — lista os certificados que o Certbot conhece, data de expiração de cada um, e
   qual domínio.
4. Confirmar se o certificado servido pelo nginx (`openssl x509 -in <caminho> -noout -dates` no arquivo
   real referenciado pela config do nginx) é o mesmo gerenciado pelo Certbot, ou se há divergência de
   path.
5. Confirmar se há algum firewall/regra de rede bloqueando a porta 80 (necessária para desafio HTTP-01) —
   se o Certbot usa esse método.

### I2 — Correção (após I1 identificar a causa raiz específica)

Sem prescrever a correção agora — depende do que I1 encontrar. Candidatos, a confirmar:
- Se o timer nunca foi habilitado: `systemctl enable --now certbot.timer`.
- Se há falha de desafio por bloqueio de porta 80: corrigir regra de firewall/nginx.
- Se há divergência de path entre certificado gerenciado e servido: corrigir referência no nginx e
  recarregar (`nginx -s reload`, sem downtime).
- Se é rate limit da Let's Encrypt: aguardar janela e considerar `--staging` para testar antes da
  renovação real.
- **Renovação manual imediata do certificado atual, independente da causa raiz** — para eliminar a
  janela de exposição agora, antes/em paralelo à investigação da causa raiz.

## Critérios de aceitação

- Causa raiz da falha de renovação identificada e documentada (não apenas "renovamos de novo").
- Certificado válido servido pelo nginx, confirmado por `openssl s_client`/verificação externa real (não
  apenas `curl` ignorando validação).
- Renovação automática comprovadamente funcional — não apenas o timer "ativo", mas uma execução real
  bem-sucedida confirmada nos logs, ou um teste com `certbot renew --dry-run` passando.
- Registro atualizado (`DEC-CBTM-001` ou nova decisão) refletindo a causa raiz encontrada e a correção
  aplicada — para não repetir pela terceira vez sem entender por quê.

## Fora de escopo

- Não migrar de Certbot para outra solução de certificado (ex.: Cloudflare, outro CA) nesta Spec — só
  corrigir o mecanismo já em uso, salvo se I1 revelar que o mecanismo atual é estruturalmente inviável.
- Não alterar `docker-compose.yml`/PP-031 nesta Spec — nginx roda fora do compose (na VM diretamente,
  conforme DEC-CBTM-001), então não há sobreposição com a segmentação de rede Docker.

## Encaminhamento imediato

Aguardando autorização de Leo para I1 (read-only, primeiro passo) — determina o escopo real de I2.
