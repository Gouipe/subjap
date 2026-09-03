# Architecture de SubJap

## Vue d’ensemble

SubJap est une extension de navigateur Manifest V3 qui transforme les
sous-titres japonais d’un lecteur vidéo en support d’apprentissage :
détection des cues, tokenisation, affichage enrichi, consultation du
dictionnaire, marquage des mots connus et création de cartes de mining.

L’architecture sépare le traitement interactif, exécuté dans la page vidéo,
des opérations persistantes ou privilégiées, exécutées dans le service worker.
Les interfaces entre ces deux contextes sont centralisées dans
[`src/core/types.ts`](../src/core/types.ts) et [`src/core/messaging.ts`](../src/core/messaging.ts).

```mermaid
flowchart LR
  V[Lecteur vidéo / sous-titres] --> A[Adaptateur de plateforme]
  A --> C[Content script\nnormalisation + segmentation]
  C --> T[Lindera + UniDic WASM\ncontrat + cache LRU]
  C --> M[Service worker\nmessages typés]
  M --> D[(IndexedDB\nDexie)]
  C --> O[Overlay DOM\npopover + modal de mining]
  M --> AK[AnkiConnect\nlocalhost:8765]
  P[Popup / Options / Onboarding] --> M
  P --> S[(chrome.storage.local\nréglages et état onboarding)]
```

## Entrées et composants

Le manifeste est construit par Vite et `@crxjs/vite-plugin` à partir de
[`src/manifest.ts`](../src/manifest.ts). Il déclare :

- un service worker : [`src/background/service-worker.ts`](../src/background/service-worker.ts) ;
- un content script lancé à `document_end` sur les plateformes ciblées ;
- une popup React et une page Options React ;
  - le binaire Lindera + UniDic embarqué dans le bundle du content script ;
- les permissions de stockage, d’injection et les accès réseau nécessaires au
  téléchargement de JMdict et à AnkiConnect.

Les principaux modules sont organisés ainsi :

| Module | Responsabilité |
| --- | --- |
| `src/core/` | Types partagés, bus de messages, options et schéma Dexie. |
| `src/background/` | Persistance, lookups, statistiques, création de cartes, AnkiConnect et installation. |
| `src/content/` | Orchestration du pipeline dans la page vidéo et gestion des interactions. |
| `src/adapters/` | Adaptateurs de lecteurs ; Netflix est l’adaptateur réellement utilisé pour le MVP. |
| `src/tokenizer/` | Adaptateur Lindera + UniDic, contrat morphologique, regroupements et cache LRU. |
| `src/subtitles/` | Normalisation, segmentation et parseurs SRT/VTT/ASS prêts pour l’import local. |
| `src/dictionary/` | Conversion JMdict et index de recherche ; le service worker interroge les entrées persistées. |
| `src/overlay/` | Rendu DOM vanilla des cues et popover de définition. |
| `src/mining/` | Modal de création de carte, TTS, capture d’image et client AnkiConnect. |
| `src/popup/`, `src/options/`, `src/onboarding/` | Surfaces UI et configuration initiale. |
| `src/ui/` | Thème partagé des pages de l’extension : palette, typographie, focus et transitions. |

L'identité visuelle de référence est décrite dans [`PRODUCT.md`](../PRODUCT.md)
et [`DESIGN.md`](../DESIGN.md). Les pages React importent
[`src/ui/theme.css`](../src/ui/theme.css), tandis que les surfaces injectées
dans la page vidéo et les cartes Anki reprennent les mêmes tokens dans leurs
styles isolés afin de ne pas dépendre du CSS du site hôte.

## Sélection de plateforme et capture des sous-titres

Le content script enregistre les adaptateurs dans un
[`AdapterRegistry`](../src/core/adapters/registry.ts), puis sélectionne le
premier adaptateur dont `isActive()` correspond à la page. Chaque adaptateur
implémente le contrat `PlatformAdapter` : découverte de la vidéo, émission des
cues, temps courant, vitesse de lecture, contexte d’épisode et contrôle des
sous-titres natifs.

### Netflix

[`NetflixAdapter`](../src/adapters/netflix.ts) observe le DOM du lecteur :

1. `MutationObserver` repère le conteneur `.player-timedtext` et ses lignes ;
2. les mutations sont regroupées avec un debounce de 60 ms ;
3. les timestamps `data-start` / `data-end` sont utilisés lorsqu’ils existent,
   sinon le temps courant de la vidéo sert de repli ;
4. l’adaptateur réattache ses observateurs lorsqu’un lecteur est recréé par la
   navigation SPA ;
5. une voie `textTracks` est conservée comme fallback.

Les pistes officielles et l’historique de navigation sont isolés par identifiant
Netflix `/watch/<id>`. Le bridge conserve l’identifiant de lecture trouvé sur
le manifeste autour de chaque `timedtexttracks` et n’annonce que les pistes dont
l’identifiant correspond exactement à la route active. Une piste découverte
sans identité exploitable est ignorée, sauf lorsque son chargement est déclenché
par le changement temporaire de piste sur la session de lecture active : le
bridge exige alors que `getMovieId()` sur cette session corresponde au
`/watch/<id>` courant, puis recoupe aussi l’identifiant interne de la piste avec
celui du manifeste. Lors d’un changement d’épisode dans le même document, le
bridge et l’adaptateur vident les pistes de l’ancienne lecture et invalident les
téléchargements encore en vol. Une réponse tardive ou un manifeste préchargé
pour un autre épisode ne peut donc pas apparaître pendant un silence.

Pour le mode bilingue, le bridge Netflix est injecté dans le monde de la page
à `document_start`. Il observe les métadonnées `timedtexttracks` et relaie
uniquement les URLs officielles disponibles. L’adaptateur demande ensuite le
contenu au service worker via le bus MV3 ; le téléchargement ne passe donc pas
par le `fetch` du contexte de la page, ce qui évite les bloqueurs qui modifient
ce dernier. Les pistes TTML/DFXP/VTT sont ensuite choisies selon la préférence
persistante de l’utilisateur (français ou anglais), avec l’autre langue en
repli. Le japonais reste toujours la piste d’apprentissage et la piste
restaurée après une sonde Netflix ; le DOM Netflix est préféré lorsqu’il est
visible, avec la piste japonaise capturée comme repli. Avant d’associer une
réponse à la piste secondaire, le bridge vérifie aussi la langue déclarée ou
dominante de son contenu afin qu’un sous-titre japonais ne soit pas étiqueté
FR/EN par erreur.

La popup permet aussi d’importer une traduction locale SRT, VTT ou ASS. Son
contenu et son décalage temporel sont conservés dans `chrome.storage.local`,
indexés par l’identifiant Netflix `/watch/<id>`. Cette piste locale est
prioritaire sur les traductions officielles FR/EN et se recharge lors des
changements d’épisode dans la navigation SPA.

Le masquage des sous-titres natifs est piloté par une classe sur `<html>` et
une règle CSS document-level. Cette approche résiste à la recréation du DOM
Netflix et aux styles `visibility` inline de ses descendants. La préférence
est `hideNativeSubtitles`, activée par défaut.

### Adaptateur HTML5 générique

[`GenericHtml5Adapter`](../src/adapters/generic-html5.ts) sait lire les
`TextTrack` / `VTTCue` d’un élément `<video>` et contrôler leur visibilité.
Il constitue la base pour les lecteurs HTML5 standards et les futurs
adaptateurs. Le registre possède également un fallback ultime sans émission de
cues lorsque la page ne correspond à aucun adaptateur spécialisé. Dans le
content script actuel, Netflix est l’adaptateur explicitement enregistré ; le
branchement d’autres adaptateurs est une extension du registre.

## Pipeline de rendu

Le chemin principal est le suivant :

1. L’adaptateur émet un tableau de `SubtitleCue`.
2. [`normalizeCueText()`](../src/subtitles/normalize.ts) retire les balises
   HTML/ASS, décode les entités et normalise les espaces.
3. [`splitIntoSentences()`](../src/subtitles/segment.ts) sépare les phrases,
   respecte les retours à la ligne et limite les segments trop longs à 80
   caractères par défaut.
4. Lindera + UniDic est initialisé paresseusement depuis le monde isolé du
   content script. Le chargement WASM est singleton, borné par un timeout et
   réinitialisable après erreur.
5. Chaque token est converti vers le contrat partagé `Token` : surface, forme
   de dictionnaire naturelle, identité canonique, termes de lookup, lecture,
   POS, conjugaison et composants. Les offsets UTF-8 de Lindera sont vérifiés
   afin que la concaténation des surfaces reproduise exactement la phrase.
6. Les états de mots (`known`, `unknown`, `learning` ou `ignored`) sont
   demandés au service worker, avec déduplication des requêtes en vol. Ils sont
   partagés entre les écritures d'une même identité lexicale reconnue par
   UniDic, mais jamais entre deux mots uniquement parce qu'ils ont la même
   lecture en hiragana. Un mot ignoré est rendu blanc comme un mot connu, mais
   reste exclu du compteur de vocabulaire connu.
7. Le content script récupère le nombre de mots connus et un rang pratique par
   lemme. Ce rang vient d’une liste de fréquence issue de sous-titres
   OpenSubtitles (films, séries et anime), préalablement recroisée avec le
   vocabulaire JMdict afin de conserver des mots lexicaux plutôt que des
   fragments morphologiques. La liste compacte est livrée avec SubJap et les
   couples lemme/rang sont conservés dans IndexedDB. Le renderer construit des
   spans par token, ajoute éventuellement le furigana ; les mots connus restent
   blancs, les inconnus jusqu’au rang connu sont verts et les 300 rangs suivants
   sont bleus.

L’affichage suit un pipeline à deux temps avec priorité à la cue la plus
récente. Le texte brut est peint immédiatement, puis UniDic le remplace par des
tokens interactifs blancs. Les états de vocabulaire, la présence Anki et les
rangs de fréquence sont chargés en une passe asynchrone et appliquent ensuite
les couleurs. Chaque arrivée incrémente une révision : un traitement plus ancien
peut terminer ses lectures, mais ne peut plus remplacer la phrase courante. Les
lectures de mots d’une phrase sont groupées dans un seul message MV3 et les
résultats récurrents restent en cache. Au premier chargement, le sous-titre natif
reste visible jusqu’au premier rendu SubJap.

Le tokenizer est un singleton par content script et possède un cache LRU de
500 phrases. Les cues identiques sont ignorés grâce à une signature de texte.

Si Chrome invalide le contexte d’un content script après une mise à jour ou un
rechargement de l’extension, les échecs de messagerie ne sont jamais interprétés
comme des mots inconnus. L’overlay conserve un rendu neutre, désactive les
interactions qui ne pourraient pas être persistées et demande explicitement de
recharger Netflix pour joindre le nouveau service worker.

Les unités pédagogiques regroupent notamment les suffixes pluriels `ら`, `たち`,
`ども` et `がた` uniquement lorsque UniDic les marque comme suffixes ; les
composants morphologiques restent disponibles pour la popover et le mining.
Si Netflix remplace l’élément `<video>`, l’ancien overlay et le modal de mining
sont détruits puis recréés pour le nouveau lecteur.

Les cues publiées par l’adaptateur sont des instantanés : une correction de
timing ou le déroulement `A → A+B → B` produit un nouvel instantané portant la
même identité, sans modifier celui déjà utilisé par l’overlay ou le modal de
mining. Les seeks applicatifs sont traités comme une transition et leurs états
DOM intermédiaires ne deviennent pas des cues. La relecture destinée à
`AudioPhrase` ouvre en plus une session privée : elle peut observer le DOM pour
déterminer la fin d’une cue sans alimenter la timeline visible. La phrase et
ses bornes sont donc figées pour toute la durée du minage.

## Overlay et interactions

[`OverlayRenderer`](../src/overlay/renderer.ts) est implémenté en DOM vanilla
pour éviter de faire passer le rendu de chaque token par React. Le conteneur :

- est monté directement sur `document.body` ;
- est en `position: fixed`, avec un z-index très élevé ;
- reprend les coordonnées de `video.getBoundingClientRect()` ;
- est repositionné périodiquement pour suivre resize, plein écran et contrôles
  du lecteur ;
- ancre les lignes en bas de la vidéo avec une marge inférieure pour éviter la
  barre de contrôle Netflix ;
- laisse les lignes interagir (`pointer-events: auto`) tout en laissant le
  conteneur global traversable.

Les événements sont délégués depuis le document :

- touche `C` seule : copie la phrase japonaise affichée sur une ligne et confirme
  brièvement l'action ; le raccourci est ignoré dans les champs éditables ;
- survol d’un token : ouverture de la popover après 350 ms ;
- sortie : fermeture après une grâce de 200 ms pour rejoindre la popover ;
- clic : popover épinglée jusqu’à `Escape` ou clic extérieur ;
- popover : définition, bascule connu/inconnu et accès au mining.

La recherche utilise `dict:lookup` vers le service worker. Celui-ci lit alors
JMdict depuis IndexedDB par headword, puis par reading. Le module
`src/dictionary/index.ts` fournit en parallèle un index mémoire headword /
reading, réutilisable lorsque le chargement en mémoire sera branché au flux.

## Service worker et persistance

Le service worker ouvre la base Dexie `SubJap` au démarrage. Les tables
actuelles sont :

- `wordStates` : état et provenance d’un lemme ;
- `mineCards` : cartes de phrases, métadonnées de l’épisode et état SRS ;
- `dictionaryEntries` : entrées JMdict converties ;
- `settings` : espace de réglages persistants côté IndexedDB.

Les handlers enregistrés dans le bus couvrent :

- `dict:status`, `dict:download` et `dict:lookup` ;
- `word:get`, `word:set` et `word:batch` ;
- `mine:create` et `stats:get` ;
- `data:reset` ;
- `anki:status`, `anki:syncKnown`, `anki:setup`, `anki:addNote` et
  `anki:dueCount` ;
- `tts:speak`, actuellement sans effet dans le service worker car
  `speechSynthesis` est utilisé dans les contextes foreground.

Les erreurs asynchrones des handlers sont encapsulées par le marqueur
`__subjapError` afin que `sendMessage()` rejette réellement la promesse au
lieu de renvoyer `undefined`.

### Format des messages et blobs

Le bus MV3 transporte des objets sérialisables. Les `Blob` ne traversent donc
pas directement `chrome.runtime.sendMessage` : le contrat de création de carte
prévoit des data URLs (`screenshotDataUrl`, `audioDataUrl`), puis le service
worker les reconvertit en `Blob` avant l’écriture IndexedDB. La capture
d’écran et l’extrait audio réel suivent ce chemin.

Les réglages légers sont séparés dans `chrome.storage.local`, sous la clé
`subjap_options`. [`DEFAULT_OPTIONS`](../src/core/options.ts) est la source
unique des valeurs par défaut et les changements sont appliqués en direct au
content script via `chrome.storage.onChanged`.

## Dictionnaire et installation

Le dictionnaire est JMdict-simplified, converti en `DictionaryEntry` par
[`src/dictionary/jmdict.ts`](../src/dictionary/jmdict.ts). Deux packs sont
proposés : un pack commun d’environ 22 000 entrées et un pack complet
d’environ 218 000 entrées.

Lors d’un téléchargement, le service worker :

1. récupère et décompresse l’archive gzip ;
2. convertit les mots JMdict ;
3. remplace les anciennes entrées IndexedDB par lots de 10 000 ;
4. marque le dictionnaire comme chargé dans `chrome.storage.local`.

Le téléchargement est donc réalisé hors de la page vidéo. Pendant la lecture,
la tokenisation et les lookups utilisent les ressources locales, sans appel à
une API de dictionnaire distante.

## Mining et AnkiConnect

Le mining est déclenché depuis la popover et ouvre
[`MiningModal`](../src/mining/modal.ts), qui présente la phrase, le token cible,
la lecture et les glosses sélectionnables. Le modal peut :

- générer l’audio du mot avec VOICEVOX local à partir de sa lecture ;
- enrichir manuellement `Notes` avec Gemini Nano via la Prompt API locale de
  Chrome, sans clé ni appel à un service distant ;
- découper l’audio réel du lecteur dans `AudioPhrase` quand le navigateur
  expose le flux audio ; la relecture couvre 300 ms avant le début de la cue et
  300 ms après sa fin, sans republier les transitions DOM provoquées par ses
  seeks dans la timeline des sous-titres ;
- capturer une image de la vidéo lorsque le navigateur l’autorise ;
- créer d’abord une carte locale dans IndexedDB ;
- pousser ensuite une copie vers AnkiConnect, en best effort.

L’enrichissement IA est lancé uniquement par le bouton du modal. Le service
worker construit d’abord, dans
[`ai-enrichment.ts`](../src/background/ai-enrichment.ts), une liste d’au plus dix
mots candidats par kanji. Il ne retient que le vocabulaire `known`, puis
`learning`, puis simplement présent dans Anki, et joint les lectures et glosses
JMdict. La liste complète du vocabulaire n’est jamais donnée au modèle.

[`src/mining/ai-enrichment.ts`](../src/mining/ai-enrichment.ts) demande ensuite
une réponse JSON contrainte à Gemini Nano : synonymes importants, définition en
un mot de chaque kanji, au plus deux exemples familiers de même lecture et une
phrase mnémotechnique d’association lorsque le mot possède plusieurs kanjis.
Après génération, SubJap rejette les exemples absents de la liste locale et les
synonymes absents des entrées JMdict courantes. La phrase d’association doit
citer tous les kanjis du mot ; sinon, une seconde requête locale corrige
uniquement cette phrase avant son affichage. Le texte validé reste modifiable
dans un éditeur distinct et est concaténé aux Notes personnelles seulement lors
de la sauvegarde. Une seconde génération remplace uniquement ce texte IA.

La carte locale, y compris ses Notes combinées, reste la source de vérité : une
indisponibilité d’Anki ne fait pas perdre le mining. Le modal conserve alors la
carte locale, affiche l’erreur et permet de réessayer sans créer de doublon
local. Le service worker communique
avec AnkiConnect sur `127.0.0.1:8765`, crée automatiquement les sous-decks de
vocabulaire et
garantit le type de note exact
`Migaku Memory` avec les champs `Mot`, `Lecture`, `Phrase`, `Traduction`,
`Définitions`, `Notes`, `Image`, `AudioMot`, `AudioPhrase` et `Production`. Les médias sont
stockés par `storeMediaFile`, puis référencés dans les champs Migaku.
Le paquet externe utilise un type distinct, `Migaku Memory Import`, avec ce
même contrat de champs : cela évite le renommage automatique `Migaku Memory+`
par Anki tout en permettant la synchronisation globale des statuts.

Les deux modèles actifs génèrent une carte `Compréhension` et, lorsque le champ
`Production` est renseigné, une carte sœur `Production`. SubJap range ces cartes
dans `日本語::Vocabulaire::Compréhension` et
`日本語::Vocabulaire::Production`. Une activation depuis le verso crée la sœur
en état suspendu ; le service worker la libère comme nouvelle carte après deux
jours, sans modifier la planification de la compréhension.

Toutes les notes Anki dont le champ `Mot` est renseigné sont recherchées dans
tous les decks au démarrage, au retour sur l’onglet et périodiquement. Le champ
est normalisé vers le lemme : SubJap conserve à la fois le nombre de cartes et
les éventuels tags `KNOWN`, `IGNORED`, `UNKNOWN` ou `LEARNING`. Les imports de
statut sont réconciliés : retirer un tag retire l’ancien état importé, tandis
qu’un état manuel local reste prioritaire. `KNOWN` et `IGNORED` sont blancs ;
un mot déjà présent dans Anki ou marqué `LEARNING` est violet. Un mot `UNKNOWN`
sans carte existante suit la fréquence (vert, bleu, puis orange). La
popover affiche le rang dès qu’il existe et précise `Déjà dans Anki · N cartes`.

VOICEVOX est démarré localement par un Native Messaging host Windows enregistré
une seule fois ; voir [`docs/voicevox.md`](voicevox.md). Si la capture du flux
Netflix est bloquée par le navigateur ou le DRM, `AudioPhrase` reste vide et
la carte demeure valide.

## Interfaces utilisateur

- **Onboarding** : page Options ouverte au premier install ; trois étapes pour
  installer le dictionnaire, configurer ou ignorer AnkiConnect, puis enregistrer
  les réglages d’affichage.
- **Popup** : statut du dictionnaire, statistiques locales, statut Anki,
  rappel de l’onboarding et réglage rapide du masquage des traductions FR/EN
  quand la phrase est entièrement connue.
- **Options** : installation ou réinstallation du pack JMdict, configuration
  du deck Anki, taille/police/furigana/couleur de l’overlay, masquage des
  sous-titres natifs, masquage conditionnel des traductions FR/EN, remise à
  zéro des données et relance de l’onboarding.

Les pages React ne contiennent pas la logique de lecture : elles utilisent le
bus de messages et les modules partagés pour lire ou modifier l’état.

## Contraintes et décisions importantes

- Le support Netflix dépend de sélecteurs DOM (`.player-timedtext`) susceptibles
  de changer ; les sélecteurs sont regroupés dans l’adaptateur.
- L’overlay ne doit pas être remonté dans le stacking context du player : cela
  rendrait le texte visible mais pourrait empêcher hover et clic.
- Il faut conserver le loader Kuromoji basé sur `fetch` et
  `DecompressionStream` avec timeout.
- Les options d’overlay doivent rester définies dans `src/core/options.ts`.
- Les données binaires doivent rester en data URLs sur le bus, puis être
  converties en `Blob` côté service worker.
- L’overlay reste visible pendant la pause : c’est le moment où l’apprenant
  peut lire la phrase.
- Le push Anki est volontairement best effort ; la carte locale est créée
  avant toute tentative réseau.

## État actuel et extensions prévues

Le MVP couvre le squelette MV3, Netflix, le pipeline de rendu, JMdict,
l’interaction hover/clic, le marquage connu/inconnu, le mining local, le push
Anki, le popup, les options et l’onboarding.

Les évolutions naturelles sont :

- alimenter l’accent tonal et étendre les raccourcis clavier aux autres surfaces ;
- compléter les statistiques et l’historique ;
- ajouter un sélecteur de deck dans les Options ;
- brancher YouTube, Crunchyroll et Prime ;
- ajouter l’export/import JSON et l’i18n FR/EN.

Les parseurs SRT/VTT/ASS sont isolés dans `src/subtitles/` et leur import comme
traduction secondaire Netflix est disponible depuis la popup.
