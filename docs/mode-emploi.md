# Mode d’emploi — SubJap, Migaku et Anki

## Mise en place (une fois)

1. Installer AnkiConnect dans Anki et laisser Anki ouvert pendant l’usage de
   SubJap (`127.0.0.1:8765`).
2. Dans `C:\Users\piola\Projects\subjap`, exécuter `npm install`, puis
   `npm run build`.
3. Dans `chrome://extensions`, activer le mode développeur et charger le dossier
   `C:\Users\piola\Projects\subjap\dist`. Après chaque nouvelle compilation,
   cliquer sur **Recharger**.

SubJap crée automatiquement le deck `SubJap` et son type de note
`Migaku Memory`. Il ne faut pas les préparer manuellement.

## Usage quotidien de SubJap

1. Ouvrir Anki, puis la vidéo dans Chrome.
2. Survoler un mot du sous-titre et cliquer sur **Mine this**.
3. Vérifier la définition, l’audio et l’image, puis envoyer la carte. En cas
   d’erreur Anki, utiliser **Réessayer Anki** : la carte locale n’est pas recréée.
4. Réviser les nouvelles cartes dans le deck `SubJap` d’Anki.

Couleurs : vert = inconnu très pertinent, bleu = plutôt pertinent, orange =
inconnu peu pertinent, violet = `LEARNING` ou déjà présent dans Anki, blanc =
`KNOWN` ou `IGNORED`. La popover affiche toujours le rang disponible et le
nombre de cartes Anki existantes.

## Reconstruire et importer l’export Migaku

Dans PowerShell :

```powershell
cd C:\Users\piola\Projects\migaku-export
npm install
node export-cards.js .\core_<identifiant>.db .\migaku_cards_full.json .\migaku_cards_full.csv .\migaku_word_states.json
node fetch-media.js
node build-export.js
node verify-export.js
```

`fetch-media.js` nécessite la session Migaku locale dans `db/study`. Importer
ensuite `Migaku_Memory.apkg` depuis **Fichier > Importer** dans Anki. Le paquet
crée `Migaku Memory::New`, à réviser normalement, et
`Migaku Memory::Status`, qui doit rester entièrement suspendu : ce second deck
sert uniquement à transmettre les couleurs à SubJap. Les cartes Migaku déjà
étudiées et les cartes sans mot japonais cible ne sont pas ajoutées aux
révisions. Faire une sauvegarde Anki avant un import important.

## Piloter les couleurs depuis Anki

Ajouter à une note l’un des tags exacts `KNOWN`, `IGNORED`, `UNKNOWN` ou
`LEARNING`. SubJap les lit dans tous les decks si la note possède un champ
`Mot`. La synchronisation est automatique ; pour la forcer, ouvrir les options
SubJap et cliquer sur **Synchroniser maintenant**.

Une décision prise manuellement dans SubJap reste prioritaire sur Anki. Si une
couleur ne change pas, vérifier le tag, le champ `Mot`, AnkiConnect, puis relancer
la synchronisation.
