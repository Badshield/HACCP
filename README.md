# Pack Hygiène HACCP

Logiciel de gestion de l'hygiène alimentaire (méthode HACCP / Plan de Maîtrise Sanitaire) pour les professionnels des métiers de bouche : restaurants, boulangeries, boucheries, traiteurs, food-trucks, cantines…

Il remplace les classeurs papier par une application web utilisable sur tablette en cuisine. Lors d'un contrôle sanitaire (DDPP / DDETSPP), il édite en un clic un **classeur HACCP complet au format PDF**.

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| 🌡️ **Températures** | Relevé rapide par équipement (frigos, chambres froides, congélateurs, vitrines, maintien au chaud). Seuils réglementaires par défaut, alerte immédiate en cas de dépassement. |
| 🧽 **Plan de nettoyage** | Tâches par zone avec produit, méthode et fréquence. Liste « à faire » du jour, validation en un geste. |
| 📦 **Réceptions** | Contrôle des livraisons : température selon la catégorie, emballage, DLC, n° de lot, fournisseur. |
| ❄️ **Refroidissement rapide** | +63 °C → +10 °C en moins de 2 h, calcul automatique de la durée et de la conformité. |
| 🔥 **Remise en température** | Atteindre +63 °C en moins d'1 h. |
| 🍟 **Huiles de friture** | Suivi du taux de composés polaires (≤ 25 %). |
| 🏷️ **Étiquettes DLC secondaires** | Produits entamés, fabriqués ou décongelés : DLC calculée, étiquette imprimable. |
| 🐭 **Nuisibles** | Registre des passages du prestataire et des contrôles. |
| ⚠️ **Non-conformités** | Créées **automatiquement** à chaque relevé hors limite. Clôture uniquement avec une action corrective. |
| 🥜 **Allergènes** | Tableau des 14 allergènes réglementaires (INCO) par plat, imprimable pour la salle. |
| 🎓 **Formations** | Suivi des formations hygiène du personnel et de leurs échéances. |
| 📄 **Rapports** | Classeur HACCP PDF complet ou par registre, exports CSV (Excel). |
| 🧩 **Modèles de métiers** | À l'inscription : restaurant, boulangerie, boucherie, traiteur, food-truck ou restauration collective. Équipements, plan de nettoyage et durées de vie préremplis. |
| 💳 **Abonnements** | Essai gratuit de 30 jours, paiement Stripe, portail client, lecture seule sans abonnement (voir [docs/STRIPE.md](docs/STRIPE.md)). |
| 🔔 **Rappels et alertes** | E-mail si les températures ne sont pas relevées à l'heure, alerte immédiate à chaque non-conformité, récapitulatif du soir (voir [docs/EMAILS.md](docs/EMAILS.md)). |
| 🔑 **Mot de passe oublié** | Lien sécurisé à usage unique, déconnexion des autres sessions. |
| 📊 **Tableau de bord** | Équipements à relever, nettoyages en retard, NC ouvertes, taux de conformité sur 30 jours. |

### Points forts pour un usage professionnel

- **Multi-clients (SaaS)** : chaque établissement a son espace, les données sont strictement isolées (testé).
- **Registres non modifiables** : un relevé ne peut être ni modifié ni supprimé, ce qui préserve sa valeur de preuve. Chaque saisie est horodatée et attribuée à un utilisateur, avec un journal d'audit.
- **Rôles** : *Administrateur* (gère tout), *Responsable* (gère équipements, plan de nettoyage, fournisseurs…), *Employé* (saisit les relevés).
- **Application installable (PWA)** sur tablette et smartphone, interface adaptée au tactile.
- **Sécurité** : mots de passe hachés (bcrypt), sessions JWT, limitation des tentatives de connexion, en-têtes de sécurité.

## Démarrage rapide

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run seed     # crée un établissement de démo : demo@haccp.local / demo1234
npm start        # http://localhost:3000
```

Tests automatisés :

```bash
npm test
```

## Mise en production

```bash
docker build -t haccp .
docker run -d -p 3000:3000 -e JWT_SECRET="$(openssl rand -hex 32)" -v haccp-data:/app/data haccp
```

Pour activer les paiements, suivez [docs/STRIPE.md](docs/STRIPE.md). Pour l'envoi des e-mails (rappels, mot de passe oublié), suivez [docs/EMAILS.md](docs/EMAILS.md).

Placez l'application derrière un reverse proxy HTTPS (Caddy, Nginx, Traefik) et définissez `TRUST_PROXY=1`. Voir `.env.example` pour toutes les variables. **Sauvegardez régulièrement le dossier `data/`** : il contient la base de données.

## Architecture

```
server/
  index.js      démarrage
  app.js        API : authentification, utilisateurs, non-conformités, tableau de bord
  modules.js    déclaration des modules HACCP (champs, règles, NC automatiques)
  resource.js   moteur générique : validation, isolation par client, registres en ajout seul
  rules.js      règles de conformité réglementaires (fonctions pures, testées)
  reports.js    exports PDF / CSV
  billing.js    abonnements Stripe (Checkout, portail, webhook, lecture seule)
  templates.js  modèles de démarrage par métier
  mailer.js     envoi d'e-mails (SMTP) et mise en forme
  reminders.js  rappels planifiés et alertes de non-conformité
  db.js         schéma SQLite
  seed.js       données de démonstration
public/         interface web (HTML/CSS/JS sans étape de compilation, PWA)
test/           tests automatisés (node:test)
docs/           feuille de route produit et commerciale
```

Pour ajouter un nouveau registre : créer la table dans `db.js`, le déclarer dans `modules.js` (champs + règle de conformité), l'ajouter à `REGISTERS` dans `reports.js`, puis créer sa page avec `logPage(...)` dans `public/app.js`.

## Avertissement

Les seuils intégrés reprennent la réglementation française et le GBPH Restaurateur. Ils doivent être validés par chaque établissement dans son Plan de Maîtrise Sanitaire. Le logiciel est un outil d'aide et ne se substitue pas à la responsabilité de l'exploitant.
