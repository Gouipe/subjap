# Mode d’emploi — SubJap, Migaku et Anki

## Mise en place (une fois)

1. Installer AnkiConnect dans Anki et laisser Anki ouvert pendant l’usage de
   SubJap (`127.0.0.1:8765`).
2. À la racine du dépôt, exécuter `npm install`, puis `npm run build`.
3. Dans `chrome://extensions`, activer le mode développeur et charger le dossier
   `dist` du dépôt. Après chaque nouvelle compilation,
   cliquer sur **Recharger**.

SubJap crée automatiquement les sous-decks
`日本語::Vocabulaire::Compréhension` et `日本語::Vocabulaire::Production`, ainsi
que son type de note `Migaku Memory`. Il ne faut pas les préparer manuellement.

Le premier passage par SubJap applique aussi le thème desktop sombre aux modèles
`Migaku Memory` et `Migaku Memory Import` lorsqu’ils existent. Cette mise à jour
ne modifie pas le contenu des notes. Après l’installation du template versionné,
SubJap préserve les ajouts effectués par d’autres extensions dans celui-ci,
notamment les balises realtime créées par HyperTTS. Le modèle
`Migaku Memory Import` est celui des cartes de compréhension importées depuis
Migaku.

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
   Chaque sens du dictionnaire est une pastille qui montre au plus trois
   traductions (`…` s’il en existe davantage, liste complète au survol). Seul le
   premier sens est retenu : un clic coche le sens de la scène ou en écarte un.
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

Le réglage **Phrases connues** (popup et Options) agit sur les phrases dont
tous les mots sont connus ou ignorés ; les noms de locuteur et indications
entre parenthèses ne comptent pas :

- **Tout afficher** : comportement normal ;
- **Masquer la traduction** : seul le japonais reste affiché ;
- **Masquer tout (écoute)** : japonais et traduction sont masqués, la vidéo
  continue. On écoute d’abord une phrase dont on connaît déjà tous les mots,
  pour entraîner l’oreille plutôt que la lecture. **S** la rejoue.

Une ligne masquée réapparaît au survol. **X** révèle la phrase courante par
étapes : le japonais d’abord, puis la traduction. Tout est à nouveau masqué au
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
HTML5 visible, y compris dans un lecteur intégré depuis un autre site. Il ne
peut pas prendre en charge un lecteur qui n’expose pas d’élément `<video>`
accessible.

Les lecteurs Artplayer (par exemple sur reanime.to) fournissent leurs propres
pistes : SubJap charge automatiquement le japonais (sans annotations pour
malentendants si possible) et la traduction FR, sinon EN, sans import. Les
raccourcis clavier fonctionnent après un clic dans le lecteur.

### Vidéo sans sous-titres japonais

Quand un lecteur Artplayer ne propose pas de piste japonaise, un bandeau
s’affiche une fois par vidéo en bas du lecteur pendant quelques secondes :
**Chercher sur Jimaku** ouvre la page Jimaku de l’anime (ou sa recherche) dans
un nouvel onglet, **Importer** charge directement un fichier japonais comme
piste principale. Sur Netflix et YouTube, rien ne s’affiche sur la vidéo : la
popup indique « Pas de sous-titres japonais » dans **Sous-titres**, avec
**Importer un fichier** ; sur un lecteur Artplayer, elle propose aussi la
recherche Jimaku.

Avec une clé API Jimaku (compte gratuit sur jimaku.cc, clé copiée depuis la
page de compte, puis collée dans les options SubJap, section **Sous-titres
japonais (Jimaku)**), SubJap installe tout seul les sous-titres japonais de
l’épisode sur les lecteurs Artplayer : il retrouve l’anime grâce à la page
(identifiant AniList, sinon nom de la série), choisit le fichier de l’épisode
en préférant les sources web et en écartant les fichiers mêlant chinois et
japonais, et ouvre si besoin les archives ZIP de saison. Le fichier devient la
piste principale locale de la vidéo. Le bandeau propose alors **Changer**
(autres fichiers de l’épisode) et **Retirer**. Une piste retirée, depuis le
bandeau ou la popup, n’est plus jamais réinstallée pour cette vidéo. Sans clé,
le bandeau propose **Installer automatiquement**, qui ouvre ce réglage.

Quand un mot doit devenir disponible à l’oral, cliquer sur **Activer la
production orale** au verso. Sa carte sœur rejoint les
nouvelles cartes de `日本語::Vocabulaire::Production` dès qu’Anki n’affiche plus
de révision (Chrome doit être ouvert avec l’extension). Cliquer sur le parent
`日本語::Vocabulaire` pour une session commune, ou sur `Production` seule
lorsqu’il est possible de répondre à voix haute.

Couleurs : un mot n’est coloré que s’il est à miner, c’est-à-dire le seul mot
non blanc de sa phrase — vert s’il est très fréquent, bleu s’il l’est un peu
moins, souligné d’un trait continu de sa couleur. Un mot `LEARNING` ou déjà
présent dans Anki mais pas encore acquis compte comme inconnu : il empêche la
coloration. Les autres inconnus sont seulement grisés, si bien que le blanc se
lit comme « compris » ; `KNOWN` et `IGNORED` sont blancs sans trait. La popover
affiche toujours le rang disponible et le nombre de cartes Anki existantes.

## Piloter les couleurs depuis Anki

Ajouter à une note l’un des tags exacts `KNOWN`, `IGNORED`, `UNKNOWN` ou
`LEARNING`. SubJap les lit dans tous les decks si la note possède un champ
`Mot`. La synchronisation est automatique ; pour la forcer, ouvrir les options
SubJap et cliquer sur **Synchroniser maintenant**.

Une décision prise manuellement dans SubJap (**Mark Known**, **Ignore**) reste
prioritaire sur Anki. La retirer (**✓ Known**, **Unignore**) rend la main à
Anki : un mot appris plus tard dans Anki redevient connu. Si une
couleur ne change pas, vérifier le tag, le champ `Mot`, AnkiConnect, puis relancer
la synchronisation.

Lorsque l’extension est mise à jour ou rechargée pendant qu’un onglet Netflix
reste ouvert, cet onglet ne peut plus joindre le nouveau service worker. SubJap
laisse alors les mots en blanc, désactive temporairement leurs actions et affiche
un message avec un bouton **Recharger**. Le rechargement de Netflix reconnecte
l’overlay sans modifier les états de vocabulaire.
