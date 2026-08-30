// ---------------------------------------------------------------------------
// SubJap — Content script: full learning pipeline
//
//   adapter → cues → tokenizer → dictionary → word states → overlay + popover
//
// Pipeline stages:
//   1. Register platform adapters (Netflix first, others as they land).
//   2. Subscribe to subtitle cues from the active adapter.
//   3. Tokenise each cue with Lindera + UniDic.
//   4. Cross-reference tokens with word states (via the service worker) and
//      dictionary glosses (in-memory, when the dictionary is loaded).
//   5. Render the annotated cue through the overlay; wire popover interactions
//      (click → definitions, mark known/unknown, mine to Anki).
// ---------------------------------------------------------------------------

import { NetflixAdapter } from "@/adapters/netflix";
import { adapterRegistry } from "@/core/adapters/registry";
import { onMessage, sendMessage } from "@/core/messaging";
import { getOptions, DEFAULT_OPTIONS } from "@/core/options";
import { lookup } from "@/dictionary";
import { lookupTokenDictionaryEntry } from "@/dictionary/token-lookup";
import { isAllKnownOrIgnored, isNonLexicalToken } from "@/core/frequency";
import { MiningModal, VideoAudioCapture } from "@/mining";
import { ListeningMode } from "./listening-mode";
import { OverlayRenderer, getPopover, showPopover, hidePopover } from "@/overlay";
import {
  markParentheticalTokens,
  normalizeCueText,
  splitIntoSentences,
} from "@/subtitles";
import { createTokenizer } from "@/tokenizer";
import { LRUCache } from "@/tokenizer/lru-cache";
import { groupTokens } from "@/tokenizer/group";
import {
  CueNavigator,
  installPausePlayShortcut,
  installPlaybackShortcuts,
  installSubtitleCopyShortcut,
  subtitleTextForClipboard,
} from "./shortcuts";
import {
  tokenCanonicalKey,
  tokenDictionaryForm,
  tokenStateLookupTerms,
} from "@/core/types";
import type {
  DictionaryEntry,
  EpisodeContext,
  OverlayOptions,
  PlatformAdapter,
  RenderedCue,
  SpanToken,
  SubtitleCue,
  SubtitleTranslation,
  Token,
  Tokenizer,
  WordState,
  WordStatus,
} from "@/core/types";

// ---------------------------------------------------------------------------
// 1. Platform adapters
// ---------------------------------------------------------------------------

adapterRegistry.register(new NetflixAdapter());

const adapter: PlatformAdapter = adapterRegistry.findActive(document, window.location.href);

const cueNavigator = new CueNavigator();
let cueNavigationSessionId: string | null = null;

console.log(`[SubJap] Platform: ${adapter.id}`);

// ---------------------------------------------------------------------------
// 2. State
// ---------------------------------------------------------------------------

let tokenizer: Tokenizer | null = null;
let tokenizerPromise: Promise<Tokenizer | null> | null = null;
let overlay: OverlayRenderer | null = null;
let currentVideo: HTMLVideoElement | null = null;
let audioCapture: VideoAudioCapture | null = null;
let listeningMode: ListeningMode | null = null;
const listeningExerciseKeys = new Set<string>();
let nativeSubtitlesHidden = false;
let nativeSubtitleReplacementReady = false;

// The action popup prepares tab capture after the user invokes the extension.
// Keeping the listener in the content script lets tab capture start from the
// extension action without requiring the mining modal to be open first.
onMessage("tabCapture:stream", async ({ streamId }) => {
  ensureOverlay();
  await audioCapture?.startTabCapture(streamId);
  return {};
});

// tabCapture mutes the source tab. The AudioContext that restores the sound
// may be created asynchronously after the popup closes, so Chrome can leave
// it suspended. Any real interaction in the Netflix tab is a valid media
// activation and lets us resume it without another SubJap button.
const resumeTabAudio = (): void => {
  audioCapture?.resume();
};
document.addEventListener("pointerdown", resumeTabAudio, true);
document.addEventListener("keydown", resumeTabAudio, true);

/** Effective overlay options (loaded from storage, live-updated). */
let overlayOptions: OverlayOptions = DEFAULT_OPTIONS;

/**
 * Apply the user's native-subtitles preference to the platform adapter.
 * Hides the native tracks when `hideNativeSubtitles` is on (the overlay
 * replaces them), restores them otherwise. Idempotent.
 */
function applyNativeSubtitleVisibility(): void {
  const shouldHideNative =
    overlayOptions.hideNativeSubtitles && nativeSubtitleReplacementReady;
  if (!shouldHideNative) {
    if (nativeSubtitlesHidden) {
      try {
        adapter.setNativeSubtitlesVisible(true);
      } catch (err) {
        console.warn("[SubJap] Failed to restore native subtitles:", err);
      }
      nativeSubtitlesHidden = false;
    }
    return;
  }
  if (nativeSubtitlesHidden) return;
  try {
    adapter.setNativeSubtitlesVisible(false);
  } catch (err) {
    console.warn("[SubJap] Failed to hide native subtitles:", err);
  }
  nativeSubtitlesHidden = true;
}

/** Signature of the latest accepted cue set — skips identical cuechange spam. */
let lastSignature = "";
/** Monotonic revision: only the newest cue pipeline may update the overlay. */
let cueRevision = 0;
let lastCues: SubtitleCue[] = [];

/** Last tokenized cues — used by interactions and the mining modal. */
let lastRenderedCues: RenderedCue[] = [];

/** Mining modal singleton (created on demand, destroyed on video swap). */
let miningModal: MiningModal | null = null;
/** Latest cue snapshot observed while the listening panel owns playback. */
let deferredCuesWhileListening: SubtitleCue[] | null = null;

/** Global token index → { cue, token } for the currently rendered cues. */
const spanRegistry = new Map<number, { cue: SubtitleCue; token: Token }>();

/** lemma → last resolved status (synchronous reads for the popover). */
const wordStatusByLemma = new LRUCache<string, WordStatus | null>(1_000);

/** Full word state used by the fast synchronous subtitle render. */
const wordStateByLemma = new LRUCache<string, WordState | null>(1_000);

/** lemma → number of matching notes from the latest successful Anki sync. */
const ankiNoteCountByLemma = new LRUCache<string, number>(1_000);

/** Cached frequency ranks avoid repeating IndexedDB reads for recurring words. */
const frequencyRankByTerm = new LRUCache<string, number | null>(2_000);

/** Cached learner vocabulary size used by the frequency colour bands. */
let knownWordCount = 0;
let knownWordCountPromise: Promise<number> | null = null;

// ---------------------------------------------------------------------------
// Hover interaction state (popover shown on hover, pinned on click)
// ---------------------------------------------------------------------------

/** Delay before the popover opens on hover (lets the pointer settle). */
const HOVER_OPEN_DELAY_MS = 350;
/** Grace period to move from a token onto the open popover. */
const HOVER_CLOSE_DELAY_MS = 200;

let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hoveredToken: { span: HTMLElement; token: Token } | null = null;
/** When true the popover was opened by a click and must stay until dismissed. */
let popoverPinned = false;

function clearHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function schedulePopoverHide(): void {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hoveredToken = null;
    if (!popoverPinned) hidePopover();
  }, HOVER_CLOSE_DELAY_MS);
}

// ---------------------------------------------------------------------------
// 3. Subtitle metadata lookups (batched and cached)
// ---------------------------------------------------------------------------

async function getWordStates(
  lookups: Array<{ key: string; aliases: string[] }>,
  revision: number,
): Promise<void> {
  const uniqueLookups = new Map<string, { key: string; aliases: string[] }>();
  for (const lookup of lookups) {
    if (!wordStateByLemma.has(lookup.key)) uniqueLookups.set(lookup.key, lookup);
  }
  const missing = [...uniqueLookups.values()];
  if (missing.length === 0) return;

  try {
    const result = await sendMessage("word:getBatch", { items: missing });
    if (revision !== cueRevision) return;
    for (const item of result.items) {
      wordStateByLemma.set(item.key, item.state);
      wordStatusByLemma.set(item.key, item.state?.status ?? null);
      ankiNoteCountByLemma.set(item.key, item.ankiNoteCount);
    }
  } catch (err: unknown) {
    console.warn("[SubJap] word:getBatch failed:", err);
    if (revision !== cueRevision) return;
    for (const { key } of missing) {
      wordStateByLemma.set(key, null);
      wordStatusByLemma.set(key, null);
      ankiNoteCountByLemma.set(key, 0);
    }
  }
}

function getKnownWordCount(): Promise<number> {
  if (knownWordCountPromise) return knownWordCountPromise;

  knownWordCountPromise = sendMessage("stats:get", {})
    .then((result) => {
      knownWordCount = Math.max(0, result.knownWords);
      return knownWordCount;
    })
    .catch((err: unknown) => {
      console.warn("[SubJap] stats:get failed:", err);
      return knownWordCount;
    });

  return knownWordCountPromise;
}

let lastAnkiSyncAt = 0;
let ankiSyncPromise: Promise<void> | null = null;

async function syncKnownWordsFromAnki(force = false): Promise<void> {
  if (!force && Date.now() - lastAnkiSyncAt < 30_000) return;
  if (ankiSyncPromise) return ankiSyncPromise;
  ankiSyncPromise = (async () => {
    lastAnkiSyncAt = Date.now();
    try {
      const result = await sendMessage("anki:syncKnown", {});
      if (
        result.changed === 0 &&
        result.removed === 0 &&
        result.presenceChanged === 0
      ) return;

      wordStateByLemma.clear();
      wordStatusByLemma.clear();
      ankiNoteCountByLemma.clear();
      knownWordCountPromise = null;
      lastSignature = "";
      if (lastCues.length > 0) enqueueCues(lastCues);
    } catch (err: unknown) {
      // Anki is optional; a missing AnkiConnect must not affect subtitle use.
      console.info("[SubJap] Anki known-word sync unavailable:", err);
    }
  })().finally(() => {
    ankiSyncPromise = null;
  });
  return ankiSyncPromise;
}

async function getFrequencyRanks(
  terms: string[],
): Promise<Record<string, number>> {
  const uniqueTerms = [...new Set(terms.filter(Boolean))];
  const missing = uniqueTerms.filter((term) => !frequencyRankByTerm.has(term));
  if (missing.length > 0) {
    try {
      const result = await sendMessage("frequency:batch", { terms: missing });
      for (const term of missing) {
        frequencyRankByTerm.set(term, result.ranks[term] ?? null);
      }
    } catch (err: unknown) {
      console.warn("[SubJap] frequency:batch failed:", err);
      for (const term of missing) frequencyRankByTerm.set(term, null);
    }
  }

  return Object.fromEntries(
    uniqueTerms.flatMap((term) => {
      const rank = frequencyRankByTerm.get(term);
      return rank == null ? [] : [[term, rank]];
    }),
  );
}

// ---------------------------------------------------------------------------
// 4. Overlay lifecycle
// ---------------------------------------------------------------------------

function ensureOverlay(): OverlayRenderer | null {
  const video = adapter.getVideoElement();
  if (!video) return null;

  // The video element can be swapped on SPA navigation (e.g. Netflix): tear
  // down the overlay mounted in the old player's parent and rebuild.
  if (overlay && currentVideo !== video) {
    listeningMode?.destroy();
    listeningMode = null;
    overlay.destroy();
    overlay = null;
    listeningExerciseKeys.clear();
    deferredCuesWhileListening = null;
    audioCapture?.destroy();
    audioCapture = null;
    currentVideo = null;
    cueNavigator.reset();
    miningModal?.destroy();
    miningModal = null;
    nativeSubtitleReplacementReady = false;
    applyNativeSubtitleVisibility();
    // Force the next cue set through the pipeline after a player swap.
    lastSignature = "";
  }

  if (!overlay) {
    overlay = new OverlayRenderer(video, overlayOptions);
    listeningMode = new ListeningMode(video, adapter, overlay, () => {
      const deferred = deferredCuesWhileListening;
      deferredCuesWhileListening = null;
      if (deferred !== null) enqueueCues(deferred);
    });
    audioCapture = new VideoAudioCapture(video, (timeSeconds, resume) =>
      adapter.seekTo(timeSeconds, resume),
    );
    currentVideo = video;
  }

  return overlay;
}

async function ensureTokenizerReady(): Promise<Tokenizer | null> {
  if (tokenizer) return tokenizer;
  if (!tokenizerPromise) {
    tokenizerPromise = createTokenizer()
      .then((readyTokenizer) => {
        tokenizer = readyTokenizer;
        return readyTokenizer;
      })
      .catch((err: unknown) => {
        console.error("[SubJap] Tokenizer failed to initialise:", err);
        return null;
      })
      .finally(() => {
        tokenizerPromise = null;
      });
  }
  return tokenizerPromise;
}

function cueSignature(cues: SubtitleCue[]): string {
  const sessionId = adapter.getNavigationSessionId?.() ?? "";
  return `${sessionId}\u0002${cues
    .map(
      (cue) =>
        `${cue.language ?? ""}\u0000${cue.id}\u0000${cue.start}\u0000${cue.end}\u0000${cue.endConfirmed ?? ""}\u0000${cue.text}`,
    )
    .join("\u0001")}`;
}

/** Start the newest cue immediately; older async work may finish but cannot commit. */
function enqueueCues(cues: SubtitleCue[]): void {
  // Seeking back to the beginning of an exercise can make Netflix emit a
  // transient empty/incomplete cue set. Keep the frozen exercise sentence
  // and its translation while the listening panel owns playback.
  if (listeningMode?.isActive) {
    deferredCuesWhileListening = cues;
    return;
  }

  const signature = cueSignature(cues);
  if (signature === lastSignature) return;
  lastSignature = signature;
  const revision = ++cueRevision;
  void handleCues(cues, revision).catch((err: unknown) => {
    if (revision === cueRevision) {
      console.error("[SubJap] Cue processing failed:", err);
    }
  });
}

// ---------------------------------------------------------------------------
// 5. Core pipeline: cues → rendered cues
// ---------------------------------------------------------------------------

async function handleCues(cues: SubtitleCue[], revision: number): Promise<void> {
  // Netflix can provide its complete official track even when this content
  // script was loaded in the middle of the current phrase. Seed navigation
  // before render deduplication so Q can still reach the unseen predecessor.
  rememberNavigationCues();
  lastCues = cues;

  const overlayInstance = ensureOverlay();
  if (!overlayInstance) {
    if (revision === cueRevision) lastSignature = "";
    console.log("[SubJap] render: skipped (no video yet)");
    return;
  }

  // ensureOverlay() can reset navigation after Netflix replaces <video>.
  // Re-seed the authoritative track immediately, including while paused when
  // no subsequent timeupdate would otherwise repair Q's history.
  rememberNavigationCues();

  const japaneseCues = cues.filter((cue) => isJapaneseTrack(cue.language));
  const translationCue = selectTranslationCue(cues);
  const translation: SubtitleTranslation | null = translationCue
    ? {
        text: normalizeCueText(translationCue.text),
        language: translationCue.language ?? "",
      }
    : null;

  // A new cue set is being committed: the previous spans are replaced, so any
  // popover anchored to them is stale. Close it (hover mode) or unpin it.
  popoverPinned = false;
  hidePopover();
  clearHoverTimer();
  hoveredToken = null;

  if (japaneseCues.length === 0) {
    overlayInstance.updateContent([], null, knownWordCount);
    overlayInstance.hide();
    spanRegistry.clear();
    lastRenderedCues = [];
    cueNavigator.observe([]);
    return;
  }

  // First paint is independent of WASM and IndexedDB. This replaces the old
  // subtitle immediately, then becomes interactive as soon as UniDic is ready.
  spanRegistry.clear();
  lastRenderedCues = [];
  overlayInstance.updatePendingContent(
    japaneseCues.map((cue) => normalizeCueText(cue.text)),
    translation,
    knownWordCount,
  );
  overlayInstance.show();
  cueNavigator.observe(japaneseCues);
  nativeSubtitleReplacementReady = true;
  applyNativeSubtitleVisibility();

  const readyTokenizer = await ensureTokenizerReady();
  if (!readyTokenizer || revision !== cueRevision) return;

  const tokenizedCues: Array<{ cue: SubtitleCue; tokens: Token[] }> = [];
  const allTokens: Token[] = [];

  for (const cue of japaneseCues) {
    // Normalize markup, then segment into sentence-sized chunks so the
    // tokenizer LRU cache hits across repeated sentences.
    const sentences = splitIntoSentences(normalizeCueText(cue.text));
    const cueTokens: Token[] = [];
    for (const sentence of sentences) {
      const tokens = groupTokens(readyTokenizer.tokenize(sentence));
      cueTokens.push(...tokens);
    }
    tokenizedCues.push({ cue, tokens: cueTokens });
    allTokens.push(...cueTokens);
  }

  const buildRenderedCues = (
    pending: boolean,
    frequencyRanks: Record<string, number> = {},
  ): {
    rendered: RenderedCue[];
    registry: Map<number, { cue: SubtitleCue; token: Token }>;
  } => {
    const registry = new Map<number, { cue: SubtitleCue; token: Token }>();
    const rendered: RenderedCue[] = [];
    let globalIndex = 0;

    for (const { cue, tokens } of tokenizedCues) {
      const parentheticalFlags = markParentheticalTokens(tokens);
      const spans: SpanToken[] = tokens.map((token, tokenIndex) => {
        const index = globalIndex++;
        registry.set(index, { cue, token });
        const lexicalKey = tokenCanonicalKey(token);
        return {
          index,
          token,
          wordState: wordStateByLemma.get(lexicalKey) ?? null,
          isPending: pending,
          isParenthetical: parentheticalFlags[tokenIndex],
          ankiNoteCount: ankiNoteCountByLemma.get(lexicalKey) ?? 0,
          frequencyRank:
            frequencyRanks[lexicalKey] ??
            frequencyRanks[tokenDictionaryForm(token)] ??
            frequencyRanks[token.surface],
        };
      });
      rendered.push({ cue, spans });
    }

    return { rendered, registry };
  };

  const commitRenderedCues = (
    rendered: RenderedCue[],
    registry: Map<number, { cue: SubtitleCue; token: Token }>,
    resolvedKnownWordCount: number,
  ): void => {
    spanRegistry.clear();
    for (const [index, entry] of registry) spanRegistry.set(index, entry);
    lastRenderedCues = rendered;
    overlayInstance.updateContent(rendered, translation, resolvedKnownWordCount);
    overlayInstance.show();
  };

  // UniDic is synchronous once warm, so interactive white tokens replace the
  // plain first paint without waiting for vocabulary metadata.
  const provisional = buildRenderedCues(true);
  commitRenderedCues(provisional.rendered, provisional.registry, knownWordCount);

  const frequencyTerms = [
    ...new Set(
      allTokens.flatMap((token) => [
        tokenCanonicalKey(token),
        tokenDictionaryForm(token),
        token.surface,
      ]),
    ),
  ];
  const wordLookups = allTokens.map((token) => ({
    key: tokenCanonicalKey(token),
    aliases: tokenStateLookupTerms(token),
  }));
  const [frequencyRanks, resolvedKnownWordCount] = await Promise.all([
    getFrequencyRanks(frequencyTerms),
    getKnownWordCount(),
    getWordStates(wordLookups, revision),
  ]);

  // Skip stale renders: a newer emission (e.g. an empty cue set that hid the
  // overlay) may have superseded this one while metadata was loading.
  if (revision !== cueRevision) return;

  const enriched = buildRenderedCues(false, frequencyRanks);
  commitRenderedCues(enriched.rendered, enriched.registry, resolvedKnownWordCount);
  maybeTriggerListeningMode(enriched.rendered);
  console.log(`[SubJap] render: shown ${enriched.rendered.length} cue(s)`);
}

function rememberNavigationCues(): boolean {
  const sessionId = adapter.getNavigationSessionId?.() ?? null;
  const changed =
    sessionId !== null &&
    cueNavigationSessionId !== null &&
    sessionId !== cueNavigationSessionId;
  if (changed) cueNavigator.reset();
  if (sessionId !== null) cueNavigationSessionId = sessionId;
  cueNavigator.remember(adapter.getNavigationCues?.() ?? []);
  return changed;
}

function isJapaneseTrack(language: string | undefined): boolean {
  return /^ja(?:[-_]|$)/i.test(language ?? "");
}

function selectTranslationCue(cues: SubtitleCue[]): SubtitleCue | null {
  return (
    cues.find((cue) => cue.language === "local") ??
    cues.find((cue) => /^fr(?:[-_]|$)/i.test(cue.language ?? "")) ??
    cues.find((cue) => /^en(?:[-_]|$)/i.test(cue.language ?? "")) ??
    null
  );
}

function hasPos(token: Token, ...parts: string[]): boolean {
  return parts.some(
    (part) =>
      token.partOfSpeech.includes(part) ||
      token.partOfSpeechDetails?.includes(part) === true,
  );
}

function isRepeatedSyllableText(text: string): boolean {
  const units = Array.from(text.trim());
  if (units.length < 4 || units.length % 2 !== 0) return false;
  const middle = units.length / 2;
  return units.slice(0, middle).join("") === units.slice(middle).join("");
}

/** Conservative structural exclusions for the audio-first exercise. */
function isInterestingListeningCue(rendered: RenderedCue): boolean {
  const lexical = rendered.spans.filter(
    (span) => !span.isParenthetical && !isNonLexicalToken(span.token),
  );
  if (lexical.length < 3) return false;

  // Skip isolated interjections/adverbs such as えっ, ああ or もう一度.
  if (
    lexical.every(
      (span) => hasPos(span.token, "感動詞") || hasPos(span.token, "副詞"),
    )
  ) {
    return false;
  }

  // Repeated kana/katakana forms are a useful but noisy first approximation
  // for sound effects and onomatopoeia. Keep this deliberately conservative.
  if (
    lexical.length <= 2 &&
    lexical.some((span) => isRepeatedSyllableText(span.token.surface)) &&
    lexical.every(
      (span) => !hasPos(span.token, "動詞", "形容詞", "助詞", "助動詞"),
    )
  ) {
    return false;
  }

  // A block made only of proper names is usually a character/location label,
  // not useful listening practice.
  if (
    lexical.every(
      (span) =>
        hasPos(span.token, "固有名詞") ||
        span.token.partOfSpeechDetails?.some((detail) => detail.includes("固有名詞")) ===
          true,
    )
  ) {
    return false;
  }

  return true;
}

function maybeTriggerListeningMode(rendered: RenderedCue[]): void {
  if (!overlayOptions.activeListeningMode) return;
  if (!listeningMode || listeningMode.isActive) return;
  if (adapter.isPaused()) return;

  // A multi-line active block is deliberately left alone for now: it is not
  // possible to identify one clean exercise phrase without a larger cue model.
  if (rendered.length !== 1) return;
  const candidate = rendered[0];
  if (!candidate || candidate.cue.endConfirmed === false) return;
  if (!isAllKnownOrIgnored(candidate.spans)) return;
  if (!isInterestingListeningCue(candidate)) return;

  const key = `${candidate.cue.id}\u0000${candidate.cue.start}\u0000${candidate.cue.end}`;
  if (listeningExerciseKeys.has(key)) return;
  listeningExerciseKeys.add(key);
  listeningMode.open(candidate);
}

// ---------------------------------------------------------------------------
// 6. Interactions: popover (click), mining, known/unknown toggling
// ---------------------------------------------------------------------------

function onOverlayClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const span = target?.closest(".subjap-token") as HTMLElement | null;
  if (!span) return;
  if (span.dataset.parenthetical === "true") return;

  const indexStr = span.dataset.index;
  if (indexStr == null) return;

  const entry = spanRegistry.get(Number(indexStr));
  if (!entry) return;

  // A click pins the popover open (hover hides it automatically otherwise).
  popoverPinned = true;
  void showPopoverForToken(span, entry.token);
}

/**
 * Hover handler: open the popover after a short delay so a quick pass over the
 * text does not spam lookups. Re-showing for the same token is a no-op.
 */
function onOverlayMouseOver(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const span = target?.closest(".subjap-token") as HTMLElement | null;

  // Entering the popover itself cancels any pending hide.
  if (!span) {
    if (target?.closest("#subjap-popover")) clearHideTimer();
    return;
  }
  if (span.dataset.parenthetical === "true") return;

  clearHoverTimer();
  clearHideTimer();
  hoveredToken = null;

  const indexStr = span.dataset.index;
  if (indexStr == null) return;

  const entry = spanRegistry.get(Number(indexStr));
  if (!entry) return;

  console.log("[SubJap] hover: enter token", indexStr);
  hoveredToken = { span, token: entry.token };
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (!hoveredToken) return;
    // Hover shows the popover in ephemeral (non-pinned) mode.
    popoverPinned = false;
    console.log("[SubJap] hover: opening popover for", hoveredToken.token.surface);
    void showPopoverForToken(hoveredToken.span, hoveredToken.token);
  }, HOVER_OPEN_DELAY_MS);
}

/**
 * Mouse-out handler: hide the popover when the pointer leaves a token (or the
 * popover) without landing on another token or on the popover itself.
 */
function onOverlayMouseOut(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const related = event.relatedTarget as Node | null;

  const leavingToken = target?.closest?.(".subjap-token");
  const leavingPopover = target?.closest?.("#subjap-popover");
  if (!leavingToken && !leavingPopover) return;

  // Pointer moved onto another token or onto the popover: keep it open.
  if (related instanceof Element) {
    if (related.closest(".subjap-token")) return;
    if (related.closest("#subjap-popover")) return;
  }

  clearHoverTimer();
  schedulePopoverHide();
}

/**
 * Show the popover for a clicked token. Prefers the in-memory dictionary
 * (when loaded); otherwise falls back to a dict:lookup round-trip through
 * the service worker.
 */
async function showPopoverForToken(anchor: HTMLElement, token: Token): Promise<void> {
  let dictEntry: DictionaryEntry | null = null;
  try {
    dictEntry = await lookupTokenDictionaryEntry(
      token,
      lookup,
      async (term) => (await sendMessage("dict:lookup", { lemma: term })).entry,
    );
  } catch (err: unknown) {
    console.warn(`[SubJap] dict:lookup failed for "${tokenDictionaryForm(token)}":`, err);
  }

  // The lookup is async: the cue may have been re-rendered (anchor gone) or
  // the pointer may have moved to another token while we awaited. Don't show
  // a popover anchored to a stale span.
  if (!anchor.isConnected) return;
  if (hoveredToken && hoveredToken.token !== token) return;

  const renderedSpan = lastRenderedCues
    .flatMap((cue) => cue.spans)
    .find((span) => span.token === token);
  showPopover({
    anchor,
    token,
    entry: dictEntry,
    wordStatus: wordStatusByLemma.get(tokenCanonicalKey(token)) ?? null,
    frequencyRank: renderedSpan?.frequencyRank,
    ankiNoteCount: renderedSpan?.ankiNoteCount ?? 0,
  });
}

async function isMiningCaptureActive(): Promise<boolean> {
  try {
    return (await sendMessage("tabCapture:status", {})).active;
  } catch {
    return false;
  }
}

function showMiningCaptureWarning(): void {
  const warning = document.createElement("div");
  warning.id = "subjap-mining-capture-warning";
  warning.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:16px",
    "box-sizing:border-box",
    "background:rgba(15,23,42,.72)",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
  ].join(";");
  warning.innerHTML = `
    <div style="max-width:420px;padding:24px;border:1px solid #475569;border-radius:14px;background:#1e293b;color:#f8fafc;box-shadow:0 20px 60px rgba(0,0,0,.45)">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Enregistrement audio désactivé</div>
      <div style="line-height:1.5;color:#cbd5e1">
        Active d’abord « Audio Netflix » depuis le popup SubJap pour pouvoir miner une phrase avec son audio.
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:20px">
        <button data-action="close" style="padding:9px 14px;border:0;border-radius:8px;background:#64748b;color:#f8fafc;font-weight:700;cursor:pointer">Fermer</button>
      </div>
    </div>
  `;
  warning.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener("click", () => {
    warning.remove();
  });
  document.body.appendChild(warning);
}

async function ensureMiningCaptureReady(): Promise<boolean> {
  if (await isMiningCaptureActive()) return true;
  showMiningCaptureWarning();
  return false;
}

/**
 * Open the mining modal for a token: shows the sentence, reading, definitions,
 * and lets the user generate audio/screenshot before pushing the card.
 */
async function openMiningModal(token: Token, entry: DictionaryEntry | null): Promise<void> {
  const video = adapter.getVideoElement();
  if (!video) return;

  // Locate the rendered cue that introduced this token (last match wins).
  const rendered = lastRenderedCues.find((rc) => rc.spans.some((st) => st.token === token));
  const targetSpan = rendered?.spans.find((st) => st.token === token);
  if (!rendered || !targetSpan) return;

  // Do not start mining without an active tab capture. The warning explains
  // how to enable it and is dismissed explicitly by the user.
  if (!(await ensureMiningCaptureReady())) return;

  // Opening the mining flow is a user gesture. Start capture only when it is
  // actually needed, then use the gesture to unlock the audio context.
  audioCapture?.start();
  audioCapture?.resume();

  const source: EpisodeContext = adapter.getEpisodeContext() ?? {
    platform: adapter.id,
    title: document.title || "Unknown",
    language: "ja",
    url: window.location.href,
  };

  miningModal?.destroy();
  miningModal = new MiningModal(video, audioCapture);
  miningModal.open({
    cue: rendered,
    targetToken: targetSpan,
    lemmaReading: entry?.reading || targetSpan.token.reading,
    translation: normalizeCueText(selectTranslationCue(lastCues)?.text ?? ""),
    episodeContext: source,
    definitions: entry?.senses.flatMap((sense) => sense.glosses) ?? [],
  });
}

function onToggleKnown(lemma: string, currentStatus: WordStatus | null): void {
  const next: WordState = {
    key: lemma,
    status: currentStatus === "known" ? "unknown" : "known",
    source: "manual",
    knownAt: currentStatus === "known" ? undefined : Date.now(),
  };

  void sendMessage("word:set", next)
    .catch((err) => {
      console.warn(`[SubJap] word:set failed for "${lemma}":`, err);
    })
    .finally(() => {
      knownWordCountPromise = null;
      lastSignature = "";
      enqueueCues(lastCues);
    });

  wordStatusByLemma.set(lemma, next.status);
  wordStateByLemma.set(lemma, next);
  lastSignature = "";
  enqueueCues(lastCues);

  // Re-render immediately so known/unknown/frequency colours update. The
  // persisted count is refreshed after the write completes.
}

function onToggleIgnored(
  lemma: string,
  currentStatus: WordStatus | null,
): void {
  const next: WordState = {
    key: lemma,
    status: currentStatus === "ignored" ? "unknown" : "ignored",
    source: "manual",
  };

  void sendMessage("word:set", next)
    .catch((err) => {
      console.warn(`[SubJap] word:set failed for "${lemma}":`, err);
    })
    .finally(() => {
      knownWordCountPromise = null;
      lastSignature = "";
      enqueueCues(lastCues);
    });

  wordStatusByLemma.set(lemma, next.status);
  wordStateByLemma.set(lemma, next);
  lastSignature = "";
  enqueueCues(lastCues);
}

// ---------------------------------------------------------------------------
// 7. Boot
// ---------------------------------------------------------------------------

// Load the effective overlay options and keep them in sync when the user
// changes settings from the options page.
void getOptions().then((opts) => {
  overlayOptions = opts;
  console.log("[SubJap] options:", opts);
  // Keep Netflix's subtitle visible until SubJap has painted its replacement.
  applyNativeSubtitleVisibility();
});

// Warm UniDic while Netflix is mounting so ordinary cues can become
// interactive synchronously after their immediate plain-text first paint.
void ensureTokenizerReady();

void syncKnownWordsFromAnki(true);
window.setInterval(() => void syncKnownWordsFromAnki(), 120_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncKnownWordsFromAnki();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes["subjap_options"];
  if (!change) return;

  void getOptions().then((opts) => {
    overlayOptions = opts;
    overlay?.setOptions(opts);
    applyNativeSubtitleVisibility();
  });
});

// Subscribe to subtitle cues from the active adapter.
adapter.subscribeCues((cues) => {
  enqueueCues(cues);
});

// Create the popover singleton (mounted on document.body).
getPopover({
  onToggleKnown,
  onToggleIgnored,
  onMine: (token, entry) => {
    void openMiningModal(token, entry);
  },
});

const removePlaybackShortcuts = installPlaybackShortcuts(document, adapter, cueNavigator);
const removePausePlayShortcut = installPausePlayShortcut(document, adapter);
const removeSubtitleCopyShortcut = installSubtitleCopyShortcut(document, {
  getText: () => {
    const renderedCues = lastRenderedCues.map((rendered) => rendered.cue);
    return subtitleTextForClipboard(
      renderedCues.length > 0
        ? renderedCues
        : lastCues.filter((cue) => isJapaneseTrack(cue.language)),
    );
  },
});
window.addEventListener(
  "pagehide",
  () => {
    removePlaybackShortcuts();
    removePausePlayShortcut();
    removeSubtitleCopyShortcut();
    document.removeEventListener("pointerdown", resumeTabAudio, true);
    document.removeEventListener("keydown", resumeTabAudio, true);
    audioCapture?.destroy();
    audioCapture = null;
  },
  { once: true },
);

// Click delegation (capture phase — the overlay container may be rebuilt).
document.addEventListener("click", onOverlayClick, true);

// Hover delegation: show the popover while the pointer rests on a token.
document.addEventListener("mouseover", onOverlayMouseOver, true);
document.addEventListener("mouseout", onOverlayMouseOut, true);

// A mousedown anywhere outside a token and the popover unpins the popover
// (the popover's own outside-click handler closes it).
document.addEventListener(
  "mousedown",
  (e) => {
    const t = e.target as Node | null;
    if (t instanceof Element) {
      if (t.closest(".subjap-token")) return;
      if (t.closest("#subjap-popover")) return;
    }
    popoverPinned = false;
  },
  true,
);
