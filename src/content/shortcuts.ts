import type { PlatformAdapter, SubtitleCue } from "@/core/types";

export type CueShortcutAction = "previous" | "current" | "next";

const NEXT_CUE_OFFSET_SECONDS = 0.05;
const REEMITTED_CUE_TOLERANCE_SECONDS = 1;

/**
 * Keeps the subtitle cues observed during playback so keyboard navigation can
 * revisit them even though Netflix only exposes the currently visible cues.
 */
export class CueNavigator {
  private currentCues: SubtitleCue[] = [];
  private observedCues = new Map<string, SubtitleCue>();
  /** Logical destination retained while Netflix rebuilds timed text after seek. */
  private seekAnchor: SubtitleCue | null = null;

  observe(cues: SubtitleCue[]): void {
    const observed = this.canonicalizeCues(this.applySeekAnchor(cues));
    this.currentCues = observed;
    for (const cue of observed) {
      this.observedCues.set(this.keyFor(cue), cue);
    }
  }

  reset(): void {
    this.currentCues = [];
    this.observedCues.clear();
    this.seekAnchor = null;
  }

  getSeekTime(action: CueShortcutAction, currentTime: number): number | null {
    const current = this.seekAnchor ?? this.findCurrentCue(currentTime);
    if (!current) {
      if (action !== "previous") return null;

      // During the gap after a cue, Netflix exposes no current cue. Q should
      // still replay the last subtitle that has already been observed.
      const previous = [...this.observedCues.values()]
        .filter((cue) => cue.start <= currentTime)
        .sort((a, b) => b.start - a.start)[0] ?? null;
      this.seekAnchor = previous;
      return previous?.start ?? null;
    }

    if (action === "current") {
      this.seekAnchor = current;
      return current.start;
    }

    const ordered = [...this.observedCues.values()].sort((a, b) => a.start - b.start);

    if (action === "previous") {
      const previous = [...ordered].reverse().find((cue) => cue.start < current.start);
      this.seekAnchor = previous ?? null;
      return previous?.start ?? null;
    }

    const next = ordered.find((cue) => cue.start > current.start);
    if (next) {
      this.seekAnchor = next;
      return next.start;
    }

    this.seekAnchor = current;
    return Math.max(current.end, currentTime) + NEXT_CUE_OFFSET_SECONDS;
  }

  cancelPendingSeek(): void {
    this.seekAnchor = null;
  }

  private findCurrentCue(currentTime: number): SubtitleCue | null {
    const active = this.currentCues.find(
      (cue) => currentTime >= cue.start && currentTime < cue.end,
    );
    if (active) return active;

    const observedActive = [...this.observedCues.values()].find(
      (cue) => currentTime >= cue.start && currentTime < cue.end,
    );
    return observedActive ?? this.currentCues[0] ?? null;
  }

  private keyFor(cue: SubtitleCue): string {
    return `${cue.id}\u0000${cue.start}\u0000${cue.end}\u0000${cue.text}`;
  }

  private applySeekAnchor(cues: SubtitleCue[]): SubtitleCue[] {
    const anchor = this.seekAnchor;
    if (!anchor || cues.length === 0) return cues;

    let matched = false;
    const stabilized = cues.map((cue) => {
      if (
        cue.text !== anchor.text ||
        cue.language !== anchor.language ||
        Math.abs(cue.start - anchor.start) > REEMITTED_CUE_TOLERANCE_SECONDS
      ) {
        return cue;
      }
      matched = true;
      return anchor;
    });

    if (!matched) this.seekAnchor = null;
    return stabilized;
  }

  private canonicalizeCues(cues: SubtitleCue[]): SubtitleCue[] {
    const observed = [...this.observedCues.values()];
    return cues.map((cue) => {
      const equivalent = observed.find(
        (candidate) =>
          candidate.text === cue.text &&
          candidate.language === cue.language &&
          Math.abs(candidate.start - cue.start) <=
            REEMITTED_CUE_TOLERANCE_SECONDS,
      );
      return equivalent ?? cue;
    });
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

/** Install q/s/d playback navigation and return the cleanup function. */
export function installPlaybackShortcuts(
  doc: Document,
  adapter: Pick<PlatformAdapter, "getCurrentTime" | "seekTo">,
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
    const runSeek = async (): Promise<void> => {
      if (removed) return;
      const seekTime = navigator.getSeekTime(action, adapter.getCurrentTime());
      if (seekTime === null) return;

      try {
        const accepted = await adapter.seekTo(seekTime, true);
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
