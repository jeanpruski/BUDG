# Direction visuelle BUDG

Vert profond, ivoire, sauge et touches de laiton. Titres éditoriaux en Georgia et chiffres en caractères système à chasse tabulaire. Aucune police ni illustration n’est chargée depuis un service externe.

La couche visuelle se trouve dans `src/polish.css`, les composants de chargement, les illustrations et les confirmations dans `src/visuals.tsx`. Les règles de calcul et les données sont conservées.

## Comportements

- Un écran avec squelette animé accompagne le chargement réel du stockage.
- Les boutons de sauvegarde et la lecture des copies affichent un indicateur pendant l’opération, sans délai artificiel.
- Les vues, fenêtres et cartes apparaissent progressivement ; les montants restent exacts et ne passent pas par des valeurs intermédiaires fictives.
- Les confirmations s’affichent sans déplacer le contenu et se ferment après 5,5 secondes ou manuellement.
- Les animations et transitions sont désactivées avec `prefers-reduced-motion: reduce`.

## Illustrations

Créées avec l’outil **imagegen intégré**, sans CLI ni clé API. Les fichiers PNG conservent leur transparence et sont stockés dans le projet :

- [Accueil — budg-home-illustration.png](../public/assets/budg-home-illustration.png)
- [Pot commun — budg-savings-illustration.png](../public/assets/budg-savings-illustration.png)

Les anciens visuels restent disponibles ; le symbole vectoriel de marque existant est réutilisé.

### Prompt final — accueil

```text
Use case: stylized-concept. Asset type: production illustration for the right side of the dashboard hero and welcome screen of BUDG, a tasteful French couple budgeting app. Primary request: one polished, charming, premium miniature still life symbolizing a shared home and growing savings. Subject: a small architect-designed ivory house with a dark forest-green rounded roof next to a beautiful sage ceramic savings jar, three warm matte brass coins, and one elegant leafy plant in a muted terracotta pot. Style: sophisticated 3D editorial clay illustration, tactile matte ceramic, smooth softly rounded forms, subtle natural imperfections, like a beautifully art-directed boutique fintech illustration rather than stock clip art. Composition: landscape 3:2 image, centered compact arrangement, three-quarter view, generous clear space around objects, complete uncropped subjects, grounded delicate contact shadows. Background: genuinely transparent alpha background, no backdrop, no checkerboard drawn in the image. Palette: forest green #173f35, sage #9ab49a, warm ivory #f5f1e7, muted gold #dbb974, terracotta #c99176. Lighting: large soft studio light from upper left, warm serene optimistic mood. No words, no letters, no logos, no numbers, no UI, no watermark. High quality raster image for a real application. Save the generated asset and return its local file path.
```

### Prompt final — pot commun

```text
Use case: stylized-concept. Asset type: compact illustration for the common savings pot screen of BUDG, a warm French couple budget application. Create a premium tactile 3D editorial clay still life: a beautiful rounded sage-green ceramic savings jar with an ivory rim and three matte brass coins, with a small elegant two-leaf sprout emerging near the jar. Sophisticated simple sculptural composition, soft matte ceramic and subtle textures, soft studio illumination, warm serene optimistic mood. Centered complete uncropped arrangement, generous transparent padding, three-quarter view. Use forest green #173f35, sage #9ab49a, ivory #f5f1e7, gold #dbb974. A genuinely transparent alpha background, only faint grounding contact shadow. Landscape 3:2 composition. No text, no logos, no numbers, no watermark, no drawn checkerboard, no backdrop, no people. A matching companion to a ceramic house-and-savings illustration, suitable for a polished real application. Return local saved file path.
```
