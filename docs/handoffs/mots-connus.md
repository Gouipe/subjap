# Handoff — synchroniser les mots connus depuis Anki

## État

La synchronisation initiale est implémentée. Au démarrage du content script,
SubJap recherche les notes Anki portant le tag `KNOWN`, normalise leur champ
`Mot` (syntaxe Migaku ou ruby HTML), puis crée des `WordState` locaux avec la
provenance `import`. Un état `manual` local n’est pas écrasé.

## Comportement actuel

- `wordStates` est une table IndexedDB locale à l’extension ; `word:get` et
  `word:set` lisent et écrivent uniquement cette table.
- Le bouton « Mark Known » crée ou modifie un `WordState` local.
- AnkiConnect sert à vérifier la connexion, lister les decks, rechercher les
  notes `KNOWN`, créer le modèle, compter les cartes dues et envoyer les
  nouvelles cartes après un mining.
- `findNotes` + `notesInfo` synchronisent les mots connus au démarrage ; le
  calendrier SRS n’est pas modifié.
- L’URL AnkiConnect est codée en dur sur `http://127.0.0.1:8765` ; AnkiWeb
  n’est pas utilisé directement.
- Les notes envoyées utilisent le modèle `Migaku Memory` ; le champ `Mot`
  contient la forme affichée, mais pas encore un champ dédié au lemme.

## Décisions à prendre

1. « Serveur Anki » signifie-t-il une instance AnkiConnect accessible sur le
   réseau, ou AnkiWeb ? AnkiWeb n’est pas couvert par AnkiConnect directement.
2. Un mot est-il connu dès qu’une note existe, ou seulement si sa carte a été
   révisée / est mature ?
3. Quels decks inclure : uniquement `SubJap`, un deck configuré, ou tous les
   decks ?
4. Ajouter un champ stable `Lemma` au modèle SubJap, ou un tag structuré ?
5. Comment arbitrer les états : Anki comme source de vérité, ou possibilité de
   conserver des exceptions locales `unknown` ?

## Suite possible

1. Rendre l’hôte/URL AnkiConnect configurable et traiter explicitement les
   contraintes CORS, authentification et sécurité réseau.
2. Ajouter le lemme aux nouvelles notes et faire évoluer le modèle SubJap si
   la normalisation du champ `Mot` devient insuffisante.
3. Ajouter une synchronisation périodique ou déclenchée depuis les Options.
4. Ajouter une suppression des anciens `source: "import"` lorsque le tag
   `KNOWN` est retiré dans Anki.

## Fichiers utiles

- `src/background/service-worker.ts` — handlers `word:*` et AnkiConnect ;
- `src/mining/modal.ts` — création locale puis push Anki ;
- `src/core/types.ts` — `WordState`, messages et modèle Anki ;
- `src/core/db.ts` — schéma IndexedDB ;
- `src/content/index.ts` — affichage et consommation de l’état connu ;
- `docs/architecture.md` et `docs/spec_initiale.md` — décisions historiques.
