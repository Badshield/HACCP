#!/bin/sh
# Démarre la planification des sauvegardes (cron) après quelques vérifications.
set -eu

if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "⚠ Sauvegardes DÉSACTIVÉES : RESTIC_REPOSITORY et RESTIC_PASSWORD ne sont pas définis (voir docs/DEPLOIEMENT.md)."
  # On reste en vie sans rien faire, pour ne pas faire redémarrer le conteneur en boucle.
  while true; do sleep 3600; done
fi

# Crée le dépôt chiffré au premier lancement.
if ! restic cat config >/dev/null 2>&1; then
  echo "Initialisation du dépôt de sauvegarde ${RESTIC_REPOSITORY}…"
  restic init
fi

SCHEDULE="${BACKUP_CRON:-15 * * * *}"
echo "${SCHEDULE} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Sauvegardes planifiées : « ${SCHEDULE} » (fuseau ${TZ})."

# Première sauvegarde au démarrage pour vérifier immédiatement que tout fonctionne.
/usr/local/bin/backup.sh || true

exec crond -f -l 6
