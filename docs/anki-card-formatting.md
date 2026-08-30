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

Le dépôt séparé `C:\Users\piola\Projects\migaku-export` possède une copie
CommonJS de cette présentation dans `anki-presentation.js`. Toute modification
visuelle destinée à l’export Migaku doit être répercutée dans les deux fichiers.
Ne pas modifier `dist/` ou un fichier `.apkg` à la main : ce sont des sorties
générées.

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
production masque le span `.target` de `Phrase` par un blanc fixe et garde la
traduction repliée. Son verso remet la phrase complète et ordonne `AudioMot`
avant `AudioPhrase`.

Le verso conserve cette structure verticale :

1. `Mot` en haut, dans la couleur d’accent ;
2. `Phrase` ;
3. les boutons `AudioMot` puis `AudioPhrase` ;
4. le bouton de révélation de `Traduction`, si le champ existe ;
5. le séparateur ;
6. le panneau `Définitions` ;
7. `Image` ;
8. `Notes`, si le champ existe.

Ne pas réafficher automatiquement `Mot` ou `Lecture` dans la définition. Ne pas
changer l’ordre vertical sans demande explicite : il correspond aux habitudes
de révision établies.

## Règles visuelles actuelles

Le thème est sombre et cinématographique, mais la carte est destinée à un
ordinateur. La règle `@media (min-width: 901px)` compacte le verso tout en
conservant son empilement vertical :

- tailles et marges du mot, de la phrase, de la traduction et de la définition
  réduites ;
- boutons audio distincts mais discrets : violet pour le mot, turquoise pour la
  phrase ;
- image affichée en entier avec `object-fit: contain` ;
- image limitée à `min(300px, 30vh)` en hauteur pour laisser apparaître Notes ;
- Notes conservées dans la carte, avec une taille de texte et des espacements
  réduits ;
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
2. répercuter le changement dans
   `C:\Users\piola\Projects\migaku-export\anki-presentation.js` si l’export
   est concerné ;
3. conserver les noms de champs et les conditions `{{#Champ}}...{{/Champ}}` ;
4. conserver le marqueur dans les templates ;
5. exécuter `npm.cmd run build` dans SubJap ;
6. exécuter `npm.cmd run build` dans `migaku-export` pour régénérer le paquet
   si sa présentation a changé ;
7. appliquer la présentation au modèle existant via `anki:setup` et vérifier
   visuellement un recto et un verso sur ordinateur.

Selon les instructions du projet, ne pas créer ni lancer de tests automatisés
ou de vérification navigateur pour une simple modification de présentation.

## Pièges à éviter

- modifier uniquement `migaku-export/anki-presentation.js` et oublier SubJap ;
- modifier uniquement le CSS d’un modèle dans Anki sans mettre à jour la source ;
- confondre le champ `Définitions` avec un champ hypothétique `Definition` ;
- rendre l’image plus grande sans réserver de place à `Notes` ;
- ajouter une dépendance HyperTTS au template sans vérifier la configuration du
  preset chez l’utilisateur ;
- supprimer le marqueur de template, ce qui peut autoriser SubJap à remplacer
  une personnalisation existante ;
- éditer les notes existantes une par une alors que le besoin concerne le type
  de note.
