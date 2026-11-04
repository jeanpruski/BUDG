# Récapitulatifs et sauvegardes par email

Deux événements distincts sont prévus :

- Le **1er du mois à midi, heure de Paris**, un récapitulatif du mois précédent. Il est indiqué provisoire si ce mois est encore ouvert.
- À la **clôture manuelle**, un bilan définitif de ce mois, avec l’état exact conservé dans la transaction de clôture.

Une clôture anticipée et le rendez-vous du 1er produisent chacun leur email. Les mois de préparation absents du suivi ne sont pas inventés : octobre 2026, écarté lors du démarrage en novembre, ne déclenche pas de récapitulatif financier.

## Ce que contient le message

L’email HTML présente les dépenses réellement enregistrées, les versements reçus, les contributions de chacun, le solde calculé du compte commun, les réserves financées et le pot commun. Un graphique intégré répartit les dépenses entre appartement, vie quotidienne et achats du pot. Le prévu reste distinct de l’argent réellement reçu ou payé. Les renforts du pot vers une enveloppe, les surplus libérés à la clôture d’une facture et leur reprise lors d’une réouverture sont identifiés comme mouvements internes, exclus des dépenses et des versements. La clôture mensuelle ajoute seulement le surplus qui n’a pas déjà été libéré. Les sauvegardes conservent ces mouvements, leur journal et les reports de réserve issus du pot. Clôturer une facture ne déclenche pas d’email ; les envois restent liés au mois.

Trois documents sont joints :

1. `bilan-AAAA-MM.pdf` : rapport lisible et imprimable, avec graphique, toutes les enveloppes et un aperçu des quinze opérations les plus récentes. Les totaux portent sur toutes les opérations du mois.
2. `budget-AAAA-MM.json` : export complet importable dans **BUDG → Paramètres → Importer une sauvegarde**.
3. `archive-serveur-AAAA-MM.json` : sauvegarde complète avec le journal des ajouts, corrections et suppressions, restaurable avec les commandes serveur existantes.

Le graphique PNG est intégré à l’email, sans image chargée depuis un service externe. Selon le logiciel de messagerie, il peut aussi apparaître comme une quatrième pièce jointe.

Le rapport porte uniquement sur le mois annoncé. Les JSON reprennent **l’ensemble de l’application et de son historique au moment de la capture** ; ils peuvent donc aussi contenir le mois courant suivant. Leur restauration reprend cet ensemble, pas une seule enveloppe.

## Activer l’envoi sur N0C

La migration `003_email_reports.sql` est intégrée à `server-dist/cli.cjs migrate` et crée la file durable. Elle ne modifie pas les montants ou opérations existants.

L’application et le Cron lisent le même fichier privé : `/home/ACCOUNT/budg-private/budg-report-email.json`, à côté de `backups/`. Il est relu lors du traitement des rapports ; sa modification ne nécessite pas de recopier des variables dans la configuration de Passenger. Un chemin différent peut être fourni avec `BUDG_REPORT_EMAIL_CONFIG`. Le fichier doit rester hors de `dist`, avec des permissions `600`.

Exemple avec le service local d’envoi :

```json
{
  "enabled": true,
  "from": "budg@example.com",
  "to": "destinataire@example.com",
  "transport": "sendmail",
  "sendmailPath": "/usr/sbin/sendmail"
}
```

L’adresse `to` est l’adresse qui **reçoit** les sauvegardes. L’adresse `from` est uniquement l’expéditeur technique ; elle doit être autorisée par l’hébergeur. Pour une adresse sur le domaine hébergé, créer cette adresse dans N0C. Une adresse technique attribuée au compte serveur peut être essayée si le service local l’autorise ; la réception effective doit être vérifiée.

Si le service local ne délivre pas correctement, utiliser un compte SMTP existant :

```json
{
  "enabled": true,
  "from": "budg@example.com",
  "to": "destinataire@example.com",
  "transport": "smtp",
  "smtp": {
    "host": "SERVEUR_SMTP_FOURNI_PAR_N0C",
    "port": 465,
    "user": "budg@example.com",
    "password": "SECRET_DANS_CE_FICHIER_PRIVE_UNIQUEMENT"
  }
}
```

Le port 465 utilise TLS dès la connexion ; le port 587 exige STARTTLS. Les certificats sont vérifiés. Aucun mot de passe ne doit être placé dans Git, une variable `VITE_*`, une commande ou les logs.

Sans fichier, l’envoi est désactivé. `{"enabled":false}` ou `BUDG_REPORT_EMAIL_ENABLED=false` suspend les envois sans effacer les rapports déjà en attente.

## Cron et vérification

Le **Cron horaire existant** appelle toujours `jobs`. Les sauvegardes sur disque gardent leur créneau de minuit ; le traitement email tourne séparément à chaque passage, donc aussi à midi. Le fuseau `Europe/Paris` suit les changements d’heure. Un rendez-vous mensuel manqué peut être rattrapé jusqu’à la fin du mois courant.

```sh
node --env-file=/CHEMIN/PRIVE/.env.production server-dist/cli.cjs report-preview --month AAAA-MM --output /CHEMIN/PRIVE/apercu
node --env-file=/CHEMIN/PRIVE/.env.production server-dist/cli.cjs report-test --month AAAA-MM
node --env-file=/CHEMIN/PRIVE/.env.production server-dist/cli.cjs reports
```

`report-preview` écrit le PDF, les JSON et un email HTML lisible localement, sans envoyer. `report-test` envoie un message marqué **TEST** au seul destinataire configuré, sans clôturer de mois ni créer de mouvement financier. Il ne remplace pas le futur rendez-vous automatique.

Un succès d’envoi signifie que le service mail a accepté le message, pas que Gmail l’a déjà placé dans la boîte de réception. Vérifier le test reçu et ses pièces jointes avant de considérer la configuration validée.

## Reprises et conservation

Chaque événement possède une seule entrée par mois et un instantané figé. Les nouvelles tentatives ne reprennent jamais un budget plus récent. Un verrou empêche deux processus d’envoyer simultanément la même file. Après échec, l’envoi attend un délai croissant, de quinze minutes à six heures, puis un passage du Cron ou un traitement déclenché par l’application.

Une panne du service mail ne remet pas en cause une clôture enregistrée : son rapport reste en attente en PostgreSQL. En revanche, si la transaction ne peut pas conserver cet instantané en base, la clôture est annulée avec le reste de la transaction.

Le même `Message-ID` est réutilisé lors d’une reprise. Comme tout transport SMTP, un arrêt entre l’acceptation externe et la confirmation SQL peut provoquer une réception en double ; il n’y a pas de garantie absolue de réception unique.

Les rapports envoyés et leurs instantanés restent dans la table privée `budg_email_reports`. Les erreurs enregistrées sont génériques et ne contiennent ni mot de passe ni contenu financier. Les emails ne remplacent pas les sauvegardes sur disque ni les vingt versions précédentes en base.

Documentation : [sendmail avec Nodemailer](https://nodemailer.com/transports/sendmail), [TLS SMTP avec Nodemailer](https://nodemailer.com/smtp), [paramètres des comptes N0C](https://kb.n0c.com/knowledge-base/comment-ajouter-des-comptes-de-messagerie-a-outlook/), [Cron N0C](https://kb.n0c.com/knowledge-base/taches-cron-et-courriel-dans-n0c/).
