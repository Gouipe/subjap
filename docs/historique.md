# SubJap — Handoff (2026-08-07, fin de session 8)

## État du projet

**Le MVP (jalon M0 de la spec) est complet, et la session 8 a corrigé en conditions réelles (Chrome + Netflix) les derniers bugs d'interaction : les sous-titres natifs sont masqués, l'overlay se positionne au-dessus de la barre de contrôle Netflix, le survol d'un mot ouvre la popover de définition, et le push Anki fonctionne sur les profils non-anglophones (modèle résolu ou créé automatiquement).** Tous les critères de sortie M0 sont couverts :
squelette MV3, adaptateurs Netflix (L1) + générique, overlay avec surlignage connu/inconnu,
clic **et survol** → dictionnaire jmdict-simplified EN (22 626 entrées par défaut, pack complet 218k en option),
mining → carte locale complète + push best-effort vers Anki (deck « SubJap » + modèle « SubJap Basic » dédiés, créés à la demande),
popup, options complètes, onboarding 3 étapes, normalisation + segmentation des sous-titres.

Vérifications actuelles (toutes vertes, vérifiées en fin de session) :
- `npx tsc --noEmit` : 0 erreur
- `npm run lint` : 0 erreur (8 warnings `no-non-null-assertion`, non bloquants)
- `npm run build` : OK, 98 modules — content script 85 kB, service worker 101 kB
- `npm test` : **50/50** (jmdict 8, options 9, subtitles 20, lru-cache 7, dictionary index 6)

## Ce qui a été fait

### Sessions 1–4 (voir historique précédent)
Scaffold M0 strict, pipeline content script, dictionnaire jmdict (SW + IndexedDB), popup, Options + Onboarding complets.

### Session 6 : correctif install dict (bug réel utilisateur)
- **Cause racine** : le download GitHub `releases/latest/download/...` redirige vers `release-assets.githubusercontent.com`, qui manquait dans `host_permissions` (seul `objects.githubusercontent.com` y était) → fetch du SW bloqué CORS → le handler `dict:download` échouait, le bus renvoyait une réponse nullish, et l'UI plantait sur `result.count` (« Cannot read properties of null »).
- **`src/manifest.ts`** : ajout de `https://release-assets.githubusercontent.com/*` aux host_permissions (garde aussi `objects.githubusercontent.com`).
- **`src/core/messaging.ts`** : les erreurs async des handlers sont désormais propagées via un marqueur `__subjapError` → `sendMessage()` **rejette** au lieu de résoudre `undefined`/`null`. Les callers voient le vrai message d'erreur au lieu d'un crash sur `.field`.
- **`src/options/index.tsx` + `src/popup/index.tsx`** : garde défensive sur le résultat de `dict:download` (`!result || typeof result.count !== "number"` → throw) en ceinture-bretelles.
- Vérifié : tsc 0, lint 0 erreur (8 warnings), 50/50 tests, build OK, permission présente dans `dist/manifest.json`.

### Session 7 : capture des sous-titres Netflix via le DOM (bug réel utilisateur — CORRIGÉ)

**Symptôme** : extension chargée, dico installé, mais aucun effet sur Netflix (pas d'overlay, sous-titres natifs non masqués).

- **Cause racine** : Netflix n'expose PAS ses sous-titres via `video.textTracks` (vérifié en console : `textTracks.length` inexploitable). Son player les rend dans le DOM : conteneur `.player-timedtext` → lignes `.player-timedtext-text-container` (span avec styles inline). L'ancien `subscribeCues` écoutait `cuechange` sur des tracks inexistantes → le callback n'était jamais appelé → `handleCues()` mort → ni overlay ni masquage. Confirmé en comparant avec les extensions de référence (NflxMultiSubs hooke le manifest ; LLN lisait le DOM).
- **`src/adapters/netflix.ts`** (réécrit) :
  - `subscribeCues` : voie principale = MutationObserver sur `.player-timedtext` (attache tardive via observer racine sur `document.documentElement`, ré-attache si l'élément est recréé — track change / navigation SPA). Lecture du texte par ligne (`textContent` trimé), timestamps depuis `data-start`/`data-end` si présents sinon `currentTime`, debounce 60 ms, log `[SubJap] Netflix cues: N`.
  - Fallback `textTracks` conservé (doublons absorbés par le dedupe signature de `handleCues`).
  - `setNativeSubtitlesVisible(false)` : masque `.player-timedtext` en `visibility:hidden !important` (préserve le layout pour le player), préférence stockée dans l'adaptateur et **ré-appliquée à chaque attache** (le flag `nativeSubtitlesHidden` du content script early-return, donc c'est l'adaptateur qui gère la ré-application).
  - `isActive` : ajout du signal `.player-timedtext`, puis **`isActive` basé sur le domaine** (`/netflix\.com/i`) — au `document_end`, les signaux DOM du player ne sont pas encore montés, l'ancienne logique pouvait retomber sur `generic-html5` (subscribeCues no-op → rien ne se passait).
  - Robustesse : `videoHuntTimer` (poll 400 ms si le `<video>` n'est pas encore dans le DOM à l'attache, re-emit à la découverte), `emitCues` ne dépend plus du `<video>` (fallback `currentTime ?? 0`), `handleCues` ne commit la signature qu'une fois l'overlay disponible (`lastSignature` reset au swap de player).
- **Tokenizer kuromoji : le loader XHR par défaut pendait silencieusement dans le content script** (ni `onload` ni `onerror` → le callback de `build()` n'était jamais appelé → aucun rendu, aucune erreur). **`src/tokenizer/index.ts`** : `kuromoji.builder()` contourné — on pilote `DictionaryLoader` (import profond `kuromoji/src/loader/DictionaryLoader`) avec un `loadArrayBuffer` maison en `fetch()` + `DecompressionStream("gzip")` natif (Chrome 80+), timeout 20 s par fichier, erreurs et logs explicites (`[SubJap] tokenizer: fetch/ok/failed/ready`). zlibjs et le loader XHR éliminés du bundle (114 → 98 modules, content script 98 → 83 kB).
- **Rendu overlay : le furigana en `display:block` dans un span inline empilait chaque mot verticalement** → le texte débordait sous la vidéo et était clippé par le player (« tronqué »). **`src/overlay/renderer.ts`** : `.subjap-cue-line` passe en `flex` (wrap + centrage + `column-gap`), `.subjap-token` en `inline-flex` colonne (mot + furigana), furigana au-dessus via `order:-1`, `white-space:normal` + `overflow-wrap` pour les lignes longues.
- **`src/content/index.ts`** : log `[SubJap] options: {...}` au boot (diagnostic du masquage des natifs).
- Vérifié : tsc 0, lint 0 erreur (8 warnings connus), **50/50 tests**, build OK. **Test réel Chrome : CONFIRMÉ** — logs complets (`Platform: netflix` → `video found` → `timedtext observer attached` → `cues` → `tokenizer: ready` → `render: shown`), overlay visible et lisible sur Netflix.

### Session 8 : interaction Netflix (masquage natifs, position overlay, hover) + Anki sur profils localisés (bugs réels utilisateur — CORRIGÉS)

**Symptômes rapportés** : (1) les sous-titres natifs Netflix restaient visibles ; (2) le sous-titre custom s'affichait sous la barre de contrôle Netflix et le survol/clic ne donnait rien ; (3) le push Anki échouait silencieusement sur un profil français (`model was not found: Basic`).

- **Masquage natifs — `src/adapters/netflix.ts`** : l'ancien `visibility: hidden !important` **inline** sur le seul conteneur `.player-timedtext` ne pouvait pas forcer des enfants ayant leur propre `visibility` inline (la valeur propre d'un enfant l'emporte sur l'héritage, même `!important`). Remplacé par une **règle CSS document-level** activée par une classe sur `<html>` (`html.subjap-hide-native-subs [class*="player-timedtext"], ... * { visibility: hidden !important }`) → survit à la recréation de l'élément et aux overrides inline. Le content script applique aussi la préférence **au boot** (avant le premier cue).
- **Position overlay — `src/overlay/renderer.ts`** : le conteneur était monté DANS le player (`.watch-video`) → son z-index était piégé dans le stacking context du player, une couche transparente de Netflix (fond des contrôles) se peignait au-dessus et **avalait les événements souris** (overlay visible mais mort). L'overlay est désormais monté sur **`document.body` en `position: fixed`** (z-index 2147483646, comme la popover), positionné directement depuis `getBoundingClientRect()` du `<video>` (RAF 200 ms). Bonus : plus de calcul `offsetParent` ; garde `width/height === 0` (vidéo non layoutée).
- **Texte au-dessus de la barre** : le conteneur couvre exactement la vidéo (`box-sizing: border-box` + `height`), lignes **ancrées en bas** (flex `justify-content: flex-end`) avec `padding-bottom ≥ 120 px / 13 %` → le texte dégage la barre de contrôle Netflix au lieu de passer dessous.
- **Popover au survol — `src/content/index.ts` + `src/overlay/popover.ts`** : ajout du mode hover (la spec F2 ne prévoyait que le clic). Survol d'un token → popover après **350 ms** ; sortie → fermeture après 200 ms de grâce (pour atteindre la popover) ; **clic → épinglage** (ferme par Escape/clic à côté). Garde de fraîcheur dans `showPopoverForToken` (ancre déconnectée / token changé pendant le lookup async) ; popover fermée et dépinglée à chaque re-render de cue. Nouvel export `hidePopover()`. Logs temporaires `[SubJap] hover: enter token N` / `hover: opening popover for ...` (à retirer après confirmation).
- **Vérification logique hover** : test jsdom jetable (`src/hover.scratch.test.ts`, **supprimé ensuite**) reproduisant le handler avec le vrai `WordPopover` + `OverlayRenderer` → la popover s'ouvre bien quand les événements atteignent les tokens. Confirmé réel Chrome : **le survol fonctionne** après le correctif de montage body/fixed.
- **Anki sur profils localisés — `src/background/service-worker.ts`** : `addNote` envoyait `modelName: "Basic"` en dur → `model was not found: Basic` sur les profils non-anglophones (« Basique » + champs localisés). Nouvelle résolution `resolveAnkiModel()` : (1) nom demandé s'il existe, (2) premier modèle aux champs `Front`/`Back`, (3) **création automatique** du modèle « SubJap Basic » (`Front`/`Back`/`Audio`/`Picture`, idempotent via `ensureAnkiModel()`). Log de succès `[SubJap] Anki note added: { noteId, deckName, modelName }`.
- **Handler `anki:setup` + UI Options** : crée le deck « SubJap » (`createDeck`, idempotent) + garantit le modèle « SubJap Basic » ; bouton « Créer le deck « SubJap » » dans la section Anki des Options (panneau réglages). Le modal de mining **préfère le deck « SubJap »** s'il existe (fallback `deckNames[0]`). Types ajoutés dans `types.ts` (`anki:setup`/`anki:setupResult`, `anki:addNoteResult` étendu avec `modelName`).
- Vérifié : tsc 0, lint 0 erreur (8 warnings connus), **50/50 tests**, build OK.

### Session 5 : pipeline de rendu + mining complet + tests (étapes 5 & 6 du handoff — TERMINÉES)

**Pipeline de rendu (étape 5)**
- **`src/subtitles/normalize.ts`** (NOUVEAU) : `normalizeCueText()` — supprime les tags HTML (`<i>`, `<c.yellow>`…), les overrides ASS (`{\i1}`), convertit `\N`/`\n` ASS, décode les entités (nommées + numériques déc/hex), collapse les espaces.
- **`src/subtitles/segment.ts`** (NOUVEAU) : `splitIntoSentences(text, maxLen=80)` — découpe sur `。！？!?…` (garde les guillemets fermants attachés), newlines comme frontières dures, re-découpe des chunks trop longs au plus proche séparateur (espace/comma/・).
- **`src/subtitles/parse.ts`** (NOUVEAU) : `parseSRT` / `parseVTT` (saute header/NOTE/STYLE/REGION, gère les cue settings `position:50%` en fin de ligne) / `parseASS` (section `[Events]`, Format + Dialogue, virgules dans le texte) + `detectFormat`/`parseSubtitleFile` (extension + sniff contenu). Utilisés par les tests aujourd'hui ; servent à l'import de fichiers locaux (F9, M2).
- **`src/subtitles/index.ts`** : barrel.
- **`src/content/index.ts`** :
  - Segmentation : chaque cue est normalisé puis découpé en phrases avant tokenisation → le cache LRU du tokenizer frappe sur les phrases répétées.
  - `applyNativeSubtitleVisibility()` : respecte la nouvelle option `hideNativeSubtitles` (masque/restaure la piste native japonaise, idempotent, ré-appliqué sur `storage.onChanged`).
  - **Décision pause** : l'overlay reste affiché en pause (moment de lecture pour l'apprenant) — documenté dans le code.
  - Mining : `onMine` ouvre désormais le **MiningModal** (plus de création directe).

**Mining complet (trouvé et corrigé : le modal n'était jamais instancié)**
- **`src/mining/modal.ts`** (réécrit) :
  - `getDefinitions()` renvoyait `[]` en dur → les définitions passées à `open()` sont maintenant stockées et utilisées (checkbox).
  - Les listeners s'accumulaient à chaque `render()` (double audio/double envoi) → **délégation unique** sur le container dans le constructeur.
  - `sendToAnki()` : crée la carte locale (`mine:create` avec phrase normalisée, définitions sélectionnées, screenshot data URL) puis **push best-effort AnkiConnect** (premier deck, modèle Basic, champs Front/Back) — un échec Anki ne bloque jamais le flux.
  - Échappement HTML des glosses/surfaces, état `sending` (bouton désactivé), Entrée/Escape gérés.
- **`src/core/types.ts`** : `CreateMineCardPayload` — les Blobs ne traversent PAS le bus de messaging MV3 ; audio/screenshot transitent en **base64 data URLs** (`screenshotDataUrl`/`audioDataUrl`).
- **`src/background/service-worker.ts`** : handler `mine:create` convertit les data URLs → Blobs (`dataUrlToBlob`) avant stockage IndexedDB.
- **`src/content/index.ts`** : `lastRenderedCues` retenu pour le modal, modal détruit au changement de `<video>` (SPA).

**Dictionnaire — packs**
- **`src/dictionary/jmdict.ts`** : `JMDICT_PACKS` (common ~22k / full ~218k, asset complet vérifié sur la release `3.6.2+20260803141815` via l'API GitHub).
- **Options page** : sélecteur de pack + description + bouton « Réinstaller (pack courant/complet) » — `dict:download` acceptait déjà `{url}`.

**Options / types**
- `OverlayOptions.hideNativeSubtitles` (défaut `true`) ajouté dans `types.ts`, `core/options.ts` (defaults + sanitize) et l'UI (wizard étape 3 + panneau Affichage).
- `renderer.ts` : sa copie locale de `DEFAULT_OPTIONS` supprimée — il importe maintenant celui de `@/core/options` (zéro duplication).

**Tests (étape 6 — partie pure)**
- `src/subtitles/subtitles.test.ts` : 20 tests (normalisation, segmentation, SRT/VTT/ASS, timestamps, détection de format).
- `src/tokenizer/lru-cache.test.ts` : 7 tests (éviction, recency, has sans recency, clear, capacités invalides).
- `src/dictionary/index.test.ts` : 6 tests (mapping lemme→entrée, headword vs reading, idempotence, first-write-wins).
- `src/core/options.test.ts` : +1 test (hideNativeSubtitles).
- Pas de test du tokenizer kuromoji (nécessite les fichiers dict hors navigateur) ni des handlers SW (nécessite fake-indexeddb) — documentés ci-dessous.

**Dette traitée**
- Manifest : le glob mort `web_accessible_resources` `src/dictionary/**`/`src/wasm/**` supprimé → **les fichiers de test ne sont plus embarqués dans dist** (seul `dict/*` reste exposé).
- `npm audit` : 5 vulnérabilités **toutes en devDependencies** (esbuild/vite/vitest — non embarquées dans l'extension ; GHSA-67mh-4wv8-2f99 ne touche que le serveur de dev). Le seul correctif est un upgrade cassant vers vite 8 — **décision : ne pas forcer**, réévaluer plus tard.

## Architecture (à jour)

```
src/
├── manifest.ts                    # MV3 via @crxjs/vite-plugin (web_accessible: dict/* seulement)
├── core/
│   ├── types.ts                   # 16+ types de messages + CreateMineCardPayload
│   ├── options.ts + test.ts       # Réglages overlay (source unique), 9 tests
│   ├── db.ts / messaging.ts       # Dexie / bus typé
│   └── adapters/registry.ts
├── background/service-worker.ts   # dict / word / mine (data URL→Blob) / stats / data:reset / anki / onInstalled
├── content/index.ts               # Pipeline complet : cues → normalisation → segmentation → kuromoji → states → overlay ; options live ; modal mining
├── adapters/                      # netflix.ts (L1), generic-html5.ts (fallback)
├── tokenizer/                     # kuromoji (loader fetch maison — PAS kuromoji.builder) + LRU 500 (+ test)
├── subtitles/                     # normalize.ts, segment.ts, parse.ts (SRT/VTT/ASS), index.ts (+ 20 tests) ← NOUVEAU
├── dictionary/
│   ├── index.ts + test.ts         # index mémoire (6 tests) ← test NOUVEAU
│   ├── jmdict.ts (+ test)         # fetch tgz + conversion + JMDICT_PACKS (common/full)
│   └── jmdict.test.ts             # 8 tests
├── overlay/                       # renderer.ts (importe DEFAULT_OPTIONS partagé), popover.ts, barrel
├── mining/                        # modal.ts (réécrit, branché), anki.ts, tts.ts, capture.ts, index.ts
├── onboarding/index.ts            # Logique onboarding (état, steps, skipAnki, markDictionaryLoaded)
├── popup/index.tsx                # stats + dict + bandeau onboarding
├── options/index.tsx + .html      # Wizard onboarding + panneau réglages (pack dict, Anki, affichage, données)
└── types/kuromoji.d.ts
public/dict/                       # 12 fichiers .dat.gz kuromoji (17 Mo)
scripts/verify-jmdict.mjs          # Validation du dict
```

## Ce qui reste à faire (hors MVP — M1/M2 de la spec)

### M1 (prochaine itération naturelle)
- Accent tonal (le modèle `PitchAccent` existe, non alimenté) ; raccourcis clavier complets (la spec prévoit `M` → modal). Le furigana s'affiche déjà (renderer flex).
- Statistiques de base + historique (la page Stats n'existe pas).
- Audio réel pour le mining : capture MediaRecorder ou branchement de `storeMediaFile` (le modèle « SubJap Basic » a déjà les champs `Audio`/`Picture` ; actuellement TTS de lecture + placeholder `tts://generated` ; le screenshot est bien stocké en Blob local, mais pas attaché à la note Anki).
- Sélecteur de deck dans les Options (aujourd'hui : préférence deck « SubJap » sinon premier deck). La création deck/modèle (handler `anki:setup`) est faite.

### M2
- Adaptateurs YouTube / Crunchyroll / Prime (L2) ; import de fichiers SRT/ASS locaux (les parseurs `subtitles/parse.ts` sont prêts — il manque l'UI d'import F9) ; export/import JSON ; i18n FR/EN.

### Tests à compléter
- Tokenizer kuromoji (le loader fetch maison est testable avec un mock de `fetch` + fixtures dict ; jusqu'ici non testé car nécessitait les fichiers hors navigateur).
- Handlers SW avec `fake-indexeddb` (dict:download, mine:create data URL→Blob, data:reset).
- Playwright avec fixtures DOM plateformes (netflix/generic).

### Dette restante
- `npm audit` : 5 vulns dev-only, upgrade cassant vite 8 — à réévaluer.
- `allow-scripts` bloque le postinstall d'esbuild (build OK quand même).
- 8 warnings lint `no-non-null-assertion` (règle en "warn" volontairement).

## Points d'attention (relire avant de coder)

- **kuromoji** : ne PAS repasser par `kuromoji.builder()` — son loader XHR par défaut pend silencieusement dans le content script (callback de build jamais appelé, aucune erreur). Le tokenizer pilote `DictionaryLoader` (import profond `kuromoji/src/loader/DictionaryLoader` + `kuromoji/src/Tokenizer`, types dans `src/types/kuromoji.d.ts`) avec un `loadArrayBuffer` maison en `fetch()` + `DecompressionStream("gzip")` (timeout 20 s/fichier, logs `[SubJap] tokenizer: ...`). `path-browserify` indispensable.
- **Réglages overlay** : source unique `src/core/options.ts` + clé `subjap_options`. Le content script applique via `overlay.setOptions()` + `applyNativeSubtitleVisibility()` sur `storage.onChanged`.
- **Blobs ≠ messaging** : jamais de Blob dans `sendMessage` — toujours base64 data URL, conversion côté SW (`dataUrlToBlob`).
- **Onboarding** : le SW ouvre la page Options au premier install ; `subjap_dictionary_loaded` posé par `dict:download`, retiré par `data:reset`/`resetOnboarding` ; `subjap_onboarding` n'est pas touché par `data:reset`.
- **AnkiConnect** : push best-effort depuis le modal — modèle résolu via `resolveAnkiModel()` (nom demandé → premier modèle Front/Back → création « SubJap Basic »), deck « SubJap » préféré sinon premier deck ; handler `anki:setup` (création deck + modèle, idempotent) branché sur un bouton des Options ; host_permissions `127.0.0.1:8765`. Le modèle « SubJap Basic » a les champs `Front`/`Back`/`Audio`/`Picture` — penser à eux pour le futur attachement média (`storeMediaFile`).
- **speechSynthesis** : foreground only — `tts:speak` du SW est un no-op documenté ; le modal appelle `speak()` directement.
- **SPA Netflix** : l'overlay ET le modal sont recréés si le `<video>` change.
- **Netflix : sous-titres = DOM, pas textTracks** — conteneur `.player-timedtext` observé par MutationObserver (debounce 60 ms) ; les timestamps viennent de `data-start`/`data-end` si présents sinon `currentTime` ; masquage des natifs par **classe sur `<html>`** (`subjap-hide-native-subs`) + règle CSS `!important` sur le conteneur et tous ses descendants (PAS de style inline : les enfants Netflix avec `visibility` propre l'emporteraient). Si Netflix change de classe, ajuster `NETFLIX_TIMEDTEXT_SELECTORS`/`NETFLIX_TIMEDTEXT_LINE_SELECTOR` dans `netflix.ts`.
- **Overlay** : monté sur `document.body` en `position: fixed` (z-index 2147483646) — ne PAS le remonter dans le player : son z-index y serait piégé dans le stacking context et une couche transparente du player avalerait hover/clic. Coordonnées = `getBoundingClientRect()` du `<video>` (RAF 200 ms).
- **Interaction hover** : survol d'un token → popover après 350 ms, fermeture après 200 ms de grâce, clic → épinglage. Logs `[SubJap] hover: ...` dans `content/index.ts` **temporaires — à retirer** une fois le comportement confirmé.
- **Pause** : l'overlay reste affiché en pause (choix délibéré pour la lecture) — ne pas « corriger » sans discussion.
- **jmdict v3.x** : `JMDICT_PACKS` contient des noms d'assets versionnés — à mettre à jour quand une release change ; `scripts/verify-jmdict.mjs` valide avant toute modif du convertisseur.
- **Test réel dans Chrome** : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → `Projects/subjap/dist` (reconstruire avec `npm run build`).

## Références

- Spec détaillée : `SPEC.md` (471 lignes, v0.2) — jalons §17, pipeline §7.3
- Types partagés : `src/core/types.ts` ; réglages : `src/core/options.ts`
- Sous-titres : `src/subtitles/` ; jmdict-simplified : `github.com/scriptin/jmdict-simplified`
- Outil de validation dict : `scripts/verify-jmdict.mjs`
