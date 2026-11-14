// ---------------------------------------------------------------------------
// SubJap — Offsets of the tracks the player itself provides
//
// An imported file keeps its offset in its own record. The player's Japanese
// track and translation have no record: their offsets are stored per video
// here. Whether the popup shifts both tracks together is a global choice.
// The translation's offset is set automatically to start its lines with the
// Japanese ones, once per Japanese track: choosing another Japanese file
// measures it again. Like an imported file, the player's own Japanese track
// is aligned once, by parts, on the player's translation.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";
import { announceAutoSync, estimateSubtitleSync, estimateTranslationShift, syncReference } from "./auto-sync";
import { getLocalSubtitle, saveLocalSubtitle, syncSegmentOffset, type SyncSegment } from "./local-storage";

const TRANSLATION_PREFIX = "subjap_translation_offset_";
const TRANSLATION_CHECKED_PREFIX = "subjap_translation_offset_checked_";
const TRANSLATION_MEASURED_TRACK_PREFIX = "subjap_translation_offset_track_";
const JAPANESE_PREFIX = "subjap_japanese_offset_";
const JAPANESE_SYNC_PREFIX = "subjap_japanese_sync_";
const NO_SEGMENTS: SyncSegment[] = [];
const LINKED_KEY = "subjap_linked_offsets";
/** Smaller automatic shifts are not worth changing the user's value. */
const MIN_AUTOMATIC_SHIFT_SECONDS = 0.05;

export function translationOffsetStorageKey(videoId: string): string {
  return `${TRANSLATION_PREFIX}${videoId}`;
}

function translationOffsetCheckedStorageKey(videoId: string): string {
  return `${TRANSLATION_CHECKED_PREFIX}${videoId}`;
}

function translationMeasuredTrackStorageKey(videoId: string): string {
  return `${TRANSLATION_MEASURED_TRACK_PREFIX}${videoId}`;
}

/**
 * The Japanese track the cues come from: an imported file (a new import or
 * another Jimaku file is a new track), or the player's own track.
 */
function japaneseTrackIdentity(cues: SubtitleCue[]): string | null {
  const source = cues[0]?.source;
  if (!source) return null;
  return source.trackId?.startsWith("local-")
    ? source.sessionId
    : `${source.trackId ?? ""}\u0000${source.resourceId ?? ""}`;
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

function asOrigin(value: unknown): TranslationOffsetOrigin | null {
  return value === "auto" || value === "user" || value === "measured" ? value : null;
}

async function translationOffsetOrigin(videoId: string): Promise<TranslationOffsetOrigin | null> {
  const key = translationOffsetCheckedStorageKey(videoId);
  return asOrigin((await chrome.storage.local.get(key))[key]);
}

interface TranslationAlignment {
  origin: TranslationOffsetOrigin | null;
  /** The Japanese track the offset was last measured on. */
  track: string | null;
}

async function translationAlignment(videoId: string): Promise<TranslationAlignment> {
  const originKey = translationOffsetCheckedStorageKey(videoId);
  const trackKey = translationMeasuredTrackStorageKey(videoId);
  const stored = await chrome.storage.local.get([originKey, trackKey]);
  const track = stored[trackKey] as unknown;
  return { origin: asOrigin(stored[originKey]), track: typeof track === "string" ? track : null };
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

/**
 * The automatic alignment of the player's Japanese track on its translation:
 * the parts and their offset, none once checked, cancelled or when the user
 * set the offset first (no track then: no track of the video is aligned).
 */
interface PlayerJapaneseSync {
  track: string | null;
  segments: SyncSegment[];
}

function japaneseSyncStorageKey(videoId: string): string {
  return `${JAPANESE_SYNC_PREFIX}${videoId}`;
}

/** The track's file, without the query a site may renew at each visit. */
function playerJapaneseTrack(cues: SubtitleCue[]): string | null {
  const source = cues[0]?.source;
  if (!source || source.trackId?.startsWith("local-")) return null;
  return `${source.trackId ?? ""}\u0000${(source.resourceId ?? "").replace(/[?#].*$/, "")}`;
}

function asPlayerJapaneseSync(value: unknown): PlayerJapaneseSync | null {
  if (!value || typeof value !== "object") return null;
  const { track, segments } = value as Partial<PlayerJapaneseSync>;
  if ((track !== null && typeof track !== "string") || !Array.isArray(segments)) return null;
  return {
    track,
    segments: segments.filter((segment): segment is SyncSegment =>
      Number.isFinite(segment?.from) && Number.isFinite(segment?.offset)),
  };
}

async function readPlayerJapaneseSync(videoId: string): Promise<PlayerJapaneseSync | null> {
  const key = japaneseSyncStorageKey(videoId);
  return asPlayerJapaneseSync((await chrome.storage.local.get(key))[key]);
}

/** Parts of the player's Japanese track shifted automatically; empty when none. */
export async function getPlayerJapaneseSync(videoId: string): Promise<SyncSegment[]> {
  return (await readPlayerJapaneseSync(videoId))?.segments ?? [];
}

/** Back to the player's own timing; the user's offset stays. */
export async function cancelPlayerJapaneseSync(videoId: string): Promise<void> {
  const stored = await readPlayerJapaneseSync(videoId);
  if (!stored?.segments.length) return;
  await chrome.storage.local.set({ [japaneseSyncStorageKey(videoId)]: { track: stored.track, segments: [] } });
}

/** The user set the Japanese offset first: the player's track is never aligned. */
export async function markJapaneseOffsetSetByUser(videoId: string): Promise<void> {
  if (await readPlayerJapaneseSync(videoId)) return;
  await chrome.storage.local.set({ [japaneseSyncStorageKey(videoId)]: { track: null, segments: [] } });
}

/**
 * A Japanese track SubJap can shift (an imported file, an Artplayer or Vidstack track)
 * moves onto the translation: the translation is never shifted to follow it.
 */
function isMovableJapanese(cues: SubtitleCue[]): boolean {
  const trackId = cues[0]?.source?.trackId ?? "";
  return trackId.startsWith("local-") || trackId.startsWith("artplayer-") || trackId.startsWith("vidstack-");
}

/**
 * Removes the translation's offset set automatically to follow the Japanese
 * (the former rule), and lets the automatic alignment measure the Japanese
 * again on the translation's own timing. Offsets the user set stay.
 */
async function retireAutomaticTranslationOffset(videoId: string): Promise<void> {
  const [stored, record, sync] = await Promise.all([
    translationAlignment(videoId),
    getLocalSubtitle(videoId, "primary"),
    readPlayerJapaneseSync(videoId),
  ]);
  if (stored.origin !== "auto") return;
  // The Japanese first, so that it is measured on the translation's own timing.
  if (record?.syncChecked && record.offsetSeconds === 0) {
    await saveLocalSubtitle(videoId, { ...record, syncChecked: false, syncSegments: undefined }, "primary");
  }
  if (sync?.track) await chrome.storage.local.remove(japaneseSyncStorageKey(videoId));
  await chrome.storage.local.remove([
    translationOffsetStorageKey(videoId),
    translationOffsetCheckedStorageKey(videoId),
    translationMeasuredTrackStorageKey(videoId),
  ]);
  console.info("[SubJap] Décalage automatique de la traduction retiré : le japonais se cale sur elle.");
}

export function isPlayerJapaneseSyncChange(
  changes: Record<string, chrome.storage.StorageChange>,
  videoId: string,
): boolean {
  return !!changes[japaneseSyncStorageKey(videoId)];
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
  /** Undefined until known for the current video. */
  private alignment: TranslationAlignment | undefined;
  private aligning = false;
  private lastMeasured: { japanese: SubtitleCue[]; translation: SubtitleCue[] } | null = null;
  /** Undefined until known for the current video. */
  private japaneseSync: PlayerJapaneseSync | null | undefined;
  private japaneseSyncing = false;
  private japaneseSyncAttempt = "";
  private retiring = false;
  private revision = 0;
  private listening = false;
  private readonly shifted = new WeakMap<
    SubtitleCue[],
    { offset: number; segments: SyncSegment[]; cues: SubtitleCue[] }
  >();

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
      changes[translationOffsetCheckedStorageKey(this.videoId)] ||
      changes[translationMeasuredTrackStorageKey(this.videoId)] ||
      changes[japaneseSyncStorageKey(this.videoId)]
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
    this.alignment = undefined;
    this.lastMeasured = null;
    const synced = !!this.japaneseSync?.segments.length;
    this.japaneseSync = undefined;
    this.japaneseSyncAttempt = "";
    if (this.japanese !== 0 || this.translation !== 0 || synced) {
      this.japanese = 0;
      this.translation = 0;
      this.onChange();
    }
    this.load();
  }

  shiftPlayerJapanese(cues: SubtitleCue[]): SubtitleCue[] {
    const sync = this.japaneseSync;
    const segments = sync?.track && sync.track === playerJapaneseTrack(cues) ? sync.segments : NO_SEGMENTS;
    return this.shift(cues, this.japanese, segments);
  }

  /**
   * Whether a Japanese track SubJap can shift may be aligned automatically on
   * the translation now: once the offsets are known, and once a translation
   * offset set automatically under the former rule is removed.
   */
  readyToMoveJapanese(): boolean {
    const videoId = this.videoId;
    const alignment = this.alignment;
    if (!videoId || !alignment || this.retiring) return false;
    if (alignment.origin !== "auto") return true;
    this.retiring = true;
    void retireAutomaticTranslationOffset(videoId).catch((error: unknown) => {
      console.warn("[SubJap] Décalage de la traduction impossible à retirer:", error);
    }).finally(() => {
      this.retiring = false;
      if (this.videoId === videoId) this.load();
    });
    return false;
  }

  /**
   * Once per track, aligns the player's Japanese track on the player's
   * translations, as shown (the first long enough). Raw Japanese cues: the
   * parts found are kept unless the user set the Japanese offset first.
   */
  syncPlayerJapanese(japanese: SubtitleCue[], translations: SubtitleCue[][]): void {
    const videoId = this.videoId;
    const sync = this.japaneseSync;
    if (!videoId || sync === undefined || sync?.track === null || this.japaneseSyncing || this.japanese !== 0) return;
    if (!japanese.length || !this.readyToMoveJapanese()) return;
    const track = playerJapaneseTrack(japanese);
    const reference = syncReference(translations);
    if (!track || !reference || sync?.track === track) return;
    const attempt = `${videoId}\u0000${track}\u0000${reference.length}\u0000${reference[0]?.source?.sessionId ?? ""}\u0000${reference[0]?.start ?? ""}`;
    if (attempt === this.japaneseSyncAttempt) return;
    this.japaneseSyncAttempt = attempt;
    const estimate = estimateSubtitleSync(japanese.map((cue) => cue.start), reference.map((cue) => cue.start));
    // Without a clear answer, try again as the tracks complete.
    if (estimate === null) return;
    const segments = estimate === "synced" ? [] : estimate;
    this.japaneseSyncing = true;
    void (async () => {
      const [stored, offset] = await Promise.all([readPlayerJapaneseSync(videoId), getJapaneseOffset(videoId)]);
      if (stored && (stored.track === null || stored.track === track)) return;
      if (offset !== 0) return;
      await chrome.storage.local.set({ [japaneseSyncStorageKey(videoId)]: { track, segments } });
      if (!segments.length) return;
      console.info("[SubJap] Sous-titres japonais du lecteur recalés sur la traduction:", segments);
      announceAutoSync({ videoId, segments, track: "player" });
    })().catch((error: unknown) => {
      console.warn("[SubJap] Synchronisation du japonais impossible:", error);
    }).finally(() => {
      this.japaneseSyncing = false;
      if (this.videoId === videoId) this.load();
    });
  }

  shiftPlayerTranslation(cues: SubtitleCue[]): SubtitleCue[] {
    return this.shift(cues, this.translation);
  }

  /**
   * Once per Japanese track, sets the player's translation offset so that its
   * lines start with the Japanese ones. Both lists are the cues as shown,
   * offsets included; the measured gap adds to the current offset. An offset
   * the user set on the translation is never replaced. Only for a Japanese
   * track SubJap cannot shift (Netflix, YouTube): any other moves onto the
   * translation instead.
   */
  alignTranslation(japanese: SubtitleCue[], translation: SubtitleCue[]): void {
    if (isMovableJapanese(japanese)) {
      this.readyToMoveJapanese();
      return;
    }
    const videoId = this.videoId;
    const alignment = this.alignment;
    if (!videoId || !alignment || alignment.origin === "user" || this.aligning) return;
    const track = japaneseTrackIdentity(japanese);
    if (!track || (alignment.origin && alignment.track === track)) return;
    // Shifted copies are reused: the same tracks need no new measure.
    if (this.lastMeasured?.japanese === japanese && this.lastMeasured.translation === translation) return;
    this.lastMeasured = { japanese, translation };
    // An automatic offset measured on another Japanese track is measured
    // again from the translation's own timing, not added to.
    const base = alignment.origin === "auto" ? 0 : this.translation;
    const measured = estimateTranslationShift(
      japanese.filter((cue) => cue.endConfirmed !== false).map((cue) => cue.start),
      translation.map((cue) => cue.start - this.translation + base),
    );
    // Without a clear measure, try again as the tracks complete.
    if (measured === null) return;
    const offset = Math.round((base + measured) * 100) / 100;
    const shift = offset - this.translation;
    this.aligning = true;
    void (async () => {
      const stored = await translationAlignment(videoId);
      if (stored.origin === "user" || (stored.origin && stored.track === track)) return;
      const originKey = translationOffsetCheckedStorageKey(videoId);
      const trackKey = translationMeasuredTrackStorageKey(videoId);
      if (Math.abs(shift) < MIN_AUTOMATIC_SHIFT_SECONDS) {
        // Already aligned: an automatic offset stays automatic.
        await chrome.storage.local.set({
          [originKey]: stored.origin === "auto" ? "auto" : "measured",
          [trackKey]: track,
        });
        return;
      }
      // Offset and origin together, so the popup never shows one without the other.
      if (offset === 0) await chrome.storage.local.remove(translationOffsetStorageKey(videoId));
      await chrome.storage.local.set({
        [originKey]: "auto",
        [trackKey]: track,
        ...(offset === 0 ? {} : { [translationOffsetStorageKey(videoId)]: offset }),
      });
      console.info(`[SubJap] Traduction synchronisée sur le japonais : ${offset.toFixed(2)} s`);
    })().catch((error: unknown) => {
      console.warn("[SubJap] Synchronisation de la traduction impossible:", error);
    }).finally(() => {
      this.aligning = false;
      if (this.videoId === videoId) this.load();
    });
  }

  destroy(): void {
    if (this.listening) chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.listening = false;
    this.videoId = null;
    this.japanese = 0;
    this.translation = 0;
    this.alignment = undefined;
    this.lastMeasured = null;
    this.japaneseSync = undefined;
    this.japaneseSyncAttempt = "";
    this.revision += 1;
  }

  /** Offset plus each cue's part, the parts found on the cues' own timing. */
  private shift(cues: SubtitleCue[], offset: number, segments = NO_SEGMENTS): SubtitleCue[] {
    if ((offset === 0 && !segments.length) || cues.length === 0) return cues;
    const cached = this.shifted.get(cues);
    if (cached?.offset === offset && cached.segments === segments) return cached.cues;
    const shifted = cues.map((cue) => {
      const seconds = offset + syncSegmentOffset(segments, cue.start);
      return { ...cue, start: cue.start + seconds, end: cue.end + seconds };
    });
    this.shifted.set(cues, { offset, segments, cues: shifted });
    return shifted;
  }

  private load(): void {
    const videoId = this.videoId;
    const revision = ++this.revision;
    if (!videoId) return;
    void Promise.all([
      getJapaneseOffset(videoId),
      getTranslationOffset(videoId),
      translationAlignment(videoId),
      readPlayerJapaneseSync(videoId),
    ]).then(([japanese, translation, alignment, sync]) => {
      if (revision !== this.revision) return;
      this.alignment = alignment;
      // The same parts keep their shifted copies.
      const syncChanged = JSON.stringify(sync) !== JSON.stringify(this.japaneseSync ?? null);
      if (syncChanged) this.japaneseSync = sync;
      else if (this.japaneseSync === undefined) this.japaneseSync = null;
      if (japanese === this.japanese && translation === this.translation && !syncChanged) return;
      this.japanese = japanese;
      this.translation = translation;
      this.onChange();
    }).catch(() => {
      // Without storage the tracks keep their own timing.
    });
  }
}
