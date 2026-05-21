#!/usr/bin/env bash
# Reemissão manual do certificado TLS Let's Encrypt.
# Executar após recriação de VM ou quando certbot falhar por conta ACME ausente.
#
# Uso: bash scripts/vm/renew-cert.sh [--email EMAIL]
#
# Pré-condições:
#   - nginx em execução (webroot challenge usa a porta 80 via nginx)
#   - porta 80 acessível externamente (ufw allow 80/tcp)
#   - DuckDNS apontando para o IP atual da VM
#   - certbot instalado (sudo apt install certbot)
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

DOMAIN="${DOMAIN:-api-pingpongpaidegua.duckdns.org}"
WEBROOT="${WEBROOT:-/var/www/letsencrypt}"
EMAIL="${EMAIL:-gemaqueflores@gmail.com}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

echo "=== renew-cert.sh ==="
echo "Dominio: $DOMAIN"
echo "Webroot: $WEBROOT"
echo "Email:   $EMAIL"
echo ""

# Garantir que o diretório webroot existe antes do challenge.
sudo mkdir -p "$WEBROOT"

# Verificar se nginx está respondendo na porta 80 para o domínio.
if ! curl -s --max-time 5 "http://${DOMAIN}/.well-known/acme-challenge/probe" -o /dev/null; then
  echo "AVISO: probe HTTP falhou — verifique se nginx está ativo e porta 80 acessível." >&2
  echo "Continuando mesmo assim (pode ser que o path 404 seja esperado)."
fi

echo "Obtendo certificado via webroot..."
sudo certbot certonly \
  --webroot \
  -w "$WEBROOT" \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --force-renewal

echo ""
echo "Recarregando nginx com o novo certificado..."
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "Verificando certificado instalado:"
sudo certbot certificates 2>/dev/null | grep -E "Certificate Name|Expiry|INVALID"

echo ""
echo "=== Certificado renovado com sucesso. ==="
