#!/usr/bin/env bash
# Prépare un serveur Ubuntu 24.04 neuf pour héberger l'application.
#   sudo ./deploy/install.sh app.mon-domaine.fr vous@mon-domaine.fr
# Installe Docker, active le pare-feu et les mises à jour de sécurité
# automatiques, puis crée le fichier .env avec un secret de session généré.
set -euo pipefail

DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"
if [[ -z "${DOMAIN}" || -z "${ACME_EMAIL}" ]]; then
  echo "Usage : sudo $0 <domaine> <e-mail>   ex. sudo $0 app.mon-domaine.fr vous@mon-domaine.fr" >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez ce script avec sudo." >&2
  exit 1
fi
cd "$(dirname "$0")/.."

echo "▶ Mises à jour du système…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw unattended-upgrades openssl

echo "▶ Mises à jour de sécurité automatiques…"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "▶ Docker…"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "▶ Pare-feu : SSH, HTTP et HTTPS uniquement…"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "▶ Fichier de configuration .env…"
if [[ -f .env ]]; then
  echo "  .env existe déjà : conservé tel quel."
else
  cp .env.example .env
  chmod 600 .env
  set_var() { sed -i "s|^$1=.*|$1=$2|" .env; }
  set_var JWT_SECRET "$(openssl rand -hex 32)"
  set_var RESTIC_PASSWORD "$(openssl rand -hex 24)"
  set_var DOMAIN "${DOMAIN}"
  set_var ACME_EMAIL "${ACME_EMAIL}"
  set_var APP_URL "https://${DOMAIN}"
  echo "  .env créé (secret de session et mot de passe des sauvegardes générés)."
fi

cat <<MSG

✔ Serveur prêt.

Étapes suivantes :
  1. Vérifiez que le DNS de ${DOMAIN} pointe vers l'adresse IP de ce serveur.
  2. Complétez .env : SMTP, Stripe, informations légales, sauvegardes (RESTIC_REPOSITORY…).
     ⚠ Recopiez RESTIC_PASSWORD dans un gestionnaire de mots de passe : sans lui,
       les sauvegardes sont illisibles.
  3. Vérifiez la configuration :  docker compose run --rm app node server/config.js
  4. Lancez :                     docker compose up -d --build
  5. Ouvrez https://${DOMAIN}

MSG
