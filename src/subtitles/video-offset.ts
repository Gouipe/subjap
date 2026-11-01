// ---------------------------------------------------------------------------
// SubJap — Offsets of the tracks the player itself provides
//
// An imported file keeps its offset in its own record. The player's Japanese
// track and translation have no record: their offsets are stored per video
// here. Whether the popup shifts both tracks together is a global choice.
// The translation's offset is first set automatically, once per video, to
// start its lines with the Japanese ones.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";
import { estimateTranslationShift } from "./auto-sync";

const TRANSLATION_PREFIX = "subjap_translation_offset_";
const TRANSLATION_CHECKED_PREFIX = "subjap_translation_offset_checked_";
const JAPANESE_PREFIX = "subjap_japanese_offset_";
const LINKED_KEY = "subjap_linked_offsets";
/** Smaller automatic shifts are not worth changing the user's value. */
const MIN_AUTOMATIC_SHIFT_SECONDS = 0.05;

export function translationOffsetStorageKey(videoId: string): string {
  return `${TRANSLATION_PREFIX}${videoId}`;
}

function translationOffsetCheckedStorageKey(videoId: string): string {
  return `${TRANSLATION_CHECKED_PREFIX}${videoId}`;
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

/**
 * Who last set the translation's offset of a video: the automatic alignment
 * ("auto"), the user ("user"), or nobody once measured as already aligned
 * ("measured"). Unset until then.
 */
type TranslationOffsetOrigin = "auto" | "user" | "measured";

async function translationOffsetOrigin(videoId: string): Promise<TranslationOffsetOrigin | null> {
  const key = translationOffsetCheckedStorageKey(videoId);
  const value = (await chrome.storage.local.get(key))[key] as unknown;
  return value === "auto" || value === "user" || value === "measured" ? value : null;
}

/** True while the translation's offset is the one set automatically. */
export async function isTranslationOffsetAutomatic(videoId: string): Promise<boolean> {
  return (await translationOffsetOrigin(videoId)) === "auto";
}

/** The user set the translation's offset: it is never set automatically again. */
export async function markTranslationOffsetSetByUser(videoId: string): Promise<void> {
  await chrome.storage.local.set({ [translationOffsetCheckedStorageKey(videoId)]: "user" });
}

/** True when a change of storage may change whether the offset is automatic. */
export function isTranslationOffsetOriginChange(
  changes: Record<string, chrome.storage.StorageChange>,
  videoId: string,
): boolean {
  return !!changes[translationOffsetCheckedStorageKey(videoId)];
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
  /** Null until known for the current video. */
  private translationChecked: boolean | null = null;
  private aligning = false;
  private lastMeasured: { japanese: SubtitleCue[]; translation: SubtitleCue[] } | null = null;
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
    if (
      changes[translationOffsetStorageKey(this.videoId)] ||
      changes[japaneseOffsetStorageKey(this.videoId)] ||
      changes[translationOffsetCheckedStorageKey(this.videoId)]
    ) {
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
    this.translationChecked = null;
    this.lastMeasured = null;
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

  /**
   * Once per video, sets the player's translation offset so that its lines
   * start with the Japanese ones. Both lists are the cues as shown, offsets
   * included; the measured gap adds to the current offset. An offset the
   * user set on the translation is never replaced.
   */
  alignTranslation(japanese: SubtitleCue[], translation: SubtitleCue[]): void {
    const videoId = this.videoId;
    if (!videoId || this.translationChecked !== false || this.aligning) return;
    // Shifted copies are reused: the same tracks need no new measure.
    if (this.lastMeasured?.japanese === japanese && this.lastMeasured.translation === translation) return;
    this.lastMeasured = { japanese, translation };
    const shift = estimateTranslationShift(
      japanese.filter((cue) => cue.endConfirmed !== false).map((cue) => cue.start),
      translation.map((cue) => cue.start),
    );
    // Without a clear measure, try again as the tracks complete.
    if (shift === null) return;
    const offset = Math.round((this.translation + shift) * 100) / 100;
    this.aligning = true;
    void (async () => {
      if (await translationOffsetOrigin(videoId)) return;
      const originKey = translationOffsetCheckedStorageKey(videoId);
      if (Math.abs(shift) < MIN_AUTOMATIC_SHIFT_SECONDS) {
        await chrome.storage.local.set({ [originKey]: "measured" });
        return;
      }
      // Offset and origin together, so the popup never shows one without the other.
      if (offset === 0) await chrome.storage.local.remove(translationOffsetStorageKey(videoId));
      await chrome.storage.local.set({
        [originKey]: "auto",
        ...(offset === 0 ? {} : { [translationOffsetStorageKey(videoId)]: offset }),
      });
      console.info(`[SubJap] Traduction synchronisée sur le japonais : ${offset.toFixed(2)} s`);
    })().catch((error: unknown) => {
      console.warn("[SubJap] Synchronisation de la traduction impossible:", error);
    }).finally(() => {
      this.aligning = false;
      if (this.videoId === videoId) this.translationChecked = true;
    });
  }

  destroy(): void {
    if (this.listening) chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.listening = false;
    this.videoId = null;
    this.japanese = 0;
    this.translation = 0;
    this.translationChecked = null;
    this.lastMeasured = null;
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
    void Promise.all([
      getJapaneseOffset(videoId),
      getTranslationOffset(videoId),
      translationOffsetOrigin(videoId),
    ]).then(([japanese, translation, origin]) => {
      if (revision !== this.revision) return;
      this.translationChecked = origin !== null;
      if (japanese === this.japanese && translation === this.translation) return;
      this.japanese = japanese;
      this.translation = translation;
      this.onChange();
    }).catch(() => {
      // Without storage the tracks keep their own timing.
    });
  }
}
