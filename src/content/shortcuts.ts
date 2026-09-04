import type { PlatformAdapter, SubtitleCue } from "@/core/types";
import { normalizeCueText } from "@/subtitles";

export type CueShortcutAction = "previous" | "current" | "next";

const NEXT_CUE_OFFSET_SECONDS = 0.05;
const MATCH_TOLERANCE_SECONDS = 1;
const PROVISIONAL_CUE_PREROLL_SECONDS = 0.15;
const PENDING_TTL_MS = 1_500;
const STALE_DISPLAY_SECONDS = 0.75;
const COPY_FEEDBACK_DURATION_MS = 1_000;
const COPY_FEEDBACK_ID = "subjap-copy-feedback";

/**
 * Keeps the subtitle cues observed during playback so keyboard navigation can
 * revisit them even though Netflix only exposes the currently visible cues.
 */
export class CueNavigator {
  private official: SubtitleCue[] = [];
  private domCues: SubtitleCue[] = [];
  private displayed: SubtitleCue[] = [];
  private pending: { cue: SubtitleCue; issuedAtMs: number } | null = null;
  private lastRememberedCues: SubtitleCue[] | null = null;

  observe(cues: SubtitleCue[]): void {
    const meaningfulCues = cues.filter((cue) => normalizeCueText(cue.text).length > 0);
    this.displayed = meaningfulCues.map((cue) => {
      if (this.findMatchingCue(cue, this.official)) return cue;

      const canonical = this.domCues.find(
        (candidate) =>
          this.comparisonText(candidate.text) === this.comparisonText(cue.text) &&
          this.isSameOccurrence(candidate, cue),
      );
      if (canonical) return canonical;
      this.domCues.push(cue);
      return cue;
    });
    this.domCues.sort((a, b) => a.start - b.start);

    if (
      this.pending &&
      this.displayed.some((cue) => this.isSameOccurrence(cue, this.pending!.cue))
    ) {
      this.pending = null;
    }
  }

  /** Add authoritative track cues to navigation without rendering them. */
  remember(cues: SubtitleCue[]): void {
    // Netflix emits the current cue on every media timeupdate. The official
    // track keeps the same array instance until a new track is loaded.
    if (this.lastRememberedCues === cues) return;
    this.lastRememberedCues = cues;
    this.official = cues
      .filter((cue) => normalizeCueText(cue.text).length > 0)
      .slice()
      .sort((a, b) => a.start - b.start);
    this.domCues = this.domCues.filter(
      (domCue) => !this.findMatchingCue(domCue, this.official),
    );

    if (this.pending) {
      const officialCue = this.findMatchingCue(this.pending.cue, this.official);
      if (officialCue) this.pending = { ...this.pending, cue: officialCue };
    }
  }

  reset(): void {
    this.official = [];
    this.domCues = [];
    this.displayed = [];
    this.pending = null;
    this.lastRememberedCues = null;
  }

  getSeekTime(action: CueShortcutAction, pressedAt: number): number | null {
    const timeline = this.timeline();
    const now = performance.now();
    if (this.pending && now - this.pending.issuedAtMs >= PENDING_TTL_MS) {
      this.pending = null;
    }

    let base: SubtitleCue | null = null;
    let source: "official" | "dom" | "pending" | "gap" = "gap";
    if (this.pending) {
      base = this.pending.cue;
      source = "pending";
    } else if (this.displayed.length > 0) {
      base = this.findMatchingCue(this.displayed[0]!, timeline);
      if (
        base &&
        base.endConfirmed !== false &&
        pressedAt > base.end + STALE_DISPLAY_SECONDS
      ) {
        base = null;
      }
      if (base) source = this.official.includes(base) ? "official" : "dom";
    }

    let targetCue: SubtitleCue | null = null;
    let targetTime: number | null = null;

    if (base) {
      const baseIndex = this.indexOfCue(base, timeline);
      if (action === "current") {
        targetCue = base;
      } else if (action === "previous") {
        targetCue = baseIndex > 0 ? timeline[baseIndex - 1] ?? null : null;
      } else {
        targetCue = baseIndex >= 0 ? timeline[baseIndex + 1] ?? null : null;
        if (
          !targetCue &&
          base.endConfirmed !== false &&
          base.end > base.start
        ) {
          targetTime = Math.max(base.end, pressedAt) + NEXT_CUE_OFFSET_SECONDS;
        }
      }
    } else if (action === "next") {
      targetCue = timeline.find((cue) => cue.start > pressedAt) ?? null;
    } else {
      targetCue = [...timeline].reverse().find((cue) => cue.start <= pressedAt) ?? null;
    }

    if (targetCue) {
      targetTime = targetCue.start;
      this.pending = { cue: targetCue, issuedAtMs: now };
    }

    console.debug(
      `[SubJap] nav ${action} at=${pressedAt} base=${base?.start ?? "gap"} ` +
        `src=${source} target=${targetTime ?? "null"} ` +
        `official=${this.official.length} dom=${this.domCues.length}`,
    );
    return targetTime;
  }

  cancelPendingSeek(): void {
    this.pending = null;
  }

  private timeline(): SubtitleCue[] {
    const uncoveredDomCues = this.domCues.filter(
      (domCue) => !this.findMatchingCue(domCue, this.official),
    );
    return [...this.official, ...uncoveredDomCues].sort((a, b) => a.start - b.start);
  }

  private indexOfCue(cue: SubtitleCue, timeline: SubtitleCue[]): number {
    const exactIndex = timeline.indexOf(cue);
    if (exactIndex >= 0) return exactIndex;
    const matching = this.findMatchingCue(cue, timeline);
    return matching ? timeline.indexOf(matching) : -1;
  }

  private findMatchingCue(
    cue: SubtitleCue,
    candidates: SubtitleCue[],
  ): SubtitleCue | null {
    return (
      candidates
        .filter((candidate) => this.isSameOccurrence(candidate, cue))
        .sort(
          (a, b) =>
            Math.abs(a.start - cue.start) - Math.abs(b.start - cue.start),
        )[0] ?? null
    );
  }

  private isSameOccurrence(a: SubtitleCue, b: SubtitleCue): boolean {
    const [aStart, aEnd] = this.cueExtent(a);
    const [bStart, bEnd] = this.cueExtent(b);
    const startsNear = Math.abs(a.start - b.start) <= MATCH_TOLERANCE_SECONDS;
    const rangesOverlap = aStart < bEnd && bStart < aEnd;
    return startsNear || rangesOverlap;
  }

  private cueExtent(cue: SubtitleCue): [number, number] {
    if (cue.endConfirmed === false) {
      const point = cue.start + PROVISIONAL_CUE_PREROLL_SECONDS;
      return [point, point];
    }
    return [cue.start, Math.max(cue.start, cue.end)];
  }

  /** Netflix rebuilds the same Japanese cue with unstable presentation spaces. */
  private comparisonText(text: string): string {
    return normalizeCueText(text).replace(/\s+/gu, "");
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
  adapter: Pick<PlatformAdapter, "getCurrentTime" | "isPaused" | "seekTo">,
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
    const runSeek = async (): Promise<void> => {
      if (removed) return;
      const seekTime = navigator.getSeekTime(action, pressedAt);
      if (seekTime === null) return;

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
