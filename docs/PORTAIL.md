# Le portail prestataire

Il n'y a **aucune inscription publique** : c'est vous (et votre équipe SAV) qui créez chaque client depuis le portail, à l'adresse **`/portal`** (par exemple `https://releveo.fr/portal`). Chaque client n'accède qu'à son propre espace, sur `/app`, et rien d'autre.

## Ce que vous pouvez faire

| Besoin | Où |
|---|---|
| **Créer un client** : établissement, métier (équipements et plan de nettoyage préremplis), administrateur | *Clients → Nouveau client* |
| **Rattacher les bonnes adresses e-mail** : ajouter une personne, changer son adresse, son rôle, la désactiver | Fiche client → *Utilisateurs* |
| **Inviter** : chaque personne reçoit un lien pour choisir son mot de passe ; le lien est aussi affiché à l'écran pour vous | à la création, puis *Envoyer un nouveau lien de connexion* |
| **Regrouper plusieurs sites** d'un même client (champ « Client ou groupe ») | création ou *Modifier* |
| **Piloter l'accès** : essai daté (prolongeable), actif (facturé par vos soins), suspendu (lecture seule), paiement en ligne si Stripe est configuré | Fiche client → *Résumé → Accès* |
| **Voir ce que fait le client** : dernière saisie, dernière connexion, alertes ouvertes, conformité, qui a fait quoi et quand | *Résumé*, *Activité*, et l'onglet *Activité* de l'accueil |
| **Consulter ses registres** (températures, nettoyage, réceptions…), en CSV ou PDF, et éditer son **classeur HACCP** | Fiche client → *Registres* ou *Classeur PDF* |
| **SAV** : notes internes (jamais visibles par le client) et journal des actions faites depuis le portail | Fiche client → *Notes SAV* |
| **Supprimer un client** (nom du client + votre mot de passe exigés) | Fiche client → *Résumé → Zone sensible* |
| **Ajouter un collègue** au portail | *Compte → Équipe du portail* |

Le portail est **en lecture seule sur les registres** : aucune route ne permet d'y modifier une saisie d'un client. Une saisie HACCP est une preuve ; elle doit rester celle du client.

## Premier accès : créer votre compte opérateur

Le portail n'a pas de mot de passe par défaut : vous créez votre accès en ligne de commande, sur la machine qui fait tourner l'application.

```bash
# En local (ordinateur de test)
npm run operator -- vous@exemple.fr "Votre Nom"

# Sur le serveur
docker compose exec app node server/operator-cli.js vous@exemple.fr "Votre Nom"
```

La commande affiche un **mot de passe aléatoire, une seule fois** : notez-le dans un gestionnaire de mots de passe, connectez-vous sur `/portal`, puis changez-le dans *Compte*. Relancer la même commande **réinitialise** le mot de passe de cet opérateur (utile en cas d'oubli). Mot de passe imposé : `... operator-cli.js vous@exemple.fr "Nom" "un-mot-de-passe-de-10-caracteres-ou-plus"`.

En test local, `npm run seed` crée un compte de démonstration : `operateur@haccp.local` / `operateur1234`, avec deux clients d'exemple.

## Comment un client démarre

1. Vous créez le client dans le portail (30 jours d'essai par défaut).
2. L'administrateur reçoit un e-mail « Votre espace … est prêt » avec un lien (7 jours, usage unique). Si les e-mails ne sont pas configurés, le portail affiche le lien : copiez-le et envoyez-le vous-même (SMS, WhatsApp…).
3. Il choisit son mot de passe, accepte les CGV à sa première connexion, puis ajoute son équipe : employés avec e-mail, ou « sans e-mail » avec un code PIN pour la tablette de cuisine.

Pour que le client voie le modèle prérempli en ouvrant l'application, choisissez son métier à la création.

## Accès des clients : quatre états

| État | Effet pour le client | Se pilote par |
|---|---|---|
| **Essai** | Tout fonctionne jusqu'à la date de fin ; un bandeau prévient 7 jours avant. Ensuite : lecture seule. | *Prolonger l'essai* |
| **Actif** | Tout fonctionne, sans date de fin. Vous gérez la facturation vous-même (facture, virement…). | *Passer en accès actif* |
| **Suspendu** | Lecture seule immédiate : il consulte et exporte ses registres, mais ne peut plus saisir. Message avec votre contact. | *Suspendre / Rétablir* |
| **Paiement en ligne** | Essai, puis abonnement Stripe (voir [STRIPE.md](STRIPE.md)). Proposé seulement si Stripe est configuré. | *Passer au paiement en ligne* |

La lecture seule est volontaire : les registres HACCP doivent rester consultables même en cas d'impayé, ce que demande un contrôle sanitaire.

Les clients voient votre adresse de contact dans le bandeau : renseignez `SUPPORT_EMAIL` dans `.env` (par défaut, `LEGAL_EMAIL`).

## Étanchéité et sécurité

- **Deux mondes séparés** : les opérateurs ont leur propre table, leurs propres jetons (signés avec une clé distincte) et leur propre page. Un jeton client n'ouvre pas le portail, un jeton opérateur n'ouvre aucun espace client (testé dans les deux sens).
- **Aucun client ne voit les autres** : l'isolation par établissement est inchangée et testée.
- **Journal** : chaque action faite depuis le portail est tracée (qui, quoi, quand) et visible dans *Notes SAV → Actions faites depuis le portail*. Les connexions des clients sont tracées aussi (« dernière connexion »).
- **Sessions** : 8 heures ; un changement de mot de passe coupe les autres sessions ; une désactivation coupe la session aussitôt. Connexion limitée à 5 essais par 15 minutes.
- La page `/portal` n'est jamais indexée par les moteurs de recherche.
- Garde-fous : un client garde toujours un administrateur actif ; on ne peut pas désactiver son propre compte opérateur.

### Pour aller plus loin (recommandé en production)

1. **Restreindre `/portal` à vos adresses IP** dans `deploy/Caddyfile`. Ajoutez ceci dans le bloc `{$DOMAIN} { … }`, juste avant `reverse_proxy app:3000` :

   ```
   @portail_interdit {
   	path /portal* /api/portal*
   	not remote_ip 203.0.113.10 198.51.100.0/24
   }
   respond @portail_interdit "Accès réservé." 403
   ```
   Remplacez les adresses par les vôtres, puis `docker compose restart caddy` et vérifiez depuis un autre réseau (4G) que `/portal` est refusé. Si votre adresse IP change souvent (box grand public), ne le faites pas : vous perdriez l'accès au portail.
2. Utiliser un mot de passe long, unique, stocké dans un gestionnaire.
3. L'authentification à deux facteurs pour les opérateurs n'est pas encore là (voir la [feuille de route](ROADMAP.md)).

## Ce qu'il faut savoir

- **Suppression d'un client** : irréversible (établissement, utilisateurs, registres, photos). Éditez son classeur PDF avant. Si le client demande lui-même l'effacement de ses données (RGPD), c'est le même mécanisme.
- **Adresses e-mail uniques** : une adresse ne peut appartenir qu'à un seul client. Pour un prestataire qui intervient chez plusieurs clients, utilisez une adresse par client.
- **Pas de « connexion en tant que »** : vous voyez l'activité et les registres du client depuis le portail, mais vous n'ouvrez pas sa session (ce qui évite de saisir à sa place par erreur). Dites-le-moi si vous en avez besoin : ce serait une session en lecture seule, tracée.
