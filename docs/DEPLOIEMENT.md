# Mettre l'application en ligne

Ce guide part de zéro : un nom de domaine, un serveur en France, et environ **une heure** de travail. Aucune compétence d'administrateur système n'est nécessaire : il suffit de copier les commandes.

## Ce que vous obtenez

```
 Internet ──HTTPS──▶ Caddy ──▶ Application (Node.js) ──▶ Base SQLite + photos
                     │  certificat automatique              │
                     │  redirection http → https            │ instantané toutes les heures
                     │                                      ▼
                     │                          Service de sauvegarde (restic)
                     │                                      │ chiffré, toutes les heures
                     ▼                                      ▼
               Vos clients                    Stockage objet S3 (autre datacenter)
```

- **HTTPS automatique** : Caddy obtient et renouvelle seul le certificat Let's Encrypt.
- **Sauvegardes chiffrées toutes les heures**, hors du serveur. Conservation : 24 sauvegardes horaires, 14 journalières, 8 hebdomadaires et 12 mensuelles. L'intégrité du dépôt est vérifiée chaque nuit.
- **Redémarrage automatique** après une panne ou un redémarrage du serveur.
- **Sécurité** : pare-feu, mises à jour de sécurité automatiques, application sans droits administrateur, en-têtes de sécurité (HSTS, CSP).
- **Vérification au démarrage** : l'application refuse de démarrer si un réglage critique manque.

## Budget indicatif

Prix à vérifier au moment de la commande.

| Poste | Exemple | Ordre de prix |
|---|---|---|
| Nom de domaine `.fr` | OVHcloud, Gandi | 7 à 15 € par an |
| Serveur (2 Go de RAM suffisent pour démarrer) | Scaleway (Paris), OVHcloud VPS (Roubaix, Gravelines) | 5 à 12 € par mois |
| Stockage des sauvegardes | Scaleway Object Storage, OVHcloud Object Storage | quelques centimes par Go et par mois |
| E-mails | Brevo (offre gratuite, 300 e-mails/jour) | 0 € pour démarrer |
| Supervision | UptimeRobot, Healthchecks.io (offres gratuites) | 0 € |

Une centaine d'établissements tient sans difficulté sur un petit serveur. Les photos occupent l'essentiel de l'espace disque.

---

## Étape 1 : nom de domaine et serveur

1. **Achetez un nom de domaine**, par exemple `pack-hygiene.fr`. L'application sera servie sur un sous-domaine comme `app.pack-hygiene.fr`, ou directement sur le domaine.
2. **Commandez un serveur** sous **Ubuntu 24.04**, hébergé en France :
   - Scaleway : *Instances* → région *Paris* → une petite instance (2 Go de RAM) ;
   - OVHcloud : *VPS* → datacenter français.

   Ajoutez votre **clé SSH** à la commande. C'est plus sûr qu'un mot de passe, et l'hébergeur explique comment la créer.
3. **Faites pointer le domaine vers le serveur.** Dans la zone DNS du domaine, créez un enregistrement **A** `app` → *adresse IPv4 du serveur* (et **AAAA** si vous avez une IPv6). Comptez quelques minutes à quelques heures de propagation.

## Étape 2 : stockage des sauvegardes

1. Créez un **bucket** de stockage objet, de préférence dans une autre région que le serveur. Par exemple, chez Scaleway : *Object Storage* → *Créer un bucket* → `pack-hygiene-sauvegardes`, région *Paris* ou *Amsterdam*, **privé**.
2. Créez une **clé d'API** (identifiant d'accès et clé secrète) limitée au stockage objet.
3. Notez l'adresse du dépôt :
   - Scaleway Paris : `s3:https://s3.fr-par.scw.cloud/pack-hygiene-sauvegardes/haccp` (région `fr-par`) ;
   - OVHcloud Gravelines : `s3:https://s3.gra.io.cloud.ovh.net/pack-hygiene-sauvegardes/haccp` (région `gra`).

## Étape 3 : installation du serveur

Connectez-vous au serveur (`ssh ubuntu@IP-du-serveur`, ou `root@…` selon l'hébergeur), puis :

```bash
git clone https://github.com/Badshield/HACCP.git haccp
cd haccp
sudo ./deploy/install.sh app.pack-hygiene.fr vous@pack-hygiene.fr
```

Le script installe Docker, active le pare-feu (SSH, HTTP et HTTPS seulement) et les mises à jour de sécurité automatiques, puis crée le fichier `.env`. Il y génère le secret de session et le mot de passe de chiffrement des sauvegardes.

**Déconnectez-vous puis reconnectez-vous** (`exit`, puis `ssh …` à nouveau), et revenez dans le dossier avec `cd haccp`. C'est nécessaire pour utiliser Docker sans `sudo`.

> Si le dépôt GitHub est privé, `git clone` vous demandera de vous identifier. Le plus simple est une *deploy key* en lecture seule : GitHub → dépôt → *Settings* → *Deploy keys*.

## Étape 4 : configuration

Éditez le fichier `.env` (`nano .env`) et complétez :

| Section | À renseigner | Guide |
|---|---|---|
| Sauvegardes | `RESTIC_REPOSITORY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` | étape 2 ci-dessus |
| E-mails | `SMTP_*`, `MAIL_FROM`, `CONTACT_EMAIL` | [EMAILS.md](EMAILS.md) |
| Paiements | `STRIPE_*` (clés **live** pour encaisser réellement) | [STRIPE.md](STRIPE.md) |
| Informations légales | `LEGAL_*`, `HOST_*` | [LEGAL.md](LEGAL.md) |

⚠️ **Recopiez `RESTIC_PASSWORD` dans un gestionnaire de mots de passe**, hors du serveur. Si le serveur est perdu, ce mot de passe est le seul moyen de relire les sauvegardes.

Vérifiez la configuration :

```bash
docker compose run --rm --no-deps app node server/config.js
```

Les lignes **✖** bloquent le démarrage. Les lignes **⚠** signalent une fonction désactivée : sans Stripe par exemple, l'accès est gratuit et illimité.

## Étape 5 : démarrage

```bash
docker compose up -d --build
docker compose ps          # les 3 services doivent être « Up », l'application « healthy »
docker compose logs backup # doit se terminer par « ✔ Sauvegarde terminée. »
```

Ouvrez `https://app.pack-hygiene.fr` : la page d'accueil s'affiche, avec le cadenas HTTPS. Créez votre propre compte depuis « Essai gratuit » pour tester.

## Étape 6 : brancher les services externes

1. **Stripe** : déclarez le webhook `https://app.pack-hygiene.fr/api/billing/webhook` (voir [STRIPE.md](STRIPE.md)) et faites un vrai paiement de test, que vous rembourserez.
2. **E-mails** : authentifiez le domaine d'envoi (SPF, DKIM, DMARC), puis *Paramètres → Rappels et alertes → Envoyer un e-mail de test*.
3. **Supervision** (gratuite) :
   - **UptimeRobot** ou **Better Stack** : surveillez `https://app.pack-hygiene.fr/api/health` toutes les 5 minutes. Vous êtes prévenu si le site tombe. La réponse contient aussi `snapshot_age_min`, l'âge du dernier instantané de la base, qui doit rester inférieur à 60.
   - **Healthchecks.io** : créez un contrôle « toutes les heures, tolérance 30 min » et copiez son adresse dans `BACKUP_PING_URL`, puis `docker compose up -d`. Vous recevez un e-mail si une sauvegarde échoue ou n'a pas lieu.

## Étape 7 : tester une restauration (indispensable)

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Faites ce test une fois au lancement, puis une fois par trimestre :

```bash
./deploy/restore.sh            # liste les sauvegardes
./deploy/restore.sh 4f2a9c1b   # restaure celle choisie (remplacez par un identifiant réel)
```

Le script arrête l'application, extrait la sauvegarde, met de côté les données actuelles dans `data/avant-restauration-…`, remet en place la base et les photos, puis redémarre et vérifie que l'application répond.

---

## Au quotidien

| Besoin | Commande |
|---|---|
| Mettre à jour l'application | `./deploy/update.sh` (construit la nouvelle version, sauvegarde, puis redémarre : coupure de quelques secondes) |
| Voir l'état | `docker compose ps` |
| Lire les journaux | `docker compose logs -f app` (ou `caddy`, `backup`) |
| Lister les sauvegardes | `docker compose exec backup restic snapshots` |
| Lancer une sauvegarde maintenant | `docker compose exec backup backup.sh` |
| Redémarrer | `docker compose restart` |
| Vérifier la configuration | `docker compose exec app node server/config.js` |

## En cas de panne

**Le site ne répond plus.** Lancez `docker compose ps`, puis `docker compose logs --tail 100 app`. Un `docker compose up -d` relance ce qui est arrêté.

**Le serveur est perdu** (panne matérielle, piratage, résiliation) :
1. Commandez un nouveau serveur et refaites les étapes 1 (DNS vers la nouvelle IP) et 3.
2. Recopiez votre ancien `.env`, au minimum `RESTIC_*`, `AWS_*`, `JWT_SECRET` et les clés Stripe.
3. **Avant tout démarrage**, restaurez : `./deploy/restore.sh` puis `./deploy/restore.sh <ID>`.

⚠️ **Choisissez une sauvegarde datant d'avant l'incident.** Si l'application a redémarré sur une base vide, les sauvegardes les plus récentes peuvent contenir cette base vide : aidez-vous de la date et de la taille affichées.

## Et ensuite ?

- **Haute disponibilité** : au-delà de quelques centaines de clients, passez à PostgreSQL managé et à un stockage objet pour les photos (voir la feuille de route).
- **Réplication continue de la base**, avec perte de données de quelques secondes au lieu d'une heure : Litestream, à ajouter si vos clients l'exigent.
