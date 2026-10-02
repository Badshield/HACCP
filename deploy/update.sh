#!/usr/bin/env bash
# Met à jour l'application avec la dernière version du code.
#   ./deploy/update.sh
# La nouvelle version est construite pendant que l'ancienne tourne encore ;
# la coupure se limite à l'arrêt (instantané final), la sauvegarde et le redémarrage.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Récupération du code…"
git pull --ff-only

echo "▶ Construction de la nouvelle version (l'application reste en ligne)…"
docker compose build

echo "▶ Arrêt de l'application (instantané final de la base)…"
docker compose stop app

echo "▶ Sauvegarde avant redémarrage…"
docker compose exec -T backup backup.sh || echo "  ⚠ sauvegarde impossible (service de sauvegarde non configuré ?)"

echo "▶ Redémarrage…"
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

echo "▶ Vérification…"
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✔ Mise à jour terminée, l'application répond."
    exit 0
  fi
  sleep 2
done
echo "✖ L'application ne répond pas : consultez « docker compose logs app »." >&2
exit 1
