# Feuille de route : du MVP au produit commercial

## Version 0.1 (livrée) : MVP fonctionnel

Tous les registres HACCP essentiels, multi-clients, rôles, non-conformités automatiques, classeur PDF pour les contrôles, PWA. Elle suffit pour des **clients pilotes** (2 à 5 établissements, gratuitement ou à prix réduit, en échange de retours).

## Version 0.2 : prête à vendre

Indispensable avant d'encaisser des abonnements :

- [x] **Paiement et abonnements** (Stripe Billing) : essai gratuit de 30 jours, puis lecture seule si l'abonnement n'est pas payé
- [x] **Mot de passe oublié** (envoi SMTP : Brevo, Scaleway, Postmark...)
- [x] **Portail prestataire** : création des clients par vous seul (plus d'inscription publique), e-mails rattachés, invitations, pilotage de l'accès, historique et registres en lecture seule, notes SAV
- [ ] Portail : authentification à deux facteurs pour les opérateurs
- [ ] Portail : « voir comme le client » (session en lecture seule, tracée) pour le SAV
- [ ] Portail : tickets de support avec échanges par e-mail avec le client
- [x] **Rappels automatiques par e-mail** : relevés oubliés, alerte immédiate de non-conformité, récapitulatif du soir
- [ ] Rappels par SMS (Brevo SMS) pour les alertes critiques
- [x] **Modèles de démarrage par métier** (restaurant, boulangerie, boucherie, traiteur, food-truck, collectivité) : équipements, plan de nettoyage et durées de vie préremplis à l'inscription
- [x] **Photos** jointes aux réceptions, non-conformités, nettoyages, process et nuisibles, avec annexe dans le classeur PDF
- [ ] Stockage des photos sur un service objet (S3 / Scaleway Object Storage) au-delà d'un serveur
- [x] **Connexion par code PIN** pour les employés sur la tablette partagée de la cuisine
- [x] Pas de page vitrine : l'adresse du site ouvre directement la page de connexion (un site commercial pourra être refait à part le moment venu)
- [x] **Interface simplifiée et sobre** (Material 3) : 4 onglets (Aujourd'hui, Saisir, Alertes, Plus), jauge de progression et jours consécutifs, saisie de température en un geste avec retour immédiat, assistant d'action corrective, formulaires réduits à l'essentiel, icônes et police embarquées
- [ ] Tester l'interface avec 3 ou 4 vrais restaurateurs (observer sans aider) et ajuster : libellés, ordre des rubriques de « Saisir », lisibilité en plein service
- [x] **Sauvegardes automatiques** chiffrées et hors site (restic vers S3, toutes les heures, restauration testée)
- [ ] Réplication continue de la base (Litestream) pour réduire la perte de données possible à quelques secondes
- [x] Pages légales : CGV/CGU, politique de confidentialité, mentions légales, **contrat de sous-traitance RGPD** (modèles à faire relire)
- [x] Export complet des données et suppression du compte (RGPD)
- [ ] Purge automatique des comptes sans abonnement depuis 12 mois (avec e-mail de préavis 30 jours avant)
- [x] Prêt pour un hébergement en France (Docker Compose, HTTPS automatique, guide pas à pas) — reste à commander le serveur

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
