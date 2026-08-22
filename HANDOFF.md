# Handoff — synchroniser les mots connus depuis Anki

## État

Sujet étudié, mais pas encore implémenté. L’objectif est de déduire les mots
connus depuis un deck Anki distant afin que plusieurs navigateurs partagent le
même état. Le correctif précédent sur le rafraîchissement de la couleur des
mots est déjà intégré dans `master` (`ce504e9`).

## Comportement actuel

- `wordStates` est une table IndexedDB locale à l’extension ; `word:get` et
  `word:set` lisent et écrivent uniquement cette table.
- Le bouton « Mark Known » crée ou modifie un `WordState` local.
- AnkiConnect sert actuellement à vérifier la connexion, lister les decks,
  créer le deck/modèle, compter les cartes dues et envoyer les nouvelles cartes
  après un mining.
- Aucun appel actuel à `findNotes` ou `notesInfo` ne synchronise les mots
  depuis Anki.
- L’URL AnkiConnect est codée en dur sur `http://127.0.0.1:8765` ; AnkiWeb
  n’est pas utilisé directement.
- Les notes envoyées ne contiennent pas encore le lemme dans un champ dédié :
  `Front` contient la phrase et `Back` la lecture/définition/contexte.

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

## Piste d’implémentation

1. Rendre l’hôte/URL AnkiConnect configurable et traiter explicitement les
   contraintes CORS, authentification et sécurité réseau.
2. Ajouter le lemme aux nouvelles notes et faire évoluer le modèle SubJap.
3. Implémenter dans le service worker une lecture `findNotes`/`notesInfo` du ou
   des decks configurés.
4. Convertir les lemmes récupérés en `WordState` (`source: "import"`) via
   `word:batch`, ou les servir par un cache distant sans écraser les états
   manuels selon la décision prise.
5. Ajouter des tests unitaires avec un AnkiConnect simulé et un scénario E2E
   couvrant le rafraîchissement/synchronisation visible.

## Fichiers utiles

- `src/background/service-worker.ts` — handlers `word:*` et AnkiConnect ;
- `src/mining/modal.ts` — création locale puis push Anki ;
- `src/core/types.ts` — `WordState`, messages et modèle Anki ;
- `src/core/db.ts` — schéma IndexedDB ;
- `src/content/index.ts` — affichage et consommation de l’état connu ;
- `docs/architecture.md` et `docs/spec_initiale.md` — décisions historiques.
