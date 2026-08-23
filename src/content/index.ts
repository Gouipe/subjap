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
import { MiningModal, VideoAudioCapture } from "@/mining";
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
  installPlaybackShortcuts,
  installSubtitleCopyShortcut,
  subtitleTextForClipboard,
} from "./shortcuts";
import { WordStateCache } from "./word-state-cache";
import {
  tokenCanonicalKey,
  tokenDictionaryForm,
  tokenLookupTerms,
} from "@/core/types";
import type {
  DictionaryEntry,
  EpisodeContext,
  OverlayOptions,
  PlatformAdapter,
  RenderedCue,
  SpanToken,
  SubtitleCue,
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

console.log(`[SubJap] Platform: ${adapter.id}`);

// ---------------------------------------------------------------------------
// 2. State
// ---------------------------------------------------------------------------

let tokenizer: Tokenizer | null = null;
let overlay: OverlayRenderer | null = null;
let currentVideo: HTMLVideoElement | null = null;
let audioCapture: VideoAudioCapture | null = null;
let nativeSubtitlesHidden = false;

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
  if (!overlayOptions.hideNativeSubtitles) {
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

/** Signature of the last rendered cue set — skips identical cuechange spam. */
let lastSignature = "";
let lastCues: SubtitleCue[] = [];

/** Last fully rendered cues — used by the mining modal for its sentence view. */
let lastRenderedCues: RenderedCue[] = [];

/** Mining modal singleton (created on demand, destroyed on video swap). */
let miningModal: MiningModal | null = null;
let pendingCues: SubtitleCue[] | null = null;
let cueProcessing = false;

/** Global token index → { cue, token } for the currently rendered cues. */
const spanRegistry = new Map<number, { cue: SubtitleCue; token: Token }>();

/** lemma → last resolved status (synchronous reads for the popover). */
const wordStatusByLemma = new LRUCache<string, WordStatus | null>(1_000);

/** lemma → number of matching notes from the latest successful Anki sync. */
const ankiNoteCountByLemma = new LRUCache<string, number>(1_000);

/** Cached learner vocabulary size used by the frequency colour bands. */
let knownWordCount = 0;
let knownWordCountPromise: Promise<number> | null = null;

/** Cached word-state reads, invalidated after a manual state change. */
const wordStateCache = new WordStateCache((lemma, aliases) =>
  sendMessage("word:get", { key: lemma, aliases })
    .then((result) => {
      wordStatusByLemma.set(lemma, result.state?.status ?? null);
      ankiNoteCountByLemma.set(lemma, result.ankiNoteCount);
      return result.state;
    })
    .catch((err: unknown) => {
      console.warn(`[SubJap] word:get failed for "${lemma}":`, err);
      wordStatusByLemma.set(lemma, null);
      ankiNoteCountByLemma.set(lemma, 0);
      return null;
    }),
);

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
// 3. Word-state lookups (deduplicated, cached)
// ---------------------------------------------------------------------------

function getWordState(lemma: string, aliases?: string[]): Promise<WordState | null> {
  return wordStateCache.get(lemma, aliases);
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

      wordStateCache.clear();
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
  if (terms.length === 0) return {};
  try {
    const result = await sendMessage("frequency:batch", { terms });
    return result.ranks;
  } catch (err: unknown) {
    console.warn("[SubJap] frequency:batch failed:", err);
    return {};
  }
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
    overlay.destroy();
    overlay = null;
    audioCapture?.destroy();
    audioCapture = null;
    currentVideo = null;
    cueNavigator.reset();
    miningModal?.destroy();
    miningModal = null;
    // Force the next cue set through the pipeline after a player swap.
    lastSignature = "";
  }

  if (!overlay) {
    overlay = new OverlayRenderer(video, overlayOptions);
    audioCapture = new VideoAudioCapture(video, (timeSeconds, resume) =>
      adapter.seekTo(timeSeconds, resume),
    );
    currentVideo = video;
  }

  return overlay;
}

/** Keep only the newest cue snapshot while an async render is in flight. */
function enqueueCues(cues: SubtitleCue[]): void {
  pendingCues = cues;
  if (cueProcessing) return;
  cueProcessing = true;
  void (async () => {
    try {
      while (pendingCues !== null) {
        const nextCues = pendingCues;
        pendingCues = null;
        await handleCues(nextCues);
      }
    } catch (err: unknown) {
      console.error("[SubJap] Cue processing failed:", err);
    } finally {
      cueProcessing = false;
      if (pendingCues !== null) enqueueCues(pendingCues);
    }
  })();
}

// ---------------------------------------------------------------------------
// 5. Core pipeline: cues → rendered cues
// ---------------------------------------------------------------------------

async function handleCues(cues: SubtitleCue[]): Promise<void> {
  // Netflix can provide its complete official track even when this content
  // script was loaded in the middle of the current phrase. Seed navigation
  // before render deduplication so Q can still reach the unseen predecessor.
  cueNavigator.remember(adapter.getNavigationCues?.() ?? []);

  const signature = cues
    .map(
      (cue) =>
        `${cue.language ?? ""}\u0000${cue.id}\u0000${cue.start}\u0000${cue.end}\u0000${cue.endConfirmed ?? ""}\u0000${cue.text}`,
    )
    .join("\u0001");
  if (signature === lastSignature) return;
  lastCues = cues;

  const overlayInstance = ensureOverlay();
  if (!overlayInstance) {
    console.log("[SubJap] render: skipped (no video yet)");
    return;
  }

  // Commit the signature only once the overlay is available, so a cue set
  // that arrived before the <video> was discovered is not dropped forever
  // (the adapter re-emits when it finds the video).
  lastSignature = signature;

  const japaneseCues = cues.filter((cue) => isJapaneseTrack(cue.language));
  const translationCue = selectTranslationCue(cues);

  // The overlay replaces native subtitles (unless the user opted to keep them
  // visible). The overlay stays on screen while paused — pausing is
  // when the learner wants to read the sentence.
  applyNativeSubtitleVisibility();

  // A new cue set is being committed: the previous spans are replaced, so any
  // popover anchored to them is stale. Close it (hover mode) or unpin it.
  popoverPinned = false;
  hidePopover();
  clearHoverTimer();
  hoveredToken = null;

  if (japaneseCues.length === 0) {
    overlayInstance.updateTranslation(null);
    overlayInstance.hide();
    spanRegistry.clear();
    lastRenderedCues = [];
    cueNavigator.observe([]);
    return;
  }

  if (!tokenizer) {
    try {
      tokenizer = await createTokenizer();
    } catch (err) {
      console.error("[SubJap] Tokenizer failed to initialise:", err);
      return;
    }
    // A newer emission may have superseded this one while we awaited.
    if (signature !== lastSignature) return;
  }

  const tokenizedCues: Array<{ cue: SubtitleCue; tokens: Token[] }> = [];
  const allTokens: Token[] = [];

  for (const cue of japaneseCues) {
    // Normalize markup, then segment into sentence-sized chunks so the
    // tokenizer LRU cache hits across repeated sentences.
    const sentences = splitIntoSentences(normalizeCueText(cue.text));
    const cueTokens: Token[] = [];
    for (const sentence of sentences) {
      const tokens = groupTokens(tokenizer.tokenize(sentence));
      cueTokens.push(...tokens);
    }
    tokenizedCues.push({ cue, tokens: cueTokens });
    allTokens.push(...cueTokens);
  }

  const frequencyTerms = [
    ...new Set(
      allTokens.flatMap((token) => [
        tokenCanonicalKey(token),
        tokenDictionaryForm(token),
        token.surface,
      ]),
    ),
  ];
  const [frequencyRanks, resolvedKnownWordCount] = await Promise.all([
    getFrequencyRanks(frequencyTerms),
    getKnownWordCount(),
  ]);

  const nextSpanRegistry = new Map<number, { cue: SubtitleCue; token: Token }>();
  const rendered: RenderedCue[] = [];
  let globalIndex = 0;

  for (const { cue, tokens } of tokenizedCues) {
    const parentheticalFlags = markParentheticalTokens(tokens);
    const spans: SpanToken[] = await Promise.all(
      tokens.map(async (token, tokenIndex): Promise<SpanToken> => {
        const index = globalIndex++;
        nextSpanRegistry.set(index, { cue, token });
        const lexicalKey = tokenCanonicalKey(token);
        const stateLookupKeys = [lexicalKey, ...tokenLookupTerms(token)];
        const state = await getWordState(lexicalKey, stateLookupKeys);
        const frequencyRank =
          frequencyRanks[lexicalKey] ??
          frequencyRanks[tokenDictionaryForm(token)] ??
          frequencyRanks[token.surface];
        return {
          index,
          token,
          wordState: state,
          isParenthetical: parentheticalFlags[tokenIndex],
          ankiNoteCount: ankiNoteCountByLemma.get(lexicalKey) ?? 0,
          frequencyRank,
        };
      }),
    );

    rendered.push({ cue, spans });
  }

  // Skip stale renders: a newer emission (e.g. an empty cue set that hid the
  // overlay) may have superseded this one while the async tokenizer/word-state
  // work was in flight.
  if (signature !== lastSignature) return;

  spanRegistry.clear();
  for (const [index, entry] of nextSpanRegistry) {
    spanRegistry.set(index, entry);
  }
  lastRenderedCues = rendered;
  overlayInstance.updateContent(
    rendered,
    translationCue
      ? {
          text: normalizeCueText(translationCue.text),
          language: translationCue.language ?? "",
        }
      : null,
    resolvedKnownWordCount,
  );
  overlayInstance.show();
  cueNavigator.observe(japaneseCues);
  console.log(`[SubJap] render: shown ${rendered.length} cue(s)`);
}

function isJapaneseTrack(language: string | undefined): boolean {
  return /^ja(?:[-_]|$)/i.test(language ?? "");
}

function selectTranslationCue(cues: SubtitleCue[]): SubtitleCue | null {
  return (
    cues.find((cue) => /^fr(?:[-_]|$)/i.test(cue.language ?? "")) ??
    cues.find((cue) => /^en(?:[-_]|$)/i.test(cue.language ?? "")) ??
    null
  );
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
  wordStateCache.invalidate(lemma);

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
  wordStateCache.invalidate(lemma);
}

// ---------------------------------------------------------------------------
// 7. Boot
// ---------------------------------------------------------------------------

// Load the effective overlay options and keep them in sync when the user
// changes settings from the options page.
void getOptions().then((opts) => {
  overlayOptions = opts;
  console.log("[SubJap] options:", opts);
  // Apply the native-subtitle preference immediately, even before the first
  // cue arrives (the player may already be showing Japanese subtitles).
  applyNativeSubtitleVisibility();
});

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
const removeSubtitleCopyShortcut = installSubtitleCopyShortcut(document, {
  getText: () =>
    subtitleTextForClipboard(lastRenderedCues.map((rendered) => rendered.cue)),
});
window.addEventListener(
  "pagehide",
  () => {
    removePlaybackShortcuts();
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
