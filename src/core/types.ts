// ---------------------------------------------------------------------------
// SubJap — Types partagés (source unique de la spec §7.4, §8, §9)
// ---------------------------------------------------------------------------

// ── Plateformes ───────────────────────────────────────────────────────────

export type PlatformId =
  | "netflix"
  | "youtube"
  | "crunchyroll"
  | "primevideo"
  | "disneyplus"
  | "generic-html5";

export interface SubtitleCue {
  id: string;
  start: number; // secondes
  end: number; // secondes
  text: string; // texte brut (kana/kanji)
  language?: string;
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
  getPlaybackRate(): number;
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

export interface WordState {
  key: string; // lemme (ex. 食べる)
  status: "known" | "unknown";
  knownAt?: number;
  source: "manual" | "frequency-list" | "import";
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
export interface CreateMineCardPayload
  extends Omit<MineCard, "id" | "createdAt" | "screenshot" | "audio"> {
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

  // Word state
  "word:get": { key: string };
  "word:getResult": { state: WordState | null };
  "word:set": WordState;
  "word:batch": WordState[];

  // Frequency ranks
  "frequency:batch": { terms: string[] };
  "frequency:batchResult": { ranks: Record<string, number> };

  // Mining
  "mine:create": CreateMineCardPayload;
  "mine:createResult": { id: string };

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

  // AnkiConnect
  "anki:status": Record<string, never>;
  "anki:statusResult": { connected: boolean; deckNames: string[] };
  "anki:addNote": { deckName: string; modelName: string; fields: Record<string, string>; audioUrl?: string; screenshotUrl?: string };
  "anki:addNoteResult": { noteId: number; modelName: string };
  "anki:setup": Record<string, never>;
  "anki:setupResult": { deckName: string; modelName: string };
  "anki:dueCount": Record<string, never>;
  "anki:dueCountResult": { count: number };
}

export type MessageType = keyof MessageMap;
export type MessagePayload<T extends MessageType> = MessageMap[T];
export type MessageResult<T extends MessageType> =
  T extends keyof MessageMap
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
  /** Hide the platform's native Japanese subtitle track (the overlay replaces it). */
  hideNativeSubtitles: boolean;
}
