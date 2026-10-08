# Pack Hygiène HACCP

Logiciel de gestion de l'hygiène alimentaire (méthode HACCP / Plan de Maîtrise Sanitaire) pour les professionnels des métiers de bouche : restaurants, boulangeries, boucheries, traiteurs, food-trucks, cantines…

Il remplace les classeurs papier par une application web utilisable sur tablette en cuisine. Lors d'un contrôle sanitaire (DDPP / DDETSPP), il édite en un clic un **classeur HACCP complet au format PDF**.

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| 🌡️ **Températures** | Relevé rapide par équipement (frigos, chambres froides, congélateurs, vitrines, maintien au chaud) : on tape la valeur, l'application dit tout de suite si c'est dans la norme. Seuils réglementaires par défaut, alerte immédiate en cas de dépassement. |
| 🧽 **Plan de nettoyage** | Tâches par zone avec produit, méthode et fréquence. Liste « à faire » du jour, validation en un geste. |
| 📦 **Réceptions** | Contrôle des livraisons : température selon la catégorie, emballage, DLC, n° de lot, fournisseur. |
| ❄️ **Refroidissement rapide** | +63 °C → +10 °C en moins de 2 h : on saisit la durée et la température finale, la conformité est calculée automatiquement. |
| 🔥 **Remise en température** | Atteindre +63 °C en moins d'1 h. |
| 🍟 **Huiles de friture** | Suivi du taux de composés polaires (≤ 25 %). |
| 🏷️ **Étiquettes DLC secondaires** | Produits entamés, fabriqués ou décongelés : DLC calculée, étiquette imprimable. |
| 🐭 **Nuisibles** | Registre des passages du prestataire et des contrôles. |
| ⚠️ **Non-conformités** | Créées **automatiquement** à chaque relevé hors limite. Un assistant demande « Qu'avez-vous fait ? » (déplacé les produits, appelé le frigoriste…) ; clôture uniquement avec une action corrective. |
| 🥜 **Allergènes** | Les 14 allergènes réglementaires (INCO) par plat : un client demande « sans gluten ? », on touche l'allergène et la liste des plats se filtre. Tableau imprimable pour la salle. |
| 🎓 **Formations** | Suivi des formations hygiène du personnel et de leurs échéances. |
| 📄 **Rapports** | Classeur HACCP PDF complet ou par registre, exports CSV (Excel). |
| 🧩 **Modèles de métiers** | À l'inscription : restaurant, boulangerie, boucherie, traiteur, food-truck ou restauration collective. Équipements, plan de nettoyage et durées de vie préremplis. |
| 💳 **Abonnements** | Essai gratuit de 30 jours, paiement Stripe, portail client, lecture seule sans abonnement (voir [docs/STRIPE.md](docs/STRIPE.md)). |
| 📷 **Photos** | Bon de livraison, étiquette, produit non conforme, traces de nuisibles : prises au téléphone, compressées automatiquement, ajoutées en annexe du classeur PDF. |
| ⚖️ **Pages légales et RGPD** | Mentions légales, CGV, confidentialité, contrat de sous-traitance ; acceptation tracée, export complet et suppression du compte (voir [docs/LEGAL.md](docs/LEGAL.md)). |
| 🔔 **Rappels et alertes** | E-mail si les températures ne sont pas relevées à l'heure, alerte immédiate à chaque non-conformité, récapitulatif du soir (voir [docs/EMAILS.md](docs/EMAILS.md)). |
| 🔑 **Mot de passe oublié** | Lien sécurisé à usage unique, déconnexion des autres sessions. |
| 🔢 **Tablette de cuisine** | Chaque employé touche son nom et tape son code PIN : saisies signées par la bonne personne, sans e-mail ni mot de passe partagé. Droits limités, déconnexion après 3 min d'inactivité, blocage après 5 erreurs. |
| 🌐 **Page d'accueil commerciale** | Présentation, tarifs (synchronisés avec la facturation), FAQ, formulaire de demande de démo envoyé par e-mail. |
| 🏠 **Page « Aujourd'hui »** | Ce qu'il reste à faire aujourd'hui, avec une jauge de progression, la série de jours réussis et la semaine en un coup d'œil. Un écran unique pour l'équipe, sans menu à fouiller. |
| 📊 **Statistiques** | Taux de conformité sur 30 jours, non-conformités, activité (pour le responsable). |

### Une interface pensée pour les mains pleines

- **4 onglets seulement** : *Aujourd'hui* (la liste du jour), *Saisir* (réception, étiquette, refroidissement… en grosses tuiles), *Alertes*, *Plus* (le reste : équipements, statistiques, paramètres).
- **Un geste par tâche** : relevé de température = taper la valeur + OK ; nettoyage = « C'est fait ».
- **Retour immédiat** : ✓ vert quand c'est conforme, message d'aide et assistant d'action corrective quand ça ne l'est pas, confettis quand la journée est complète (désactivés si l'appareil demande « réduire les animations »).
- **Les formulaires ne demandent que l'essentiel** ; lot, commentaire et autres précisions sont sous « Plus de détails ». Aucun champ qui influe sur la conformité n'est prérempli à l'insu de l'utilisateur.
- **Gros boutons, tactile d'abord**, barre d'onglets en bas sur téléphone et tablette, menu latéral sur ordinateur.

### Points forts pour un usage professionnel

- **Multi-clients (SaaS)** : chaque établissement a son espace, les données sont strictement isolées (testé).
- **Registres non modifiables** : un relevé ne peut être ni modifié ni supprimé, ce qui préserve sa valeur de preuve. Chaque saisie est horodatée et attribuée à un utilisateur, avec un journal d'audit.
- **Rôles** : *Administrateur* (gère tout), *Responsable* (gère équipements, plan de nettoyage, fournisseurs…), *Employé* (saisit les relevés).
- **Application installable (PWA)** sur tablette et smartphone, interface adaptée au tactile.
- **Sécurité** : mots de passe hachés (bcrypt), sessions JWT, limitation des tentatives de connexion, en-têtes de sécurité.

## Tester sur votre ordinateur, sans rien installer de compliqué

Installez [Node.js](https://nodejs.org/fr) (version LTS), puis double-cliquez sur **`demarrer.bat`** (Windows) ou **`demarrer.command`** (Mac). Guide complet et scénarios de test : **[docs/TESTER-EN-LOCAL.md](docs/TESTER-EN-LOCAL.md)**.

## Démarrage rapide

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run seed     # crée un établissement de démo : demo@haccp.local / demo1234
npm start        # page d'accueil : http://localhost:3000, application : http://localhost:3000/app
```

Tests automatisés :

```bash
npm test
```

## Installer une tablette de cuisine

1. Sur la tablette, connectez-vous avec un compte responsable ou administrateur.
2. **Paramètres → Utilisateurs** : donnez un code PIN à chaque employé (bouton « Code PIN »), ou créez un « Employé sans e-mail ».
3. **Paramètres → Tablettes de cuisine → Utiliser cet appareil comme tablette de cuisine.**
4. Ajoutez la page à l'écran d'accueil de la tablette. Chacun touche son nom, tape son code et saisit ses relevés.

Une tablette perdue ou volée se retire en un clic depuis les Paramètres : les sessions ouvertes dessus sont immédiatement coupées.

## Mise en production

Tout est prêt pour un serveur Ubuntu en France : HTTPS automatique (Caddy), sauvegardes chiffrées toutes les heures vers un stockage S3 (restic), pare-feu, mises à jour de sécurité, scripts de mise à jour et de restauration testés.

```bash
sudo ./deploy/install.sh app.mon-domaine.fr vous@mon-domaine.fr   # prépare le serveur et le fichier .env
nano .env                                                         # complète la configuration
docker compose up -d --build                                      # démarre l'application
```

👉 Guide pas à pas, budget et procédure en cas de panne : **[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)**.

Guides complémentaires : [paiements Stripe](docs/STRIPE.md), [e-mails](docs/EMAILS.md), [pages légales](docs/LEGAL.md). Pour vérifier la configuration à tout moment : `npm run check-config`.

## Architecture

```
server/
  index.js      démarrage
  app.js        API : authentification, utilisateurs, non-conformités, tableau de bord
  today.js      page « Aujourd'hui » : tâches du jour, progression, série, semaine (fuseau de l'établissement)
  modules.js    déclaration des modules HACCP (champs, règles, NC automatiques)
  resource.js   moteur générique : validation, isolation par client, registres en ajout seul
  rules.js      règles de conformité réglementaires (fonctions pures, testées)
  reports.js    exports PDF / CSV
  billing.js    abonnements Stripe (Checkout, portail, webhook, lecture seule)
  templates.js  modèles de démarrage par métier
  mailer.js     envoi d'e-mails (SMTP) et mise en forme
  reminders.js  rappels planifiés et alertes de non-conformité
  photos.js     photos jointes aux enregistrements (stockage disque, quota)
  legal.js      pages légales (CGV, confidentialité, sous-traitance RGPD)
  kiosk.js      tablette de cuisine partagée et connexion par code PIN
  landing.js    page d'accueil commerciale et formulaire de démo
  config.js     vérification de la configuration de production
  backup.js     instantanés cohérents de la base pour les sauvegardes
deploy/         installation du serveur, Caddy (HTTPS), sauvegardes restic, mise à jour, restauration
  db.js         schéma SQLite
  seed.js       données de démonstration
public/         interface web (HTML/CSS/JS sans étape de compilation, PWA)
  core.js       outils partagés : appels API, formulaires, formats, fenêtres
  home.js       page « Aujourd'hui », « Saisir », « Alertes », « Plus » et assistant d'action corrective
  photos.js     prise de photo, compression, galerie
  fun.js        retours visuels : coche, confettis, vibration
  app.js        routage, authentification, pages des registres
test/           tests automatisés (node:test)
docs/           feuille de route produit et commerciale
```

Pour ajouter un nouveau registre : créer la table dans `db.js`, le déclarer dans `modules.js` (champs + règle de conformité), l'ajouter à `REGISTERS` dans `reports.js`, puis créer sa page avec `logPage(...)` dans `public/app.js` et la placer dans `PAGE_PLACE` (onglet *Saisir* ou *Plus*) ainsi que, si besoin, dans les tuiles de `capturePage` / `MORE` de `public/home.js`.

## Avertissement

Les seuils intégrés reprennent la réglementation française et le GBPH Restaurateur. Ils doivent être validés par chaque établissement dans son Plan de Maîtrise Sanitaire. Le logiciel est un outil d'aide et ne se substitue pas à la responsabilité de l'exploitant.
