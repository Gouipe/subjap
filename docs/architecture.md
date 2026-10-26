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
- un content script lancé à `document_end` sur les pages web ; les bridges de
  Netflix et YouTube restent limités à leurs domaines ;
- une popup React et une page Options React ;
  - le binaire Lindera + UniDic embarqué dans le bundle du content script ;
- les permissions de stockage, d’injection et les accès réseau nécessaires au
  téléchargement de JMdict et à AnkiConnect.

Les principaux modules sont organisés ainsi :

| Module | Responsabilité |
| --- | --- |
| `src/core/` | Types partagés, bus de messages, options, réglages IA et schéma Dexie. |
| `src/background/` | Persistance, lookups, statistiques, création de cartes, AnkiConnect et installation. |
| `src/content/` | Orchestration du pipeline dans la page vidéo et gestion des interactions. |
| `src/adapters/` | Adaptateurs spécialisés Netflix et YouTube. |
| `src/core/adapters/` | Registre des adaptateurs et fallback HTML5 générique. |
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

[`NetflixAdapter`](../src/adapters/netflix.ts) publie les segments de la piste
japonaise identifiée dans le lecteur, depuis un seul fichier de sous-titres.
L’affichage, la navigation, l’écoute et le mining utilisent ces mêmes segments
et leurs horaires ; plusieurs segments simultanés restent distincts. Une phrase
longue peut donc apparaître dans plusieurs sous-titres successifs.

Le catalogue [`SubtitleTrackCatalog`](../src/subtitles/timeline.ts) conserve
l’identité de l’épisode, de la piste, du fichier et du segment. Les différentes
variantes ou représentations d’une langue ne sont pas fusionnées par
chevauchement. Le bridge relaie la piste japonaise active, y compris après un
changement tardif de piste, et l’adaptateur conserve cette identité pendant le
téléchargement MV3. En l’absence d’identité du lecteur, une correspondance de
texte affiché non ambiguë parmi les pistes disponibles permet un repli.

Sans piste officielle utilisable, une piste japonaise HTML5 fournit ses segments
horodatés ; à défaut, le DOM fournit un historique des blocs observés. Un
`MutationObserver` regroupe les mutations pendant 60 ms. Les horaires
`data-start` / `data-end` sont conservés lorsqu’ils existent ; sinon le début
est estimé au moment de la première observation et la fin reste provisoire.
Aucun partage de mots ou de lignes ne fusionne deux blocs. Les observateurs
sont réattachés lorsque le lecteur est recréé par la navigation SPA.

Le contrat et les limites sont détaillés dans
[`subtitle-timeline.md`](subtitle-timeline.md).

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
repli ; la valeur « aucun » désactive cette piste. Le japonais reste toujours
la piste d’apprentissage et la piste
restaurée après une sonde Netflix ; sa piste capturée et identifiée fournit
les segments de référence, avec le DOM comme repli lorsque cette piste manque. Avant d’associer une
réponse à la piste secondaire, le bridge vérifie aussi la langue déclarée ou
dominante de son contenu afin qu’un sous-titre japonais ne soit pas étiqueté
FR/EN par erreur.

La popup importe séparément une piste principale et une piste secondaire
locales, en SRT, VTT ou ASS. Chaque piste a son propre décalage. La principale
est traitée comme du japonais et remplace la piste japonaise native ; la
secondaire remplace la traduction native sur Netflix et YouTube. Les fichiers
sont conservés dans `chrome.storage.local`. Netflix et YouTube gardent leurs
identifiants de vidéo historiques ; les autres lecteurs sont indexés par une
empreinte de leur URL canonique. Les anciennes traductions locales restent
disponibles dans l’emplacement secondaire.

Le masquage des sous-titres natifs est piloté par une classe sur `<html>` et
une règle CSS document-level. Cette approche résiste à la recréation du DOM
Netflix et aux styles `visibility` inline de ses descendants. La préférence
est `hideNativeSubtitles`, activée par défaut.

### YouTube

[`YouTubeAdapter`](../src/adapters/youtube.ts) prend en charge les vidéos
classiques `/watch?v=…`, y compris les changements de vidéo sans rechargement.
Il choisit une piste japonaise du créateur en priorité, puis une piste japonaise
automatique. Une piste FR/EN du créateur fournit la traduction selon le réglage
habituel, avec l’autre langue en repli. Les pistes secondaires générées ou
traduites automatiquement par YouTube sont exclues. La préférence peut aussi
désactiver complètement la piste secondaire. Les pistes locales SRT/VTT/ASS
sont prioritaires lorsqu’elles sont importées dans le rôle correspondant et
utilisent des clés `youtube:<id>` ; les clés Netflix existantes sont conservées.

Le script [`youtube-bridge-entry.ts`](../src/youtube-bridge-entry.ts), injecté
dans le monde MAIN à `document_start`, lit les métadonnées du lecteur et observe
ses réponses de sous-titres `fetch`/XHR sans modifier leurs contenus. Il tente
également un téléchargement JSON3 dans la page ; si ce fichier manque, il
demande au lecteur de charger la piste japonaise sélectionnée. Pour une piste
secondaire manquante, une fois le fichier japonais disponible, il sélectionne
temporairement cette piste puis restaure le japonais après réception ou au
bout de quatre secondes. Cette sonde est isolée par vidéo et ne remplace pas
la chronologie japonaise de l’overlay. Les requêtes
signées réellement émises par YouTube servent ainsi de repli. Aucun service
tiers ni clé API n’est utilisé pour obtenir les sous-titres.

Le parseur [`subtitles/youtube.ts`](../src/subtitles/youtube.ts) accepte JSON3,
SRV3, XML historique et VTT. Les événements d’ajout à une même fenêtre sont
rattachés au segment source ; les fenêtres automatiques successives ne doublent
pas les phrases en conservant leurs anciennes lignes à l’écran. Le catalogue
commun conserve un fichier par piste avec des instantanés et des horaires
partagés entre overlay, Q/S/D, écoute active et mining.

Chaque navigation reçoit une génération distincte, même pour un retour à la
même vidéo. L’adaptateur rejette les réponses d’anciennes sessions, vide les
phrases et suspend la navigation et l’overlay pendant les publicités ou lorsque
l’identité du lecteur ne correspond pas à l’URL. Un changement de contexte
ferme aussi l’exercice et le mining ; la capture audio abandonne sa relecture
sans déplacer la nouvelle vidéo vers l’ancien horaire.

Les Shorts, lecteurs intégrés et directs ne sont pas pris en charge. Une vidéo
doit exposer une piste japonaise exploitable : SubJap ne transcrit pas l’audio
et ne traduit pas une autre langue vers le japonais. Si YouTube refuse les
fichiers de sous-titres, les sous-titres natifs restent accessibles. Les API
internes et les sélecteurs YouTube peuvent évoluer ; le fonctionnement réel
reste à vérifier sur le lecteur après rechargement de l’extension.

### Adaptateur HTML5 générique

[`GenericHtml5Adapter`](../src/core/adapters/registry.ts) suit l’horloge d’un
élément `<video>` HTML5 visible et publie les fichiers locaux importés dans les
rôles principal et secondaire. Il choisit une vidéo en lecture, puis la plus
grande vidéo visible en pause. Le contenu des sous-titres natifs et les lecteurs
qui ne rendent pas de `<video>` accessible ne sont pas pris en charge par cet
adaptateur. Les bridges spécialisés Netflix et YouTube restent distincts ; sur
les autres pages, le content script utilise cet adaptateur générique.

## Pipeline de rendu

Le chemin principal est le suivant :

1. L’adaptateur émet un tableau de `SubtitleCue`.
2. [`normalizeCueText()`](../src/subtitles/normalize.ts) retire les balises
   HTML/ASS, décode les entités et normalise les espaces.
3. [`tokenizeCue()`](../src/tokenizer/cue.ts) utilise les frontières de phrase
   de [`segmentForTokenization()`](../src/subtitles/segment.ts). Les points de
   suspension et les simples retours visuels ne coupent pas l'analyse ; aucune
   limite arbitraire de 80 caractères ne coupe un mot. Les espaces et retours
   à la ligne du texte normalisé sont restitués après analyse, avec des offsets
   UTF-16 dans la cue. Les lignes vides et marqueurs explicites de locuteur
   restent des frontières. `splitIntoSentences()` reste un utilitaire de
   découpage de présentation, hors du pipeline de tokenisation.
4. Lindera + UniDic est initialisé paresseusement depuis le monde isolé du
   content script. Le chargement WASM est singleton, borné par un timeout et
   réinitialisable après erreur.
5. Chaque token est converti vers le contrat partagé `Token` : surface, forme
   de dictionnaire naturelle, identité canonique, termes de lookup, lecture,
   POS, conjugaison et composants. Les offsets UTF-8 de Lindera sont vérifiés
   et la concaténation des surfaces sont vérifiés pour reproduire exactement
   la phrase. La lecture de la forme de dictionnaire est conservée séparément
   de celle de la surface conjuguée.
6. Les suites contiguës de noms, préfixes et suffixes nominaux sont recherchées
   par lot dans les graphies exactes du JMdict installé. Une suite trouvée
   devient une seule unité cliquable si sa lecture combinée correspond aussi à
   une lecture JMdict, avec un repli limité au rendaku. Ses composants
   morphologiques restent dans le token, et l'identité lexicale utilise la tête
   de l'entrée JMdict. La recherche s'arrête à quatre composants et retient la
   plus longue correspondance depuis la gauche ; sans dictionnaire ou
   correspondance exacte, UniDic reste inchangé.
7. Les états de mots (`known`, `unknown`, `learning` ou `ignored`) sont
   demandés au service worker, avec déduplication des requêtes en vol. Ils sont
   partagés entre les écritures d'une même identité lexicale reconnue par
   UniDic ou JMdict, mais jamais entre deux mots uniquement parce qu'ils ont la
   même lecture en hiragana. Un mot ignoré est rendu blanc comme un mot connu, mais
   reste exclu du compteur de vocabulaire connu. Les interjections et fillers
   UniDic (`感動詞`, `フィラー`), ainsi que les expressions grammaticales sans
   tête lexicale (`grammarOnly` : `じゃないです`, `なんだ`), sans état
   enregistré ni carte Anki sont ignorés par défaut au rendu ; cet état dérivé n'est jamais persisté et un choix
   manuel (Unignore, Mark Known) le remplace.
8. Le content script récupère le nombre de mots connus et un rang pratique par
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
tokens interactifs blancs. Si la cue contient des suites nominales candidates,
le content script demande leurs entrées exactes en un seul lot et peut regrouper
les composants reconnus avant le chargement des états de vocabulaire, de la
présence Anki et des rangs de fréquence. Ces métadonnées appliquent ensuite les
couleurs. Chaque arrivée incrémente une révision : un traitement plus ancien
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
Les verbes UniDic `非自立可能` peuvent servir de tête lexicale ; ce tag ne
prouve pas un emploi auxiliaire. Les regroupements couvrent aussi les adjectifs
et les chaînes de copule négatives, polies et passées. La popover expose les
composants et les indications grammaticales sans créer de statut connu pour
chaque flexion. Voir [`tokenization.md`](tokenization.md) pour le contrat et les
limites de ces regroupements.
Si Netflix remplace l’élément `<video>`, l’ancien overlay et le modal de mining
sont détruits puis recréés pour le nouveau lecteur.

Les cues publiées par l’adaptateur sont des instantanés : une correction de
fin provisoire conserve l’identité de l’observation, sans modifier celui déjà
utilisé par l’overlay ou le modal de mining. Un changement de bloc DOM
`A → A+B → B` produit des observations distinctes, sans accumulation de texte. Les seeks applicatifs sont traités comme une transition et leurs états
DOM intermédiaires ne deviennent pas des cues. La relecture destinée à
`AudioPhrase` ouvre en plus une session privée : elle peut observer le DOM pour
déterminer la fin d’une cue sans alimenter la timeline visible. La phrase et
ses bornes sont donc figées pour toute la durée du minage.

## Overlay et interactions

[`OverlayRenderer`](../src/overlay/renderer.ts) est implémenté en DOM vanilla
pour éviter de faire passer le rendu de chaque token par React. Le conteneur :

- est monté sur `document.body` en mode normal, puis dans l’élément plein écran
  lorsque le lecteur utilise l’API Fullscreen ; popover, mining et écoute active
  suivent la même règle via `src/overlay/mount.ts` ;
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
- touche `X` seule : révèle la traduction secondaire de la phrase affichée
  jusqu'au changement de sous-titre ; le raccourci est ignoré dans les champs
  éditables ;
- survol d’un token : ouverture de la popover après 350 ms ;
- survol de la ligne japonaise : révélation d’une traduction secondaire masquée ;
- sortie : fermeture après une grâce de 200 ms pour rejoindre la popover ;
- clic : popover épinglée jusqu’à `Escape` ou clic extérieur ;
- popover : définition, bascule connu/inconnu et accès au mining.

La navigation `Q` / `S` / `D` utilise la même chronologie que l’affichage,
sans refaire de correspondance par proximité temporelle. `S` reprend le segment
affiché ; lorsque plusieurs segments se chevauchent, le dernier commencé sert
de référence. `Q` et `D` visent le début distinct précédent et suivant ; deux
segments commençant ensemble partagent une position de navigation. Dans un
silence, `Q` et `S` reprennent le dernier segment commencé et `D` vise le
prochain. La cible est choisie dès l’appui, avant la mise en file du déplacement,
et une commande d’une ancienne session ou piste n’est pas exécutée.

La recherche utilise `dict:lookup` vers le service worker. Le pipeline épuise
les écritures exactes (forme de dictionnaire, identité canonique et surface)
avant les replis par lecture. Toutes les entrées candidates sont conservées
jusqu'au classement par catégorie grammaticale et lecture du mot de base.
`src/dictionary/match.ts` partage ce classement avec l'index mémoire de
`src/dictionary/index.ts`, réutilisable lorsque son chargement sera branché au
flux. Les packs nouvellement installés distinguent écritures et lectures ;
les packs existants restent utilisables avec une interprétation conservatrice
de leurs alias kana.

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
[`MiningModal`](../src/mining/modal.ts), un aperçu du verso Anki modifiable sur
place : mot, lecture, sens JMdict en pastilles (le premier retenu, trois
glosses au plus par sens),
vignette de l’image, phrase surlignée, audio et traduction, puis Notes. Le modal
peut :

- enrichir manuellement `Notes` avec Gemini 3.5 Flash-Lite via un endpoint
  Cloudflare Worker ; la clé Gemini reste dans le secret du Worker ;
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
une réponse JSON contrainte à Gemini 3.5 Flash-Lite : synonymes importants, définition en
un mot de chaque kanji, au plus deux exemples familiers de même lecture et une
phrase mnémotechnique d’association lorsque le mot possède plusieurs kanjis.
Après génération, SubJap rejette les exemples absents de la liste locale et les
synonymes absents des entrées JMdict courantes. La phrase d’association doit
citer tous les kanjis du mot ; sinon, une seconde requête locale corrige
uniquement cette phrase avant son affichage. Le texte validé est découpé par
[`ai-notes.ts`](../src/mining/ai-notes.ts) en paragraphes structurés (tuiles de
kanji et lignes libellées) que le modal édite sans exposer le format de ligne ;
il est resérialisé dans ce format, celui que le script de la carte transforme en
tuiles, et placé avant les Notes personnelles seulement lors de la sauvegarde. Une
seconde génération remplace uniquement ce texte IA.

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
les éventuels tags `KNOWN`, `IGNORED`, `UNKNOWN` ou `LEARNING`. En complément,
`anki:syncKnown` recherche les notes ayant une carte `Compréhension` dans
`日本語` ou ses sous-decks avec `is:review`. Cette recherche Anki inclut le
réapprentissage après un oubli : ces mots restent donc acquis. Les cartes de
production seules et les cartes encore en apprentissage initial ne suffisent
pas. Le résultat rejoint les tags dans une seule table indexée par identité
lexicale : un mot appris et tagué `KNOWN` ne compte qu'une fois.

`KNOWN` (explicite ou déduit des révisions) prime sur `LEARNING` et `UNKNOWN` ;
`IGNORED` conserve sa priorité et reste exclu du compteur. Les tags de tous les
decks, notamment `Migaku Memory::Status`, restent importés indépendamment de
la planification de leurs cartes. Les imports de statut sont réconciliés :
retirer un tag retire l’ancien état importé seulement si aucune autre note ou
carte acquise ne le justifie, tandis qu’un état manuel local reste prioritaire.
Une remise à zéro volontaire de la carte dans Anki, sa suppression ou sa sortie
de `日本語` peut retirer ce signal d’acquisition ; un simple oubli ne le retire
pas. Toutes les lectures Anki doivent réussir avant la réconciliation locale.
`KNOWN` et `IGNORED` sont blancs ;
un mot déjà présent dans Anki (les notes techniques `Migaku Vocabulary Status`
ne comptent pas comme présence, seuls leurs tags fixent l’état) ou marqué
`LEARNING` reste blanc avec un trait violet. Un mot `UNKNOWN` sans carte existante n’est coloré (vert
ou bleu selon sa fréquence) que s’il est le seul inconnu de sa phrase, c’est-à-dire
le mot à miner ; tout autre inconnu est seulement grisé. La
popover affiche le rang dès qu’il existe et précise `Déjà dans Anki · N cartes`.

SubJap laisse `AudioMot` vide lors de l’envoi à Anki ; la prononciation du mot
peut être fournie par HyperTTS depuis le champ `Lecture`. Si la capture du flux
Netflix est bloquée par le navigateur ou le DRM, `AudioPhrase` reste vide et la
carte demeure valide.

## Interfaces utilisateur

- **Onboarding** : page Options ouverte au premier install ; trois étapes pour
  installer le dictionnaire, configurer ou ignorer AnkiConnect, puis enregistrer
  les réglages d’affichage.
- **Popup** : statut du dictionnaire, statistiques locales, statut Anki,
  rappel de l’onboarding et réglage rapide du masquage des traductions FR/EN
  quand la phrase est entièrement connue.
- **Options** : installation ou réinstallation du pack JMdict, configuration
  du deck Anki, taille/police/furigana de l’overlay, masquage des
  sous-titres natifs, masquage conditionnel des traductions FR/EN, remise à
  zéro des données et relance de l’onboarding.

L’interrupteur global de la popup est persisté dans
`chrome.storage.local["subjap_enabled"]` ([`src/core/enabled.ts`](../src/core/enabled.ts)),
hors des options d’overlay. Le content script ne s’abonne à l’adaptateur,
n’installe ses raccourcis et ne charge UniDic qu’une fois activé ; à la
désactivation, il détruit overlay et adaptateur et rend les sous-titres natifs.
Un adaptateur détruit libère son bridge de page (`subjap:netflix-release`,
`subjap:youtube-release`) : les bridges continuent d’observer passivement mais
ne changent plus de piste dans le lecteur, et Netflix ne sonde la traduction
qu’après une première requête d’un adaptateur abonné. Le service worker affiche
le badge **OFF**.

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

Le MVP couvre le squelette MV3, Netflix, les vidéos classiques YouTube et
l’import de sous-titres locaux sur les pages exposant une vidéo HTML5, le
pipeline de rendu, JMdict, l’interaction hover/clic, le marquage
connu/inconnu, le mining local, le push Anki, le popup, les options et
l’onboarding.

Les évolutions naturelles sont :

- alimenter l’accent tonal et étendre les raccourcis clavier aux autres surfaces ;
- compléter les statistiques et l’historique ;
- ajouter un sélecteur de deck dans les Options ;
- brancher Crunchyroll et Prime ;
- ajouter l’export/import JSON et l’i18n FR/EN.

Les parseurs SRT/VTT/ASS sont isolés dans `src/subtitles/`. L’import local
principal/secondaire est disponible depuis la popup sur les pages web ordinaires
avec une vidéo HTML5 visible. L’intégration des pistes natives de Crunchyroll,
Prime et Disney+ reste à brancher.
