# Pages légales et conformité RGPD

> ⚠️ Les textes fournis sont des **modèles de départ**, rédigés pour un logiciel SaaS vendu à des professionnels en France. Ils ne constituent pas un conseil juridique : **faites-les relire par un avocat ou un juriste** avant de commercialiser.

## Pages publiées

| Page | Adresse | Contenu |
|---|---|---|
| Mentions légales | `/legal/mentions` | Éditeur, directeur de la publication, hébergeur (obligatoires, loi LCEN) |
| CGV / CGU | `/legal/cgv` | Offres et prix (repris automatiquement de `server/billing.js`), essai, paiement, résiliation, responsabilité HACCP du client, réversibilité, limitation de responsabilité, tribunal compétent |
| Politique de confidentialité | `/legal/confidentialite` | Données collectées, finalités, bases légales, durées, sous-traitants (hébergeur, Stripe, e-mails), cookies, droits |
| Contrat de sous-traitance | `/legal/sous-traitance` | Accord prévu par l'article 28 du RGPD pour les données que vos clients saisissent (salariés, fournisseurs, photos) |

Les informations de votre entreprise sont lues dans les variables `LEGAL_*` et `HOST_*` (voir `.env.example`). Tant qu'une valeur manque, la page affiche **[À compléter]** en surbrillance.

## Ce que fait l'application

- **Acceptation à l'inscription** : case à cocher obligatoire. La date et la version acceptées sont enregistrées.
- **Mise à jour des CGV** : changez `TERMS_VERSION` dans `server/legal.js`. À leur prochaine connexion, les administrateurs doivent accepter la nouvelle version, et l'acceptation est tracée dans le journal d'audit.
- **Droit à la portabilité** : Paramètres → Mes données → export complet au format JSON.
- **Droit à l'effacement** : Paramètres → Mes données → suppression définitive. Il faut saisir le mot de passe et le nom de l'établissement. La suppression résilie l'abonnement Stripe et efface les données et les photos.
- **Cookies** : aucun. Le jeton de session est conservé dans le stockage local du navigateur ; il est strictement nécessaire, donc pas besoin de bannière de consentement.

## Votre liste de vérification avant de vendre

- [ ] Créer la structure juridique (micro-entreprise, SASU...) et obtenir le SIREN
- [ ] Renseigner toutes les variables `LEGAL_*` et `HOST_*`
- [ ] Faire relire les quatre documents par un juriste, en particulier la limitation de responsabilité et les durées de conservation
- [ ] Tenir votre **registre des traitements** (obligatoire, modèle sur cnil.fr)
- [ ] Signer les contrats de sous-traitance de vos propres prestataires (hébergeur, Stripe, fournisseur d'e-mails : ils sont généralement acceptés en ligne)
- [ ] Souscrire une **assurance responsabilité civile professionnelle** couvrant l'édition de logiciel
- [ ] Vérifier vos mentions de facture dans Stripe (SIREN, TVA ou franchise en base, pénalités de retard)
- [ ] Mettre en place la purge des comptes sans abonnement depuis 12 mois, annoncée dans les CGV (voir la feuille de route)
