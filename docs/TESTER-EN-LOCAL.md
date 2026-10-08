# Tester le logiciel sur votre ordinateur

Aucun serveur, aucun achat : le logiciel tourne sur votre ordinateur, et vous pouvez l'ouvrir depuis une tablette ou un téléphone connecté à la même box Wi-Fi.

## 1. Installer Node.js (une seule fois, 5 min)

Téléchargez la version **LTS** sur **https://nodejs.org/fr** et installez-la en gardant les options proposées par défaut.

## 2. Télécharger le logiciel

1. Sur GitHub, ouvrez le dépôt **Badshield/HACCP** (connecté à votre compte).
2. Bouton vert **Code** → **Download ZIP**.
3. **Décompressez** le fichier, par exemple dans *Documents*.

## 3. Lancer

| Windows | Mac |
|---|---|
| Double-cliquez sur **`demarrer.bat`**. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur *Informations complémentaires* puis *Exécuter quand même*. | **Clic droit** sur **`demarrer.command`** → *Ouvrir* → *Ouvrir*. Le clic droit n'est nécessaire que la première fois, à cause de la protection des fichiers téléchargés. |

Au premier lancement, l'installation prend environ une minute, puis un **restaurant de démonstration** est créé avec deux semaines de relevés. Le navigateur s'ouvre ensuite sur **http://localhost:3000**.

- **Compte de démonstration** : `demo@haccp.local`, mot de passe `demo1234`.
- **Laissez la fenêtre noire ouverte** pendant vos tests. Fermez-la pour arrêter le logiciel.

> Si le fichier ne se lance pas sur Mac (« permission refusée »), ouvrez le Terminal dans le dossier et tapez `chmod +x demarrer.command`, ou bien lancez directement `npm ci`, `npm run seed`, puis `npm start`.

## 4. Sur une tablette ou un téléphone

La fenêtre noire affiche une ligne comme celle-ci :

```
Depuis une tablette ou un téléphone sur le même Wi-Fi : http://192.168.1.23:3000
```

Tapez cette adresse dans le navigateur de la tablette, connectée **à la même box**. Au premier lancement, Windows ou Mac vous demande d'autoriser les connexions entrantes pour Node.js : acceptez **pour les réseaux privés**.

## 5. Quoi tester ? (environ 30 minutes)

L'application s'organise en 4 onglets : **Aujourd'hui**, **Saisir**, **Alertes** et **Plus**.

- [ ] **Page d'accueil** (http://localhost:3000) : lisez-la comme si vous étiez un restaurateur.
- [ ] **Inscription** d'un nouvel établissement avec un modèle de métier (*Essai gratuit*) : les équipements et le plan de nettoyage sont-ils réalistes pour ce métier ? Le cadre « Pour bien démarrer » sur *Aujourd'hui* est-il clair ?
- [ ] **Aujourd'hui → températures** : tapez une valeur normale dans une carte (l'indication « conforme » apparaît dès que vous tapez), puis une valeur hors limite (8 °C dans un frigo). La fenêtre « Action corrective » s'ouvre-t-elle ? Est-il compréhensible sans explication ?
- [ ] **Congélateur** : le signe « − » est-il déjà choisi ? Pensez-vous à le changer pour un frigo ?
- [ ] **Journée complète** : une fois tous les relevés et nettoyages faits, le bandeau du haut passe au vert et affiche une coche. Est-ce assez clair pour savoir qu'il n'y a plus rien à faire ?
- [ ] **Alertes** : clôturez une alerte (« Clôturer l'alerte »), puis recommencez en choisissant « Noter l'action, alerte à suivre » : l'alerte doit rester ouverte.
- [ ] **Saisir → Réception** avec une photo prise à la tablette ou au téléphone. Le bouton « Plus de détails » (lot, commentaire) est-il facile à trouver ?
- [ ] **Saisir → Étiquette DLC** : touchez un produit fréquent, enregistrez et imprimez l'étiquette.
- [ ] **Saisir → Refroidissement** : saisissez la durée en minutes (par exemple 90) et la température finale. Un refroidissement de 150 minutes doit être signalé non conforme.
- [ ] **Plus → Allergènes** : ajoutez un plat, puis touchez un allergène pour filtrer la liste, et imprimez le tableau.
- [ ] **Tablette de cuisine** : *Plus → Paramètres* → donnez un code PIN à un employé → *Utiliser cet appareil comme tablette de cuisine* → touchez le nom, tapez le code puis ✓.
- [ ] **Plus → Préparer un contrôle** : éditez le classeur HACCP en PDF. Est-il présentable devant un inspecteur ?
- [ ] **Sur téléphone, puis sur ordinateur** : la mise en page reste-t-elle lisible et les boutons assez gros ?

Notez tout ce qui vous surprend, vous gêne ou manque. Ce sont ces retours qui rendront le logiciel vendable.

## Bon à savoir

- **Les données restent sur votre ordinateur**, dans le dossier `data`. Elles ne sont pas sauvegardées ailleurs : ne mettez pas de vrais clients en production sur un ordinateur.
- **Aucun e-mail ne part en local.** Les messages (rappels, mot de passe oublié) s'affichent dans la fenêtre noire.
- **Repartir de zéro** : arrêtez le logiciel, supprimez le dossier `data`, puis relancez. Un nouveau restaurant de démonstration est créé.
- **Nouvelle version** : retéléchargez le ZIP, et recopiez votre dossier `data` dans le nouveau dossier pour garder vos essais.
- La tablette n'est accessible que **chez vous, sur votre Wi-Fi**. Pour un test chez un vrai restaurant, il faudra la mise en ligne (voir [OVHCLOUD.md](OVHCLOUD.md)).
