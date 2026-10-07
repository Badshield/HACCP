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

- [ ] **Page d'accueil** (http://localhost:3000) : lisez-la comme si vous étiez un restaurateur.
- [ ] **Inscription** d'un nouvel établissement avec un modèle de métier (*Essai gratuit*) : les équipements et le plan de nettoyage sont-ils réalistes pour ce métier ?
- [ ] **Températures** : saisissez une valeur normale, puis une valeur hors limite (8 °C dans un frigo). L'alerte et la non-conformité s'affichent-elles ?
- [ ] **Non-conformités** : clôturez-en une avec une action corrective.
- [ ] **Réception** avec une photo prise à la tablette ou au téléphone.
- [ ] **Étiquette DLC** : imprimez-en une.
- [ ] **Tablette de cuisine** : *Paramètres* → donnez un code PIN à un employé → *Utiliser cet appareil comme tablette de cuisine* → connectez-vous avec le code.
- [ ] **Rapports** : éditez le classeur HACCP en PDF. Est-il présentable devant un inspecteur ?
- [ ] **Allergènes** : ajoutez un plat et imprimez le tableau.

Notez tout ce qui vous surprend, vous gêne ou manque. Ce sont ces retours qui rendront le logiciel vendable.

## Bon à savoir

- **Les données restent sur votre ordinateur**, dans le dossier `data`. Elles ne sont pas sauvegardées ailleurs : ne mettez pas de vrais clients en production sur un ordinateur.
- **Aucun e-mail ne part en local.** Les messages (rappels, mot de passe oublié) s'affichent dans la fenêtre noire.
- **Repartir de zéro** : arrêtez le logiciel, supprimez le dossier `data`, puis relancez. Un nouveau restaurant de démonstration est créé.
- **Nouvelle version** : retéléchargez le ZIP, et recopiez votre dossier `data` dans le nouveau dossier pour garder vos essais.
- La tablette n'est accessible que **chez vous, sur votre Wi-Fi**. Pour un test chez un vrai restaurant, il faudra la mise en ligne (voir [OVHCLOUD.md](OVHCLOUD.md)).
