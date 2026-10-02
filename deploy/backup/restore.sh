#!/bin/sh
# Extrait une sauvegarde dans /restore/<dossier> (dossier ./restore sur le serveur).
# Utilisé par deploy/restore.sh ; sans argument, liste les sauvegardes disponibles.
set -eu
ID="${1:-}"
NAME="${2:-$(date +%Y%m%d-%H%M%S)}"
if [ -z "${ID}" ]; then
  echo "Sauvegardes disponibles (heure de Paris) — choisissez celle d'AVANT l'incident :"
  restic snapshots --host haccp --compact
  exit 0
fi
TARGET="/restore/${NAME}"
mkdir -p "${TARGET}"
restic restore "${ID}" --host haccp --target "${TARGET}"
test -f "${TARGET}/data/snapshots/haccp.db" || { echo "✖ La sauvegarde ne contient pas de base de données." >&2; exit 1; }
echo "✔ Sauvegarde ${ID} extraite dans ./restore/${NAME}"
