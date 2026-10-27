# Déploiement automatique de BUDG

Le workflow [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) vérifie chaque push sur `master` et chaque pull request vers `master`. Seul un push sur `master`, ou un lancement manuel du workflow sur cette branche, peut mettre à jour [budg.prjski.com](https://budg.prjski.com).

## Vérifications avant publication

GitHub Actions installe les dépendances verrouillées, lance les tests de l’application et du déploiement, puis compile le navigateur et le serveur avec `npm run build:online`. Les tests PostgreSQL utilisent un service PostgreSQL 16 jetable, avec `TEST_DATABASE_URL` ; ils n’accèdent jamais à la base réelle. Une pull request exécute ces vérifications sans accès aux secrets de déploiement.

L’archive publiée contient uniquement `dist/`, `server-dist/`, `app.cjs`, `package.json` et `package-lock.json`. Elle est conservée trois jours dans les artifacts GitHub. Aucun export de budget, fichier d’environnement, mot de passe ou sauvegarde ne fait partie de cette archive.

## Connexion au serveur

Deux secrets GitHub sont nécessaires :

- `BUDG_SSH_PRIVATE_KEY` : une clé dédiée au déploiement de BUDG, différente de la clé SSH personnelle.
- `BUDG_SSH_KNOWN_HOSTS` : la clé d’hôte déjà vérifiée de `node176-eu.n0c.com`, sur le port `5022`.

La connexion utilise `ghmhtrcg@node176-eu.n0c.com:5022`, refuse une clé d’hôte inconnue et ne transmet aucun agent SSH. La clé dédiée est limitée côté serveur à la commande de déploiement de BUDG. Le programme installé dans `/home/ghmhtrcg/budg-private/deploy/deploy.py` valide la commande, la révision Git, l’empreinte SHA-256 et le contenu de l’archive avant son installation.

Le mot de passe PostgreSQL, les mots de passe des deux comptes et le contenu du budget restent hors de GitHub Actions. Les identifiants de base de données ne sont chargés que sur le serveur depuis le fichier privé existant.

## Mise à jour et retour à la version précédente

Les déploiements sont sérialisés dans GitHub Actions et sur le serveur. Une vérification ou une compilation en échec empêche la publication.

Le serveur prépare une version séparée, y installe les dépendances de production et applique les migrations avant de remplacer le code actif. Il redémarre ensuite uniquement l’application BUDG et contrôle sa réponse ainsi que sa révision. Si ce contrôle échoue, il remet la version précédente du code et signale un échec dans GitHub Actions.

Le retour automatique concerne le code. Il ne restaure ni n’efface la base de données. Les migrations doivent donc rester compatibles avec la version précédente et préserver les données existantes. Une migration destructive nécessite un traitement séparé ; elle ne doit pas être ajoutée à une mise à jour courante.

Le déploiement ne crée pas de comptes, n’importe pas de budget et ne lance pas une sauvegarde quotidienne forcée. Les sessions, les droits de Jean et Miruna, le Cron et les sauvegardes sont conservés.

Le dossier `budg-app/current` désigne la version active. Les chemins `dist` et `server-dist` suivent ce lien, ce qui conserve la commande Cron existante. Seules la version active et la précédente sont gardées sur disque. Le bootstrap stable et le relais `maintenance.cjs` restent en place pour N0C/LiteSpeed.

Le programme de déploiement est installé séparément dans le dossier privé : une modification de `scripts/deploy/deploy.py` nécessite de mettre à jour cette copie avec l’accès SSH d’administration. Une mise à jour ordinaire du site ne remplace pas ce programme.

## Emplacement des données et sauvegardes

Les données restent dans PostgreSQL. Les secrets et les sauvegardes restent dans `/home/ghmhtrcg/budg-private`, hors du dossier public et des versions du code. Le déploiement ne modifie pas le dossier public du sous-domaine ni sa configuration HTTPS.

Pour le moment, les sauvegardes sont conservées sur ce même serveur : un `current-month.json` remplacé quotidiennement à minuit, heure de Paris, et une archive par mois, actualisée jusqu’à la clôture manuelle puis figée. Ce workflow n’ajoute pas de copie vers un hébergement externe.

## Suivi

Le résultat des vérifications et du déploiement apparaît dans l’onglet **Actions** du dépôt GitHub. Un workflow vert signifie que les vérifications ont réussi et, pour `master`, que la version attendue répond sur le site. Un lancement manuel sur une autre branche effectue seulement les vérifications.

Pour relancer une publication après une panne réseau, utiliser **Actions → Verify and deploy BUDG → Run workflow**, en choisissant `master`. Les procédures de reprise du budget restent décrites dans [planethoster.md](planethoster.md).
