# Releveo chez OVHcloud : domaine, serveur et sauvegardes

Plan choisi : **releveo.fr**, **VPS-1** pour le serveur, **Object Storage** pour les sauvegardes, le tout dans un seul compte OVHcloud.

> Les prix indiqués sont des ordres de grandeur relevés en octobre 2026 : OVHcloud a augmenté ses tarifs VPS en avril 2026. Vérifiez le prix affiché au moment de la commande.

| Élément | Choix | Coût indicatif |
|---|---|---|
| Domaine | `releveo.fr` | ~ 7 à 10 € par an |
| Serveur | VPS-1 (4 vCores, 8 Go de RAM, 75 Go NVMe), Ubuntu 24.04, sans engagement | ~ 6,50 à 8 € par mois |
| Sauvegardes | Object Storage *Standard*, API S3, **dans une autre ville que le serveur** | ~ 7 € par To et par mois, soit quelques centimes pour vos premiers Go |

---

## ☐ Étape 0 : vérifier le nom (5 min, gratuit)

1. Sur **data.inpi.fr**, cherchez `releveo`, puis des noms proches comme `relevoo` ou `relevo`.
2. Regardez surtout les marques déposées dans les **classes 9 et 42** (logiciels et services informatiques).
3. Si une marque très proche existe dans ces classes, choisissez une variante avant d'acheter le domaine.

## ☐ Étape 1 : compte OVHcloud et nom de domaine (10 min)

1. Créez un compte sur **ovhcloud.com** (en particulier ou en entreprise, selon votre situation).
2. Cherchez `releveo.fr` dans *Noms de domaine*. S'il est disponible, ajoutez-le au panier.
3. **Refusez les options proposées** : hébergement web, e-mails ou « DNS Anycast » ne sont pas nécessaires. Gardez la **zone DNS OVHcloud**, qui est gratuite.
4. Facultatif : `releveo.com` pour protéger le nom (~ 10 à 15 € par an).

## ☐ Étape 2 : votre clé SSH (5 min)

La clé SSH vous permet de vous connecter au serveur sans mot de passe, de façon sûre.

- **Windows** (PowerShell) ou **Mac / Linux** (Terminal) :
  ```
  ssh-keygen -t ed25519 -C "releveo"
  ```
  Appuyez sur Entrée pour accepter l'emplacement proposé. Choisissez une phrase de passe et notez-la.
- Affichez ensuite la **clé publique**, celle qui se partage :
  - Windows : `type $env:USERPROFILE\.ssh\id_ed25519.pub`
  - Mac / Linux : `cat ~/.ssh/id_ed25519.pub`
- Copiez la ligne qui commence par `ssh-ed25519 …`.

⚠️ Ne donnez **jamais** le fichier sans `.pub` : c'est votre clé privée.

## ☐ Étape 3 : le serveur VPS (10 min de commande, puis livraison en quelques minutes)

1. *Bare Metal & VPS* → *VPS* → **VPS-1**.
2. Choisissez :
   - **Localisation** : un datacenter **en France**, par exemple Gravelines (GRA). Notez celui choisi.
   - **Système** : **Ubuntu 24.04**, sans application préinstallée.
   - **Clé SSH** : collez la clé publique de l'étape 2.
   - **Durée** : mensuelle, sans engagement, pour démarrer.
   - **Options** : aucune. La sauvegarde automatique payante d'OVH est inutile, puisque Releveo a déjà ses sauvegardes chiffrées.
3. Vous recevrez un e-mail avec l'**adresse IPv4** (du type `51.xx.xx.xx`), l'**adresse IPv6** et l'**utilisateur** (en général `ubuntu`).
4. Testez la connexion : `ssh ubuntu@ADRESSE-IPV4`.

## ☐ Étape 4 : le stockage des sauvegardes (10 min)

1. *Public Cloud* → **créez un projet** (le projet lui-même est gratuit, mais il demande un moyen de paiement).
2. *Object Storage* → **Créer un conteneur d'objets** :
   - **API S3** et classe **Standard** ;
   - **Région** : une **autre ville que le serveur**. Si le serveur est à Gravelines, prenez Strasbourg (SBG) ou Roubaix (RBX), et inversement. Ainsi, un incendie ou une panne de datacenter n'emporte pas tout ;
   - **Nom** : unique et en minuscules, par exemple `releveo-sauvegardes-` suivi de quelques chiffres ;
   - **Privé**. Le chiffrement côté OVH est facultatif : restic chiffre déjà tout avant l'envoi.
3. *Object Storage* → *Utilisateurs S3* → **créez un utilisateur** et associez-le au conteneur, en lecture et écriture.
4. Notez l'**Access key** et la **Secret key**. La clé secrète ne s'affiche qu'une seule fois : rangez-la dans un gestionnaire de mots de passe.

Valeurs à reporter dans le `.env` du serveur, en remplaçant la région et le nom :

```
RESTIC_REPOSITORY=s3:https://s3.sbg.io.cloud.ovh.net/releveo-sauvegardes-XXXX/haccp
AWS_ACCESS_KEY_ID=<Access key>
AWS_SECRET_ACCESS_KEY=<Secret key>
AWS_DEFAULT_REGION=sbg
```

## ☐ Étape 5 : relier le domaine au serveur (5 min, puis propagation)

*Noms de domaine* → `releveo.fr` → *Zone DNS* → **modifiez ou ajoutez** :

| Type | Sous-domaine | Cible |
|---|---|---|
| A | *(vide)* | IPv4 du serveur |
| A | `www` | IPv4 du serveur |
| AAAA | *(vide)* | IPv6 du serveur |
| AAAA | `www` | IPv6 du serveur |

**Supprimez les anciens enregistrements A et AAAA** créés par défaut par OVH (ils pointent vers une page d'attente). Comptez de quelques minutes à quelques heures de propagation. Pour vérifier, `ping releveo.fr` doit répondre avec l'adresse du serveur.

Releveo sera servi sur **https://releveo.fr**, la page d'accueil et l'application sous `/app`. `www.releveo.fr` redirige automatiquement vers `releveo.fr`.

## ☐ Étape 6 : installation (20 min)

Suivez [DEPLOIEMENT.md](DEPLOIEMENT.md), étape 3, avec :

```
sudo ./deploy/install.sh releveo.fr votre@email.fr
```

Puis, dans `.env` : `APP_NAME=Releveo`, les quatre lignes de sauvegarde ci-dessus, et `HOST_NAME=OVH SAS`, `HOST_ADDRESS=2 rue Kellermann, 59100 Roubaix`, `HOST_PHONE=1007` pour les mentions légales (à vérifier sur ovhcloud.com).

Sans Stripe ni Brevo pour l'instant, l'application fonctionne normalement. L'accès est gratuit et illimité, les e-mails ne partent pas (la récupération de mot de passe ne fonctionnera donc pas), et la vérification de configuration l'indique par des ⚠, sans bloquer.
