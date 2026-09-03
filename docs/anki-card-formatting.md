# Mise en forme des cartes Anki

Ce document sert de guide de maintenance pour un agent qui doit modifier
l’apparence des cartes Anki compatibles avec Migaku. Il décrit l’état actuel du
projet et le contrat à préserver ; il ne remplace pas une demande fonctionnelle
plus récente de l’utilisateur.

## Sources de vérité

Dans le dépôt SubJap, la présentation est définie dans
[`src/background/anki-presentation.ts`](../src/background/anki-presentation.ts) :

- `MIGAKU_FIELDS` définit le contrat de champs ;
- `MIGAKU_CSS` contient tout le CSS du type de note ;
- `MIGAKU_FRONT_TEMPLATE` contient le recto ;
- `MIGAKU_BACK_TEMPLATE` contient le verso ;
- `MIGAKU_TEMPLATE_MARKER` permet de reconnaître un template déjà géré par
  SubJap.

Le dépôt séparé `C:\Users\piola\Projects\migaku-export` n’appartient plus au
workflow de maintenance de SubJap : ne pas le modifier ni le construire lors
des évolutions de cartes Anki. Le modèle `Migaku Memory Import` reste néanmoins
pris en charge dans Anki afin que les cartes déjà importées bénéficient de la
présentation actuelle. Ne pas modifier `dist/` à la main : c’est une sortie
générée.

## Modèles et decks concernés

| Type de note | Deck habituel | Origine | Présentation partagée |
| --- | --- | --- | --- |
| `Migaku Memory` | `日本語::Vocabulaire::Compréhension` | cartes minées depuis SubJap | oui |
| `Migaku Memory Import` | `日本語::Vocabulaire::Compréhension` | paquet produit par `migaku-export` | oui |
| `Migaku Vocabulary Status` | `Migaku Memory::Status` | états de vocabulaire importés | non, modèle technique suspendu |

Le modèle `Migaku Memory Import` a volontairement un nom différent de
`Migaku Memory` afin qu’Anki ne le renomme pas automatiquement en
`Migaku Memory+` lors d’un import.

Chaque modèle actif possède deux types de carte, `Compréhension` et
`Production`. Leur comportement pédagogique et leur organisation en sous-decks
sont définis dans [`anki-production.md`](anki-production.md).

## Contrat des champs

Les deux modèles de cartes d’apprentissage doivent conserver exactement ces
champs :

| Champ | Rôle | Particularités de mise en forme |
| --- | --- | --- |
| `Mot` | mot cible japonais | peut contenir du HTML ruby avec les furigana ; affiché en haut du recto et du verso |
| `Lecture` | lecture en kana | champ texte séparé, utile comme source de prononciation HyperTTS |
| `Phrase` | phrase japonaise | peut contenir des spans HTML, dont `.target` pour le mot cible |
| `Traduction` | traduction de la phrase | affichée derrière le bouton « Voir la traduction » |
| `Définitions` | définition(s) du mot | définitions séparées par `, ` |
| `Notes` | explication ou remarque facultative | doit rester visible sur le verso, dans un bloc compact |
| `Image` | capture ou image contextuelle | généralement un `<div><img ...></div>` |
| `AudioMot` | audio du mot facultatif | balise Anki `[sound:...]` ou HTML audio fourni par HyperTTS |
| `AudioPhrase` | audio de la phrase facultatif | balise Anki `[sound:...]` |
| `Production` | état technique de la carte sœur | vide avant activation, timestamp pendant le délai de deux jours, puis `active` |

Ne pas renommer `Définitions` en `Definition`, ni `Lecture` en `Reading`, sans
mettre à jour simultanément le contrat dans le code SubJap et dans l’export.
Une note dont un champ optionnel est vide doit rester affichable : les sections
correspondantes sont protégées par les conditions de template Anki.

## Ordre et contenu actuels

Le recto de compréhension reste volontairement simple :

1. `Mot` ;
2. `Lecture`, si elle existe ;
3. `AudioMot`, si elle existe.

Son verso conserve le bouton d’activation de la production. Le recto de
production masque le span `.target` de `Phrase` par un blanc fixe, affiche
directement `Définitions` et n’affiche pas `Traduction`. Son verso remet la
phrase complète et reprend exactement la présentation du verso de compréhension,
sans le bloc d’activation de la production.

Le verso conserve cette structure verticale :

1. `Mot` en haut, dans la couleur d’accent ;
2. `Phrase` ;
3. les contrôles audio `Mot` puis `Phrase` (si les champs existent) ;
4. le bouton de révélation de `Traduction`, si le champ existe ;
5. le séparateur ;
6. le panneau `Définitions` ;
7. `Image` ;
8. `Notes`, si le champ existe.

Ne pas réafficher automatiquement `Mot` ou `Lecture` dans la définition. Ne pas
changer l’ordre vertical sans demande explicite : il correspond aux habitudes
de révision établies.

## Raccourcis de notation

Sur le verso d’une carte, SubJap relaie les touches AZERTY vers les commandes de
notation natives d’Anki : `&` pour « À revoir », `é` pour « Difficile », `"` pour
« Correct » et `'` pour « Facile ». Les touches avec `Ctrl`, `Alt` ou `Cmd`, ainsi
que les champs éditables, sont ignorées afin de ne pas intercepter une saisie.
Les boutons et leur ordre restent ceux du reviewer Anki ; le raccourci est un
accélérateur supplémentaire.

## Règles visuelles actuelles

Les cartes déclinent la direction artistique « L'Après-séance » décrite dans
[`DESIGN.md`](../DESIGN.md). Le thème évoque un studio de sous-titrage
contemporain : encres froides, blanc de sous-titre, vermillon rare et
typographie IBM Plex Sans JP avec des replis système. Il est destiné en priorité
à un ordinateur dans une ambiance lumineuse faible.

La présentation reste plate et tonale : pas de dégradé décoratif, pas de grande
ombre flottante, pas de liseré coloré sur un seul côté et aucun rayon supérieur
à 12 px sur un panneau. Le vermillon identifie le mot cible et les actions
principales ; les contrôles audio restent compacts, nommés et neutres pour ne
pas concurrencer le contenu.

La règle `@media (min-width: 901px)` compacte le verso tout en conservant son
empilement vertical :

- colonne de lecture unifiée, avec panneaux texte et image alignés sur la même
  largeur éditoriale ;
- contrôles audio nommés `Mot` et `Phrase`, avec une cible tactile compacte ;
- image affichée en entier avec `object-fit: contain` ;
- image limitée à `min(360px, 36vh)` en hauteur afin de gagner en présence tout
  en laissant apparaître Notes ;
- Notes conservées dans la carte, avec une mesure de lecture limitée à environ
  70 caractères par ligne ;
- traduction révélée par « Voir la traduction », puis maintenue visible sans
  contrôle secondaire qui prend de la place ;
- pas de règle qui recadre l’image avec `object-fit: cover` ou qui masque Notes.

La mise en page sous 901 px conserve le comportement général non compact. Le
projet cible l’usage ordinateur ; une évolution mobile devra être spécifiée
séparément.

## HyperTTS et audio

SubJap ne doit pas injecter un nom de preset HyperTTS arbitraire dans le
template. L’utilisateur peut ajouter ses balises realtime HyperTTS depuis Anki.
Les templates marqués par `MIGAKU_TEMPLATE_MARKER` sont considérés comme déjà
gérés : la synchronisation de présentation préserve alors les personnalisations
du template, notamment ces balises.

Pour éviter qu’un kanji soit lu avec une mauvaise prononciation, la source
recommandée pour l’audio du mot est `Lecture`, pas `Mot`. Si HyperTTS affiche
« preset not found » ou « Source text is empty », diagnostiquer d’abord la
configuration HyperTTS et la valeur du champ `Lecture`. Ce n’est pas un
problème CSS.

Les champs audio sont optionnels. `AudioPhrase` peut rester vide lorsque la
capture de l’audio du lecteur est impossible ; cela ne doit pas invalider la
carte.

## Comment une modification atteint Anki

`src/background/service-worker.ts` applique la présentation pendant
`anki:setup` :

1. il vérifie les champs du modèle ;
2. il lit le CSS et les templates existants via AnkiConnect ;
3. il appelle `updateModelStyling` uniquement si le CSS a changé ;
4. il appelle `updateModelTemplates` uniquement si le template n’a pas déjà le
   marqueur SubJap ;
5. il traite aussi `Migaku Memory Import` lorsqu’il existe.

Cette mise à jour agit au niveau du type de note : les cartes existantes qui
utilisent ce modèle adoptent le nouveau CSS sans réécriture de leurs champs.
La mise à jour des modèles ne doit donc pas être remplacée par une migration
note par note.

Pour appliquer une nouvelle présentation aux modèles déjà présents :

1. laisser Anki ouvert avec AnkiConnect sur `127.0.0.1:8765` ;
2. recompiler l’extension ;
3. ouvrir les options SubJap et cliquer sur **Configurer les decks Anki** (l’action
   est idempotente et sert aussi à remettre à jour la présentation existante) ;
4. rouvrir l’aperçu Anki si une carte déjà affichée conserve l’ancien rendu.

## Procédure de modification

Pour une modification de style ou de template :

1. modifier `src/background/anki-presentation.ts` ;
2. conserver les noms de champs et les conditions `{{#Champ}}...{{/Champ}}` ;
3. conserver le marqueur dans les templates ;
4. exécuter `npm.cmd run build` dans SubJap ;
5. appliquer la présentation au modèle existant via `anki:setup` et vérifier
   visuellement un recto et un verso sur ordinateur.

Selon les instructions du projet, ne pas créer ni lancer de tests automatisés
ou de vérification navigateur pour une simple modification de présentation.

## Pièges à éviter

- modifier ou construire le dépôt externe `migaku-export` depuis un travail
  consacré à SubJap ;
- modifier uniquement le CSS d’un modèle dans Anki sans mettre à jour la source ;
- confondre le champ `Définitions` avec un champ hypothétique `Definition` ;
- rendre l’image plus grande sans réserver de place à `Notes` ;
- ajouter une dépendance HyperTTS au template sans vérifier la configuration du
  preset chez l’utilisateur ;
- supprimer le marqueur de template, ce qui peut autoriser SubJap à remplacer
  une personnalisation existante ;
- éditer les notes existantes une par une alors que le besoin concerne le type
  de note.
