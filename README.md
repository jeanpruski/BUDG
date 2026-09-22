<p align="center"><img src="public/assets/budg-logo.png" alt="Logo BUDG" width="120" /></p>

# BUDG — votre compte commun à deux

Une application locale pour préparer les enveloppes, vérifier les versements de chacun, enregistrer les dépenses et conserver le surplus dans un pot commun.

## Lancer sur ce Mac

Double-cliquez sur **Lancer BUDG.command**, ou lancez :

```bash
npm install  # uniquement si les dépendances ne sont pas encore présentes
npm start
```

BUDG s’ouvre sur **http://127.0.0.1:1420**. Gardez le terminal ouvert pendant l’utilisation. Le serveur écoute uniquement sur cet ordinateur. Utilisez toujours cette adresse et le même profil de navigateur pour retrouver vos données. Fermer l’onglet ne les efface pas ; effacer les données du navigateur les supprime.

## Première utilisation

1. Renseignez vos prénoms, vos salaires nets et le premier mois à gérer.
2. Dans **Enveloppes**, renseignez les montants mensuels du prêt, de l’électricité, de l’assurance, des courses, etc. Les enveloppes initiales sont à zéro et aucune opération fictive n’est créée.
3. Dans **Versements**, enregistrez les virements réellement reçus sur le compte commun. Vous pouvez les saisir en plusieurs fois, les modifier et corriger une erreur.
4. Ajoutez chaque sortie réelle dans **Dépenses** ou directement depuis son enveloppe. Un achat diminue immédiatement le disponible.
5. En fin de mois, vérifiez les factures et les contributions, puis cliquez sur **Vérifier et clôturer**.
6. Le surplus non dépensé rejoint **Pot commun**. Il reste sur le compte commun ; aucun virement personnel n’est nécessaire. Vous pouvez y enregistrer les achats payés avec ce pot.
7. **Préparer le mois suivant** reprend les enveloppes et les réserves, applique les salaires du nouveau mois et remet les opérations à zéro.

Le solde est calculé à partir des opérations saisies. BUDG ne se connecte pas à votre banque et n’effectue aucun virement. Le premier mois commence avec un solde à zéro : les sommes déjà versées pour ce mois doivent être enregistrées comme versements.

## Répartition, reste personnel et pot commun

- **Appartement** : au prorata des salaires du mois, par exemple prêt, assurance, électricité.
- **Vie quotidienne** : 50/50, par exemple courses et vacances.
- Les calculs utilisent des centimes entiers avec un arrondi déterministe qui conserve le total.
- Le versement partiel de chaque membre est affecté proportionnellement à ses parts prévues dans les enveloppes. Les compléments financent d’abord ses dépassements. Les sommes versées mais non dépensées rejoignent le pot commun à la clôture.
- **Prévu** est un objectif ; **financé** correspond aux versements reçus affectés à l’enveloppe et à sa réserve reportée ; **disponible** est le montant financé moins les dépenses.
- Au début du mois, chaque personne conserve sur son compte personnel son salaire moins sa contribution prévue. Ce reste personnel est affiché sur sa carte.
- Après les dépenses, le surplus réellement disponible rejoint le pot commun, une fois les réserves affectées exclues. Il est inclus dans le solde du compte et ne réduit pas automatiquement les contributions du mois suivant.
- Les achats du pot sont identifiés **Pot commun**, modifiables et supprimables. Ils diminuent une seule fois le pot et le solde bancaire calculé, sans être facturés à nouveau aux membres. Ne les saisissez pas aussi dans une enveloppe. Un achat ne peut dépasser le pot disponible.

Exemple avec des salaires de 3 000 € et 2 000 € : appartement prévu 1 000 €, courses prévues 500 €, vacances réservées 200 €. Contributions : 950 € et 750 €. Si l’appartement coûte 800 € et les courses 420 €, chacun garde initialement **2 050 € et 1 250 €** de salaire personnel. Après les achats, **280 € rejoignent le pot commun** et **200 € restent réservés aux vacances** : le compte commun contient toujours 480 €.

## Trois types d’enveloppes

- **Facture** : paiement réel à saisir et règlement complet à confirmer. Une échéance facultative signale les factures à vérifier. La confirmation seule ne crée pas de dépense.
- **Dépenses courantes** : plusieurs achats possibles ; le solde non dépensé rejoint le pot commun à la clôture.
- **Réserve** : le solde est reporté et séparé du pot commun, utile pour les vacances, travaux ou taxes annuelles. Le propriétaire de chaque centime est conservé même si les salaires changent.

Une réserve reportée ne peut pas être supprimée ou transformée. Pour arrêter de l’alimenter, mettez sa contribution mensuelle à zéro. Cette version ne propose pas encore de libération manuelle d’une réserve vers le pot commun.

## Clôture et historique

La clôture exige que les contributions et éventuels compléments soient reçus, et que toutes les factures prévues soient confirmées. Elle fige les dépenses, les répartitions et le montant affecté au pot commun. Relancer une clôture n’ajoute jamais le surplus deux fois. Les dépenses du pot sont enregistrées séparément.

Les mois se suivent sans doublon. Le pot cumule les surplus des mois clôturés ; il n’est pas ajouté une deuxième fois au solde lors du passage au mois suivant. Les salaires sont historisés par mois d’effet et les répartitions des mois clôturés ne changent jamais.

## Données et sauvegardes

- **Navigateur** : IndexedDB, transactions atomiques, conservation des 20 états précédents et contrôle de révision pour éviter qu’une seconde fenêtre écrase une modification récente.
- **Application Tauri** : fichier `budget-v3.json` dans le dossier de données de l’application (`app.budg.desktop`), écrit par remplacement atomique, contenant les données et 20 versions précédentes. Le support desktop nécessite Rust et les prérequis Tauri pour être compilé.
- Export et import de fichiers JSON versionnés dans **Paramètres**. L’import contrôle les montants, les dates, les références, les répartitions, les clôtures et la continuité des réserves avant toute modification.
- Un écran de récupération permet de restaurer une copie ou un export si les données ne sont plus lisibles.
- Conservez régulièrement un export dans un dossier sauvegardé indépendamment de BUDG. Les copies automatiques sont sur le même appareil.
- Le navigateur et l’application desktop ont des stockages distincts : utilisez export/import pour passer de l’un à l’autre.

Les sauvegardes de la version 3 sont converties automatiquement au format 4 : les remboursements non effectués deviennent du pot commun ; les virements déjà effectués restent déduits et visibles dans l’historique. Les emplacements de stockage conservent leur nom historique pour retrouver les données existantes.

L’application ne reprend pas les données de démonstration de l’ancien prototype (`budg-state-v2`). Cette ancienne clé n’est pas effacée ; son format n’est pas accepté comme sauvegarde de la nouvelle version.

## Structure et évolution

- `src/domain.ts` : schémas, calculs, validation et règles de clôture.
- `src/store.ts` : opérations métier pures et passage au mois suivant.
- `src/repository.ts` : contrat asynchrone de stockage et adaptateurs navigateur/desktop.
- `src/App.tsx`, `src/screens.tsx`, `src/forms.tsx`, `src/ui.tsx` : navigation, formulaires et composants.
- `src-tauri/src/lib.rs` : commandes de stockage local desktop.

Un futur stockage partagé pourra remplacer le dépôt local derrière le même contrat. Il faudra alors ajouter authentification, autorisations du foyer et gestion des conflits côté serveur. Il n’existe actuellement ni compte distant ni synchronisation.

Le schéma SQLite de l’ancien prototype est conservé comme référence mais n’est pas utilisé.

## Développement et vérification

```bash
npm run dev
npm test
npm run build
npm run tauri dev  # nécessite Rust et les prérequis Tauri
```

Les tests couvrent les répartitions, les versements partiels, les corrections d’opérations, les dépassements, le pot commun, sa consommation, la migration des anciens remboursements, le verrouillage des mois, les réserves, les changements de revenus et la validation des sauvegardes.
