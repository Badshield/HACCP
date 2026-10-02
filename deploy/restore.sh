#!/usr/bin/env bash
# Restaure l'application à partir d'une sauvegarde restic.
#   ./deploy/restore.sh            → liste les sauvegardes
#   ./deploy/restore.sh 4f2a9c1b   → restaure cette sauvegarde
#
# ⚠ Après une panne, choisissez une sauvegarde datant d'AVANT l'incident :
#   si l'application a redémarré sur une base vide, les sauvegardes les plus
#   récentes peuvent contenir cette base vide.
set -euo pipefail
cd "$(dirname "$0")/.."
ID="${1:-}"

if [[ -z "${ID}" ]]; then
  docker compose run --rm --no-deps --entrypoint restore.sh backup
  echo
  echo "Relancez avec l'identifiant choisi :  ./deploy/restore.sh <ID>"
  exit 0
fi

NAME="restauration-$(date +%Y%m%d-%H%M%S)"
echo "▶ Arrêt de l'application et des sauvegardes automatiques…"
docker compose stop app backup

echo "▶ Extraction de la sauvegarde ${ID}…"
docker compose run --rm --no-deps --entrypoint restore.sh backup "${ID}" "${NAME}"

echo "▶ Mise en place des données (l'état actuel est conservé dans data/avant-${NAME})…"
docker compose run --rm --no-deps -v "$(pwd)/restore/${NAME}/data:/src:ro" --entrypoint sh app -c "
  set -e
  mkdir -p /app/data/avant-${NAME}
  for f in haccp.db haccp.db-wal haccp.db-shm uploads; do
    [ -e /app/data/\$f ] && mv /app/data/\$f /app/data/avant-${NAME}/ || true
  done
  cp /src/snapshots/haccp.db /app/data/haccp.db
  if [ -d /src/uploads ]; then cp -r /src/uploads /app/data/uploads; fi
  echo \"  base : \$(du -h /app/data/haccp.db | cut -f1), photos : \$(find /app/data/uploads -type f 2>/dev/null | wc -l) fichier(s)\"
"

echo "▶ Redémarrage…"
docker compose up -d
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✔ Restauration terminée. Vérifiez vos données dans l'application."
    echo "  Les fichiers extraits restent dans ./restore/${NAME} (à supprimer une fois vérifié)."
    exit 0
  fi
  sleep 2
done
echo "✖ L'application ne répond pas : consultez « docker compose logs app »." >&2
exit 1
