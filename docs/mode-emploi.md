# Mode d’emploi — SubJap, Migaku et Anki

## Mise en place (une fois)

1. Installer AnkiConnect dans Anki et laisser Anki ouvert pendant l’usage de
   SubJap (`127.0.0.1:8765`).
2. Dans `C:\Users\piola\Projects\subjap`, exécuter `npm install`, puis
   `npm run build`.
3. Dans `chrome://extensions`, activer le mode développeur et charger le dossier
   `C:\Users\piola\Projects\subjap\dist`. Après chaque nouvelle compilation,
   cliquer sur **Recharger**.

SubJap crée automatiquement les sous-decks
`日本語::Vocabulaire::Compréhension` et `日本語::Vocabulaire::Production`, ainsi
que son type de note `Migaku Memory`. Il ne faut pas les préparer manuellement.

Le premier passage par SubJap applique aussi le thème desktop sombre aux modèles
`Migaku Memory` et `Migaku Memory Import` lorsqu’ils existent. Cette mise à jour
ne modifie pas le contenu des notes. Après l’installation du template versionné,
SubJap préserve les ajouts effectués par d’autres extensions dans celui-ci,
notamment les balises realtime créées par HyperTTS. Le modèle
`Migaku Memory Import` est celui utilisé par les cartes de compréhension
produites par `migaku-export`.

SubJap ne génère pas l’audio du mot. Pour entendre le mot dans Anki, installer et
configurer HyperTTS sur le modèle `Migaku Memory`, avec `Lecture` comme source,
puis ajouter sa balise realtime au modèle. La procédure détaillée est dans
[`anki-card-formatting.md`](anki-card-formatting.md).

## Usage quotidien de SubJap

1. Ouvrir Anki, puis la vidéo dans Chrome.
2. Dans la popup SubJap, choisir la langue secondaire : **Aucun**,
   **Français** ou **Anglais**. Le japonais reste toujours principal ; si la
   traduction choisie n’existe pas pour l’épisode, SubJap utilise automatiquement
   l’autre, sauf avec **Aucun**, qui désactive toute traduction secondaire.
3. Survoler un mot du sous-titre et cliquer sur **Mine this**.
4. La fenêtre « Créer une carte » présente un aperçu du verso Anki. Cliquer sur
   le mot, la lecture, la phrase ou la traduction pour les corriger sur place.
   Chaque traduction du dictionnaire est une pastille : les trois premières sont
   retenues, un clic en écarte ou en ajoute une.
5. Facultatif : cliquer sur **Enrichir avec l’IA** (`I`) pour ajouter aux Notes
   la décomposition des kanjis en tuiles, les synonymes et une association.
   SubJap privilégie les exemples contenant des mots déjà connus, puis en
   apprentissage, puis présents dans Anki. Le sens d’un kanji, un exemple ou
   une phrase se corrige au clic ; le × au survol supprime un exemple, une tuile
   ou un paragraphe. **+ Ajouter une note** ouvre une note personnelle libre.
6. Écouter la phrase avec `Q`, puis envoyer la carte avec **Créer dans Anki**
   (`Ctrl+Entrée`). Pendant la saisie d’un champ, `Entrée` valide et `Échap`
   annule la modification ; `Échap` ne ferme jamais la fenêtre. En cas d’erreur
   Anki, utiliser **Réessayer Anki** : la carte locale n’est pas recréée.
7. Réviser les nouvelles cartes dans le deck
   `日本語::Vocabulaire::Compréhension` d’Anki.

Le compteur **Mots connus** inclut automatiquement les mots dont une carte
`Compréhension` dans `日本語` ou ses sous-decks a terminé l’apprentissage
initial et est passée en Révision. Un oubli suivi de réapprentissage ne les
retire pas du compteur. Les mots tagués `KNOWN`, y compris dans
`Migaku Memory::Status`, restent connus ; chaque identité lexicale compte une
seule fois. Les anciens tags `UNKNOWN` ou `LEARNING` ne bloquent pas un mot
acquis. Les choix manuels dans SubJap et les mots ignorés restent prioritaires.
La synchronisation a lieu à l’ouverture de Netflix, au retour sur l’onglet et
toutes les deux minutes, avec Anki ouvert. La popup seule ne la déclenche pas.

Pour regarder une vidéo sans SubJap, utiliser l’interrupteur en haut de la
popup. Désactivé, SubJap ne fait plus rien sur aucun site : pas d’overlay, pas
de raccourcis, sous-titres natifs inchangés. L’effet est immédiat dans les
onglets ouverts, sans rechargement, et l’icône affiche **OFF** jusqu’à la
réactivation.

Chaque profil de navigateur possède sa propre base locale : SubJap peut être
utilisé dans plusieurs navigateurs ou profils, mais leurs états de vocabulaire
ne se synchronisent pas entre eux. Les décisions manuelles ne sont donc pas
partagées. Les états provenant d’Anki peuvent être réimportés dans chaque profil
lors d’une synchronisation, si AnkiConnect y est accessible.

Si **Activer l’écoute active** est activé, l’exercice ne se lance pas
automatiquement : appuyer sur **Q** (phrase précédente) ou **S** (phrase
courante) sur une phrase dont tous les mots sont connus ou ignorés. Les noms
de locuteur ou indications entre parenthèses dans les sous-titres CC sont
ignorés. La phrase doit aussi être suffisamment longue et structurée pour
constituer un exercice.
Cela fonctionne aussi en pause : **Q** ou **S** prépare l’exercice sans
reprendre la vidéo, puis **A** démarre l’écoute. Pendant la lecture, l’exercice
accompagne la phrase rejouée et met la vidéo en pause à sa fin.
Sans piste japonaise complète, **S** fonctionne aussi sur une phrase encore
en cours : SubJap observe sa disparition pour en déterminer la fin, puis
met la vidéo en pause. Aucun temps d'écoute arbitraire n'est ajouté.
Quand la traduction secondaire est masquée, le survol de la ligne japonaise la
révèle également. À la fin de l’écoute, **Z** affiche le japonais et **E** les
sous-titres secondaires, indépendamment et sans reprendre la vidéo. **R** ou
**Espace** continue la lecture ; **A** rejoue la phrase. Les langues déjà
révélées restent affichées à la fin de la relecture.

Lorsque le masquage automatique est activé, **X** révèle la traduction de la
phrase courante. Elle est à nouveau soumise au masquage automatique au
changement de sous-titre.

L’enrichissement utilise Gemini 3.5 Flash-Lite via le Worker Cloudflare configuré
pour SubJap. La phrase, le mot et une courte liste d’exemples familiers sont
envoyés à ce service pour générer la note. La clé Gemini reste côté serveur.
Si le Worker n’est pas configuré ou devient indisponible, le bouton affiche une
erreur sans empêcher le mining normal. Une régénération remplace uniquement le
bloc IA ; les Notes personnelles restent intactes.

Le prompt global se modifie depuis la page Options, dans la section
« Intelligence artificielle ». Les variables `{{targetWord}}`,
`{{targetReading}}`, `{{sentence}}`, `{{definitions}}` et
`{{kanjiCandidates}}` sont remplacées automatiquement pour chaque carte. Le
bouton « Restaurer le défaut » remet les instructions d’origine.

### Utiliser SubJap sur YouTube

1. Après compilation, recharger SubJap dans `chrome://extensions`, puis
   recharger les onglets YouTube déjà ouverts.
2. Ouvrir une vidéo classique possédant des sous-titres japonais. SubJap
   privilégie ceux du créateur et utilise les sous-titres automatiques japonais
   lorsqu’aucune piste du créateur n’est disponible. Il ne génère pas de
   transcription pour les vidéos sans piste japonaise.
3. Utiliser les mots interactifs, le dictionnaire et les raccourcis habituels
   **Q/S/D**, **C** et **X**. Les modes normal, cinéma et plein écran
   utilisent le même overlay ; celui-ci se suspend pendant les publicités.
4. Avant de miner avec l’audio, ouvrir la popup et cliquer sur
   **Activer l’audio de l’onglet**, puis miner comme sur Netflix. Le titre et
   le lien de la vidéo sont conservés dans la carte.

La traduction FR/EN apparaît si une piste du créateur est disponible dans la
langue choisie, avec l’autre langue en repli. Le choix **Aucun** désactive les
sous-titres secondaires. Les pistes générées automatiquement et la traduction
automatique YouTube sont exclues des sous-titres secondaires.
Les réglages de masquage et la révélation avec **X** restent ceux de Netflix.
Une traduction locale
peut aussi être importée. Les Shorts, directs et lecteurs intégrés ne sont pas
inclus dans cette première version.

Si aucun texte SubJap n’apparaît malgré une piste japonaise, activer les
sous-titres dans le lecteur YouTube et sélectionner le japonais, puis recharger
la page si nécessaire. YouTube peut refuser le téléchargement d’une piste ;
dans ce cas, SubJap conserve l’accès aux sous-titres natifs.

### Importer des sous-titres locaux

1. Ouvrir une page web avec un lecteur vidéo HTML5 visible, puis la popup SubJap.
2. Dans **Sous-titres locaux**, importer le fichier japonais sous **Piste
   principale**. SubJap le traite comme du japonais pour l’overlay, la navigation
   et le mining.
3. Facultativement, importer une traduction sous **Piste secondaire**. Chaque
   piste possède son propre décalage au centième de seconde ; une valeur positive
   l’affiche plus tard et les boutons ajustent de 0,1 s.

Les fichiers SRT, VTT et ASS sont acceptés et mémorisés séparément pour chaque
vidéo : par identifiant de lecture Netflix ou YouTube, ou par adresse de page
sur les autres sites. Les anciennes traductions locales restent dans la piste
secondaire. Sur Netflix et YouTube, une piste locale remplace la piste native de
son rôle ; le choix **Aucun** masque la piste secondaire locale comme native.

Sur les autres sites, SubJap suit les fichiers locaux avec l’horloge du lecteur
HTML5 visible. Il ne lit pas les sous-titres natifs de ces sites et ne peut pas
prendre en charge un lecteur qui n’expose pas d’élément `<video>` accessible.

Quand un mot doit devenir disponible à l’oral, cliquer sur **Activer la
production orale** au verso. Sa carte sœur apparaît dans
`日本語::Vocabulaire::Production` deux jours plus tard. Cliquer sur le parent
`日本語::Vocabulaire` pour une session commune, ou sur `Production` seule
lorsqu’il est possible de répondre à voix haute.

Couleurs : vert = inconnu très pertinent, bleu = plutôt pertinent, ambre =
inconnu peu pertinent, indigo = `LEARNING` ou déjà présent dans Anki, blanc =
`KNOWN` ou `IGNORED`. Les soulignements distincts doublent ce code couleur afin
que l'état reste perceptible sans dépendre uniquement de la teinte. La popover
affiche toujours le rang disponible et le nombre de cartes Anki existantes.

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
crée `日本語::Vocabulaire::Compréhension`, à réviser normalement, ainsi que
`日本語::Vocabulaire::Production`, initialement vide, et
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

Lorsque l’extension est mise à jour ou rechargée pendant qu’un onglet Netflix
reste ouvert, cet onglet ne peut plus joindre le nouveau service worker. SubJap
laisse alors les mots en blanc, désactive temporairement leurs actions et affiche
un message avec un bouton **Recharger**. Le rechargement de Netflix reconnecte
l’overlay sans modifier les états de vocabulaire.
