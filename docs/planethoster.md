# BUDG sur PlanetHoster N0C

Cette procédure prépare `https://budg.prjski.com` pour deux comptes sur un même budget : Jean peut modifier, Miruna consulte. Le code est préparé localement ; la base, les comptes, le domaine et le Cron ne sont pas installés sur l’hébergement tant que les étapes ci-dessous n’ont pas été exécutées sur N0C.

L’application utilise Node.js et PostgreSQL. Le navigateur affiche le budget et conserve seulement la session via un cookie protégé ; les données financières sont enregistrées dans PostgreSQL. Les inscriptions publiques sont absentes. Le serveur vérifie les droits à chaque écriture, y compris import, restauration et réinitialisation.

## 1. Préparer l’hébergement

Dans N0C :

1. Créer le sous-domaine `budg.prjski.com`, vérifier son DNS et activer son certificat HTTPS.
2. Créer une base PostgreSQL dédiée et son utilisateur ; conserver son hôte, son port et son nom exacts. Ne pas réutiliser une base d’un autre site.
3. Créer une application Node.js pour ce sous-domaine. Choisir une version maintenue, 22 ou plus récente si proposée. La compilation cible Node 20 et nécessite au moins Node 20.6 pour les commandes `--env-file` ci-dessous.
4. Définir le dossier de l’application, par exemple `/home/ACCOUNT/budg`, et le fichier de démarrage `app.cjs`. Ce point d’entrée fonctionne aussi lorsque Passenger charge le programme au lieu de l’exécuter directement. Utiliser le mode `production`.
5. Créer un dossier privé `/home/ACCOUNT/budg-private`, hors de `public_html`, du dossier public du sous-domaine et de `dist`. Il contiendra les secrets et les sauvegardes.

Le serveur Node expose uniquement `dist` et `/api`. Ne pas exposer la racine du projet comme dossier de fichiers statiques. Les migrations, fichiers `.env`, dépendances et sauvegardes doivent rester inaccessibles en HTTP.

Les emplacements exacts du dossier, de l’exécutable Node et de son environnement virtuel dépendent de l’application créée dans N0C. Utiliser les chemins fournis par le panneau ; ne pas recopier les marqueurs `ACCOUNT` tels quels.

Documentation officielle : [applications Node.js](https://kb.n0c.com/en/knowledge-base/nodejs-application-management/) et [tâches Cron](https://kb.n0c.com/knowledge-base/taches-cron-et-courriel-dans-n0c/).

## 2. Compiler et transférer

Depuis le projet local :

```sh
npm ci
npm run build:online
```

Cette commande produit le navigateur connecté au serveur dans `dist` et le serveur dans `server-dist`. Le mode en ligne ne bascule jamais silencieusement sur une base de navigateur en cas de panne du serveur. `npm start` reste le lancement de l’ancienne version locale ; ce n’est pas la commande d’hébergement.

Transférer `dist/`, `server-dist/`, `app.cjs`, `package.json` et `package-lock.json` dans le dossier privé de l’application, puis y installer les dépendances de production :

```sh
npm ci --omit=dev
```

Les migrations SQL sont intégrées au programme d’administration compilé. Aucun secret ne doit être ajouté au code, aux variables `VITE_*` ou aux fichiers du navigateur.

## 3. Configurer les variables serveur

Partir de `.env.example` et créer `/home/ACCOUNT/budg-private/.env.production`. Adapter la connexion PostgreSQL et les chemins :

```dotenv
NODE_ENV=production
APP_ORIGIN=https://budg.prjski.com
DATABASE_URL=postgresql://BUDG_USER:REPLACE_PASSWORD@localhost:5432/BUDG_DATABASE
DATABASE_SSL=false
TRUST_PROXY=1
SESSION_TTL_DAYS=14
TZ=Europe/Paris
BUDG_TIME_ZONE=Europe/Paris
BUDG_BACKUP_DIR=/home/ACCOUNT/budg-private/backups
```

Encoder les caractères spéciaux du mot de passe dans l’URL PostgreSQL. `DATABASE_SSL=false` convient seulement si la base est jointe localement selon les indications de l’hébergeur ; pour une connexion distante TLS, utiliser `true` et un certificat valide. Les options TLS ne doivent pas être ajoutées dans `DATABASE_URL` : retirer notamment `sslmode` d’une URL fournie par un service et régler le TLS via `DATABASE_SSL`. Le serveur refuse ces options dans l’URL pour empêcher qu’elles contournent la vérification du certificat.

Renseigner les mêmes variables dans la configuration N0C de l’application, ou lancer le programme avec `--env-file`. Le programme ne charge pas un fichier `.env` implicitement. Les tâches Cron n’héritent pas nécessairement des variables définies dans le panneau : leur commande doit charger ce fichier privé explicitement.

Pour le port, conserver celui fourni par l’hébergement. Si l’application est pilotée par Passenger et attend le socket `passenger`, régler `PORT=passenger`. Sinon, utiliser le port indiqué par N0C. `TRUST_PROXY` doit correspondre au nombre exact de relais de confiance devant Node, à vérifier dans cette configuration ; ne pas faire confiance sans limite aux en-têtes transmis par les visiteurs.

Protéger les fichiers et dossiers :

```sh
chmod 700 /home/ACCOUNT/budg-private
chmod 600 /home/ACCOUNT/budg-private/.env.production
```

## 4. Créer les tables et les deux comptes

Activer l’environnement Node indiqué par N0C, se placer dans le dossier BUDG et lancer :

```sh
node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs migrate
```

La création des comptes n’envoie pas d’email. Utiliser les adresses de Jean et Miruna à la place des exemples ci-dessous. Un seul compte de chaque rôle est autorisé.

Les mots de passe doivent être distincts et avoir au moins 12 caractères. Pour ne pas les inscrire dans l’historique du terminal, les saisir avec une lecture masquée, puis les transmettre par l’entrée standard. Exemple dans le terminal Bash de l’hébergement :

```bash
read -r -s -p 'Mot de passe de Jean : ' BUDG_ACCOUNT_PASSWORD
printf '\n'
printf '%s' "$BUDG_ACCOUNT_PASSWORD" | node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs create-user --email jean@example.com --name Jean --role editor
unset BUDG_ACCOUNT_PASSWORD
```

```bash
read -r -s -p 'Mot de passe de Miruna : ' BUDG_ACCOUNT_PASSWORD
printf '\n'
printf '%s' "$BUDG_ACCOUNT_PASSWORD" | node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs create-user --email miruna@example.com --name Miruna --role viewer
unset BUDG_ACCOUNT_PASSWORD
```

Le serveur enregistre un hachage du mot de passe, jamais son texte. Aucun compte ou mot de passe de démonstration n’est créé automatiquement. Un mot de passe oublié se change depuis le serveur avec la commande `password --email ADRESSE`, en fournissant le nouveau mot de passe de la même façon. Cette commande ferme les sessions existantes du compte ; il n’existe pas encore de récupération automatique par email.

Lors d’une mise à jour du serveur, relancer aussi `migrate` avant de redémarrer l’application. La commande est idempotente et ajoute notamment la table de publication des archives mensuelles aux installations antérieures.

Démarrer ou redémarrer l’application depuis N0C et tester la connexion sur `https://budg.prjski.com`. Vérifier que le compte lecteur voit le budget mais ne peut pas modifier ou importer de données. Hors connexion, les données financières ne sont pas accessibles.

## 5. Reprendre le budget du navigateur

Depuis le bon profil Chrome, ouvrir la version locale et utiliser **Paramètres → Exporter une sauvegarde**. Conserver ce fichier avant toute migration.

Se connecter ensuite à `https://budg.prjski.com` avec le compte éditeur. Après la configuration initiale si nécessaire, utiliser **Paramètres → Importer une sauvegarde** et contrôler les enveloppes, réserves, dépenses, versements et archives. Le compte lecteur ne peut pas importer. L’export local n’est pas supprimé.

L’import crée des traces pour les opérations importées. Leur date de paiement d’origine est conservée, mais l’auteur et la date de création des traces correspondent à l’import : l’ancien navigateur n’avait pas de journal d’audit permettant de reconstituer qui avait fait chaque modification.

Une première sauvegarde serveur peut être produite immédiatement :

```sh
node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs jobs --daily
```

## 6. Installer le Cron de sauvegarde

Il suffit d’une tâche lancée **chaque heure à la minute 0**. Le programme vérifie lui-même l’heure de Paris : la sauvegarde quotidienne est produite seulement entre 00 h 00 et 00 h 59, en suivant l’heure d’été et d’hiver même si le serveur est en UTC. Les autres heures servent à reprendre les publications mensuelles en attente. Le quotidien n’est pas multiplié par ces nouvelles tentatives.

Dans N0C → Crons, choisir `0 * * * *` et adapter cette commande avec les chemins absolus du Node de l’application, du fichier privé et du projet :

```sh
cd /home/ACCOUNT/budg && /CHEMIN/EXACT/DE/NODE --env-file=/home/ACCOUNT/budg-private/.env.production /home/ACCOUNT/budg/server-dist/cli.cjs jobs >/dev/null
```

La redirection masque seulement la sortie normale ; **ne pas ajouter `2>&1`** si l’on souhaite recevoir les erreurs par l’adresse de notification Cron configurée dans N0C. Aucun fichier de log quotidien n’est créé par cette commande.

À minuit heure de Paris :

1. Le **1er du mois**, le programme écrit d’abord `monthly/AAAA-MM.json` pour le mois précédent. Si ce mois est encore ouvert, cette copie est provisoire et sera actualisée avec les corrections tardives.
2. Il écrit ensuite `current-month.json`. Ce même fichier est remplacé chaque nuit, sans créer une série de copies quotidiennes.
3. Les écritures utilisent un fichier temporaire privé et une publication atomique. Une écriture interrompue avant publication ne tronque pas le précédent fichier. Le budget et son journal sont lus ensemble dans une transaction cohérente.

Il y a donc **un fichier quotidien tournant et un fichier par mois**, plus les 20 versions précédentes conservées en base lors des modifications. Une seule version mensuelle est maintenue en base pour sa publication ; les corrections la remplacent jusqu’à sa clôture, sans empiler des fichiers. Les tailles des fichiers suivent le volume réel de l’historique ; un journal complet implique de conserver les événements qui le composent.

Chaque fichier serveur contient le budget complet, les archives de clôture et le journal des paiements tel qu’il existait à l’instant de la copie. La copie mensuelle indique le mois visé. Elle ne valide pas les factures, ne crée aucun paiement et ne fait pas avancer le mois : **la clôture financière et le passage au mois suivant restent manuels**.

Par exemple, la copie de septembre est créée le 1er octobre. Un paiement de septembre ajouté ou corrigé le 2 actualise cette même copie. La clôture du 3 y enregistre l’état définitif, puis les opérations d’octobre ne la remplacent plus. Une clôture effectuée avant le 1er crée également sa copie définitive immédiatement.

La version à publier est enregistrée en base dans la même transaction que la modification financière et son journal. Le serveur tente ensuite d’écrire le fichier. Si le disque est momentanément indisponible, le paiement reste enregistré ; une alerte signale seulement que la copie mensuelle attend sa publication. Cette version exacte reste en base, même si l’on prépare le mois suivant ou réinitialise ensuite le budget vivant. Le Cron reprend sa publication chaque heure. Une erreur limitée au fichier mensuel n’empêche pas de remplacer le quotidien à minuit à partir du budget valide en base : les deux copies sont indépendantes. Un fichier qui semble plus récent ou une archive clôturée différente n’est jamais remplacé silencieusement : le fichier et la version en attente restent conservés pour vérification.

Si le mois précédent n’existe plus dans le budget et que le dernier quotidien vient du mois précédent, le programme signale l’erreur et conserve ce quotidien. Il n’invente pas un mois manquant. Lors d’une première installation sans mois précédent ni ancien quotidien, il conserve tout de même le premier quotidien et indique qu’aucune archive du mois absent n’a été créée.

Si le serveur ou le Cron est indisponible pendant tout le créneau de minuit, le quotidien ne se rattrape pas automatiquement en journée ; les publications mensuelles déjà enregistrées en base peuvent, elles, reprendre à l’heure suivante. Vérifier les notifications et, si nécessaire, lancer `jobs --monthly` avant `jobs --daily`. Le timestamp du fichier indique le moment réel de la capture ; on ne peut pas recréer exactement un état de minuit qui n’a pas été sauvegardé.

## 7. Retrouver le journal et préparer les statistiques

Le journal `budg_audit` conserve les ajouts, corrections et suppressions de dépenses, versements et achats du pot commun, avec l’auteur, l’heure, le mois concerné, l’ancienne valeur et la nouvelle. Le déplacement d’un mois vers les archives ne doit pas recréer ses paiements. Les imports et remises à zéro sont eux aussi visibles comme changements d’opérations. Le compte lecteur peut consulter les traces ; il ne peut pas les modifier ou les effacer par l’API.

Les snapshots incluent ce journal, même pour des paiements ensuite supprimés. Les données et l’API du journal préparent un futur écran de statistiques ; cet écran et un export statistique dédié ne sont pas encore construits. Les calculs pourront utiliser les paiements réels et les mois clôturés plutôt que les montants simplement prévus.

## 8. Restaurer une copie

Un snapshot serveur est un fichier enveloppe contenant `state` et `audit` ; ce n’est pas le même format que l’export simple du navigateur. L’import navigateur reste destiné aux exports BUDG ordinaires.

Pour revenir à un snapshot sur une base déjà utilisée, la commande suivante valide les données, conserve la copie précédente et garde le journal existant. Les différences de paiements créent de nouvelles traces attribuées au compte éditeur indiqué :

```sh
node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs restore /home/ACCOUNT/budg-private/backups/current-month.json --email jean@example.com
```

Pour récupérer **après une perte complète de la base**, créer une nouvelle base dédiée, appliquer les migrations et recréer les deux comptes, puis restaurer les données et les traces originales ensemble :

```sh
node --env-file=/home/ACCOUNT/budg-private/.env.production server-dist/cli.cjs restore-disaster /CHEMIN/DE/LA/COPIE/SAUVEE.json
```

Cette commande refuse une base contenant déjà un budget, un journal ou une archive mensuelle en base. Elle conserve les révisions, identifiants et dates historiques, sans fabriquer des événements de paiement, puis prépare la publication des mois récupérés. Les mots de passe, sessions et identifiants de connexion PostgreSQL ne sont pas inclus dans les snapshots : les comptes sont recréés séparément. Les anciens identifiants d’auteur restent dans les traces pour leur provenance.

Les fichiers du Cron sont sur le même hébergement que la base. Conserver aussi une copie périodique dans un emplacement indépendant de PlanetHoster pour pouvoir restaurer après une perte du compte ou du serveur entier.

## Validation avant ouverture

- Les deux comptes se connectent sur HTTPS ; seul Jean peut modifier, y compris par appel direct à l’API.
- Les montants importés correspondent au budget local conservé.
- Le quotidien manuel fonctionne et son remplacement conserve un seul fichier.
- Le Cron est présent dans N0C, avec l’exécutable Node correct et une adresse de notification d’erreur.
- Les snapshots sont hors du dossier public et leur restauration a été essayée sur une base de test.

Le programme et ses tests automatisés ne remplacent pas cette validation sur l’hébergement réel ; elle nécessite l’accès N0C/SSH et les paramètres de la base.
