#!/usr/bin/env bash
set -euo pipefail

SSHD_SNIPPET="/etc/ssh/sshd_config.d/90-pingpongpaidegua-hardening.conf"
FAIL2BAN_JAIL="/etc/fail2ban/jail.d/pingpongpaidegua.local"

sudo mkdir -p /etc/ssh/sshd_config.d
cat <<'EOF' | sudo tee "$SSHD_SNIPPET" >/dev/null
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
MaxAuthTries 4
LoginGraceTime 30
AllowUsers ubuntu
EOF

sudo sshd -t
sudo systemctl reload ssh

sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban ufw

cat <<'EOF' | sudo tee "$FAIL2BAN_JAIL" >/dev/null
[sshd]
enabled = true
backend = systemd
port = ssh
maxretry = 6
findtime = 10m
bantime = 1h
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client restart

sudo ufw allow 22/tcp
sudo ufw limit 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "SSH hardening, fail2ban e ufw aplicados com sucesso."
