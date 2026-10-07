#!/usr/bin/env bash
# Lance le logiciel en local (Mac et Linux) : double-cliquez sur ce fichier.
# Au premier lancement : installation et création d'un restaurant de démonstration.
cd "$(dirname "$0")" || exit 1
pause() { echo; read -r -p "Appuyez sur Entrée pour fermer cette fenêtre…" _; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé."
  echo "Installez la version « LTS » depuis https://nodejs.org/fr puis relancez ce fichier."
  command -v open >/dev/null && open "https://nodejs.org/fr"
  pause; exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js $(node -v) est trop ancien : installez la version « LTS » depuis https://nodejs.org/fr"
  pause; exit 1
fi

if [ ! -d node_modules ]; then
  echo "▶ Première utilisation : installation (une minute environ)…"
  npm ci || { echo "✖ Installation impossible (connexion internet ?)"; pause; exit 1; }
fi
if [ ! -f data/haccp.db ]; then
  echo "▶ Création du restaurant de démonstration…"
  npm run --silent seed
fi

echo
echo "▶ Démarrage. Compte de démonstration : demo@haccp.local / demo1234"
echo "  Laissez cette fenêtre ouverte pendant vos tests ; fermez-la pour arrêter le logiciel."
echo
( sleep 3; if command -v open >/dev/null; then open "http://localhost:3000"; elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:3000"; fi ) >/dev/null 2>&1 &
npm start
pause
