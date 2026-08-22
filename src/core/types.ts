// ---------------------------------------------------------------------------
// SubJap — Types partagés (source unique de la spec §7.4, §8, §9)
// ---------------------------------------------------------------------------

// ── Plateformes ───────────────────────────────────────────────────────────

export type PlatformId =
  "netflix" | "youtube" | "crunchyroll" | "primevideo" | "disneyplus" | "generic-html5";

export interface SubtitleCue {
  id: string;
  start: number; // secondes
  end: number; // secondes
  /** False while a DOM-only platform has not observed the cue disappear yet. */
  endConfirmed?: boolean;
  text: string; // texte brut (kana/kanji)
  language?: string;
}

export interface SubtitleTranslation {
  text: string;
  language: string;
}

export interface EpisodeContext {
  platform: PlatformId;
  title: string;
  season?: string;
  episode?: string;
  language: string; // "ja" attendu
  url: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  isActive(doc: Document, url: string): boolean;
  getVideoElement(): HTMLVideoElement | null;
  subscribeCues(cb: (cues: SubtitleCue[]) => void): () => void;
  getCurrentTime(): number;
  isPaused(): boolean;
  getPlaybackRate(): number;
  /** Complete timed cues available for navigation, without rendering them all. */
  getNavigationCues?(): SubtitleCue[];
  seekTo(timeSeconds: number, resume: boolean): Promise<boolean>;
  setNativeSubtitlesVisible(v: boolean): void;
  getEpisodeContext(): EpisodeContext | null;
  destroy(): void;
}

// ── Tokeniseur ────────────────────────────────────────────────────────────

export interface Token {
  surface: string; // forme à l'écran (ex. 食べて)
  lemma: string; // forme de dictionnaire (食べる)
  reading: string; // lecture en kana
  partOfSpeech: string[];
  /** Kuromoji POS details such as 自立, 非自立 or 接尾. */
  partOfSpeechDetails?: string[];
  /** Kuromoji conjugation metadata, when the token is inflected. */
  conjugationType?: string;
  conjugationForm?: string;
  /** Morphological tokens represented by one pedagogical display unit. */
  components?: Token[];
}

export interface Tokenizer {
  tokenize(sentence: string): Token[];
}

// ── Dictionnaire ──────────────────────────────────────────────────────────

export interface DictionaryEntry {
  headword: string;
  reading: string;
  /** Alternative JMdict spellings indexed for exact lookup. */
  aliases?: string[];
  partOfSpeech: string[];
  senses: { glosses: string[]; tags?: string[] }[];
  frequencyRank?: number;
  common: boolean;
}

export interface PitchAccent {
  pattern: string; // "0" | "1" | "2" | …
  moraCount: number;
  downstepIndex?: number; // 0 = 平板
}

// ── Modèle de données (IndexedDB) ─────────────────────────────────────────

export type WordStatus = "known" | "unknown" | "learning" | "ignored";

export interface WordState {
  key: string; // lemme (ex. 食べる)
  status: WordStatus;
  knownAt?: number;
  source: "manual" | "frequency-list" | "import";
}

export interface AnkiWordPresence {
  key: string; // lemme normalisé depuis le champ Anki `Mot`
  noteCount: number;
}

export interface MineCard {
  id: string; // uuid
  createdAt: number;
  sentence: string;
  sentenceReading?: string;
  targetWord: string; // lemme cible
  targetSurface?: string;
  targetReading?: string;
  definitions: string[];
  pitchAccent?: PitchAccent;
  audio?: Blob;
  screenshot?: Blob;
  source: EpisodeContext;
  cueStart: number;
  cueEnd: number;
  srs: SrsState;
  ankiNoteId?: number;
  tags: string[];
}

export interface SrsState {
  state: "new" | "learning" | "review" | "relearning" | "suspended";
  intervalDays: number;
  ease: number; // 1.3 – 2.5, défaut 2.5
  due: number; // epoch ms
  reps: number;
  lapses: number;
  lastReview?: number;
}

/**
 * Payload for `mine:create`. Blobs cannot cross the extension messaging bus,
 * so audio/screenshot travel as base64 data URLs and are converted back to
 * Blobs by the service worker before IndexedDB storage.
 */
export interface CreateMineCardPayload extends Omit<
  MineCard,
  "id" | "createdAt" | "screenshot" | "audio"
> {
  screenshotDataUrl?: string;
  audioDataUrl?: string;
}

// ── Messaging (MV3) ───────────────────────────────────────────────────────

export type MessageHandler<T = unknown, R = unknown> = (
  payload: T,
  sender: chrome.runtime.MessageSender,
) => R | Promise<R>;

export interface MessageMap {
  // Dict lookups
  "dict:lookup": { lemma: string };
  "dict:lookupResult": { entry: DictionaryEntry | null };
  "dict:status": Record<string, never>;
  "dict:statusResult": { count: number; installed: boolean };
  "dict:download": { url?: string };
  "dict:downloadResult": { count: number };

  // Netflix official timed-text retrieval. The service worker performs the
  // request outside the page context so page-level blockers cannot replace it.
  "netflix:timedTextFetch": { url: string; language: string };
  "netflix:timedTextFetchResult": { url: string; language: string; body: string };

  // Word state
  "word:get": { key: string };
  "word:getResult": { state: WordState | null; ankiNoteCount: number };
  "word:set": WordState;
  "word:batch": WordState[];

  // Frequency ranks
  "frequency:batch": { terms: string[] };
  "frequency:batchResult": { ranks: Record<string, number> };

  // Mining
  "mine:create": CreateMineCardPayload;
  "mine:createResult": { id: string };
  "screenshot:capture": Record<string, never>;
  "screenshot:captureResult": { dataUrl: string };

  // Rendered tab media capture (used for DRM-backed video/audio).
  "tabCapture:streamId": Record<string, never>;
  "tabCapture:streamIdResult": { streamId: string };
  "tabCapture:prepare": { tabId: number };
  "tabCapture:prepareResult": { ready: boolean };
  "tabCapture:stream": { streamId: string };
  "tabCapture:streamResult": Record<string, never>;
  "tabCapture:offscreen": { streamId: string };
  "tabCapture:offscreenResult": { ready: boolean };
  "tabCapture:offscreenStream": { streamId: string };
  "tabCapture:offscreenStreamResult": Record<string, never>;
  "tabCapture:phraseStart": Record<string, never>;
  "tabCapture:phraseStartResult": { ready: boolean };
  "tabCapture:phraseStop": Record<string, never>;
  "tabCapture:phraseStopResult": { dataUrl: string | null };
  "tabCapture:offscreenPhraseStart": Record<string, never>;
  "tabCapture:offscreenPhraseStartResult": { ready: boolean };
  "tabCapture:offscreenPhraseStop": Record<string, never>;
  "tabCapture:offscreenPhraseStopResult": { dataUrl: string | null };

  // Stats
  "stats:get": Record<string, never>;
  "stats:getResult": {
    knownWords: number;
    totalCards: number;
    cardsDue: number;
  };

  // Data management
  "data:reset": Record<string, never>;
  "data:resetResult": void;

  // TTS
  "tts:speak": { text: string };
  "tts:speakResult": void;
  "tts:generate": { text: string };
  "tts:generateResult": { dataUrl: string };

  // AnkiConnect
  "anki:status": Record<string, never>;
  "anki:statusResult": { connected: boolean; deckNames: string[] };
  "anki:syncKnown": Record<string, never>;
  "anki:syncKnownResult": {
    imported: number;
    removed: number;
    changed: number;
    presenceChanged: number;
  };
  "anki:addNote": {
    deckName: string;
    fields: Record<string, string>;
    audioMotDataUrl?: string;
    audioPhraseDataUrl?: string;
    imageDataUrl?: string;
    tags?: string[];
  };
  "anki:addNoteResult": { noteId: number; modelName: string; deckName: string };
  "anki:setup": Record<string, never>;
  "anki:setupResult": { deckName: string; modelName: string };
  "anki:dueCount": Record<string, never>;
  "anki:dueCountResult": { count: number };
}

export type MessageType = keyof MessageMap;
export type MessagePayload<T extends MessageType> = MessageMap[T];
export type MessageResult<T extends MessageType> = T extends keyof MessageMap
  ? T extends `${string}Result`
    ? never
    : `${T}Result` extends keyof MessageMap
      ? MessageMap[`${T}Result`]
      : void
  : void;

// ── UI ────────────────────────────────────────────────────────────────────

export interface SpanToken {
  index: number;
  token: Token;
  wordState: WordState | null;
  /** True when the token belongs to a complete parenthetical expression. */
  isParenthetical?: boolean;
  /** Number of existing Anki notes whose normalized `Mot` matches the lemma. */
  ankiNoteCount?: number;
  /** Rank in the subtitle frequency list (1 = most frequent). */
  frequencyRank?: number;
}

export interface RenderedCue {
  cue: SubtitleCue;
  spans: SpanToken[];
}

export interface OverlayOptions {
  fontSize: number;
  fontFamily: string;
  showFurigana: boolean;
  /** Legacy option name; controls highlighting of frequency-relevant unknowns. */
  highlightKnown: boolean;
  /** Colour for unknown words within the learner's known-vocabulary rank. */
  knownColor: string;
  /** Hide the platform's native subtitle tracks (the overlay replaces them). */
  hideNativeSubtitles: boolean;
}
