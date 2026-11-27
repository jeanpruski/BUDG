<p align="center"><img src="public/assets/budg-logo.png" alt="Logo BUDG" width="120" /></p>

# BUDG — votre compte commun à deux

Une application pour préparer les enveloppes, vérifier les versements de chacun, enregistrer les dépenses et conserver le surplus dans un pot commun. Elle peut fonctionner sur ce Mac ou sur un serveur PostgreSQL partagé.

## Version en ligne sur PlanetHoster

La version serveur est prévue pour **budg.prjski.com**, avec deux comptes individuels : Jean peut modifier le budget, Miruna dispose d’un accès en lecture seule. Les droits sont vérifiés par le serveur. Le budget est enregistré dans PostgreSQL et reste accessible depuis les différents appareils et profils de navigateur après connexion.

```bash
npm run build:online
```

Cette commande construit l’interface en mode serveur et les programmes Node.js dans `server-dist/`. Le serveur de production refuse une interface construite en mode local. Les paramètres de connexion et les secrets restent côté serveur ; le fichier [.env.example](.env.example) présente les variables attendues.

Le [guide d’installation PlanetHoster](docs/planethoster.md) décrit la création de la base et des deux comptes, HTTPS, l’import du budget existant et la tâche Cron. La construction locale ne publie rien et n’installe pas la tâche Cron sur l’hébergement.

- Chaque écriture est validée et protégée contre l’écrasement d’une modification récente. Les 20 versions précédentes du budget sont conservées en base.
- Les ajouts, corrections et suppressions de dépenses et de versements alimentent un journal attribué à leur auteur. L’API de consultation de ce journal prépare les futurs outils de statistiques ; aucun tableau de statistiques supplémentaire n’est encore proposé.
- À minuit, heure de Paris, une sauvegarde complète du budget et du journal remplace le fichier privé `current-month.json`.
- Le premier du mois, une copie du mois précédent est conservée dans `monthly/AAAA-MM.json` avant le remplacement quotidien. Elle reste provisoire et suit les dernières corrections jusqu’à la clôture manuelle, qui la remplace par l’état final du mois. Les modifications des mois suivants ne remplacent pas cette archive finalisée. L’ouverture du mois suivant reste manuelle.
- Ces sauvegardes de données ne contiennent pas les mots de passe ni les sessions. Le guide distingue la restauration du budget et la reprise après perte de la base, avec conservation du journal des paiements.

Les commandes ci-dessous continuent à lancer la version locale existante. Aucun budget Chrome n’est transféré automatiquement vers PostgreSQL : exportez-le depuis son profil d’origine puis importez-le avec le compte éditeur.

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
4. Ajoutez chaque sortie réelle depuis son enveloppe. Sa liste dépliable permet de modifier ou supprimer une dépense ; **Historique** propose le journal global avec recherche et filtres. Un achat diminue immédiatement le disponible.
5. En fin de mois, vérifiez les factures et les contributions, puis cliquez sur **Vérifier et clôturer**.
6. Le surplus non dépensé rejoint **Pot commun**. Il reste sur le compte commun ; aucun virement personnel n’est nécessaire. Vous pouvez y enregistrer les achats payés avec ce pot.
7. **Préparer le mois suivant** reprend les enveloppes et les réserves, applique les salaires du nouveau mois et remet les opérations à zéro.

### Versements anticipés et prévision

Dans **Versements**, un virement déjà reçu peut être affecté au mois courant ou au mois prochain, dès n’importe quel jour du mois. **Prévision du mois prochain** reprend les salaires préparés (ou les salaires habituels), les montants programmés et les exceptions : contribution de chacun, avances reçues, somme encore réservée, complément à verser et reste personnel estimé avant les autres dépenses. Les objectifs des réserves restent dus en totalité, indépendamment de leur stock reporté.

Une avance ne finance pas les enveloppes courantes et n’alimente pas automatiquement le pot commun. **Utiliser une partie** retire un montant de l’avance vers le pot, avec possibilité d’alimenter directement une enveloppe dans la même opération. L’argent ne quitte pas le compte : seule son affectation change. Une dépense réelle reste à enregistrer dans son mois de paiement. **Rendre à l’avance** rétablit la réservation si le pot contient encore la somme ; un transfert vers une enveloppe peut d’abord être annulé si cet argent n’a pas été dépensé.

Exemple : 500 € reçus pour décembre, dont 50 € utilisés en novembre, donnent 450 € de financement à l’ouverture de décembre et un complément de 50 € si la contribution prévue est 500 €. L’historique conserve les 500 € reçus et l’utilisation des 50 €. La reprise n’ajoute aucune nouvelle rentrée bancaire. Le reste personnel prévisionnel soustrait les avances déjà versées et le complément restant du salaire prévu ; une avance utilisée augmente donc le complément.

La **Vue d’ensemble** présente le **Solde réel du compte commun**, incluant les avances, leur montant réservé et le **Solde hors avances**. Ce dernier comprend encore les enveloppes et les réserves du mois courant : ce n’est pas de l’argent entièrement libre. Les archives, l’audit et les rapports conservent les avances et leurs utilisations. Une fois le mois d’origine clôturé, leurs traces sont verrouillées ; les versements repris dans le mois suivant sont identifiés et ne peuvent pas être supprimés comme de nouveaux virements.

### Paiements à venir

Les cartes et leurs fiches utilisent la même barre : vert pour les sommes déjà payées, bleu hachuré pour les paiements prévus du mois, fond clair pour le budget restant. Les prévisions du mois prochain en sont exclues. Un dépassement prévu est indiqué séparément, sans étirer la barre au-delà de 100 %.

Dans **Saisir un paiement** ou **Une dépense**, une date future crée un **paiement prévu**, pour le mois courant ou le mois prochain. Il apparaît dans la fiche de l’enveloppe, avec son montant et sa date. Le disponible réel, les dépenses payées et le solde bancaire restent inchangés ; la fiche indique aussi ce qui resterait après les paiements prévus du mois. Les débits du mois prochain apparaissent dans sa prévision et sont conservés lors de son ouverture.

La Vue d’ensemble affiche sous le solde réel un montant plus petit **Après paiements prévus ce mois**, également sous le solde hors avances. Il soustrait seulement les prévisions du mois ouvert, sans déduire celles du mois prochain ni compter un débit deux fois.

À la date annoncée, le serveur transforme automatiquement le paiement prévu en dépense réelle. Après le dernier débit prévu d’une facture entièrement financée, il la clôture et affecte son surplus au pot commun. Si son financement manque, le débit est enregistré et la clôture attend le complément. Une réserve financée peut être terminée pour le mois en conservant son argent dans son enveloppe ; un budget à consommer reste ouvert. Une réouverture manuelle est respectée.

Le traitement utilise la date de Paris : le Cron horaire le vérifie avant les sauvegardes, et l’ouverture ou l’actualisation du budget le vérifie aussi. L’app en ligne s’actualise toutes les 30 secondes hors formulaire en cours. Une prévision du mois prochain est traitée seulement après l’ouverture de ce mois, avec rattrapage si sa date est déjà passée. La clôture et l’ouverture des mois restent manuelles.

Avant l’échéance, les paiements prévus peuvent être corrigés, reportés ou annulés ; **Confirmer le débit** permet aussi d’enregistrer la date et le montant effectifs plus tôt. BUDG ne consulte pas la banque : à l’échéance il utilise le montant saisi. Les paiements encore prévus du mois doivent être résolus avant sa clôture et avant de terminer leur enveloppe. Le journal identifie les écritures automatiques par **BUDG — automatique**, avec sauvegarde de la version précédente. Les comptes rendus distinguent les prévisions des paiements déjà enregistrés.

Le solde est calculé à partir des opérations saisies. BUDG ne se connecte pas à votre banque et n’effectue aucun virement. Le premier mois commence avec un solde à zéro : les sommes déjà versées pour ce mois doivent être enregistrées comme versements.

## Répartition, reste personnel et pot commun

- **Appartement** : au prorata des salaires du mois, par exemple prêt, assurance, électricité.
- **Vie quotidienne** : 50/50, par exemple courses et vacances.
- Les calculs utilisent des centimes entiers avec un arrondi déterministe qui conserve le total.
- Le versement partiel de chaque membre est affecté proportionnellement à ses parts prévues dans les enveloppes. Les compléments financent d’abord ses dépassements. Les sommes versées mais non dépensées rejoignent le pot commun à la clôture.
- **Provision du mois** est un objectif ; **financé** correspond aux versements reçus, aux réserves reportées et aux renforts issus du pot commun ; **disponible** est le montant financé moins les dépenses.
- Au début du mois, chaque personne conserve sur son compte personnel son salaire moins sa contribution prévue. Ce reste personnel est affiché sur sa carte.
- Après les dépenses, le surplus réellement disponible rejoint le pot commun, une fois les réserves affectées exclues. Il est inclus dans le solde du compte et ne réduit pas automatiquement les contributions du mois suivant.
- Les achats du pot sont identifiés **Pot commun**, modifiables et supprimables. Ils diminuent une seule fois le pot et le solde bancaire calculé, sans être facturés à nouveau aux membres. Ne les saisissez pas aussi dans une enveloppe. Un achat ne peut dépasser le pot disponible.
- **Alimenter depuis le pot commun** affecte un renfort à une enveloppe du mois actif : le pot diminue et l’enveloppe augmente, avec un solde bancaire inchangé. La provision mensuelle reste due. Le journal identifie ce transfert interne séparément des dépenses. L’annulation est possible pendant le mois actif si le montant est encore disponible dans l’enveloppe.

La **Vue d’ensemble** distingue **Dépenses payées** et **Mis de côté ce mois**. Ce dernier indicateur compte les provisions des enveloppes Réserve réellement financées par les versements du mois, dans la limite des montants prévus. Les reports, renforts du pot et compléments de dépassement en sont exclus. Chaque réserve affiche sa provision reçue **Ce mois** et son **Total disponible** cumulé après les dépenses, même sans nouveau versement. Par exemple, 300 € reportés et 100 € nouvellement reçus donnent 100 € mis de côté ce mois et 400 € disponibles dans cette enveloppe. Les provisions restent comptées dans leur mois de financement si elles sont ensuite dépensées ; les paiements apparaissent séparément dans les dépenses, et le stock disponible diminue.

Le camembert **Répartition du mois** inclut par défaut une part **Réserves du mois**, masquable pour ne voir que les paiements. Cette part montre uniquement les provisions de ce mois encore disponibles : pour cette visualisation, les achats consomment d’abord les reports personnels, puis les nouvelles provisions. Les fonds issus du pot, courants ou reportés, ne créent aucune part dans le graphique. Ainsi, 300 € de report personnel + 100 € reçus puis 350 € payés donnent 350 € de dépenses et 50 € de réserves du mois dans le camembert ; la carte conserve les 100 € historiquement provisionnés et affiche 50 € disponibles. Un paiement n’est pas compté une seconde fois comme réserve. Le bouton change uniquement la présentation, pour tous les comptes, sans modifier le budget ni les rapports.

Exemple avec des salaires de 3 000 € et 2 000 € : appartement prévu 1 000 €, courses prévues 500 €, vacances réservées 200 €. Contributions : 950 € et 750 €. Si l’appartement coûte 800 € et les courses 420 €, chacun garde initialement **2 050 € et 1 250 €** de salaire personnel. Après les achats, **280 € rejoignent le pot commun** et **200 € restent réservés aux vacances** : le compte commun contient toujours 480 €.

## Trois types d’enveloppes

- **Facture** : après saisie des paiements et financement complet, **Clôturer la facture** verse immédiatement le surplus dans le pot commun, même avant la fin du mois. Les paiements et la provision de cette facture sont alors figés pour le mois courant ; les montants futurs restent programmables. La confirmation seule ne crée pas de dépense. **Rouvrir la facture** reprend son surplus depuis le pot pour permettre une correction, si les fonds sont disponibles.
- **Dépenses courantes** : plusieurs achats possibles ; **Clôturer le budget du mois** transfère le solde réellement financé au pot commun, même avant la clôture mensuelle. La provision doit être entièrement reçue, les paiements prévus résolus et les achats terminés. Une réouverture reprend le surplus depuis le pot, s’il est encore disponible. Le solde est crédité une seule fois, même lors de la clôture du mois.
- **Réserve** : le solde reste dans cette enveloppe et s’ajoute à la provision du mois suivant. Par exemple, 100 € reportés et une provision de 600 € demandent toujours 600 € de nouveaux versements, pour 700 € financés après réception. Un renfort de 200 € depuis le pot porte le total à 900 €. Les reports personnels et les sommes issues du pot restent distincts même si les salaires changent.

À la clôture du mois, le reliquat d’un renfort reste affecté à une enveloppe Réserve ; dans une Facture ou une enveloppe courante, le solde non dépensé rejoint le pot une seule fois. Le surplus d’une facture déjà clôturée individuellement n’est pas crédité une seconde fois. Les transferts ne créent ni achat ni versement personnel.

Une réserve reportée ne peut pas être supprimée ou transformée. Pour arrêter de l’alimenter, mettez sa contribution mensuelle à zéro. Cette version ne propose pas encore de libération manuelle d’une réserve vers le pot commun.

## Terminer une enveloppe pour le mois

**Terminer pour ce mois** marque une réserve comme terminée sans créer de dépense ni débiter le compte. Le solde reste dans la même enveloppe. La provision du mois doit être entièrement reçue. Une enveloppe terminée passe en vert et en fin de groupe ; le lecteur voit son statut, seuls les éditeurs peuvent terminer ou rouvrir le suivi. Un nouveau paiement réel rouvre automatiquement le suivi du mois.

Le bouton de report est réservé aux enveloppes gérées en réserve ; une facture ordinaire propose uniquement sa clôture vers le pot. Les reports de factures déjà constitués dans une version précédente restent protégés dans leur enveloppe jusqu’à leur consommation. Une facture retrouve son fonctionnement habituel au début du mois suivant l’épuisement de ce report.

Exemple : 200 € provisionnés en novembre et aucun paiement donnent 200 € reportés. Décembre demande bien 1 000 € de nouveaux versements si sa provision prévue est 1 000 €, pour 1 200 € disponibles. Un paiement réel de 1 000 € laisse 200 € dans l’enveloppe. Les reports personnels et issus du pot gardent leur provenance, et les sauvegardes, rapports et archives conservent ce statut. Le format V10 reprend les budgets V3 à V9 sans inventer de dépense, de report ou d’avance ; les anciens clients doivent recharger la page avant d’enregistrer.

## Clôture et historique

La clôture exige que les contributions et éventuels compléments soient reçus, et que toutes les factures prévues soient confirmées. Elle fige les dépenses, les répartitions et le montant affecté au pot commun. Relancer une clôture n’ajoute jamais le surplus deux fois. Les dépenses du pot sont enregistrées séparément.

Les mois se suivent sans doublon. Le pot cumule les surplus des mois clôturés ; il n’est pas ajouté une deuxième fois au solde lors du passage au mois suivant. Les salaires sont historisés par mois d’effet et les répartitions des mois clôturés ne changent jamais.

## Données et sauvegardes

- **Serveur** : PostgreSQL, comptes éditeur/lecteur, journal des opérations et copies privées quotidiennes/mensuelles. Voir le [guide PlanetHoster](docs/planethoster.md).
- **Mises à jour en ligne** : les push sur `master` lancent les tests puis le déploiement automatique, sans remplacer les données ni les sauvegardes. Voir le [guide du déploiement](docs/ci-deployment.md).
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
- `server/` : serveur HTTP, authentification, stockage PostgreSQL, journal des opérations, sauvegardes et outils d’administration.

Le dépôt serveur utilise le même contrat que les dépôts locaux. Les comptes de connexion restent distincts des deux membres utilisés dans les répartitions financières. Cette version gère un budget partagé et un compte de chaque rôle ; elle ne propose pas d’inscription publique.

Le schéma SQLite de l’ancien prototype est conservé comme référence mais n’est pas utilisé.

## Développement et vérification

```bash
npm run dev
npm test
npm run build
npm run build:online  # interface serveur + programmes Node.js
npm run test:server  # tests PostgreSQL si TEST_DATABASE_URL est défini
npm run tauri dev  # nécessite Rust et les prérequis Tauri
```

Les tests couvrent les répartitions, les versements partiels, les corrections d’opérations, les dépassements, le pot commun, sa consommation, la migration des anciens remboursements, le verrouillage des mois, les réserves, les changements de revenus et la validation des sauvegardes.
