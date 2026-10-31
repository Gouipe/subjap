// ---------------------------------------------------------------------------
// SubJap — Offset of the translation the player itself provides
//
// An imported translation file keeps its offset in its own record. The
// player's translation has no record: its offset is stored per video here.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";

const STORAGE_PREFIX = "subjap_translation_offset_";

export function translationOffsetStorageKey(videoId: string): string {
  return `${STORAGE_PREFIX}${videoId}`;
}

/** Seconds added to the player's translation of this video; 0 when unset. */
export async function getTranslationOffset(videoId: string): Promise<number> {
  const key = translationOffsetStorageKey(videoId);
  const value = (await chrome.storage.local.get(key))[key] as unknown;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function saveTranslationOffset(videoId: string, seconds: number): Promise<void> {
  const key = translationOffsetStorageKey(videoId);
  if (seconds === 0) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: Math.round(seconds * 100) / 100 });
}

/**
 * Follows the offset of the current video and shifts the player's
 * translation cues by it, reusing the shifted copy while nothing changes.
 */
export class TranslationOffsetWatcher {
  private videoId: string | null = null;
  private offset = 0;
  private revision = 0;
  private listening = false;
  private readonly shifted = new WeakMap<SubtitleCue[], { offset: number; cues: SubtitleCue[] }>();

  /** `onChange` runs when the offset of the current video changes. */
  constructor(private readonly onChange: () => void) {}

  private readonly onStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area === "local" && this.videoId && changes[translationOffsetStorageKey(this.videoId)]) {
      this.load();
    }
  };

  setVideo(videoId: string | null): void {
    if (!this.listening) {
      chrome.storage.onChanged.addListener(this.onStorageChange);
      this.listening = true;
    }
    if (videoId === this.videoId) return;
    this.videoId = videoId;
    if (this.offset !== 0) {
      this.offset = 0;
      this.onChange();
    }
    this.load();
  }

  apply(cues: SubtitleCue[]): SubtitleCue[] {
    if (this.offset === 0 || cues.length === 0) return cues;
    const cached = this.shifted.get(cues);
    if (cached?.offset === this.offset) return cached.cues;
    const offset = this.offset;
    const shifted = cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
    this.shifted.set(cues, { offset, cues: shifted });
    return shifted;
  }

  destroy(): void {
    if (this.listening) chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.listening = false;
    this.videoId = null;
    this.offset = 0;
    this.revision += 1;
  }

  private load(): void {
    const videoId = this.videoId;
    const revision = ++this.revision;
    if (!videoId) return;
    void getTranslationOffset(videoId).then((offset) => {
      if (revision !== this.revision || offset === this.offset) return;
      this.offset = offset;
      this.onChange();
    }).catch(() => {
      // Without storage the translation keeps the player's timing.
    });
  }
}
