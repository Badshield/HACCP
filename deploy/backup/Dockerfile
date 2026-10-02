# Sauvegardes chiffrées vers un stockage objet S3 (Scaleway, OVHcloud...) avec restic.
# L'image officielle contient déjà restic, les certificats, les fuseaux horaires, cron et wget.
FROM restic/restic:0.17.3
ENV TZ=Europe/Paris
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
