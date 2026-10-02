#!/bin/sh
# Envoie l'instantané de la base et les photos vers le dépôt restic chiffré,
# applique la politique de rétention et signale le résultat (BACKUP_PING_URL).
set -u

DATA="${BACKUP_SOURCE:-/data}"
SNAPSHOT="${DATA}/snapshots/haccp.db"
ping_url() { [ -n "${BACKUP_PING_URL:-}" ] && wget -q -T 10 -O /dev/null "${BACKUP_PING_URL}$1"; true; }
fail() { echo "$(date '+%F %T') ✖ Sauvegarde ÉCHOUÉE : $1"; ping_url /fail; exit 1; }

echo "$(date '+%F %T') Sauvegarde en cours…"
[ -f "${SNAPSHOT}" ] || fail "aucun instantané de la base (${SNAPSHOT}) : l'application tourne-t-elle ?"

# Un instantané de plus de 3 heures signale un problème côté application.
AGE_MIN=$(( ( $(date +%s) - $(stat -c %Y "${SNAPSHOT}") ) / 60 ))
[ "${AGE_MIN}" -le 180 ] || fail "instantané trop ancien (${AGE_MIN} min)"

PATHS="${DATA}/snapshots"
[ -d "${DATA}/uploads" ] && PATHS="${PATHS} ${DATA}/uploads"

# shellcheck disable=SC2086
restic backup ${PATHS} --host haccp --tag haccp --exclude '*.tmp' || fail "restic backup"

restic forget --host haccp --tag haccp \
  --keep-hourly "${KEEP_HOURLY:-24}" --keep-daily "${KEEP_DAILY:-14}" \
  --keep-weekly "${KEEP_WEEKLY:-8}" --keep-monthly "${KEEP_MONTHLY:-12}" || fail "restic forget"

# Le nettoyage (plus long) et la vérification d'intégrité une fois par jour, la nuit.
if [ "$(date +%H)" = "${PRUNE_HOUR:-03}" ]; then
  restic prune || fail "restic prune"
  restic check --read-data-subset=5% || fail "restic check : dépôt endommagé"
fi

echo "$(date '+%F %T') ✔ Sauvegarde terminée."
ping_url ""
