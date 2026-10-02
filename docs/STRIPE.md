# Configurer les paiements Stripe

Sans configuration Stripe, l'application fonctionne en accès illimité (pratique en développement ou pour une installation chez un client). Dès que les variables ci-dessous sont renseignées, les nouveaux clients bénéficient d'un **essai gratuit de 30 jours sans carte bancaire**, puis doivent s'abonner.

## Fonctionnement

1. Inscription : l'essai démarre et donne accès à tout (équivalent Pro).
2. Dans **Gestion → Abonnement**, l'administrateur choisit une offre et paie sur la page sécurisée **Stripe Checkout** (carte, codes promo, n° de TVA intracommunautaire).
3. Stripe prévient l'application par **webhook** : l'abonnement devient actif.
4. L'administrateur gère sa carte, change d'offre, télécharge ses factures ou résilie depuis le **portail client Stripe** (« Gérer mon abonnement et mes factures »).
5. Sans abonnement actif (fin d'essai, résiliation, impayé définitif), le compte passe en **lecture seule** : la consultation et les exports PDF/CSV restent possibles (les registres HACCP doivent rester accessibles), seules les nouvelles saisies sont bloquées.
6. En cas d'échec de paiement (`past_due`), Stripe relance automatiquement le client. L'accès est maintenu et un bandeau l'invite à mettre à jour sa carte.

| Offre | Prix | Limite |
|---|---|---|
| Essentiel | 19 € HT/mois | 3 utilisateurs actifs |
| Pro | 39 € HT/mois | illimité |

Les prix affichés dans l'application se modifient dans `server/billing.js` (`PLANS`). Ils doivent correspondre aux prix créés dans Stripe.

## Mise en place (environ 20 minutes)

1. **Créer un compte** sur https://dashboard.stripe.com et compléter les informations de l'entreprise (SIRET, IBAN).
2. **Créer les produits** (Catalogue de produits → Ajouter un produit) :
   - « Pack Hygiène Essentiel » : prix récurrent mensuel de 19 € HT ;
   - « Pack Hygiène Pro » : prix récurrent mensuel de 39 € HT.

   Copier les identifiants `price_...` dans `STRIPE_PRICE_ESSENTIEL` et `STRIPE_PRICE_PRO`.
3. **Clé API** (Développeurs → Clés API) : copier la clé secrète dans `STRIPE_SECRET_KEY`.
4. **Webhook** (Développeurs → Webhooks → Ajouter un endpoint) :
   - URL : `https://votre-domaine/api/billing/webhook`
   - Événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
   - Copier le « secret de signature » dans `STRIPE_WEBHOOK_SECRET`.
5. **Portail client** (Paramètres → Facturation → Portail client) : activer la mise à jour du moyen de paiement, l'historique des factures, l'annulation et le **changement d'offre entre vos deux produits**.
6. **Factures** (Paramètres → Facturation → Factures) : renseigner les mentions légales françaises (raison sociale, adresse, SIRET, n° de TVA, ou « TVA non applicable, art. 293 B du CGI » en franchise en base).
7. Optionnel : activer **Stripe Tax** et définir `STRIPE_AUTOMATIC_TAX=1` pour le calcul automatique de la TVA.
8. Définir `APP_URL` (adresse publique de l'application) et redémarrer.

## Tester en local

Utiliser les clés de **mode test** (`sk_test_...`) et la [CLI Stripe](https://stripe.com/docs/stripe-cli) :

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
# copier le whsec_... affiché dans STRIPE_WEBHOOK_SECRET, puis lancer l'application
```

Carte de test : `4242 4242 4242 4242`, n'importe quelle date future et n'importe quel CVC. Carte refusée : `4000 0000 0000 0341`.

## Passage en production

Remplacer toutes les clés et tous les `price_...` par ceux du **mode live**, recréer le webhook en mode live, et faire une première souscription réelle de vérification (que vous pourrez rembourser).
