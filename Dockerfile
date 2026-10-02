# Image de production de l'application HACCP.
FROM node:22-slim

ENV NODE_ENV=production \
    DB_FILE=/app/data/haccp.db \
    UPLOAD_DIR=/app/data/uploads \
    BACKUP_SNAPSHOT_DIR=/app/data/snapshots \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : aucune compilation ni script tiers à l'installation (plus sûr).
# better-sqlite3 embarque déjà son module compilé ; on vérifie qu'il se charge.
RUN npm ci --omit=dev --ignore-scripts \
 && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()" \
 && npm cache clean --force

COPY server ./server
COPY public ./public

# L'application ne tourne pas en root ; seules ses données sont modifiables.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
