// ---------------------------------------------------------------------------
// SubJap — Offsets of the tracks the player itself provides
//
// An imported file keeps its offset in its own record. The player's Japanese
// track and translation have no record: their offsets are stored per video
// here. Whether the popup shifts both tracks together is a global choice.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";

const TRANSLATION_PREFIX = "subjap_translation_offset_";
const JAPANESE_PREFIX = "subjap_japanese_offset_";
const LINKED_KEY = "subjap_linked_offsets";

export function translationOffsetStorageKey(videoId: string): string {
  return `${TRANSLATION_PREFIX}${videoId}`;
}

export function japaneseOffsetStorageKey(videoId: string): string {
  return `${JAPANESE_PREFIX}${videoId}`;
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

/** Seconds added to the player's Japanese track of this video; 0 when unset. */
export function getJapaneseOffset(videoId: string): Promise<number> {
  return readOffset(japaneseOffsetStorageKey(videoId));
}

export function saveJapaneseOffset(videoId: string, seconds: number): Promise<void> {
  return writeOffset(japaneseOffsetStorageKey(videoId), seconds);
}

/** True when changing one track's offset changes the other by as much. */
export async function getLinkedOffsets(): Promise<boolean> {
  return (await chrome.storage.local.get(LINKED_KEY))[LINKED_KEY] === true;
}

export async function saveLinkedOffsets(linked: boolean): Promise<void> {
  await chrome.storage.local.set({ [LINKED_KEY]: linked });
}

/**
 * Follows the offsets of the current video and shifts cues by them,
 * reusing each shifted copy while nothing changes.
 */
export class VideoOffsetWatcher {
  private videoId: string | null = null;
  private japanese = 0;
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
    if (changes[translationOffsetStorageKey(this.videoId)] || changes[japaneseOffsetStorageKey(this.videoId)]) {
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
    if (this.japanese !== 0 || this.translation !== 0) {
      this.japanese = 0;
      this.translation = 0;
      this.onChange();
    }
    this.load();
  }

  shiftPlayerJapanese(cues: SubtitleCue[]): SubtitleCue[] {
    return this.shift(cues, this.japanese);
  }

  shiftPlayerTranslation(cues: SubtitleCue[]): SubtitleCue[] {
    return this.shift(cues, this.translation);
  }

  destroy(): void {
    if (this.listening) chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.listening = false;
    this.videoId = null;
    this.japanese = 0;
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
    void Promise.all([getJapaneseOffset(videoId), getTranslationOffset(videoId)]).then(([japanese, translation]) => {
      if (revision !== this.revision) return;
      if (japanese === this.japanese && translation === this.translation) return;
      this.japanese = japanese;
      this.translation = translation;
      this.onChange();
    }).catch(() => {
      // Without storage the tracks keep their own timing.
    });
  }
}
