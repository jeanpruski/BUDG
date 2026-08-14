<p align="center">
  <img src="public/assets/budg-logo.png" alt="Logo BUDG" width="180" />
</p>

<h1 align="center">BUDG</h1>

<p align="center"><strong>Votre budget. Votre projet. Votre avenir.</strong></p>

Application locale de budget commun : contributions, enveloppes, dépenses et Surplus.

![Direction artistique et interface de BUDG](public/assets/budg-direction-artistique.png)

## Principes

- Simple et compréhensible en un coup d'œil
- Équitable grâce à des règles de contribution explicites
- Local et respectueux des données du foyer
- Orienté économies et projets communs

## Développement

```bash
npm install
npm run dev
npm test
```

Pour l'application desktop, installer les prérequis Rust de Tauri 2 puis lancer `npm run tauri dev`.

## Utilisation

1. Ouvrir **Paramètres** et vérifier les membres ainsi que leurs revenus.
2. En cas de changement de salaire, cliquer sur **Modifier**, saisir le nouveau revenu et son mois d'effet.
3. Consulter **Budget** pour vérifier les enveloppes et leurs règles de répartition.
4. Ouvrir **Contributions** pour connaître le montant que chaque membre doit verser.
5. Enregistrer les versements réellement effectués sur le compte commun.
6. Ajouter les dépenses au fil du mois depuis le bouton central ou l'écran **Dépenses**.
7. Vérifier les montants prévus, dépensés et encore disponibles.
8. Clôturer le mois lorsque les versements et dépenses sont à jour.
9. Consulter le **Surplus**, puis l'affecter progressivement aux projets communs.

### Changement de revenu

Les revenus sont historisés par mois d'effet. Un changement applicable au budget actif recalcule immédiatement les ratios et les contributions des lignes `PRO_RATA`. Les lignes `FIFTY_FIFTY` ne changent pas. Un mois clôturé conserve toujours les montants et répartitions enregistrés à l'époque.

## Règle de clôture

Le Surplus transférable est le minimum entre l'économie budgétaire nette et la trésorerie réellement disponible, après exclusion des trop-versés personnels. Une clôture est idempotente et doit être exécutée dans une transaction SQLite.
