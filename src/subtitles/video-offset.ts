// ---------------------------------------------------------------------------
// SubJap — Offsets set for one video, outside imported files
//
// The common offset shifts the Japanese track and the translation together,
// whatever their source. The translation offset shifts only the translation
// the player itself provides: an imported file keeps its offset in its own
// record. Both are stored per video and added to the file offsets.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";

const TRANSLATION_PREFIX = "subjap_translation_offset_";
const COMMON_PREFIX = "subjap_common_offset_";

export function translationOffsetStorageKey(videoId: string): string {
  return `${TRANSLATION_PREFIX}${videoId}`;
}

export function commonOffsetStorageKey(videoId: string): string {
  return `${COMMON_PREFIX}${videoId}`;
}

async function readOffset(key: string): Promise<number> {
  const value = (await chrome.storage.local.get(key))[key] as unknown;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function writeOffset(key: string, seconds: number): Promise<void> {
  if (seconds === 0) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: Math.round(seconds * 100) / 100 });
}

/** Seconds added to the player's translation of this video; 0 when unset. */
export function getTranslationOffset(videoId: string): Promise<number> {
  return readOffset(translationOffsetStorageKey(videoId));
}

export function saveTranslationOffset(videoId: string, seconds: number): Promise<void> {
  return writeOffset(translationOffsetStorageKey(videoId), seconds);
}

/** Seconds added to both tracks of this video; 0 when unset. */
export function getCommonOffset(videoId: string): Promise<number> {
  return readOffset(commonOffsetStorageKey(videoId));
}

export function saveCommonOffset(videoId: string, seconds: number): Promise<void> {
  return writeOffset(commonOffsetStorageKey(videoId), seconds);
}

/**
 * Follows the offsets of the current video and shifts cues by them,
 * reusing each shifted copy while nothing changes.
 */
export class VideoOffsetWatcher {
  private videoId: string | null = null;
  private common = 0;
  private translation = 0;
  private revision = 0;
  private listening = false;
  private readonly shifted = new WeakMap<SubtitleCue[], { offset: number; cues: SubtitleCue[] }>();

  /** `onChange` runs when an offset of the current video changes. */
  constructor(private readonly onChange: () => void) {}

  private readonly onStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local" || !this.videoId) return;
    if (changes[translationOffsetStorageKey(this.videoId)] || changes[commonOffsetStorageKey(this.videoId)]) {
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
    if (this.common !== 0 || this.translation !== 0) {
      this.common = 0;
      this.translation = 0;
      this.onChange();
    }
    this.load();
  }

  /** Japanese cues and imported translations: the common offset only. */
  shiftCommon(cues: SubtitleCue[]): SubtitleCue[] {
    return this.shift(cues, this.common);
  }

  /** The player's own translation: common and translation offsets. */
  shiftPlayerTranslation(cues: SubtitleCue[]): SubtitleCue[] {
    return this.shift(cues, this.common + this.translation);
  }

  destroy(): void {
    if (this.listening) chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.listening = false;
    this.videoId = null;
    this.common = 0;
    this.translation = 0;
    this.revision += 1;
  }

  private shift(cues: SubtitleCue[], offset: number): SubtitleCue[] {
    if (offset === 0 || cues.length === 0) return cues;
    const cached = this.shifted.get(cues);
    if (cached?.offset === offset) return cached.cues;
    const shifted = cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
    this.shifted.set(cues, { offset, cues: shifted });
    return shifted;
  }

  private load(): void {
    const videoId = this.videoId;
    const revision = ++this.revision;
    if (!videoId) return;
    void Promise.all([getCommonOffset(videoId), getTranslationOffset(videoId)]).then(([common, translation]) => {
      if (revision !== this.revision) return;
      if (common === this.common && translation === this.translation) return;
      this.common = common;
      this.translation = translation;
      this.onChange();
    }).catch(() => {
      // Without storage the tracks keep their own timing.
    });
  }
}
