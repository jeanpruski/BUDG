# Direction visuelle BUDG

Vert profond, ivoire, sauge et touches de laiton. Titres éditoriaux en Georgia et chiffres en caractères système à chasse tabulaire. Aucune police ni illustration n’est chargée depuis un service externe.

La couche visuelle se trouve dans `src/polish.css`, les composants de chargement, les illustrations et les confirmations dans `src/visuals.tsx`. Les règles de calcul et les données sont conservées.

## Logo et icônes

Le logo reprend la deuxième piste choisie sur la planche de recherche créée avec **imagegen** : un B géométrique dont les découpes et le ruban en S évoquent le `$`. Les masses vert forêt et le pli vert sauge composent un symbole sur fond blanc `#ffffff`. Le dessin retenu est retranscrit en courbes vectorielles, sans dépendance à une police. Sa source unique est [budg-mark.svg](../public/assets/budg-mark.svg), utilisée par `src/BrandMark.tsx` pour la connexion, la navigation sur ordinateur et téléphone et le chargement.

`npm run icons` régénère toutes les déclinaisons : le PNG de compatibilité, le SVG historique, le favicon ICO avec sept tailles de 16 à 256 pixels, l’icône Apple 180 × 180 et les icônes du manifeste 192/512. La compilation les régénère aussi automatiquement. Les fichiers sont versionnés et inclus par Vite dans le site compilé. Les icônes d’écran d’accueil ont un fond opaque carré ; le téléphone applique son masque. Le symbole reste dans la zone centrale sûre de l’icône maskable.

Safari utilise [apple-touch-icon.png](../public/apple-touch-icon.png) pour le raccourci iPhone. Après le déploiement, ajouter BUDG depuis **Safari → Partager → Sur l’écran d’accueil**. Pour un raccourci qui conserve l’ancien logo, le recréer depuis Safari. Voir la [documentation Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

## Comportements

La vue d’ensemble (`src/Overview.tsx`) présente un graphique des dépenses du mois regroupées en appartement, vie quotidienne et achats du pot commun, accompagné du solde du compte et des versements attendus. Les montants représentent les paiements enregistrés ; les réserves apparaissent lorsqu’elles sont dépensées. Les opérations détaillées restent dans leurs onglets. La clôture et le passage au mois suivant sont accessibles dans **Enveloppes**.

- Un écran avec squelette animé accompagne le chargement réel du stockage.
- Les boutons de sauvegarde et la lecture des copies affichent un indicateur pendant l’opération, sans délai artificiel.
- Les vues, fenêtres et cartes apparaissent progressivement ; les montants restent exacts et ne passent pas par des valeurs intermédiaires fictives.
- Les confirmations s’affichent sans déplacer le contenu et se ferment après 5,5 secondes ou manuellement.
- Les animations et transitions sont désactivées avec `prefers-reduced-motion: reduce`.

## Illustrations

Créées avec l’outil **imagegen intégré**, sans CLI ni clé API. Les fichiers PNG conservent leur transparence et sont stockés dans le projet :

- [Accueil — budg-home-illustration.png](../public/assets/budg-home-illustration.png)
- [Pot commun — budg-savings-illustration.png](../public/assets/budg-savings-illustration.png)

Les illustrations restent disponibles ; le symbole de marque et ses déclinaisons sont désormais générés depuis le `$` vectoriel ci-dessus.

### Prompt final — accueil

```text
Use case: stylized-concept. Asset type: production illustration for the right side of the dashboard hero and welcome screen of BUDG, a tasteful French couple budgeting app. Primary request: one polished, charming, premium miniature still life symbolizing a shared home and growing savings. Subject: a small architect-designed ivory house with a dark forest-green rounded roof next to a beautiful sage ceramic savings jar, three warm matte brass coins, and one elegant leafy plant in a muted terracotta pot. Style: sophisticated 3D editorial clay illustration, tactile matte ceramic, smooth softly rounded forms, subtle natural imperfections, like a beautifully art-directed boutique fintech illustration rather than stock clip art. Composition: landscape 3:2 image, centered compact arrangement, three-quarter view, generous clear space around objects, complete uncropped subjects, grounded delicate contact shadows. Background: genuinely transparent alpha background, no backdrop, no checkerboard drawn in the image. Palette: forest green #173f35, sage #9ab49a, warm ivory #f5f1e7, muted gold #dbb974, terracotta #c99176. Lighting: large soft studio light from upper left, warm serene optimistic mood. No words, no letters, no logos, no numbers, no UI, no watermark. High quality raster image for a real application. Save the generated asset and return its local file path.
```

### Prompt final — pot commun

```text
Use case: stylized-concept. Asset type: compact illustration for the common savings pot screen of BUDG, a warm French couple budget application. Create a premium tactile 3D editorial clay still life: a beautiful rounded sage-green ceramic savings jar with an ivory rim and three matte brass coins, with a small elegant two-leaf sprout emerging near the jar. Sophisticated simple sculptural composition, soft matte ceramic and subtle textures, soft studio illumination, warm serene optimistic mood. Centered complete uncropped arrangement, generous transparent padding, three-quarter view. Use forest green #173f35, sage #9ab49a, ivory #f5f1e7, gold #dbb974. A genuinely transparent alpha background, only faint grounding contact shadow. Landscape 3:2 composition. No text, no logos, no numbers, no watermark, no drawn checkerboard, no backdrop, no people. A matching companion to a ceramic house-and-savings illustration, suitable for a polished real application. Return local saved file path.
```
