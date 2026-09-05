---
target: rendu Anki actuel
total_score: 22
p0_count: 0
p1_count: 2
timestamp: 2026-09-03T17-19-28Z
slug: src-background-anki-presentation-ts
---
# Critique du rendu Anki actuel

## Santé du design

| # | Heuristique | Score | Problème clé |
|---|---|---:|---|
| 1 | Visibilité de l’état du système | 3/4 | Les états de production existent, mais les audios ne communiquent pas leur rôle ni leur état. |
| 2 | Correspondance système / monde réel | 3/4 | L’ordre pédagogique est naturel ; les deux lecteurs identiques et les étoiles restent opaques. |
| 3 | Contrôle et liberté | 1/4 | La traduction révélée ne se replie plus et l’activation de production n’a pas d’annulation. |
| 4 | Cohérence et standards | 3/4 | Le langage SubJap est cohérent, sauf les gros contrôles audio blancs. |
| 5 | Prévention des erreurs | 2/4 | Une action durable de production part au premier clic sans contrat visible. |
| 6 | Reconnaissance plutôt que rappel | 2/4 | Il faut mémoriser quel audio correspond au mot ou à la phrase et deviner les étoiles. |
| 7 | Flexibilité et efficacité | 2/4 | Anki fournit ses raccourcis, mais les actions SubJap n’ont pas de distinction ou d’accélérateur visible. |
| 8 | Esthétique et minimalisme | 3/4 | La base est propre ; les panneaux dominent l’image et la fin laisse un grand vide. |
| 9 | Diagnostic et récupération | 2/4 | Les erreurs peuvent exposer AnkiConnect et aucun retour arrière n’est proposé. |
| 10 | Aide et documentation | 1/4 | Le contrat de production est caché dans un tooltip et les audios ne sont pas expliqués. |
| **Total** |  | **22/40** | **Acceptable — fondation solide, hiérarchie à reprendre.** |

## Verdict anti-patterns

Le rendu ne fait pas « généré par IA ». Il évite les dégradés, le glassmorphism, les glows, les ombres molles et les arrondis excessifs. La palette sombre, le blanc cassé et le vermillon sont disciplinés. Le seul risque de banalisation vient de la succession de grands panneaux arrondis pleine largeur, qui rapproche ponctuellement la carte d’un dashboard dark mode générique.

Le détecteur statique Impeccable a analysé `src/background/anki-presentation.ts` et n’a trouvé aucun anti-pattern : 0 constat, 0 règle déclenchée, code de sortie 0. Ce résultat confirme l’absence des tics visuels les plus évidents, mais ne valide ni le contraste calculé, ni l’accessibilité, ni les états interactifs dans Anki.

Aucun overlay navigateur fiable n’a été produit : la cible est une capture de l’application native Anki et son rendu dépend du moteur Anki. Le signal de repli combine l’inspection de la capture originale, la source et le contrat documentaire.

## Impression générale

La DA fonctionne : sobre, précise, nocturne, avec un vermillon utile. Le mot cible et la phrase japonaise donnent une bonne entrée en matière. En revanche, la composition ressemble encore à une fiche technique posée sous une phrase plutôt qu’à un souvenir de scène guidé par l’apprentissage. La plus grande opportunité est de redonner la priorité visuelle à l’image et de réunifier les largeurs.

## Ce qui fonctionne

- **La couleur est maîtrisée.** Le vermillon reste rare et sémantique ; il guide vers le mot cible et l’action de traduction.
- **Le japonais est immédiatement lisible.** Mot, furigana et phrase forment une séquence claire avec une bonne respiration.
- **Le rendu a une vraie retenue.** Pas d’effets décoratifs gratuits ; les surfaces tonales et l’image non recadrée respectent la direction « après-séance ».

## Problèmes prioritaires

### [P1] Les deux contrôles audio sont indiscernables

Les deux disques blancs identiques happent davantage l’œil que le mot cible, sans dire lequel joue le mot et lequel joue la phrase. Il faut les rendre plus discrets et leur donner un libellé ou un traitement distinct.

Commande suggérée : `$impeccable clarify`.

### [P1] « Production orale » ressemble à un easter egg alors que l’action est durable

Le contrôle est minuscule et atténué, tandis que son vrai effet — créer une carte sœur différée — n’est expliqué que dans un tooltip. Il faut garder l’action secondaire, mais rendre son contrat compréhensible et prévoir un retour clair après activation.

Commande suggérée : `$impeccable clarify`.

### [P2] La scène n’est pas réellement au premier plan

Les panneaux Définition et Notes occupent presque deux fois la largeur de l’image. Les changements de largeur donnent l’impression de trois modules indépendants et transforment l’image en pièce jointe. Une colonne éditoriale cohérente, avec une image plus présente et du texte plus mesuré, renforcerait l’identité.

Commande suggérée : `$impeccable layout`.

### [P2] La typographie secondaire est trop petite et trop longue

Les labels et petits boutons descendent autour de 10 px, tandis que les notes s’étendent bien au-delà d’une mesure de lecture confortable. Les cinq étoiles ajoutent aussi du bruit sans sens explicite. Il faut relever les micro-textes, limiter la largeur des notes et clarifier les métadonnées.

Commande suggérée : `$impeccable typeset`.

### [P2] La révélation de traduction est sans retour

Une fois ouverte, la traduction n’a plus de contrôle visible pour être repliée. Le composant devrait rester réversible et conserver une affordance stable.

Commande suggérée : `$impeccable harden`.

## Red flags par persona

**Alex — utilisateur Anki expérimenté**

- Perd du temps à apprendre par habitude l’ordre des deux audios.
- Balaye une note trop large et des blocs dont la mesure change constamment.
- Ne peut ni replier la traduction ni annuler une activation de production.

**Jordan — première carte SubJap**

- Ne peut pas identifier les fonctions respectives des deux lecteurs.
- Peut interpréter les étoiles comme une difficulté, une fréquence ou une qualité.
- Ne comprend pas ce que « + Production orale » va créer avant de cliquer.

**Sam — basse vision ou clavier**

- Les libellés à 10 px et le bouton atténué sont fragiles malgré de bons contrastes principaux.
- L’aide dans `title` est peu fiable sans survol.
- La très longue ligne de notes devient difficile à suivre au zoom.

## Observations mineures

- Le label vermillon « Définition » reçoit plus d’importance que « Notes » sans raison pédagogique claire.
- Le début de la carte est un peu tassé sous la barre native, tandis que sa fin laisse un grand vide.
- Les barres grises haute et basse appartiennent à Anki et ne sont pas une incohérence interne de la DA SubJap.
- L’image elle-même est bien traitée : le problème est son poids dans la composition, pas son recadrage.

## Questions à considérer

- Si l’image est l’artefact mémoriel de la scène, pourquoi la définition possède-t-elle deux fois sa largeur ?
- Le pic émotionnel doit-il être la reconnaissance de la scène ou la lecture de la définition ?
- Si les étoiles sont utiles, quelle décision concrète doivent-elles aider à prendre pendant la révision ?
