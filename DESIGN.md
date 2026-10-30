---
name: SubJap
description: Du japonais vécu à l'écran au japonais retenu.
colors:
  canvas-ink: "#0C0D10"
  surface-ink: "#14161B"
  surface-raised: "#1B1E24"
  surface-input: "#101216"
  hairline: "#343842"
  subtitle-white: "#F4F1EA"
  text-muted: "#B2B6BF"
  unknown-grey: "#9CA1AA"
  clap-vermilion: "#FF624D"
  clap-vermilion-hover: "#FF7966"
  learning-violet: "#D3A0FF"
  priority-green: "#78D6A3"
  priority-blue: "#55B8FF"
  priority-amber: "#F1B46D"
  danger: "#FF8490"
typography:
  caption:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.35
  small-label:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
  compact:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  display:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "64px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  headline:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  subheading:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  word:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "IBM Plex Sans JP, Yu Gothic UI, Hiragino Kaku Gothic ProN, Meiryo, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.01em"
rounded:
  control: "6px"
  dense: "8px"
  token: "0.16em"
  subtitle-line: "0.18em"
  panel: "10px"
  prominent: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clap-vermilion}"
    textColor: "{colors.canvas-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.clap-vermilion-hover}"
    textColor: "{colors.canvas-ink}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.subtitle-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  input:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.subtitle-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  panel:
    backgroundColor: "{colors.surface-ink}"
    textColor: "{colors.subtitle-white}"
    rounded: "{rounded.panel}"
    padding: "16px"
  status-chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
---

# Design System: SubJap

## 1. Overview

**Creative North Star: "L'Après-séance"**

SubJap prolonge une scène qui vient d'être vécue : le produit prélève un mot,
l'éclaire avec précision, puis le conduit jusqu'à la mémoire. Son interface
évoque un studio de sous-titrage japonais contemporain dans une pièce peu
éclairée. Elle est concentrée et cinématographique, mais reste complice plutôt
que froide.

La vidéo demeure la source de lumière et le contenu demeure le protagoniste.
Les surfaces utilisent peu de niveaux, peu d'effets et une densité maîtrisée.
Le vermillon signe la marque sans rivaliser avec les couleurs pédagogiques. Le
même langage s'étend du sous-titre à la popover, du mining aux réglages, puis à
la carte Anki.

Le système rejette explicitement l'imagerie kawaii ou manga, le cyberpunk
saturé de néons et l'interface SaaS violette générique. Sa personnalité vient
de la composition, du rythme, de la typographie et de la précision des états,
jamais d'une décoration japonaise plaquée.

**Key Characteristics:**

- Sombre par contexte d'usage, jamais sombre par effet de mode.
- Compact et calme au repos, tactile et explicite à l'action.
- Une hiérarchie de studio : scène, mot, sens, action.
- Un fil visuel continu entre l'extension et Anki.
- Une couleur de marque rare ; plusieurs couleurs pédagogiques strictement sémantiques.

## 2. Colors

La palette associe des encres froides, un blanc de sous-titre légèrement cassé
et un vermillon franc inspiré d'un repère de montage plutôt que d'un néon.

### Primary

- **Vermillon de clap** (`clap-vermilion`) : signature de SubJap, réservée à
  l'action principale, au focus actif et à de rares repères identitaires.
- **Vermillon en action** (`clap-vermilion-hover`) : état de survol ou de pression,
  jamais une seconde couleur décorative.

### Secondary

- **Violet d'apprentissage** (`learning-violet`) : mention « Déjà dans Anki » de
  la popover ; n'est plus employé dans le sous-titre.
- **Vert de priorité** (`priority-green`) : mot à miner fortement pertinent.
- **Bleu de progression** (`priority-blue`) : mot à miner de pertinence intermédiaire.
- **Ambre de marge** (`priority-amber`) : avertissement non bloquant ; n'est plus
  employé dans le sous-titre.

### Tertiary

- **Signal d'erreur** (`danger`) : échec, donnée invalide ou action impossible.
  Il n'est jamais employé pour attirer décorativement l'attention.

### Neutral

- **Encre de projection** (`canvas-ink`) : fond principal de l'application et des cartes.
- **Encre de panneau** (`surface-ink`) : regroupement structurel au premier niveau.
- **Encre relevée** (`surface-raised`) : contrôle, sélection ou surface secondaire.
- **Encre de saisie** (`surface-input`) : champs et zones éditables.
- **Trait de montage** (`hairline`) : séparateurs et contours utiles uniquement.
- **Blanc de sous-titre** (`subtitle-white`) : texte principal et mots connus.
- **Gris de régie** (`text-muted`) : texte secondaire qui reste lisible au niveau AA.
- **Gris d'inconnu** (`unknown-grey`) : mots inconnus non prioritaires des sous-titres ; plus sombre que le gris de régie pour se détacher nettement du blanc, tout en restant lisible sur une image claire grâce au halo des sous-titres.

**The Ten Percent Rule.** Le vermillon occupe au plus 10 % d'une surface ; sa rareté fait la marque.

**The Pedagogy Rule.** Vert, bleu, ambre et indigo décrivent exclusivement un état d'apprentissage. Ils ne décorent jamais l'interface.

**The Double Signal Rule.** Un état de vocabulaire important associe sa couleur à une forme, un libellé, une icône ou un traitement typographique.

## 3. Typography

**Display Font:** IBM Plex Sans JP avec une pile japonaise système robuste

**Body Font:** IBM Plex Sans JP avec la même pile de repli

**Label/Mono Font:** IBM Plex Sans JP ; le monospace est réservé aux valeurs réellement techniques

**Embarquement :** seule la partie latine d'IBM Plex (400, 500, 600) est
fournie par l'extension, sous le nom `IBM Plex Sans JP`, sur la page vidéo comme
dans la popup et les Options. Le japonais, trop lourd à embarquer, retombe sur
la pile système (Yu Gothic UI, Hiragino, Meiryo), sauf si IBM Plex Sans JP est
installée. Les cartes Anki n'embarquent pas la police.

**Character:** Une seule famille porte l'ensemble du produit. Sa construction
précise évoque un outil de studio, tandis que ses formes ouvertes gardent les
textes français et japonais humains et lisibles.

### Hierarchy

- **Caption** (500, `10px`, `1.35`) : micro-états et aide compacte uniquement lorsqu'un libellé plus grand ne tient pas.
- **Small label** (500, `11px`, `1.35`) : repères compacts des cartes Anki.
- **Compact** (400, `13px`, `1.5`) : popover et contrôles très denses superposés à la vidéo.
- **Display** (600, `64px`, `1.25`) : mot japonais principal sur le recto Anki ; la taille descend lorsque la longueur l'exige.
- **Word** (600, `44px`, `1.35`) : mot cible sur les versos Anki et exercices de production.
- **Headline** (600, `24px`, `1.35`) : phrase ou titre principal d'une surface concentrée.
- **Subheading** (600, `20px`, `1.4`) : accent intermédiaire dans les contenus de révision.
- **Title** (600, `17px`, `1.4`) : titres de panneaux, de sections et de modales.
- **Body** (400, `14px`, `1.55`) : explications et contenu courant, limité à environ 70 caractères par ligne hors données compactes.
- **Label** (500, `12px`, `0.01em`) : commandes, métadonnées et états ; casse naturelle par défaut.

**The Subtitle Rule.** Le japonais n'est jamais comprimé par un interlettrage négatif et conserve une hauteur de ligne généreuse.

**The Natural Case Rule.** Les libellés restent en casse naturelle ; les petites capitales espacées ne sont pas une décoration de section.

## 4. Elevation

SubJap est plat et tonal par défaut. La profondeur vient du contraste entre les
encres, de l'espace et de la superposition réelle. Une ombre courte apparaît
uniquement lorsqu'un élément flotte effectivement au-dessus de la vidéo ou de
l'application ; les cartes Anki et les panneaux au repos n'en utilisent pas.

### Shadow Vocabulary

- **Popover de scène** (`0 6px 8px rgba(0, 0, 0, 0.38)`) : uniquement pour la popover au-dessus de la vidéo.
- **Modal de mining** (`0 8px 8px rgba(0, 0, 0, 0.42)`) : uniquement pour le dialogue réellement modal.

**The Flat-at-Rest Rule.** Une surface au repos choisit soit un contour fin, soit une différence tonale ; elle ne cumule jamais contour et grande ombre douce.

**The Real Depth Rule.** Aucune ombre n'est autorisée si l'élément ne recouvre pas physiquement un autre plan.

## 5. Components

Les composants sont précis au repos et tactiles à l'action. Leur vocabulaire
reste identique dans la popup, les options, la popover, le mining et Anki.

### Buttons

- **Shape:** angles légèrement adoucis (`6px`) ; pilule uniquement pour une action circulaire ou un statut court.
- **Primary:** vermillon de clap, texte couleur encre, graisse moyenne et zone tactile généreuse (`10px 14px`).
- **Hover / Focus:** éclaircissement bref, focus visible de `2px`, translation maximale de `1px` à la pression ; transition de `160ms` avec sortie rapide.
- **Secondary / Ghost:** encre relevée ou fond transparent ; ils ne concurrencent jamais l'action primaire.
- **Disabled / Loading:** baisse de contraste accompagnée d'un libellé explicite ; aucun changement ne repose uniquement sur l'opacité.

### Chips

- **Style:** petites métadonnées en encre relevée, texte lisible et rayon pilule.
- **State:** une puce d'état porte un libellé ou un symbole en plus de sa couleur ; une puce ne remplace pas un bouton d'action.

### Cards / Containers

- **Corner Style:** panneaux fonctionnels à `10px`, surfaces importantes à `12px` maximum.
- **Background:** encre de panneau sur encre de projection ; l'encre relevée sert aux sous-zones actives.
- **Shadow Strategy:** aucune ombre au repos ; voir la règle de profondeur réelle.
- **Border:** trait de montage sur le périmètre complet seulement lorsqu'il améliore la séparation.
- **Internal Padding:** `16px` par défaut, `12px` en contexte compact, `24px` pour une surface de lecture.

### Inputs / Fields

- **Style:** encre de saisie, texte blanc de sous-titre, trait de montage et rayon de `6px`.
- **Focus:** contour vermillon visible et stable, sans halo diffus.
- **Error / Disabled:** erreur signalée par couleur et message ; état désactivé lisible et explicitement non interactif.

### Navigation

- **Style:** hiérarchie textuelle simple, sans barre décorative. L'état actif associe contraste, graisse et repère vermillon discret.
- **Treatment:** la popup privilégie une seule colonne ; les Options structurent les réglages en sections continues plutôt qu'en grille de cartes identiques.

### Subtitle Token

Le token japonais est le composant signature. **The Mine-Now Rule.** Un mot
écrit en couleur est un mot à miner maintenant : seul l'unique inconnu d'une
phrase prend le vert ou le bleu, souligné d'un trait plein de sa couleur. Les
autres mots encore illisibles, y compris ceux déjà dans Anki mais pas encore
acquis, sont seulement grisés, sans soulignement, afin que le blanc se lise
comme « compris ». La présence dans Anki n'est précisée que dans la popover.
Chaque état porte un seul signal, et les soulignements restent droits jusqu'aux
extrémités du mot. Survol, focus et
sélection ajoutent un soulignement ou un fond local afin que la couleur ne soit
jamais le seul signal. Comme les sous-titres natifs, le sous-titre n'a ni fond ni contour : un halo
sombre diffus autour des glyphes le garde lisible sur toute image, y compris
pour le gris et les couleurs de vocabulaire. Un contour noir net fait
autocollant et mange les glyphes fins.

Le japonais s'affiche en texte continu, sans espace entre les tokens : les
limites des mots ne se révèlent que par le survol, le focus et les soulignements
de vocabulaire, collés à leur mot. Le sous-titre japonais est en graisse `600` ;
la traduction, en blanc avec le même halo, reste secondaire par sa taille
réduite et sa graisse `400` ; un gris la rendrait terne sans fond.

### Anki Review Card

La carte ne simule pas une carte flottante : le canevas Anki devient la scène.
Le recto concentre le regard sur le mot ; le verso se lit de haut en bas dans
une seule colonne : la fiche du mot, puis la scène (image, phrase, audio,
traduction), puis les notes, soit le sens, le contexte et l'approfondissement. Le
vermillon relie la cible à SubJap, tandis que l'image reste un artefact de la scène.

## 6. Do's and Don'ts

### Do:

- **Do** utiliser l'encre de projection comme canevas et le blanc de sous-titre comme voix principale.
- **Do** réserver le vermillon de clap aux actions primaires, au focus et à de rares repères de marque.
- **Do** conserver l'ordre pédagogique des cartes Anki et adapter la densité sans masquer les Notes ni recadrer l'image.
- **Do** fournir les états default, hover, focus, active, disabled, loading et error pour chaque contrôle interactif.
- **Do** respecter `prefers-reduced-motion` et maintenir les transitions fonctionnelles entre `150ms` et `200ms`.
- **Do** associer toute couleur de vocabulaire à un second signal perceptible.

### Don't:

- **Don't** employer l'imagerie kawaii, les mascottes manga ou les clichés touristiques japonais.
- **Don't** adopter un cyberpunk saturé de néons, des effets futuristes décoratifs ou une surcharge visuelle.
- **Don't** reproduire une interface SaaS violette générique, ses dégradés décoratifs, ses grandes cartes flottantes ou ses composants uniformément arrondis.
- **Don't** utiliser de texte en dégradé, de glassmorphism décoratif ou de fond quadrillé.
- **Don't** utiliser un liseré coloré épais sur un seul côté d'un panneau ; employer un contour complet, un fond tonal ou une icône.
- **Don't** cumuler un contour de `1px` avec une ombre douce de plus de `8px` de flou.
- **Don't** dépasser `12px` de rayon sur un panneau ou une carte ; les pilules sont réservées aux statuts et contrôles qui les justifient.
- **Don't** multiplier les petits titres en capitales espacées au-dessus de chaque section.
