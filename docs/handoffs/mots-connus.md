# Handoff — synchroniser les statuts de mots depuis Anki

## État

SubJap recherche dans tous les decks toutes les notes ayant un champ `Mot` non
vide. Ce champ est normalisé (ruby HTML, syntaxe Migaku, espaces et ponctuation
périphérique), puis le nombre de notes par lemme est mémorisé. Les tags
`KNOWN`, `IGNORED`, `UNKNOWN` ou `LEARNING` alimentent en parallèle les
`WordState` de source `import`. Retirer le dernier tag Anki d’un mot supprime
donc l’ancien import ; une décision locale `manual` reste prioritaire.

La synchronisation s’exécute au démarrage du content script, lorsque l’onglet
redevient visible, toutes les deux minutes et depuis le bouton des Options.

## Couleurs

- `KNOWN` et `IGNORED` : blanc ;
- `LEARNING` ou au moins une carte existante dans Anki : violet ;
- `UNKNOWN` sans carte existante : vert si très pertinent par fréquence, bleu
  dans la fenêtre suivante de 300 rangs, puis orange ;
- sans statut explicite et sans carte : même règle de fréquence.

La popover affiche le rang de fréquence pour toutes les couleurs lorsqu’il est
disponible. Elle affiche aussi `Déjà dans Anki · N carte(s)` ; aucun avertissement
supplémentaire n’est ajouté directement dans le sous-titre.

## Anki et mining

- AnkiConnect reste local sur `http://127.0.0.1:8765`.
- Le mining crée d’abord la carte IndexedDB, puis garantit le deck `SubJap` et
  le modèle `Migaku Memory` avant l’envoi.
- L’export externe reste dans le deck `Migaku Memory` et utilise le modèle
  `Migaku Memory Import`, compatible par ses champs mais volontairement
  distinct pour éviter un suffixe Anki `+`.
- Un échec Anki reste visible dans le modal et peut être réessayé sans créer une
  seconde carte locale.
- Plusieurs phrases pour un même `Mot` sont autorisées dans le deck SubJap.

## Fichiers utiles

- `src/background/anki-known.ts` — normalisation, priorités et réconciliation ;
- `src/background/service-worker.ts` — appels AnkiConnect et persistance ;
- `src/mining/modal.ts` — création locale, envoi et retry ;
- `src/core/frequency.ts` et `src/overlay/renderer.ts` — règles de couleur ;
- `src/content/index.ts` — cadence de synchronisation.
