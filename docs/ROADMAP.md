# Feuille de route : du MVP au produit commercial

## Version 0.1 (livrée) : MVP fonctionnel

Tous les registres HACCP essentiels, multi-clients, rôles, non-conformités automatiques, classeur PDF pour les contrôles, PWA. Elle suffit pour des **clients pilotes** (2 à 5 établissements, gratuitement ou à prix réduit, en échange de retours).

## Version 0.2 : prête à vendre

Indispensable avant d'encaisser des abonnements :

- [x] **Paiement et abonnements** (Stripe Billing) : essai gratuit de 30 jours, puis lecture seule si l'abonnement n'est pas payé
- [x] **Mot de passe oublié** (envoi SMTP : Brevo, Scaleway, Postmark...)
- [ ] Vérification de l'adresse e-mail à l'inscription
- [x] **Rappels automatiques par e-mail** : relevés oubliés, alerte immédiate de non-conformité, récapitulatif du soir
- [ ] Rappels par SMS (Brevo SMS) pour les alertes critiques
- [x] **Modèles de démarrage par métier** (restaurant, boulangerie, boucherie, traiteur, food-truck, collectivité) : équipements, plan de nettoyage et durées de vie préremplis à l'inscription
- [ ] **Photos** jointes aux réceptions et aux non-conformités (bon de livraison, étiquette, produit)
- [ ] **Connexion par code PIN** pour les employés sur la tablette partagée de la cuisine
- [ ] **Sauvegardes automatiques** chiffrées et hors site (Litestream vers S3 pour SQLite)
- [ ] Pages légales : CGV/CGU, politique de confidentialité, mentions légales, **contrat de sous-traitance RGPD** (DPA)
- [ ] Hébergement en France ou dans l'UE (Scaleway, OVHcloud, Clever Cloud)

## Version 0.3 : différenciation

- [ ] **Sondes de température connectées** (Bluetooth / LoRa / Wi-Fi) : relevés automatiques 24 h/24 et alertes de nuit. C'est le principal argument face au papier, et un revenu matériel récurrent
- [ ] **Multi-établissements** : un compte « groupe » ou « franchise » avec tableau de bord consolidé
- [ ] **Impression d'étiquettes** sur imprimante thermique (Brother, Zebra)
- [ ] **Traçabilité amont/aval** : lien lot reçu → préparation → étiquette
- [ ] **Mode hors ligne** avec synchronisation (saisie même sans Wi-Fi en chambre froide)
- [ ] **Plan de Maîtrise Sanitaire** généré : document PMS complet (analyse des dangers, CCP, procédures) à partir des données saisies
- [ ] Application mobile native (Capacitor) si besoin pour les stores

## Version 1.0 : passage à l'échelle

- [ ] Migration de SQLite vers PostgreSQL au-delà d'une centaine de clients actifs
- [ ] Espace **revendeur / consultant** (les consultants hygiène sont un excellent canal de vente)
- [ ] Audit interne guidé (grille d'autocontrôle) et score d'hygiène
- [ ] Préparation au contrôle : simulation de la grille « Alim'confiance »
- [ ] API publique / intégrations caisse (Lightspeed, Zelty, L'Addition…)

---

## Pistes commerciales

**Cible prioritaire** : restaurants indépendants et petites chaînes (environ 175 000 restaurants en France, tous soumis à l'obligation HACCP). Ensuite : boulangeries, boucheries, traiteurs, food-trucks, EHPAD, cantines.

**Prix pratiqués par le marché (indicatifs, à vérifier)** : entre 20 et 80 € HT par mois et par établissement selon les options, avec un supplément pour les sondes connectées.

Proposition de grille :

| Offre | Prix indicatif | Contenu |
|---|---|---|
| Essentiel | 19 € HT/mois | Tous les registres, PDF de contrôle, 3 utilisateurs |
| Pro | 39 € HT/mois | + rappels, photos, utilisateurs illimités, étiquettes |
| Connecté | 39 € + 5 €/sonde/mois | + sondes de température et alertes 24 h/24 |
| Groupe | sur devis | Multi-sites, tableau de bord consolidé |

**Canaux d'acquisition** :
1. Consultants et formateurs en hygiène alimentaire (formation obligatoire de 14 h) : commission ou licence revendeur
2. Fournisseurs de produits d'entretien et grossistes (Metro, Promocash…)
3. Bouche-à-oreille entre restaurateurs (parrainage : un mois offert)
4. Référencement naturel : « classeur HACCP », « registre température frigo », « plan de nettoyage restaurant »
5. Salons (Sirha, Equip'Hôtel) et chambres de métiers (CMA, UMIH)

**Argument de vente principal** : « Fini le classeur papier. Prêt pour le contrôle sanitaire en un clic. »

**Avant de vendre** : créer la structure juridique (micro-entreprise ou SASU), souscrire une assurance RC professionnelle couvrant l'édition de logiciel, et faire relire les seuils réglementaires par un professionnel de l'hygiène alimentaire.
