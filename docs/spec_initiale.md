# SubJap — Spécification fonctionnelle et technique

**Statut** : v0.2 — décisions MVP intégrées · **Date** : 2026-08-06 · **Nom** : *SubJap* (provisoire, §18)

Extension navigateur (Manifest V3) qui transforme le visionnage d'anime sur les plateformes de streaming en session d'apprentissage du japonais. Équivalent ciblé de Migaku (anciennement Learning with Netflix / Migaku Dictionary).

---

## 1. Vision

SubJap affiche les sous-titres japonais dans une surcouche interactive au-dessus du lecteur vidéo :

- **clic sur un mot** → définition, lecture en kana, accent tonal, fréquence ;
- **mining** : sauvegarde d'une phrase en carte Anki (audio + capture d'écran + contexte) en un raccourci ;
- **suivi du vocabulaire** : mots marqués connu/inconnu, surlignage dans les sous-titres ;
- **révision** à répétition espacée (via Anki en v1, SRS intégré en v1.1) et statistiques de progression.

Principes directeurs : local-first (aucun compte, aucun service cloud), zéro appel réseau pendant la lecture, permissions minimales, respect des DRM et des conditions d'utilisation des plateformes.

## 2. Non-objectifs

- Ne remplace pas Anki : Anki reste le dépôt de révision principal en v1 ; le SRS intégré (v1.1) est une alternative optionnelle.
- Pas de téléchargement de vidéos, pas de redistribution de contenu.
- Pas de dictionnaire complet embarqué dans l'extension : packs téléchargés au premier lancement (§9).
- Pas de support du chinois/coréen en v1 (architecture extensible via le tokeniseur).
- Pas de génération de listes de vocabulaire, de leçons ou d'exercices hors contexte vidéo en v1.

## 3. Public et cas d'usage

Persona : apprenant intermédiaire (≈ JLPT N4–N2) qui regarde des anime en VOST avec sous-titres japonais.

Cas d'usage principaux :

1. **Regarder** : sous-titres japonais lisibles, surlignés selon l'état connu/inconnu, furigana au survol.
2. **Comprendre** : clic sur un mot → carte dictionnaire instantanée, sans quitter la vidéo.
3. **Miner** : sauvegarder une phrase (mot cible, audio, capture, contexte) vers Anki en un raccourci.
4. **Réviser** : session quotidienne (deck Anki en v1 ; SRS intégré ensuite).
5. **Suivre** : statistiques (mots connus, cartes minées, régularité).

## 4. Plateformes cibles et stratégie d'adaptation

### 4.1 Cibles

| Plateforme | Niveau d'adaptateur | Notes |
|---|---|---|
| Netflix | L1 (HTML5 textTracks) | SPA : observer la création du lecteur |
| YouTube | L1 | sous-titres via textTracks ; détection de langue |
| Crunchyroll | L1 (nouveau lecteur) / L3 | l'ancien lecteur rendait les sous-titres sur canvas |
| Amazon Prime Video | L2 (bridge réseau) | sous-titres rendus sur canvas (DRM) |
| Disney+ | L2/L3 | à étudier en M2 |
| Toute page HTML5 | L1 générique | `<video>` + textTracks, mode de repli |

### 4.2 Niveaux d'adaptateur

- **L1 — textTracks** : s'attache au `<video>` du lecteur, écoute `cuechange`, masque les sous-titres natifs, rend la surcouche. Couvre la majorité des lecteurs HTML5.
- **L2 — bridge réseau** : script injecté dans le contexte page (`world: "MAIN"`, `document_start`) qui intercepte les fetch/XHR de sous-titres (WebVTT, DFXP, JSON), parse et expose les cues à la surcouche. Pour les lecteurs qui dessinent les sous-titres sur canvas.
- **L3 — bridge propriétaire** : API interne du lecteur quand textTracks est insuffisant. Fragile : versionné et testé.

Chaque adaptateur implémente l'interface `PlatformAdapter` (§7.4). Injection : content scripts statiques pour les plateformes connues ; `chrome.scripting.registerContentScripts` (API dynamique) pour les domaines ajoutés par l'utilisateur dans les Options.

## 5. Fonctionnalités

### F1 — Surcouche de sous-titres

- Rendu des cues japonais dans un overlay positionné au-dessus du lecteur (div absolue, `ResizeObserver` pour le repositionnement).
- Style configurable : taille, police (ex. Noto Sans JP), couleur, fond, gras, position verticale, marge.
- Surlignage par état de mot : connu = gris, inconnu/non marqué = orange/rouge (désactivable).
- Furigana : jamais / au survol / toujours / seulement pour les inconnus (élément `<ruby>`).
- Masquage des sous-titres natifs de la plateforme (éviter le double affichage).
- Sélecteur de langue : choix de la piste japonaise ; détection automatique par ratio kana/kanji en repli.
- Affichage optionnel du contexte : phrase précédente / actuelle / suivante.

### F2 — Recherche de mot au clic

Clic sur un mot de l'overlay → popover ancré au mot :

- lemme, lecture (kana), définition(s) (langue configurable, v1 : EN), classe grammaticale ;
- accent tonal (si disponible), rang de fréquence, badge « courant » ;
- actions : marquer connu/inconnu, miner la phrase, rejouer l'audio ; ajouter au SRS (v1.1).

Équivalent clavier : navigation mot précédent/suivant dans la phrase (raccourcis `J`/`K`).

### F3 — Tokenisation et lecture

- Segmentation de la phrase en tokens via kuromoji.js (MeCab/IPA) en v1 ; sudachi.rs/WASM (UniDic) évalué pour v1.1. Interface commune `Tokenizer` pour permuter (§7.4).
- Lecture en kana pour chaque token ; remontée au lemme (formes conjuguées) pour la définition et l'état de mot.
- Cache LRU des phrases tokenisées (Map borné, ~500 entrées) pour la fluidité de lecture.

### F4 — Accent tonal (pitch accent)

- Affichage optionnel du motif (ex. 平板/0, 中高/2) et de la position de la chute (graphique de hauteur).
- Source : jeu de données open source packagé avec le dictionnaire (ex. suzume / données Wiktionary, §19) ; repli heuristique ; non affiché si absent ou incertain.

### F5 — Mining de phrases + Anki

- Raccourci `M` ou bouton du popover → modal de mining :
  - champs pré-remplis : phrase, lecture, mot cible, définition choisie, source (plateforme, série, épisode, timestamp) ;
  - audio : extrait du segment vidéo (§10.3) ou TTS de repli ;
  - image : capture du lecteur (peut être noire sous DRM → repli sans image ou capture de la surcouche) ;
  - édition libre avant envoi + aperçu.
- Envoi vers Anki via AnkiConnect (`http://127.0.0.1:8765`) : création du deck et du modèle à la première utilisation, `addNote` avec pièce jointe audio (§10).
- Suppression des cartes existantes (via `noteId`).

### F6 — Système de révision (SRS)

- États : `new` → `learning` → `review` / `relearning`, `suspended`.
- Algorithme SM-2 simplifié (§11).
- Page de révision plein écran (onglet d'extension) : phrase + audio, retour (définition, lecture, pitch), notation Encore / Difficile / Bien / Facile.
- Quota quotidien configurable ; file d'attente par date d'échéance.
- v1 : les cartes vivent dans Anki (révision dans Anki, extension en lecture seule) ; v1.1 : SRS intégré avec synchronisation optionnelle (décision tranchée, §18).

### F7 — Suivi et statistiques

- Compteurs : cartes minées (total/jour), révisions dues/effectuées, mots connus, série en cours.
- Historique consultable et filtrable (plateforme, série, statut) — page d'onglet.
- Vue « série » : cartes minées par épisode avec timestamps (reliure vidéo).
- Graphiques légers (sparklines canvas), sans bibliothèque lourde.

### F8 — Raccourcis clavier

Tableau complet §12. Exemples : `M` miner, `J`/`K` mot précédent/suivant, `R` rejouer la phrase, `[`/`]` boucle ±5 s, `N`/`U` marquer connu/inconnu. Tous remappables.

### F9 — Sous-titres locaux (import)

- Quand la plateforme ne fournit pas de piste japonaise : import d'un fichier `.srt`/`.ass` local, synchronisation manuelle (décalage global + ajustement par ligne), stockage en IndexedDB.
- Les cues importés passent par le même pipeline (tokenisation, clic, mining).

### F10 — Réglages et données

- Page Options : dictionnaire (packs, langue des définitions), Anki (port, deck, modèle), sous-titres (style), pitch accent, audio, raccourcis, données.
- Export/import JSON complet (cartes, états de mots, réglages) — migrations de navigateur.
- Bouton « tout effacer » (données locales uniquement).

## 6. Parcours utilisateur

1. **Onboarding** (première ouverture) : 3 écrans — (1) téléchargement du pack dictionnaire (taille, langue), (2) détection AnkiConnect + création deck/modèle, (3) options par défaut (surlignage, furigana) → ouvrir la plateforme.
2. **Regarder** : l'extension détecte le lecteur, active l'overlay, surligne les mots. Aucun appel réseau pendant la lecture.
3. **Comprendre** : clic → popover → lecture/définition → marquer connu ou fermer.
4. **Miner** : `M` → modal → (audio/capture générés) → `Entrée` → carte dans Anki.
5. **Réviser** : la popup affiche le nombre de cartes dues → Anki (v1) ; page de révision intégrée en v1.1.
6. **Suivre** : page Statistiques.

## 7. Architecture technique

### 7.1 Stack

- TypeScript strict, build Vite/esbuild, Manifest V3.
- UI : React pour popup / options / pages d'onglet ; **DOM vanilla** pour le rendu de l'overlay (performance).
- Stockage : IndexedDB via Dexie ; `chrome.storage` pour les réglages légers.
- Tests : Vitest (logique pure), Playwright (fixtures DOM des plateformes), matrice manuelle (§16).
- Navigateurs : Chrome/Edge (MV3) en priorité ; Firefox MV3 ensuite ; Safari écarté en v1.

### 7.2 Composants

```
┌────────────────────────────── extension MV3 ──────────────────────────────┐
│  background service worker   (état global, routage messages, AnkiConnect) │
│  content script plateforme   (adaptateur + overlay + popover + pipeline)  │
│  content script réseau (L2)  (bridge fetch/XHR, world MAIN, si nécessaire)│
│  popup                       (statut, compteurs, réglages rapides)        │
│  pages d'onglet              (révision v1.1, statistiques, historique)    │
│  options                     (tous les réglages)                          │
│  core (partagé)              (tokeniseur, dictionnaire, SRS, pipeline)    │
│  data layer                  (IndexedDB : cartes, états, cache, réglages) │
└───────────────────────────────────────────────────────────────────────────┘
```

Messaging : `runtime` MV3 pour content ↔ background ↔ pages ; les blobs (audio, images) transitent en base64 ou via IndexedDB partagée (accessible à toutes les vues).

### 7.3 Pipeline des sous-titres

```
cues (adaptateur) → normalisation → segmentation en phrases
  → tokenisation (kuromoji) → rendu spans (état connu/inconnu, ruby)
  → interaction (clic → lookup → popover → mining)
```

La tokenisation ne porte que sur la phrase affichée ; le cache LRU évite les re-tokenisations.

### 7.4 Contrats d'interface

```ts
type PlatformId =
  | 'netflix' | 'youtube' | 'crunchyroll'
  | 'primevideo' | 'disneyplus' | 'generic-html5';

interface SubtitleCue {
  id: string;
  start: number;          // secondes, début
  end: number;            // secondes, fin
  text: string;           // texte brut (kana/kanji)
  language?: string;
}

interface EpisodeContext {
  platform: PlatformId;
  title: string;          // titre de la série
  season?: string;
  episode?: string;
  language: string;       // 'ja' attendu
  url: string;
}

interface PlatformAdapter {
  id: PlatformId;
  isActive(doc: Document, url: string): boolean;
  getVideoElement(): HTMLVideoElement | null;
  subscribeCues(cb: (cues: SubtitleCue[]) => void): () => void; // cues actifs
  getCurrentTime(): number;
  getPlaybackRate(): number;
  setNativeSubtitlesVisible(v: boolean): void;
  getEpisodeContext(): EpisodeContext | null;
  destroy(): void;
}

interface Tokenizer {
  tokenize(sentence: string): Token[];
}

interface Token {
  surface: string;        // forme à l'écran (ex. 食べて)
  lemma: string;          // forme de dictionnaire (食べる)
  reading: string;        // lecture en kana
  partOfSpeech: string[];
}
```

Un registre d'adaptateurs sélectionne le premier `isActive` ; repli `generic-html5`.

### 7.5 Manifest (permissions)

```jsonc
{
  "manifest_version": 3,
  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": [
    "*://*.netflix.com/*",
    "*://*.youtube.com/*",
    "*://*.crunchyroll.com/*",
    "*://*.primevideo.com/*",
    "*://*.disneyplus.com/*",
    "http://127.0.0.1:8765/*"   // AnkiConnect
  ],
  "content_scripts": [/* statiques par plateforme connue */],
  "web_accessible_resources": ["dictionary/**", "wasm/**"]
}
```

Pas de `webRequest`, pas de lecture de l'historique, pas de publicité.

## 8. Modèle de données (IndexedDB)

```ts
interface WordState {
  key: string;                 // lemme (ex. 食べる)
  status: 'known' | 'unknown';
  knownAt?: number;
  source: 'manual' | 'frequency-list' | 'import';
}

interface MineCard {
  id: string;                  // uuid
  createdAt: number;
  sentence: string;
  sentenceReading?: string;
  targetWord: string;          // lemme cible
  targetSurface?: string;      // forme affichée
  targetReading?: string;
  definitions: string[];       // glosses retenues
  pitchAccent?: PitchAccent;
  audio?: Blob;                // extrait vidéo ou TTS
  screenshot?: Blob;
  source: EpisodeContext;
  cueStart: number;            // timestamps dans l'épisode
  cueEnd: number;
  srs: SrsState;               // reflet local ; Anki fait foi en v1 (SRS intégré v1.1)
  ankiNoteId?: number;
  tags: string[];
}

interface SrsState {
  state: 'new' | 'learning' | 'review' | 'relearning' | 'suspended';
  intervalDays: number;
  ease: number;                // 1.3 – 2.5, défaut 2.5
  due: number;                 // epoch ms
  reps: number;
  lapses: number;
  lastReview?: number;
}

interface DictionaryEntry {
  headword: string;
  reading: string;
  partOfSpeech: string[];
  senses: { glosses: string[]; tags?: string[] }[];
  frequencyRank?: number;
  common: boolean;
}

interface PitchAccent {
  pattern: string;             // "0" | "1" | "2" | ... (ou 平板/中高/…)
  moraCount: number;
  downstepIndex?: number;      // 0 = 平板
}
```

## 9. Dictionnaires, tokenisation, accent

- **Tokeniseur** : kuromoji.js (JS pur, bundlé) pour le MVP ; sudachi.rs/WASM en évaluation v1.1. Interface `Tokenizer` commune.
- **Dictionnaire** : jmdict-simplified (JSON, définitions EN), pack compressé téléchargé au premier lancement (≈ 15–30 Mo décompressé), stocké en IndexedDB/OPFS. Alternative secondaire : API jisho (limites de débit, non prioritaire). Définitions FR : reportées à M3 (décision §18).
- **Fréquence** : liste de fréquence intégrée (corpus de sous-titres japonais / BCCWJ) pour le rang et le badge « courant ».
- **Accent tonal** : jeu de données open source packagé ; repli heuristique ; inconnu = non affiché.

Les packs sont téléchargés depuis des URL épinglées (version + sha256 affichés) — pas de CDN dynamique.

## 10. Intégration Anki (AnkiConnect)

- **Détection** : ping `version` sur `http://127.0.0.1:8765` ; aide si Anki/AnkiConnect absent ; clé API optionnelle (Anki 2.1.56+).
- **Première utilisation** : `createDeck` (défaut `SubJap::Anime`) et `createModel` (défaut `SubJap - Phrase`) avec champs : `Phrase`, `Lecture`, `Sens`, `Mot`, `Source`, `Audio`, `Image` ; plus le champ modèle si besoin.
- **Mining** : `addNote` avec audio en pièce jointe (copie dans `collection.media`), tags `subjap, <plateforme>, <série>`.

Exemple de requête :

```json
POST http://127.0.0.1:8765
{
  "action": "addNote",
  "version": 6,
  "params": {
    "note": {
      "deckName": "SubJap::Anime",
      "modelName": "SubJap - Phrase",
      "fields": {
        "Phrase": "食べてみてください",
        "Lecture": "たべてみてください",
        "Sens": "essayer de manger",
        "Mot": "食べる",
        "Source": "Netflix — 呪術廻戦 S1E3 @ 12:34"
      },
      "tags": ["subjap", "anime", "netflix"],
      "audio": [{
        "path": "/tmp/subjap_abc123.mp3",
        "filename": "subjap_abc123.mp3",
        "fields": ["Audio"]
      }]
    }
  }
}
```

- **Révision v1** : lecture seule d'Anki (cartes dues via `findCards`/`notesInfo`) ; v1.1 : SRS intégré (décision §18).

### 10.3 Capture audio

- **Principal** : enregistrement continu du flux audio du lecteur (Web Audio `AudioContext` + `createMediaElementSource`, capture PCM dans un buffer glissant d'environ 60 s via AudioWorklet) ; au moment du mining, découpe de `[cueStart − 0,3 s, cueEnd + 0,3 s]`. Aucune interruption de lecture.
- **Repli** : pause, seek à `cueStart`, relecture et enregistrement du segment.
- **TTS** : si le flux est inaccessible (DRM) ou sur les pages sans vidéo, voix OS via `speechSynthesis` (hors ligne, aucune donnée envoyée à l'extérieur).

## 11. Algorithme SRS (SM-2 simplifié)

En v1, l'algorithme d'Anki fait foi pour les cartes minées ; ce SRS simplifié est implémenté avec le SRS intégré (v1.1).

- `new` : première apparition → étapes d'apprentissage 10 min puis 1 jour (`learning`).
- `review` : intervalle = `round(intervalDays × ease)` ; notation :
  - Encore → `ease = max(1.3, ease − 0.2)`, intervalle 10 min (`relearning`) ;
  - Difficile → `ease − 0.15`, intervalle ×1,2 ;
  - Bien → ease inchangé ;
  - Facile → `ease + 0.15`, intervalle ×1,3.
- Bornes : intervalle max 365 j ; ease ∈ [1.3, 2.5] ; `suspended` jamais automatique.
- File : cartes `due <= now`, priorité aux `relearning`, quota quotidien configurable, mélange aléatoire du reste.

## 12. Raccourcis clavier (défauts)

| Touche | Action |
|---|---|
| `M` | miner la phrase courante |
| Clic / `Entrée` sur un mot | recherche dictionnaire |
| `J` / `K` | mot précédent / suivant dans la phrase |
| `R` | rejouer l'audio de la phrase courante |
| `[` / `]` | boucle ±5 s autour de la phrase |
| `,` / `.` | reculer / avancer de 5 s |
| `N` / `U` | marquer le mot connu / inconnu |
| `H` | masquer / afficher l'overlay |
| `?` | aide raccourcis |

Tous remappables dans les Options ; désactivation globale possible (conflits avec le lecteur).

## 13. Interface utilisateur (maquettes)

### 13.1 Overlay (au-dessus du lecteur)

```
┌────────────────────────────────────────────┐
│              [lecteur vidéo]               │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │  「食べてみてください」                 │  │
│  │   たべてみてください                   │  │
│  │  食べる [動] essayer de manger         │  │
│  │  ⚑ fréquence 3 · 中高(2) · [connu]    │  │
│  │  [Miner] [Audio] [×]                 │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  gris = connu · orange = inconnu           │
└────────────────────────────────────────────┘
```

Le bouton ＋SRS apparaît avec le SRS intégré (v1.1).

### 13.2 Modal de mining

Champs édités : Phrase / Lecture / Sens / Mot / Source (auto) ; aperçus audio + image ; options : inclure audio, inclure capture, deck cible ; boutons [Annuler] [Envoyer vers Anki].

### 13.3 Popup

Statut de la plateforme (détectée ou non), toggle overlay, badge cartes dues (→ Anki en v1, page de révision en v1.1), liens : Historique, Statistiques, Options.

### 13.4 Page de révision *(v1.1 — en v1, la révision se fait dans Anki)*

Carte (phrase + bouton audio) → retournement → définition/lecture/pitch → 4 boutons de notation ; compteur de session ; barre de progression.

## 14. Sécurité, vie privée, limites

- **Local-first** : aucune donnée (cartes, états, statistiques) envoyée à un serveur ; seuls les packs de dictionnaires sont téléchargés (URLs épinglées, vérification sha256).
- **Sanitisation** : les textes de sous-titres sont injectés via API DOM (`textContent`, création de spans), jamais via `innerHTML` brut — les sous-titres sont du contenu externe.
- **AnkiConnect** : restreint à localhost ; clé API optionnelle.
- **DRM / canvas** : captures vidéo et extraits audio peuvent être bloqués (canvas noir) ; replis documentés (TTS, capture de l'overlay uniquement).
- **ToS des plateformes** : l'extension ne contourne aucun DRM, ne récupère que les sous-titres affichés ou livrés au lecteur ; usage personnel, aucune redistribution. Les captures audio/image servent uniquement à l'étude personnelle.
- **Robustesse** : les DOM/API des plateformes changent → adaptateurs versionnés et testés, dégradation propre (message « adaptateur à mettre à jour »).

## 15. Performances

- Aucun appel réseau sur le chemin de lecture ; tokenisation uniquement de la phrase visible (cache LRU ~500).
- Overlay en DOM vanilla ; `requestAnimationFrame` pour le repositionnement ; pas de framework dans le content script.
- IndexedDB en écriture différée (debounce) pour les états de mots ; blobs hors du fil d'interface.
- Pack dictionnaire chargé en arrière-plan après l'onboarding, index en mémoire (Map) ; budget RAM < 100 Mo.

## 16. Tests et qualité

- **Unitaires (Vitest)** : tokeniseur, mapping lemme → entrée, SRS (propriétés : intervalles croissants, bornes — v1.1), pipeline de rendu, parseurs SRT/ASS.
- **Adaptateurs (Playwright)** : pages fixtures reproduisant le DOM des plateformes (snapshots enregistrés) → détection, cues, masquage natif ; régression à chaque changement de DOM connu.
- **E2E limité** : vraies plateformes, matrice manuelle (Chrome/Edge) par version d'adaptateur ; versions testées documentées.
- **Qualité** : ESLint + Prettier, types stricts, revue des permissions à chaque PR.

## 17. Jalons

Les jalons intègrent les décisions du §18 (périmètre MVP : définitions EN, révision dans Anki, TTS voix OS, Chrome/Edge).

- **M0 — MVP (≈ 2–3 semaines)** : squelette MV3 ; adaptateurs Netflix (L1) + générique ; overlay + surlignage connu/inconnu (marquage manuel) ; clic → dictionnaire (jmdict-simplified EN) ; mining → Anki (audio TTS de repli, capture best-effort) ; popup ; options minimales ; onboarding pack dictionnaire.
  *Critères de sortie* : sur Netflix (Chrome), un épisode VOST : sous-titres interactifs, lookup fluide, carte Anki complète (phrase, lecture, sens, audio, capture, source) en ≤ 3 s.
- **M1 (≈ 3 semaines)** : furigana + accent tonal ; lecture en kana ; raccourcis complets ; statistiques de base ; historique.
- **M2 (≈ 4 semaines)** : adaptateurs YouTube, Crunchyroll, Prime (L2) ; audio extrait du lecteur (buffer glissant PCM) ; sous-titres locaux (SRT/ASS) ; export/import ; i18n FR/EN.
- **M3 (différé)** : SRS intégré + page de révision (v1.1) ; kanji (traits, composition) ; recherche de phrases ; marquage automatique via liste de fréquence ; pack définitions FR ; Firefox ; évaluation sudachi/WASM.

## 18. Décisions (tranchées pour le MVP)

Les cinq questions ouvertes de la v0.1 sont tranchées en faveur du périmètre minimal viable. Elles constituent la référence par défaut ; chaque revirement est évalué ci-dessous.

1. **Définitions — EN au MVP.** jmdict-simplified (EN) dès M0 ; pack FR (extraction des gloses françaises de JMdict) reporté à M3. Coût du revirement : simple ajout d'un pack de données, aucun changement de code.
2. **Révision — Anki en v1.** Les cartes minées sont révisées dans Anki ; l'extension n'est que lectrice de la révision (compteur de cartes dues via AnkiConnect). Le SRS intégré et sa page de révision (spécifiés en §11 et §13.4) passent en v1.1, après M2. Coût du revirement : moteur SRS + page de révision (≈ 1–2 semaines), déjà spécifiés.
3. **TTS de repli — voix OS.** `speechSynthesis` uniquement (hors ligne, aucune donnée envoyée) ; aucun service TTS en ligne. Coût : qualité audio variable selon l'OS.
4. **Nom — « SubJap » conservé**, provisoire, dérivé du nom du dépôt. Renommage possible sans impact technique.
5. **Navigateurs — Chrome/Edge d'abord.** Firefox MV3 ensuite ; Safari écarté en v1.

## 19. Références techniques (pour mémoire)

- AnkiConnect : protocole HTTP sur `127.0.0.1:8765` (documentation officielle).
- jmdict-simplified : JSON généré depuis JMdict (GitHub).
- kuromoji.js : tokeniseur MeCab/IPA en JS pur.
- Données d'accent tonal open source (suzume / données Wiktionary) — versions à épingler.
- Listes de fréquence : corpus de sous-titres japonais / BCCWJ — versions à épingler.
