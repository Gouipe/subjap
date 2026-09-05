import type { PlatformAdapter, SubtitleCue } from "@/core/types";
import { normalizeCueText } from "@/subtitles";
import { primarySubtitleCue, subtitleCueKey } from "@/subtitles/timeline";

export type CueShortcutAction = "previous" | "current" | "next";

const NEXT_CUE_OFFSET_SECONDS = 0.05;
const PENDING_TTL_MS = 1_500;
const STALE_DISPLAY_SECONDS = 0.75;
const COPY_FEEDBACK_DURATION_MS = 1_000;
const COPY_FEEDBACK_ID = "subjap-copy-feedback";

/** Navigation consumes the adapter's segments; it never reconciles sources. */
export class CueNavigator {
  private cues: SubtitleCue[] = [];
  private displayed: SubtitleCue[] = [];
  private pending: { cue: SubtitleCue; issuedAtMs: number } | null = null;
  private lastRememberedCues: SubtitleCue[] | null = null;

  observe(cues: SubtitleCue[]): void {
    this.displayed = cues.filter((cue) => normalizeCueText(cue.text).length > 0);
    // Adapters without a complete timeline (generic HTML5) retain ID-based
    // history. Netflix owns its canonical track / DOM history itself.
    if (!this.lastRememberedCues?.length) {
      const history = new Map(this.cues.map((cue) => [subtitleCueKey(cue), cue]));
      for (const cue of this.displayed) history.set(subtitleCueKey(cue), cue);
      this.cues = [...history.values()].sort((a, b) => a.start - b.start);
    }
    if (this.pending && this.displayed.some(
      (cue) => subtitleCueKey(cue) === subtitleCueKey(this.pending!.cue),
    )) this.pending = null;
  }

  remember(cues: SubtitleCue[]): void {
    if (this.lastRememberedCues === cues) return;
    const hadTimeline = Boolean(this.lastRememberedCues?.length);
    this.lastRememberedCues = cues;
    if (!cues.length && !hadTimeline) return;
    this.cues = cues.filter((cue) => normalizeCueText(cue.text).length > 0)
      .slice().sort((a, b) => a.start - b.start);
    if (this.pending && !this.cues.some(
      (cue) => subtitleCueKey(cue) === subtitleCueKey(this.pending!.cue),
    )) this.pending = null;
  }

  reset(): void {
    this.cues = [];
    this.displayed = [];
    this.pending = null;
    this.lastRememberedCues = null;
  }

  getSeekTime(action: CueShortcutAction, pressedAt: number): number | null {
    const now = performance.now();
    if (this.pending && now - this.pending.issuedAtMs >= PENDING_TTL_MS) this.pending = null;
    let base = this.pending?.cue ?? primarySubtitleCue(this.displayed);
    if (!this.pending && base && base.endConfirmed !== false &&
      (pressedAt > base.end + STALE_DISPLAY_SECONDS || pressedAt < base.start - STALE_DISPLAY_SECONDS)) {
      base = null;
    }
    let targetCue: SubtitleCue | null = null;
    let targetTime: number | null = null;
    if (base) {
      if (action === "current") targetCue = base;
      else if (action === "previous") {
        targetCue = [...this.cues].reverse().find((cue) => cue.start < base!.start) ?? null;
      } else {
        targetCue = this.cues.find((cue) => cue.start > base!.start) ?? null;
        if (!targetCue && base.source?.kind !== "track" && base.endConfirmed !== false && base.end > base.start) {
          targetTime = Math.max(base.end, pressedAt) + NEXT_CUE_OFFSET_SECONDS;
        }
      }
    } else if (action === "next") {
      targetCue = this.cues.find((cue) => cue.start > pressedAt) ?? null;
    } else {
      targetCue = [...this.cues].reverse().find((cue) => cue.start <= pressedAt) ?? null;
    }
    if (targetCue) {
      targetTime = targetCue.start;
      this.pending = { cue: targetCue, issuedAtMs: now };
    }
    console.debug(
      `[SubJap] nav ${action} at=${pressedAt} base=${base?.source?.segmentId ?? base?.id ?? "gap"} ` +
      `target=${targetCue?.source?.segmentId ?? targetCue?.id ?? "none"} time=${targetTime ?? "null"} ` +
      `source=${targetCue?.source?.kind ?? "unknown"} track=${targetCue?.source?.trackId ?? "unknown"} ` +
      `precision=${targetCue?.source?.startPrecision ?? "unknown"}`,
    );
    return targetTime;
  }

  cancelPendingSeek(): void {
    this.pending = null;
  }
}

export function shortcutActionForKey(key: string): CueShortcutAction | null {
  switch (key.toLowerCase()) {
    case "q":
      return "previous";
    case "s":
      return "current";
    case "d":
      return "next";
    default:
      return null;
  }
}

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest("input, textarea, select, [contenteditable]") !== null ||
    target.closest("#subjap-mining-modal") !== null
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}

/** Build the single-line Japanese text copied by the C shortcut. */
export function subtitleTextForClipboard(
  cues: Array<Pick<SubtitleCue, "text">>,
): string {
  return cues
    .map((cue) => normalizeCueText(cue.text))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export interface SubtitleCopyShortcutOptions {
  /** Returns the Japanese cues that are currently committed to the overlay. */
  getText: () => string;
  /** Injectable clipboard boundary for deterministic tests. */
  writeText?: (text: string) => Promise<void>;
  feedbackDurationMs?: number;
}

/** Install the plain-C copy shortcut and return its cleanup function. */
export function installSubtitleCopyShortcut(
  doc: Document,
  options: SubtitleCopyShortcutOptions,
): () => void {
  let removed = false;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let copyQueue: Promise<void> = Promise.resolve();

  const feedback = doc.createElement("div");
  feedback.id = COPY_FEEDBACK_ID;
  feedback.hidden = true;
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  Object.assign(feedback.style, {
    position: "fixed",
    left: "50%",
    bottom: "28px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "rgba(27, 30, 36, 0.96)",
    color: "#f4f1ea",
    font: "600 14px/1.2 'IBM Plex Sans JP', 'Yu Gothic UI', Meiryo, sans-serif",
    boxShadow: "0 6px 8px rgba(0, 0, 0, 0.35)",
    pointerEvents: "none",
  });

  const showFeedback = (message: string, failed = false): void => {
    if (removed) return;
    if (!feedback.isConnected) doc.body.appendChild(feedback);
    if (feedbackTimer !== null) clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedback.style.background = failed
      ? "rgba(92, 35, 42, 0.96)"
      : "rgba(27, 30, 36, 0.96)";
    feedback.hidden = false;
    feedbackTimer = setTimeout(() => {
      feedback.hidden = true;
      feedbackTimer = null;
    }, options.feedbackDurationMs ?? COPY_FEEDBACK_DURATION_MS);
  };

  const writeText =
    options.writeText ??
    ((text: string) => {
      const clipboard = doc.defaultView?.navigator.clipboard;
      if (!clipboard) return Promise.reject(new Error("Clipboard API unavailable"));
      return clipboard.writeText(text);
    });

  const onKeydown = (event: KeyboardEvent): void => {
    if (
      event.key.toLowerCase() !== "c" ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isBlockedTarget(event.target)
    ) {
      return;
    }

    const text = options.getText();
    if (!text) return;

    event.preventDefault();
    const runCopy = async (): Promise<void> => {
      if (removed) return;
      try {
        await writeText(text);
        showFeedback("Copié");
      } catch (err: unknown) {
        console.warn("[SubJap] Subtitle copy failed:", err);
        showFeedback("Copie impossible", true);
      }
    };
    copyQueue = copyQueue.then(runCopy, runCopy);
  };

  doc.addEventListener("keydown", onKeydown, true);
  return () => {
    removed = true;
    doc.removeEventListener("keydown", onKeydown, true);
    if (feedbackTimer !== null) clearTimeout(feedbackTimer);
    feedback.remove();
  };
}

/** Install q/s/d playback navigation and return the cleanup function. */
export function installPlaybackShortcuts(
  doc: Document,
  adapter: Pick<PlatformAdapter, "getCurrentTime" | "isPaused" | "seekTo" | "getNavigationSessionId">,
  navigator: CueNavigator,
): () => void {
  let removed = false;
  let seekQueue: Promise<void> = Promise.resolve();

  const onKeydown = (event: KeyboardEvent): void => {
    if (
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isBlockedTarget(event.target)
    ) {
      return;
    }

    const action = shortcutActionForKey(event.key);
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const resume = !adapter.isPaused();
    const pressedAt = adapter.getCurrentTime();
    // Resolve at keydown, against the displayed snapshot the user acted on.
    // Queuing transport must not change the meaning of a queued key press.
    const seekTime = navigator.getSeekTime(action, pressedAt);
    if (seekTime === null) return;
    const sessionId = adapter.getNavigationSessionId?.();
    const runSeek = async (): Promise<void> => {
      if (removed || sessionId !== adapter.getNavigationSessionId?.()) return;

      try {
        const accepted = await adapter.seekTo(seekTime, resume);
        if (accepted) return;
        navigator.cancelPendingSeek();
        console.warn("[SubJap] Playback seek was not accepted by the adapter");
      } catch (err: unknown) {
        navigator.cancelPendingSeek();
        console.warn("[SubJap] Playback seek failed:", err);
      }
    };
    seekQueue = seekQueue.then(runSeek, runSeek);
  };

  doc.addEventListener("keydown", onKeydown, true);
  return () => {
    removed = true;
    doc.removeEventListener("keydown", onKeydown, true);
  };
}

/** Install the global-in-the-page Space pause/play shortcut. */
export function installPausePlayShortcut(
  doc: Document,
  adapter: Pick<PlatformAdapter, "getVideoElement">,
): () => void {
  let removed = false;

  const onKeydown = (event: KeyboardEvent): void => {
    if (
      event.code !== "Space" ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isTextEntryTarget(event.target)
    ) {
      return;
    }

    const video = adapter.getVideoElement();
    if (!video) return;

    // Stop Netflix's native Space shortcut and the default button/page scroll
    // action. Calling pause/play on the media element remains valid for the
    // DRM-backed Netflix player; unlike currentTime, it does not desynchronise
    // Netflix's internal playback state.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (video.paused) {
      void video.play().catch((err: unknown) => {
        if (!removed) console.warn("[SubJap] Playback resume failed:", err);
      });
    } else {
      video.pause();
    }
  };

  doc.addEventListener("keydown", onKeydown, true);
  return () => {
    removed = true;
    doc.removeEventListener("keydown", onKeydown, true);
  };
}
