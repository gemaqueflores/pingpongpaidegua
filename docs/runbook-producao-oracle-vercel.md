# Runbook Producao Oracle + Vercel (sem Cloudflare)

## 1) Causas raiz identificadas

1. `failed to fetch` no Vercel:
- CORS bloqueando URLs de preview da Vercel (`https://<hash>.vercel.app`).
- API em HTTP (`:4000`) usada por frontend HTTPS, gerando bloqueio por mixed content.

2. `4000` funciona e `80/443` nao:
- Porta `4000` estava publicada direto no container.
- `80/443` dependem de Nginx + rede OCI correta (subnet/route/IGW/NSG efetivos) para ACME/HTTPS.
- Em alguns cenarios, regra foi criada em lista/subnet diferente da VNIC real.

3. travamentos/intermitencia:
- VM Always Free com pouca memoria, sem swap.
- `docker-compose` v1 com bug recorrente (`KeyError: 'ContainerConfig'`).
- Worker falhando ao persistir `scrapeRun` quando Postgres fica transitoriamente indisponivel.

## 2) Estado alvo

- API publica por HTTPS:
  - `https://api-pingpongpaidegua.duckdns.org`
- Frontend Vercel:
  - `https://pingpongpaidegua.vercel.app`
- Sem expor externamente:
  - `5432` e `6379`
- VM sobe estavel apos reboot com:
  - `postgres`, `redis`, `api`, `worker`

## 3) Checklist OCI (console)

Na instancia, aba `Rede`:
1. Abra a `Sub-rede` da VNIC principal.
2. Confirme na sub-rede:
- Route Table com `0.0.0.0/0 -> Internet Gateway`.
- Security List com ingress TCP `22`, `80`, `443`, `4000` (origem `0.0.0.0/0`).
3. Se existir NSG na VNIC:
- abrir mesmas portas no NSG.
4. Nao criar regra para `5432`/`6379`.

Teste do seu computador:
```powershell
Test-NetConnection 129.213.124.123 -Port 22
Test-NetConnection 129.213.124.123 -Port 80
Test-NetConnection 129.213.124.123 -Port 443
Test-NetConnection 129.213.124.123 -Port 4000
```

## 4) VM: baseline e swap (obrigatorio)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx curl

# swap 4GB
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 5) Docker estavel (preferir compose v2)

```bash
docker compose version || true
docker-compose version || true
```

Se `docker compose` existir, use sempre ele.
Se so houver `docker-compose` v1, use fluxo seguro sem recreate parcial:

```bash
cd ~/pingpongpaidegua
docker-compose down
docker-compose up -d postgres redis api worker
docker-compose ps
```

## 6) Nginx para ACME + proxy API

```bash
sudo mkdir -p /var/www/letsencrypt/.well-known/acme-challenge

sudo tee /etc/nginx/sites-available/pingpongpaidegua-api >/dev/null <<'EOF'
server {
  listen 80;
  server_name api-pingpongpaidegua.duckdns.org;

  location /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
  }

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/pingpongpaidegua-api /etc/nginx/sites-enabled/pingpongpaidegua-api
sudo nginx -t
sudo systemctl restart nginx
```

Teste ACME (do seu PC):
```bash
echo ok | sudo tee /var/www/letsencrypt/.well-known/acme-challenge/test.txt
```

```powershell
curl http://api-pingpongpaidegua.duckdns.org/.well-known/acme-challenge/test.txt -UseBasicParsing
```

## 7) Certbot com webroot (sem plugin nginx)

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d api-pingpongpaidegua.duckdns.org
```

Depois do certificado:
```bash
sudo tee /etc/nginx/sites-available/pingpongpaidegua-api >/dev/null <<'EOF'
server {
  listen 80;
  server_name api-pingpongpaidegua.duckdns.org;

  location /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name api-pingpongpaidegua.duckdns.org;

  ssl_certificate /etc/letsencrypt/live/api-pingpongpaidegua.duckdns.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api-pingpongpaidegua.duckdns.org/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
sudo certbot renew --dry-run
```

Teste final:
```powershell
curl https://api-pingpongpaidegua.duckdns.org/events -UseBasicParsing
```

## 8) Variaveis de ambiente Vercel

Projeto `pingpongpaidegua`:
- `NEXT_PUBLIC_API_URL = https://api-pingpongpaidegua.duckdns.org`

Redeploy de producao apos salvar.

## 9) CORS API

Ja implementado:
- aceita dominio principal configurado em `FRONTEND_URL`.
- aceita previews da Vercel via regex seguro:
  - `https://*.vercel.app` controlado internamente.

Variaveis recomendadas no container API:
- `FRONTEND_URL=https://pingpongpaidegua.vercel.app`
- `FRONTEND_ALLOW_VERCEL_PREVIEWS=true`

## 10) Runbook rapido de operacao

Subir stack:
```bash
cd ~/pingpongpaidegua
docker compose up -d postgres redis api worker
docker compose ps
```

Logs:
```bash
docker compose logs --tail=120 api
docker compose logs --tail=120 worker
```

Health:
```bash
curl -s http://127.0.0.1:4000/
curl -s https://api-pingpongpaidegua.duckdns.org/events
```

Scrape manual:
```bash
curl -X POST https://api-pingpongpaidegua.duckdns.org/admin/events/<id>/scrape-now \
  -H "Authorization: Bearer <TOKEN_ADMIN>"
```
