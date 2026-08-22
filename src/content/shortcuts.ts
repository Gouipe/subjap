import type { PlatformAdapter, SubtitleCue } from "@/core/types";

export type CueShortcutAction = "previous" | "current" | "next";

const NEXT_CUE_OFFSET_SECONDS = 0.05;

/**
 * Keeps the subtitle cues observed during playback so keyboard navigation can
 * revisit them even though Netflix only exposes the currently visible cues.
 */
export class CueNavigator {
  private currentCues: SubtitleCue[] = [];
  private observedCues = new Map<string, SubtitleCue>();

  observe(cues: SubtitleCue[]): void {
    this.currentCues = cues;
    for (const cue of cues) {
      this.observedCues.set(this.keyFor(cue), cue);
    }
  }

  reset(): void {
    this.currentCues = [];
    this.observedCues.clear();
  }

  getSeekTime(action: CueShortcutAction, currentTime: number): number | null {
    const current = this.findCurrentCue(currentTime);
    if (!current) return null;

    if (action === "current") return current.start;

    const ordered = [...this.observedCues.values()].sort((a, b) => a.start - b.start);

    if (action === "previous") {
      const previous = [...ordered].reverse().find((cue) => cue.start < current.start);
      return previous?.start ?? null;
    }

    const next = ordered.find((cue) => cue.start > current.start);
    return next?.start ?? Math.max(current.end, currentTime) + NEXT_CUE_OFFSET_SECONDS;
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

    const seekTime = navigator.getSeekTime(action, adapter.getCurrentTime());
    if (seekTime === null) return;

    event.preventDefault();
    void adapter
      .seekTo(seekTime, true)
      .then((accepted) => {
        if (!accepted) {
          console.warn("[SubJap] Playback seek was not accepted by the adapter");
        }
      })
      .catch((err: unknown) => {
        console.warn("[SubJap] Playback seek failed:", err);
      });
  };

  doc.addEventListener("keydown", onKeydown, true);
  return () => doc.removeEventListener("keydown", onKeydown, true);
}
