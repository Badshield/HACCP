# E-mails : mot de passe oublié, rappels et alertes

## Ce qui est envoyé

| E-mail | Quand | Destinataires |
|---|---|---|
| **Réinitialisation du mot de passe** | Sur demande depuis « Mot de passe oublié ? ». Lien valable 1 h, utilisable une seule fois. | L'utilisateur concerné |
| **Relevé de températures oublié** | Aux heures de relevé choisies (par défaut 09:00 et 17:00), si un équipement n'a pas été relevé après le délai de tolérance (30 min par défaut). Un relevé fait jusqu'à 2 h avant l'heure prévue compte. | Administrateurs et responsables |
| **Alerte non-conformité** | Immédiatement, à chaque non-conformité (relevé hors limite, réception refusée, déclaration manuelle...). | Administrateurs et responsables |
| **Récapitulatif du soir** | À l'heure choisie (par défaut 20:00), **seulement s'il y a quelque chose à signaler** : équipements non relevés dans la journée, nettoyages non validés, non-conformités ouvertes, DLC secondaires du jour ou du lendemain, formations à renouveler (J-30, J-7, jour J). | Administrateurs et responsables |

Chaque établissement règle ses horaires et son fuseau horaire (DOM-TOM, Belgique, Suisse, Québec...) dans **Paramètres → Rappels et alertes**. Chaque responsable peut aussi couper ses propres rappels. Les comptes en lecture seule (abonnement terminé) ne reçoivent plus de rappels.

Un rappel n'est jamais envoyé deux fois, et un rappel manqué de plus de 2 h (serveur arrêté) est abandonné plutôt qu'envoyé en retard.

## Sécurité du mot de passe oublié

- La réponse est identique que l'adresse existe ou non : on ne peut pas savoir qui est client.
- Le lien contient un jeton aléatoire de 256 bits ; seule son empreinte (SHA-256) est stockée.
- Demandes limitées à 5 par quart d'heure et par adresse.
- Après un changement de mot de passe, **toutes les sessions ouvertes sont déconnectées** (téléphone perdu, ancien salarié...).
- En production, `APP_URL` est obligatoire : les liens ne sont jamais construits à partir de l'adresse de la requête, ce qui empêche leur détournement.

## Configurer l'envoi (SMTP)

N'importe quel fournisseur SMTP convient. Pour des e-mails transactionnels hébergés en France ou dans l'UE :

| Fournisseur | Serveur SMTP | Remarque |
|---|---|---|
| Brevo (ex-Sendinblue) | `smtp-relay.brevo.com`, port 587 | Français, offre gratuite (300 e-mails/jour), propose aussi les SMS |
| Scaleway Transactional Email | `smtp.tem.scaleway.com`, port 587 | Français, très bon marché |
| Postmark | `smtp.postmarkapp.com`, port 587 | Excellente délivrabilité |
| Mailjet | `in-v3.mailjet.com`, port 587 | Français |

Variables à définir (voir `.env.example`) :

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=votre-identifiant
SMTP_PASS=votre-cle-smtp
MAIL_FROM="Pack Hygiène <alertes@mon-domaine.fr>"
APP_URL=https://app.mon-domaine.fr
```

**Important pour ne pas finir en indésirables** : authentifiez votre domaine d'envoi chez le fournisseur (enregistrements DNS **SPF**, **DKIM** et **DMARC**) et utilisez une adresse `MAIL_FROM` de ce domaine.

Testez ensuite depuis **Paramètres → Rappels et alertes → Envoyer un e-mail de test**.

Sans `SMTP_HOST`, rien n'est envoyé : les e-mails sont affichés dans la console du serveur (pratique en développement pour récupérer un lien de réinitialisation).
