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
import { YouTubeAdapter } from "@/adapters/youtube";
import { forgetVideoSurface, mountVideoSurface } from "@/overlay/mount";
import { adapterRegistry, GENERIC_HTML5_ADAPTER } from "@/core/adapters/registry";
import { onMessage, sendMessage } from "@/core/messaging";
import { getOptions, DEFAULT_OPTIONS } from "@/core/options";
import { ENABLED_STORAGE_KEY, isEnabledValue, isSubJapEnabled } from "@/core/enabled";
import { lookupCandidates } from "@/dictionary";
import { dictionaryCompoundLookupTerms, mergeDictionaryCompounds } from "@/dictionary/compound";
import { DICTIONARY_REVISION_STORAGE_KEY } from "@/dictionary/revision";
import { dictionaryReadingForToken } from "@/dictionary/match";
import { lookupTokenDictionaryEntry } from "@/dictionary/token-lookup";
import {
  effectiveWordState,
  isDefaultIgnoredToken,
} from "@/core/frequency";
import { MiningModal, VideoAudioCapture } from "@/mining";
import { OverlayRenderer, getPopover, showPopover, hidePopover } from "@/overlay";
import {
  markParentheticalTokens,
  normalizeCueText,
  getLocalSubtitle,
  parseSubtitleFile,
  removeLocalSubtitle,
  saveLocalSubtitle,
} from "@/subtitles";
import {
  declineJimaku,
  getJimakuApiKey,
  isJimakuDeclined,
  JIMAKU_API_KEY_STORAGE_KEY,
  type JimakuInstallResult,
} from "@/subtitles/jimaku";
import { VideoNotice, type VideoNoticeAction } from "@/overlay/video-notice";
import {
  estimateTranslationShift,
  onLocalSubtitleAutoSync,
  type AutoSyncEvent,
} from "@/subtitles/auto-sync";
import type { SyncSegment } from "@/subtitles/local-storage";
import { compactSubtitleText, primarySubtitleCue, subtitleCueKey } from "@/subtitles/timeline";
import { createTokenizer } from "@/tokenizer";
import { LRUCache } from "@/tokenizer/lru-cache";
import { tokenizeCue } from "@/tokenizer/cue";
import { registerPlexLatinFont } from "@/ui/plex-latin";
import {
  CueNavigator,
  installPlaybackShortcuts,
  installSecondarySubtitleRevealShortcut,
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

// Keep platform bridges scoped to their site. Other sites and embedded frames
// use the generic HTML5 adapter, which renders imported local subtitle tracks
// and the tracks offered by Artplayer.
const isTopFrame = window.top === window;
if (isTopFrame && /(^|\.)youtube\.com$/i.test(location.hostname)) {
  adapterRegistry.register(new YouTubeAdapter());
} else if (isTopFrame && /(^|\.)netflix\.com$/i.test(location.hostname)) {
  adapterRegistry.register(new NetflixAdapter());
} else {
  adapterRegistry.register(GENERIC_HTML5_ADAPTER);
}

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
let nativeSubtitlesHidden = false;
let nativeSubtitleReplacementReady = false;
let runtimeUnavailable = false;
/** Global on/off switch: while off, SubJap leaves the page untouched. */
let enabled = false;

function isExtensionContextInvalidated(error: unknown): boolean {
  return /extension context invalidated/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

/** A reloaded extension cannot reconnect an already injected content script. */
function handleRuntimeError(error: unknown): void {
  if (!isExtensionContextInvalidated(error) || runtimeUnavailable) return;
  runtimeUnavailable = true;
  clearHoverTimer();
  clearHideTimer();
  hoveredToken = null;
  popoverPinned = false;
  hidePopover();
  overlay?.setRuntimeUnavailable(true);
}

// The action popup prepares tab capture after the user invokes the extension.
// Keeping the listener in the content script lets tab capture start from the
// extension action without requiring the mining modal to be open first.
// The popup asks every frame whether it shows a video. Only such a frame
// answers, so the first answer is the right one.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: unknown } | null)?.type !== "video:probe") return;
  const visible = Array.from(document.querySelectorAll("video")).some((video) => {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  });
  if (visible) sendResponse({ hasVideo: true });
});

// The popup asks which frame plays a video without Japanese subtitles. Only
// that frame answers, so the popup never mixes up an ad frame's answer.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: unknown } | null)?.type !== "subtitles:status" || !enabled) return;
  const status = adapter.getJapaneseSubtitleStatus?.();
  if (status?.availability === "missing") sendResponse({ missing: true, player: status.player });
});

onMessage("tabCapture:stream", async ({ streamId }) => {
  if (!enabled) return {};
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
 * Hide the platform's native subtitle tracks while the overlay replaces them,
 * restore them otherwise. Idempotent.
 */
function applyNativeSubtitleVisibility(): void {
  if (!nativeSubtitleReplacementReady) {
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
/**
 * Last translation shown with Japanese cues, and those cues by key with the
 * playback time they were last shown at.
 */
let pairedTranslation: {
  cue: SubtitleCue;
  japaneseCues: Map<string, { cue: SubtitleCue; lastSeen: number }>;
} | null = null;
/** Share of a translation covered by its Japanese cues that makes it their counterpart. */
const TRANSLATION_COUNTERPART_COVERAGE = 0.5;
/** How long after its Japanese line a translation may start and still appear with it. */
const TRANSLATION_ANTICIPATION_SECONDS = 1;
/** Wait before showing a translation alone when only DOM history is known. */
const TRANSLATION_ALONE_DOM_DELAY_MS = 300;
/** Longest wait for vocabulary metadata before a neutral (white) first paint. */
const FIRST_PAINT_WAIT_MS = 150;
/** Upcoming Japanese lines whose vocabulary is loaded before they are shown. */
const PREFETCH_CUE_COUNT = 5;

/** Last tokenized cues — used by interactions and the mining modal. */
let lastRenderedCues: RenderedCue[] = [];

/** Mining modal singleton (created on demand, destroyed on video swap). */
let miningModal: MiningModal | null = null;

/** Global token index → { cue, token } for the currently rendered cues. */
const spanRegistry = new Map<number, { cue: SubtitleCue; token: Token }>();

/** lemma → last resolved status (synchronous reads for the popover). */

/** Full word state used by the fast synchronous subtitle render. */
const wordStateByLemma = new LRUCache<string, WordState | null>(1_000);

/** lemma → number of matching notes from the latest successful Anki sync. */
const ankiNoteCountByLemma = new LRUCache<string, number>(1_000);

/** lemma → aliases already resolved into the caches above. */
const queriedAliasesByLemma = new LRUCache<string, Set<string>>(1_000);

/** Cached frequency ranks avoid repeating IndexedDB reads for recurring words. */
const frequencyRankByTerm = new LRUCache<string, number | null>(2_000);

/** Successful compound matches are reused when subtitle cues repeat. */
const dictionaryCompoundByTerm = new LRUCache<string, DictionaryEntry[]>(1_000);
const DICTIONARY_COMPOUND_LOOKUP_BATCH_SIZE = 512;

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
  // Every spelling of a lexeme (すごい, 凄い, スゴイ) shares the lemma's state,
  // so resolve the union of their aliases rather than whichever came last.
  const aliasesByLemma = new Map<string, Set<string>>();
  for (const { key, aliases } of lookups) {
    const queried = queriedAliasesByLemma.get(key);
    if (wordStateByLemma.has(key) && aliases.every((alias) => queried?.has(alias))) continue;
    const union = aliasesByLemma.get(key) ?? new Set(queried);
    for (const alias of aliases) union.add(alias);
    aliasesByLemma.set(key, union);
  }
  const missing = [...aliasesByLemma].map(([key, aliases]) => ({ key, aliases: [...aliases] }));
  if (missing.length === 0) return;

  try {
    const result = await sendMessage("word:getBatch", { items: missing });
    if (revision !== cueRevision) return;
    for (const item of result.items) {
      wordStateByLemma.set(item.key, item.state);
      ankiNoteCountByLemma.set(item.key, item.ankiNoteCount);
      const aliases = aliasesByLemma.get(item.key);
      if (aliases) queriedAliasesByLemma.set(item.key, aliases);
    }
  } catch (err: unknown) {
    console.warn("[SubJap] word:getBatch failed:", err);
    handleRuntimeError(err);
    if (revision !== cueRevision) return;
    for (const { key } of missing) {
      wordStateByLemma.set(key, null);
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
      handleRuntimeError(err);
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
      ankiNoteCountByLemma.clear();
      queriedAliasesByLemma.clear();
      knownWordCountPromise = null;
      lastSignature = "";
      if (lastCues.length > 0) enqueueCues(lastCues);
    } catch (err: unknown) {
      // Anki is optional; a missing AnkiConnect must not affect subtitle use.
      console.info("[SubJap] Anki known-word sync unavailable:", err);
      handleRuntimeError(err);
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
      handleRuntimeError(err);
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

async function resolveDictionaryCompounds(
  cues: Array<{ cue: SubtitleCue; tokens: Token[] }>,
): Promise<Array<{ cue: SubtitleCue; tokens: Token[] }>> {
  const candidateTerms = [
    ...new Set(cues.flatMap(({ tokens }) => dictionaryCompoundLookupTerms(tokens))),
  ];
  if (candidateTerms.length === 0) return cues;

  const uncachedTerms = candidateTerms.filter((term) => !dictionaryCompoundByTerm.has(term));
  if (uncachedTerms.length > 0) {
    try {
      for (
        let offset = 0;
        offset < uncachedTerms.length;
        offset += DICTIONARY_COMPOUND_LOOKUP_BATCH_SIZE
      ) {
        const terms = uncachedTerms.slice(offset, offset + DICTIONARY_COMPOUND_LOOKUP_BATCH_SIZE);
        const response = await sendMessage("dict:lookupBatch", { terms });
        for (const term of terms) {
          const entries = response.entriesByTerm[term] ?? [];
          if (entries.length > 0) dictionaryCompoundByTerm.set(term, entries);
        }
      }
    } catch (err: unknown) {
      console.warn("[SubJap] dict:lookupBatch for compounds failed:", err);
      handleRuntimeError(err);
      return cues;
    }
  }

  return cues.map(({ cue, tokens }) => {
    const entriesByTerm: Record<string, DictionaryEntry[]> = {};
    for (const term of dictionaryCompoundLookupTerms(tokens)) {
      const entries = dictionaryCompoundByTerm.get(term);
      if (entries) entriesByTerm[term] = entries;
    }
    return { cue, tokens: mergeDictionaryCompounds(tokens, entriesByTerm) };
  });
}

// ---------------------------------------------------------------------------
// 4. Overlay lifecycle
// ---------------------------------------------------------------------------

function ensureOverlay(): OverlayRenderer | null {
  const video = adapter.getVideoElement();
  if (!video) return null;

  // The video element can be swapped on SPA navigation (e.g. Netflix): tear
  // down the overlay mounted in the old player's parent and rebuild.
  if (overlay && currentVideo !== video) destroyOverlay();

  if (!overlay) {
    registerPlexLatinFont();
    overlay = new OverlayRenderer(video, overlayOptions);
    overlay.setRuntimeUnavailable(runtimeUnavailable);
    audioCapture = new VideoAudioCapture(
      video,
      (timeSeconds, resume) => adapter.seekTo(timeSeconds, resume),
      adapter.beginCueReplay
        ? (cue) => adapter.beginCueReplay?.(cue) ?? null
        : null,
      adapter.id === "youtube" ? () => adapter.getNavigationSessionId?.() : null,
    );
    currentVideo = video;
  }

  return overlay;
}

/** Remove everything mounted on the player and give native subtitles back. */
function destroyOverlay(): void {
  overlay?.destroy();
  overlay = null;
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
  if (!enabled) return;
  cues = pairTranslationWithJapaneseCues(cues);
  // The official track can arrive without changing the visible cue payload.
  // Seed navigation before signature deduplication.
  const navigationChanged = rememberNavigationCues();
  if (navigationChanged && adapter.id === "youtube") {
    miningModal?.destroy();
    miningModal = null;
    nativeSubtitleReplacementReady = false;
    applyNativeSubtitleVisibility();
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
  lastCues = cues;

  const overlayInstance = ensureOverlay();
  if (!overlayInstance) {
    if (revision === cueRevision) {
      lastSignature = "";
      overlay?.hide();
      hidePopover();
      spanRegistry.clear();
      lastRenderedCues = [];
    }
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
        cueKey: subtitleCueKey(translationCue),
      }
    : null;

  // A new cue set is being committed: the previous spans are replaced, so any
  // popover anchored to them is stale. Close it (hover mode) or unpin it.
  popoverPinned = false;
  hidePopover();
  clearHoverTimer();
  hoveredToken = null;

  if (japaneseCues.length === 0) {
    if (adapter.id === "netflix" && translation) {
      spanRegistry.clear();
      lastRenderedCues = [];
      cueNavigator.observe([]);
      // DOM history only knows subtitles already seen: give the Japanese line
      // a translation may precede the chance to appear before trusting it alone.
      const timeline = adapter.getNavigationCues?.() ?? [];
      if (!timeline.some((cue) => cue.source?.kind !== "dom")) {
        overlayInstance.updateContent([], null, knownWordCount);
        overlayInstance.hide();
        await new Promise((resolve) => setTimeout(resolve, TRANSLATION_ALONE_DOM_DELAY_MS));
        if (revision !== cueRevision) return;
      }
      overlayInstance.updateContent([], translation, knownWordCount);
      overlayInstance.show();
      return;
    }
    overlayInstance.updateContent([], null, knownWordCount);
    overlayInstance.hide();
    spanRegistry.clear();
    lastRenderedCues = [];
    cueNavigator.observe([]);
    return;
  }

  spanRegistry.clear();
  lastRenderedCues = [];
  cueNavigator.observe(japaneseCues);

  let tokenizedCues: Array<{ cue: SubtitleCue; tokens: Token[] }> | null = null;

  const buildRenderedCues = (
    cues: Array<{ cue: SubtitleCue; tokens: Token[] }>,
    pending: boolean,
    frequencyRanks: Record<string, number> = {},
  ): {
    rendered: RenderedCue[];
    registry: Map<number, { cue: SubtitleCue; token: Token }>;
  } => {
    const registry = new Map<number, { cue: SubtitleCue; token: Token }>();
    const rendered: RenderedCue[] = [];
    let globalIndex = 0;

    for (const { cue, tokens } of cues) {
      const parentheticalFlags = markParentheticalTokens(tokens);
      const spans: SpanToken[] = tokens.map((token, tokenIndex) => {
        const index = globalIndex++;
        registry.set(index, { cue, token });
        const lexicalKey = tokenCanonicalKey(token);
        const storedState = wordStateByLemma.get(lexicalKey) ?? null;
        const ankiNoteCount = ankiNoteCountByLemma.get(lexicalKey) ?? 0;
        return {
          index,
          token,
          // Metadata is not loaded yet while pending: wait before defaulting.
          wordState: pending
            ? storedState
            : effectiveWordState(token, storedState, ankiNoteCount),
          isPending: pending,
          isParenthetical: parentheticalFlags[tokenIndex],
          ankiNoteCount,
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

  // Final colours are painted directly whenever vocabulary metadata answers
  // quickly, which is always the case once cached: a word painted white, then
  // grey a moment later, reads as a flicker. Only a slow lookup (cold cache,
  // UniDic still loading) gets a neutral first paint after a short wait.
  let painted = false;
  const markPainted = (): void => {
    painted = true;
    nativeSubtitleReplacementReady = true;
    applyNativeSubtitleVisibility();
  };
  const paintProvisional = (): void => {
    if (!tokenizedCues) return;
    // UniDic is synchronous once warm: interactive white tokens replace the
    // plain text without waiting for vocabulary metadata.
    const provisional = buildRenderedCues(tokenizedCues, true);
    commitRenderedCues(provisional.rendered, provisional.registry, knownWordCount);
  };
  const firstPaintTimer = setTimeout(() => {
    if (painted || revision !== cueRevision) return;
    if (tokenizedCues) {
      paintProvisional();
    } else {
      overlayInstance.updatePendingContent(
        japaneseCues.map((cue) => normalizeCueText(cue.text)),
        translation,
        knownWordCount,
      );
      overlayInstance.show();
    }
    markPainted();
  }, FIRST_PAINT_WAIT_MS);

  const readyTokenizer = await ensureTokenizerReady();
  if (!readyTokenizer || revision !== cueRevision) return;

  tokenizedCues = japaneseCues.map((cue) => ({
    cue,
    tokens: tokenizeCue(normalizeCueText(cue.text), readyTokenizer),
  }));
  if (painted) paintProvisional();

  tokenizedCues = await resolveDictionaryCompounds(tokenizedCues);
  if (revision !== cueRevision) return;
  const [frequencyRanks, resolvedKnownWordCount] = await loadVocabularyMetadata(
    tokenizedCues.flatMap(({ tokens }) => tokens),
    revision,
  );

  // Skip stale renders: a newer emission (e.g. an empty cue set that hid the
  // overlay) may have superseded this one while metadata was loading.
  if (revision !== cueRevision) return;

  clearTimeout(firstPaintTimer);
  const enriched = buildRenderedCues(tokenizedCues, false, frequencyRanks);
  commitRenderedCues(enriched.rendered, enriched.registry, resolvedKnownWordCount);
  markPainted();
  console.log(`[SubJap] render: shown ${enriched.rendered.length} cue(s)`);
  prefetchUpcomingCues(japaneseCues, readyTokenizer, revision);
}

/** Fill the frequency, known-count and word-state caches for these tokens. */
async function loadVocabularyMetadata(
  tokens: Token[],
  revision: number,
): Promise<[Record<string, number>, number]> {
  const frequencyTerms = [
    ...new Set(
      tokens.flatMap((token) => [
        tokenCanonicalKey(token),
        tokenDictionaryForm(token),
        token.surface,
      ]),
    ),
  ];
  const wordLookups = tokens.map((token) => ({
    key: tokenCanonicalKey(token),
    aliases: tokenStateLookupTerms(token),
  }));
  const [frequencyRanks, resolvedKnownWordCount] = await Promise.all([
    getFrequencyRanks(frequencyTerms),
    getKnownWordCount(),
    getWordStates(wordLookups, revision),
  ]);
  return [frequencyRanks, resolvedKnownWordCount];
}

/**
 * Warm the caches with the next lines of a known track (Netflix timed text),
 * so they are painted in their final colours as soon as they appear.
 */
function prefetchUpcomingCues(
  current: SubtitleCue[],
  readyTokenizer: Tokenizer,
  revision: number,
): void {
  const after = Math.max(...current.map((cue) => cue.start));
  const upcoming = (adapter.getNavigationCues?.() ?? [])
    .filter((cue) => cue.start > after)
    .sort((a, b) => a.start - b.start)
    .slice(0, PREFETCH_CUE_COUNT);
  if (upcoming.length === 0) return;

  void (async () => {
    const tokenized = await resolveDictionaryCompounds(
      upcoming.map((cue) => ({
        cue,
        tokens: tokenizeCue(normalizeCueText(cue.text), readyTokenizer),
      })),
    );
    if (revision !== cueRevision) return;
    await loadVocabularyMetadata(
      tokenized.flatMap(({ tokens }) => tokens),
      revision,
    );
  })().catch((err: unknown) => {
    console.warn("[SubJap] Upcoming cue prefetch failed:", err);
  });
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

/**
 * Tracks time their lines independently, so a translation rarely starts and
 * ends exactly with the Japanese line it accompanies. Each Japanese line is
 * shown with its own translation, the one overlapping it the most:
 * - a translation starting while an earlier Japanese line is still shown,
 *   but belonging to a line still to come, waits for that line; the earlier
 *   translation stays meanwhile;
 * - when the translation ends first, keep it while one of those Japanese cues
 *   is still shown, until another translation replaces it, so the Japanese
 *   line does not drop into its place and jump back up with the next pair;
 * - when the Japanese line ends first, or starts after its translation, that
 *   part of the translation is not shown alone: it would flash, in
 *   particular when hidden because every word is known;
 * - a translation starting at most 1 s after its Japanese line appears with
 *   that line, in place of the previous translation, so the pair appears
 *   together.
 * A translation only briefly overlapping Japanese cues (a burned-in sign) is
 * not their counterpart and is still shown alone outside them.
 */
function pairTranslationWithJapaneseCues(cues: SubtitleCue[]): SubtitleCue[] {
  const japaneseCues = cues.filter((cue) => isJapaneseTrack(cue.language));
  const active = selectTranslationCue(cues);
  const paired = pairedTranslation;
  const japaneseShownWithActive =
    paired && active && subtitleCueKey(paired.cue) === subtitleCueKey(active)
      ? paired.japaneseCues
      : null;

  if (japaneseCues.length === 0) {
    if (active && isCounterpartOf(active, japaneseShownWithActive)) {
      return cues.filter((cue) => cue !== active);
    }
    pairedTranslation = null;
    return cues;
  }

  const now = adapter.getCurrentTime();
  const withoutActive = active ? cues.filter((cue) => cue !== active) : cues;
  let shown: SubtitleCue | null = null;
  /** Kept from earlier Japanese lines, it stays paired with them only. */
  let held = false;
  if (active && !belongsToLaterJapaneseLine(active, japaneseCues, now)) {
    shown = active;
  } else if (
    paired &&
    (!active || subtitleCueKey(paired.cue) !== subtitleCueKey(active)) &&
    japaneseCues.some((cue) => paired.japaneseCues.has(subtitleCueKey(cue))) &&
    selectTranslationCue([paired.cue])
  ) {
    shown = paired.cue;
    held = true;
  }

  const latest = primarySubtitleCue(japaneseCues);
  if (latest && (!shown || !isOwnedBy(shown, latest, japaneseCues))) {
    const own = ownTranslationStartingSoon(latest, japaneseCues, now);
    if (own) {
      shown = own;
      held = false;
    }
  }

  if (!shown) {
    pairedTranslation = null;
    return withoutActive;
  }
  if (held) return [...withoutActive, shown];
  const pairedJapanese = paired && subtitleCueKey(paired.cue) === subtitleCueKey(shown)
    ? paired.japaneseCues
    : new Map<string, { cue: SubtitleCue; lastSeen: number }>();
  for (const cue of japaneseCues) pairedJapanese.set(subtitleCueKey(cue), { cue, lastSeen: now });
  pairedTranslation = { cue: shown, japaneseCues: pairedJapanese };
  return shown === active ? cues : [...withoutActive, shown];
}

/** Japanese timeline cues whose bounds are known, shown or not. */
function knownJapaneseCues(): SubtitleCue[] {
  return (adapter.getNavigationCues?.() ?? [])
    .filter((cue) => cue.endConfirmed !== false && normalizeCueText(cue.text).length > 0);
}

let translationShiftCache: { key: string; japanese: SubtitleCue[]; shift: number } | null = null;

/**
 * Seconds by which the translation track as a whole starts its lines before
 * the Japanese one, measured on the episode. Only pairing uses it: neither
 * track is shown at another time.
 */
function translationShift(): number {
  const japanese = adapter.getNavigationCues?.() ?? [];
  const translations = adapter.getTranslationCuesIn?.(-Infinity, Infinity) ?? [];
  const first = translations[0];
  const last = translations.at(-1);
  const key = JSON.stringify([
    japanese.length, japanese[0]?.start, translations.length,
    first && subtitleCueKey(first), first?.start, last && subtitleCueKey(last),
  ]);
  if (translationShiftCache?.japanese !== japanese || translationShiftCache.key !== key) {
    const shift = estimateTranslationShift(
      japanese.filter((cue) => cue.endConfirmed !== false).map((cue) => cue.start),
      translations.map((cue) => cue.start),
    );
    translationShiftCache = { key, japanese, shift };
  }
  return translationShiftCache.shift;
}

/**
 * The Japanese line a translation overlaps the most, among those shown and
 * the timeline's, once the translation track's usual lead is compensated. A
 * provisional DOM end only means the line is still shown: it may well last
 * through the translation.
 */
function owningJapaneseCue(translation: SubtitleCue, shown: SubtitleCue[]): SubtitleCue | null {
  const shift = translationShift();
  const start = translation.start + shift;
  const end = translation.end + shift;
  let owner: SubtitleCue | null = null;
  let longest = 0;
  for (const cue of [...shown, ...knownJapaneseCues()]) {
    const cueEnd = cue.endConfirmed === false ? Math.max(cue.end, end) : cue.end;
    const overlap = Math.min(cueEnd, end) - Math.max(cue.start, start);
    if (overlap > longest) {
      owner = cue;
      longest = overlap;
    }
  }
  return owner;
}

function isOwnedBy(translation: SubtitleCue, japanese: SubtitleCue, shown: SubtitleCue[]): boolean {
  const owner = owningJapaneseCue(translation, shown);
  return !!owner && subtitleCueKey(owner) === subtitleCueKey(japanese);
}

/** True when a translation belongs to a Japanese line that has not started yet. */
function belongsToLaterJapaneseLine(
  translation: SubtitleCue,
  shown: SubtitleCue[],
  now: number,
): boolean {
  const owner = owningJapaneseCue(translation, shown);
  if (!owner || owner.start <= now) return false;
  const ownerKey = subtitleCueKey(owner);
  return !shown.some((cue) => subtitleCueKey(cue) === ownerKey);
}

/** The translation of this Japanese line, if it starts at most 1 s after it. */
function ownTranslationStartingSoon(
  latest: SubtitleCue,
  japaneseCues: SubtitleCue[],
  now: number,
): SubtitleCue | null {
  const until = latest.start + TRANSLATION_ANTICIPATION_SECONDS;
  if (until <= now) return null;
  const candidates = adapter.getTranslationCuesIn?.(now, until) ??
    [adapter.getTranslationCueStartingIn?.(now, until)].filter((cue): cue is SubtitleCue => !!cue);
  return candidates.find((candidate) => {
    if (candidate.start > until || candidate.end <= now || !selectTranslationCue([candidate])) {
      return false;
    }
    if (!isOwnedBy(candidate, latest, japaneseCues)) return false;
    const coverage = new Map(japaneseCues.map((cue) => [
      subtitleCueKey(cue),
      { cue, lastSeen: cue.endConfirmed === false ? candidate.end : now },
    ]));
    return isCounterpartOf(candidate, coverage);
  }) ?? null;
}

/**
 * True when Japanese cues cover most of a translation: those shown with it,
 * and the timeline's, which also knows the Japanese line about to start.
 */
function isCounterpartOf(
  translation: SubtitleCue,
  shownWith: ReadonlyMap<string, { cue: SubtitleCue; lastSeen: number }> | null,
): boolean {
  const duration = translation.end - translation.start;
  if (duration <= 0) return shownWith !== null;
  const japaneseIntervals: Array<[number, number]> = [
    // A provisional DOM end is not known yet: the cue lasted until it was last shown.
    ...[...(shownWith?.values() ?? [])].map(({ cue, lastSeen }): [number, number] =>
      [cue.start, cue.endConfirmed === false ? lastSeen : cue.end]),
    ...knownJapaneseCues().map((cue): [number, number] => [cue.start, cue.end]),
  ];
  const intervals = japaneseIntervals
    .map(([start, end]): [number, number] =>
      [Math.max(translation.start, start), Math.min(translation.end, end)])
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let coveredUntil = translation.start;
  for (const [start, end] of intervals) {
    if (end <= coveredUntil) continue;
    covered += end - Math.max(start, coveredUntil);
    coveredUntil = end;
  }
  return covered >= duration * TRANSLATION_COUNTERPART_COVERAGE;
}

function selectTranslationCue(cues: SubtitleCue[]): SubtitleCue | null {
  const preferredLanguage = overlayOptions.secondarySubtitleLanguage;
  if (preferredLanguage === "none") return null;
  const fallbackLanguage = preferredLanguage === "fr" ? "en" : "fr";
  return (
    cues.find((cue) => cue.language === "local") ??
    cues.find((cue) =>
      new RegExp(`^${preferredLanguage}(?:[-_]|$)`, "i").test(cue.language ?? ""),
    ) ??
    cues.find((cue) =>
      new RegExp(`^${fallbackLanguage}(?:[-_]|$)`, "i").test(cue.language ?? ""),
    ) ??
    null
  );
}

// ---------------------------------------------------------------------------
// 6. Interactions: popover (click), mining, known/unknown toggling
// ---------------------------------------------------------------------------

function onOverlayClick(event: Event): void {
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

function onOverlayKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".subjap-token")) return;
  event.preventDefault();
  onOverlayClick(event);
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
      lookupCandidates,
      async (term, options) => {
        const response = await sendMessage("dict:lookup", { lemma: term, mode: options?.mode });
        return response.entries ?? response.entry;
      },
    );
  } catch (err: unknown) {
    console.warn(`[SubJap] dict:lookup failed for "${tokenDictionaryForm(token)}":`, err);
    handleRuntimeError(err);
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
    wordStatus:
      effectiveWordState(
        token,
        wordStateByLemma.get(tokenCanonicalKey(token)) ?? null,
        renderedSpan?.ankiNoteCount ?? 0,
      )?.status ?? null,
    frequencyRank: renderedSpan?.frequencyRank,
    ankiNoteCount: renderedSpan?.ankiNoteCount ?? 0,
  });
}

async function isMiningCaptureActive(): Promise<boolean> {
  try {
    return (await sendMessage("tabCapture:status", {})).active;
  } catch (err: unknown) {
    handleRuntimeError(err);
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
    "background:rgba(12,13,16,.78)",
    "font-family:IBM Plex Sans JP,Yu Gothic UI,Hiragino Kaku Gothic ProN,Meiryo,sans-serif",
  ].join(";");
  warning.innerHTML = `
    <div style="max-width:420px;padding:24px;border-radius:12px;background:#14161b;color:#f4f1ea;box-shadow:0 8px 8px rgba(0,0,0,.42)">
      <div style="font-size:17px;font-weight:600;margin-bottom:12px">Enregistrement audio désactivé</div>
      <div style="line-height:1.5;color:#b2b6bf">
        Active d’abord « Audio de l’onglet » via l’icône SubJap pour pouvoir miner une phrase avec son audio.
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:20px">
        <button data-action="close" style="padding:9px 14px;border:0;border-radius:6px;background:#ff624d;color:#0c0d10;font-weight:600;cursor:pointer">Fermer</button>
      </div>
    </div>
  `;
  warning.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener("click", () => {
    forgetVideoSurface(warning);
    warning.remove();
  });
  mountVideoSurface(warning);
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
    lemmaReading: dictionaryReadingForToken(targetSpan.token, entry),
    translation: miningTranslationText(rendered.cue),
    episodeContext: source,
    senses: entry?.senses.map((sense) => sense.glosses).filter((glosses) => glosses.length > 0) ?? [],
  });
}

/**
 * Translation of a mined Japanese line. Tracks split lines independently, so
 * one Japanese cue may carry several translation cues: keep those lying mostly
 * within it, plus the one on screen, joined in time order.
 */
function miningTranslationText(japanese: SubtitleCue): string {
  const shown = selectTranslationCue(lastCues);
  // A provisional DOM end does not delimit the line yet.
  const within = japanese.endConfirmed === false
    ? []
    : (adapter.getTranslationCuesIn?.(japanese.start, japanese.end) ?? []).filter((cue) => {
        const duration = cue.end - cue.start;
        const overlap = Math.min(cue.end, japanese.end) - Math.max(cue.start, japanese.start);
        return duration > 0 && overlap >= duration * TRANSLATION_COUNTERPART_COVERAGE;
      });
  // The shown cue may come from another source (DOM) than the timeline.
  const shownKey = shown ? subtitleCueKey(shown) : null;
  const shownText = shown ? compactSubtitleText(shown.text) : "";
  const parts = shown && !within.some((cue) =>
      subtitleCueKey(cue) === shownKey || compactSubtitleText(cue.text) === shownText)
    ? [...within, shown].sort((a, b) => a.start - b.start)
    : within;
  return parts.map((cue) => normalizeCueText(cue.text)).filter(Boolean).join(" ");
}

function onToggleKnown(lemma: string, currentStatus: WordStatus | null, token: Token): void {
  if (currentStatus === "known") {
    unsetWordState(lemma, "known", token);
    return;
  }
  setWordState({ key: lemma, status: "known", source: "manual", knownAt: Date.now() });
}

function onToggleIgnored(lemma: string, currentStatus: WordStatus | null, token: Token): void {
  if (currentStatus === "ignored") {
    unsetWordState(lemma, "ignored", token);
    return;
  }
  setWordState({ key: lemma, status: "ignored", source: "manual" });
}

/** Re-render immediately; the known count is refreshed once the write settles. */
function refreshWordStates(): void {
  lastSignature = "";
  enqueueCues(lastCues);
}

function setWordState(next: WordState): void {
  void sendMessage("word:set", next)
    .catch((err) => {
      console.warn(`[SubJap] word:set failed for "${next.key}":`, err);
      handleRuntimeError(err);
    })
    .finally(() => {
      knownWordCountPromise = null;
      refreshWordStates();
    });

  wordStateByLemma.set(next.key, next);
  refreshWordStates();
}

/**
 * Withdraw a manual Known/Ignore decision: the word then follows Anki and the
 * default-ignored rule again, so learning it later in Anki still counts.
 */
function unsetWordState(lemma: string, status: WordStatus, token: Token): void {
  const defaultStatus =
    isDefaultIgnoredToken(token) && (ankiNoteCountByLemma.get(lemma) ?? 0) === 0
      ? "ignored"
      : undefined;

  void sendMessage("word:unset", {
    key: lemma,
    aliases: [...(queriedAliasesByLemma.get(lemma) ?? [])],
    status,
    defaultStatus,
  })
    .then(({ state }) => {
      wordStateByLemma.set(lemma, state);
    })
    .catch((err) => {
      console.warn(`[SubJap] word:unset failed for "${lemma}":`, err);
      handleRuntimeError(err);
    })
    .finally(() => {
      knownWordCountPromise = null;
      refreshWordStates();
    });

  // Shown as unknown until the worker resolves what Anki says about the word.
  wordStateByLemma.set(lemma, { key: lemma, status: "unknown", source: "manual" });
  refreshWordStates();
}

// ---------------------------------------------------------------------------
// 7. Boot
// ---------------------------------------------------------------------------

let removeShortcuts: (() => void) | null = null;
let ankiSyncTimer: number | null = null;

function installShortcuts(): () => void {
  const removePlaybackShortcuts = installPlaybackShortcuts(document, adapter, cueNavigator);
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
  const removeSecondarySubtitleRevealShortcut = installSecondarySubtitleRevealShortcut(
    document,
    () => overlay?.revealHiddenSubtitle(),
    () => adapter.getVideoElement() !== null,
  );
  return () => {
    removePlaybackShortcuts();
    removeSubtitleCopyShortcut();
    removeSecondarySubtitleRevealShortcut();
  };
}

// ---------------------------------------------------------------------------
// Missing Japanese subtitles
// ---------------------------------------------------------------------------

const MISSING_JAPANESE_NOTICE_MS = 12_000;
let missingJapaneseTimer: number | null = null;
let missingJapaneseNotice: VideoNotice | null = null;
/** The notice reports missing subtitles: it goes away once some appear. */
let missingJapaneseNoticeReportsMissing = false;
/** The "installed from Jimaku" notice, kept when the file is then aligned. */
let jimakuInstalledActions: { videoId: string; actions: VideoNoticeAction[]; hint: string } | null = null;
/** Videos already handled, so the notice appears once per video. */
const missingJapaneseNotified = new Set<string>();

/** Anime players only: elsewhere a video without Japanese is usually not Japanese. */
function checkMissingJapanese(): void {
  const status = adapter.getJapaneseSubtitleStatus?.();
  const video = adapter.getVideoElement();
  if (!status || status.player !== "artplayer" || status.availability !== "missing" || !video) {
    if (status?.availability === "available" && missingJapaneseNoticeReportsMissing) {
      missingJapaneseNotice?.close();
    }
    return;
  }
  const key = status.videoId ?? video.currentSrc;
  if (!key || missingJapaneseNotified.has(key)) return;
  missingJapaneseNotified.add(key);
  void handleMissingJapanese(video, status.videoId);
}

/** Install from Jimaku when a key is set, unless the user removed its file before. */
async function handleMissingJapanese(video: HTMLVideoElement, videoId: string | null): Promise<void> {
  const [apiKey, declined] = videoId
    ? await Promise.all([getJimakuApiKey(), isJimakuDeclined(videoId)]).catch(() => ["", false] as const)
    : ["", true] as const;
  if (!enabled || adapter.getVideoElement() !== video) return;
  const notice = openMissingJapaneseNotice(video);
  if (!videoId || !apiKey || declined) {
    showMissingJapanese(notice, videoId, { offerSetup: !apiKey && !declined });
    return;
  }
  void installFromJimaku(notice, videoId);
}

function openMissingJapaneseNotice(video: HTMLVideoElement): VideoNotice {
  missingJapaneseNotice?.close();
  jimakuInstalledActions = null;
  const notice = new VideoNotice(video, {
    text: "",
    actions: [],
    autoHideMs: null,
    onClose: () => {
      if (missingJapaneseNotice !== notice) return;
      missingJapaneseNotice = null;
      missingJapaneseNoticeReportsMissing = false;
      jimakuInstalledActions = null;
    },
  });
  missingJapaneseNotice = notice;
  notice.show();
  return notice;
}

function showMissingJapanese(
  notice: VideoNotice,
  videoId: string | null,
  { text = "Pas de sous-titres japonais pour cette vidéo.", offerSetup = false } = {},
): void {
  missingJapaneseNoticeReportsMissing = missingJapaneseNotice === notice;
  notice.update({
    text,
    autoHideMs: MISSING_JAPANESE_NOTICE_MS,
    actions: [
      ...(offerSetup ? [{ label: "Installer automatiquement", primary: true, onClick: openJimakuSettings }] : []),
      { label: "Chercher sur Jimaku", primary: !offerSetup, onClick: () => searchJimaku(notice) },
      ...(videoId ? [{ label: "Importer", onClick: () => importJapaneseFile(videoId, notice) }] : []),
    ],
  });
}

function openJimakuSettings(): void {
  void sendMessage("options:open", { section: "jimaku" }).catch(handleRuntimeError);
}

async function installFromJimaku(notice: VideoNotice, videoId: string): Promise<void> {
  if (missingJapaneseNotice === notice) missingJapaneseNoticeReportsMissing = false;
  notice.update({
    text: "Recherche des sous-titres japonais sur Jimaku…",
    actions: [],
    autoHideMs: null,
  });
  let result: JimakuInstallResult;
  try {
    result = await sendMessage("jimaku:install", { videoId });
  } catch (err: unknown) {
    handleRuntimeError(err);
    result = { status: "error", message: "Jimaku injoignable." };
  }
  switch (result.status) {
    case "installed": {
      const actions = [{ label: "Désinstaller", onClick: () => void removeJimakuFile(notice, videoId) }];
      // Picking another file is left to the popup: by the time a file proves wrong, the notice is gone.
      const hint = result.choices.length > 1 ? "\nAutres fichiers au choix via l’icône SubJap." : "";
      jimakuInstalledActions = { videoId, actions, hint };
      notice.update({
        text: `Sous-titres japonais installés depuis Jimaku.${hint}`,
        autoHideMs: MISSING_JAPANESE_NOTICE_MS,
        actions,
      });
      return;
    }
    case "no-key":
      showMissingJapanese(notice, videoId, { offerSetup: true });
      return;
    case "bad-key":
      missingJapaneseNoticeReportsMissing = missingJapaneseNotice === notice;
      notice.update({
        text: "Clé Jimaku refusée.",
        autoHideMs: MISSING_JAPANESE_NOTICE_MS,
        actions: [
          { label: "Vérifier la clé", primary: true, onClick: openJimakuSettings },
          { label: "Chercher sur Jimaku", onClick: () => searchJimaku(notice) },
          { label: "Importer", onClick: () => importJapaneseFile(videoId, notice) },
        ],
      });
      return;
    case "not-found":
      showMissingJapanese(notice, videoId, { text: "Introuvable sur Jimaku pour cet épisode." });
      return;
    case "error":
      showMissingJapanese(notice, videoId, { text: result.message });
  }
}

/** Removed for good: the next visit of this video does not install it again. */
async function removeJimakuFile(notice: VideoNotice, videoId: string): Promise<void> {
  try {
    await Promise.all([removeLocalSubtitle(videoId, "primary"), declineJimaku(videoId)]);
    showMissingJapanese(notice, videoId, { text: "Sous-titres Jimaku désinstallés pour cette vidéo." });
  } catch (err: unknown) {
    handleRuntimeError(err);
    notice.setText("Désinstallation impossible. Supprimez la piste via l’icône SubJap.");
  }
}

// ---------------------------------------------------------------------------
// Automatic alignment of a local Japanese file
// ---------------------------------------------------------------------------

function formatOffset(seconds: number): string {
  return `${seconds > 0 ? "+" : "−"}${Math.abs(seconds).toFixed(1).replace(".", ",")}\u00a0s`;
}

/** Say it once, with a way back: the file keeps the offset it had, flagged as chosen. */
/** "(−19,0 s)" for one offset, "par parties (de −20,0 s à −19,0 s)" for several. */
function describeSync(segments: SyncSegment[]): string {
  const offsets = segments.map((segment) => segment.offset);
  if (offsets.length === 1) return `(${formatOffset(offsets[0] ?? 0)})`;
  const low = Math.min(...offsets);
  const high = Math.max(...offsets);
  return `par parties (de ${formatOffset(low)} à ${formatOffset(high)})`;
}

function showAutoSyncNotice({ videoId, segments }: AutoSyncEvent): void {
  const video = adapter.getVideoElement();
  if (!enabled || !video) return;
  const installed = jimakuInstalledActions?.videoId === videoId && missingJapaneseNotice
    ? jimakuInstalledActions
    : null;
  const notice = installed && missingJapaneseNotice ? missingJapaneseNotice : openMissingJapaneseNotice(video);
  const undo = (): void => {
    void (async () => {
      const record = await getLocalSubtitle(videoId, "primary");
      if (record) await saveLocalSubtitle(videoId, { ...record, syncSegments: undefined, syncChecked: true }, "primary");
      notice.update({
        text: "Synchronisation annulée. Le décalage reste réglable via l’icône SubJap.",
        autoHideMs: MISSING_JAPANESE_NOTICE_MS,
        actions: [],
      });
    })().catch(handleRuntimeError);
  };
  missingJapaneseNoticeReportsMissing = false;
  notice.update({
    text: installed
      ? `Sous-titres Jimaku installés et synchronisés ${describeSync(segments)}.${installed.hint}`
      : `Sous-titres japonais synchronisés sur la traduction ${describeSync(segments)}.`,
    autoHideMs: MISSING_JAPANESE_NOTICE_MS,
    actions: [...(installed?.actions ?? []), { label: "Annuler la synchro", onClick: undo }],
  });
}

onLocalSubtitleAutoSync(showAutoSyncNotice);

/** The extension opens the tab: sandboxed player frames cannot open one. */
function searchJimaku(notice: VideoNotice): void {
  void sendMessage("jimaku:search", {}).then(() => notice.close(), (err: unknown) => {
    handleRuntimeError(err);
    notice.setText("Impossible d’ouvrir Jimaku. Réessayez via l’icône SubJap.");
  });
}

/** Same storage as the popup import: the adapter picks the file up by itself. */
function importJapaneseFile(videoId: string, notice: VideoNotice): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".srt,.vtt,.webvtt,.ass,.ssa";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const content = await file.text();
        if (parseSubtitleFile(file.name, content).length === 0) {
          notice.setText("Fichier SRT, VTT ou ASS invalide ou vide.");
          return;
        }
        await saveLocalSubtitle(videoId, {
          fileName: file.name,
          content,
          offsetSeconds: 0,
          updatedAt: Date.now(),
        }, "primary");
        notice.close();
      } catch (err: unknown) {
        handleRuntimeError(err);
        notice.setText("Import impossible. Réessayez via l’icône SubJap.");
      }
    })();
  }, { once: true });
  input.click();
}

/**
 * Frames start SubJap only once they contain a video, so ads, widgets and
 * comment frames stay untouched.
 */
let frameHasVideo = isTopFrame;
let enableRequested = false;

function waitForFrameVideo(): void {
  if (frameHasVideo) return;
  const observer = new MutationObserver(() => {
    check();
  });
  const check = (): boolean => {
    if (!document.querySelector("video")) return false;
    observer.disconnect();
    frameHasVideo = true;
    if (enableRequested) enable();
    return true;
  };
  if (!check()) observer.observe(document.documentElement, { childList: true, subtree: true });
}

function enable(): void {
  enableRequested = true;
  if (enabled || !frameHasVideo) return;
  enabled = true;
  console.log("[SubJap] enabled");
  // Warm UniDic while the player is mounting so ordinary cues can become
  // interactive synchronously after their immediate plain-text first paint.
  void ensureTokenizerReady();
  void syncKnownWordsFromAnki(true);
  ankiSyncTimer = window.setInterval(() => void syncKnownWordsFromAnki(), 120_000);
  // Create the popover singleton (mounted on document.body).
  getPopover({
    onToggleKnown,
    onToggleIgnored,
    onMine: (token, entry) => {
      void openMiningModal(token, entry);
    },
  });
  removeShortcuts = installShortcuts();
  adapter.setSecondarySubtitleLanguage?.(overlayOptions.secondarySubtitleLanguage);
  adapter.subscribeCues((cues) => {
    enqueueCues(cues);
  });
  missingJapaneseTimer = window.setInterval(checkMissingJapanese, 1_000);
}

/** Leave the page as if SubJap were not installed, without reloading it. */
function disable(): void {
  enableRequested = false;
  if (!enabled) return;
  enabled = false;
  console.log("[SubJap] disabled");
  removeShortcuts?.();
  removeShortcuts = null;
  if (ankiSyncTimer !== null) window.clearInterval(ankiSyncTimer);
  ankiSyncTimer = null;
  if (missingJapaneseTimer !== null) window.clearInterval(missingJapaneseTimer);
  missingJapaneseTimer = null;
  missingJapaneseNotice?.close();
  // Invalidate cue renders still in flight.
  cueRevision++;
  lastCues = [];
  pairedTranslation = null;
  spanRegistry.clear();
  lastRenderedCues = [];
  cueNavigationSessionId = null;
  clearHoverTimer();
  clearHideTimer();
  hoveredToken = null;
  popoverPinned = false;
  hidePopover();
  const captureWarning = document.getElementById("subjap-mining-capture-warning");
  if (captureWarning) {
    forgetVideoSurface(captureWarning);
    captureWarning.remove();
  }
  destroyOverlay();
  adapter.destroy();
}

// Load the effective overlay options and keep them in sync when the user
// changes settings from the options page.
void Promise.all([getOptions(), isSubJapEnabled()]).then(([opts, on]) => {
  overlayOptions = opts;
  console.log("[SubJap] options:", opts);
  if (on) enable();
});
waitForFrameVideo();

document.addEventListener("visibilitychange", () => {
  if (enabled && document.visibilityState === "visible") void syncKnownWordsFromAnki();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const enabledChange = changes[ENABLED_STORAGE_KEY];
  if (enabledChange) {
    if (isEnabledValue(enabledChange.newValue)) enable();
    else disable();
  }

  // A key just saved from the options: try the video that was missing subtitles.
  if (changes[JIMAKU_API_KEY_STORAGE_KEY]?.newValue) missingJapaneseNotified.clear();

  if (changes[DICTIONARY_REVISION_STORAGE_KEY]) {
    dictionaryCompoundByTerm.clear();
    lastSignature = "";
    enqueueCues(lastCues);
  }

  const change = changes["subjap_options"];
  if (!change) return;

  void getOptions().then((opts) => {
    overlayOptions = opts;
    if (!enabled) return;
    adapter.setSecondarySubtitleLanguage?.(opts.secondarySubtitleLanguage);
    overlay?.setOptions(opts);
    applyNativeSubtitleVisibility();
    lastSignature = "";
    enqueueCues(lastCues);
  });
});

window.addEventListener(
  "pagehide",
  () => {
    removeShortcuts?.();
    removeShortcuts = null;
    document.removeEventListener("pointerdown", resumeTabAudio, true);
    document.removeEventListener("keydown", resumeTabAudio, true);
    audioCapture?.destroy();
    audioCapture = null;
    adapter.destroy();
  },
  { once: true },
);

// Click delegation (capture phase — the overlay container may be rebuilt).
document.addEventListener("click", onOverlayClick, true);
document.addEventListener("keydown", onOverlayKeyDown, true);

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
