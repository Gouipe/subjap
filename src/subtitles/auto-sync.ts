// ---------------------------------------------------------------------------
// SubJap — Align an imported Japanese file on the player's own translation
//
// Japanese and translated lines rarely share their text, but most of them
// start together. Voting on the gap between nearby starts gives a sharp peak
// at the true offset; random pairs spread out. The file is only shifted when
// that peak is clear and beats the current alignment by far: an already
// synchronised file is never touched.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";
import { getLocalSubtitle, saveLocalSubtitle } from "./local-storage";
import { parseSubtitleFile } from "./parse";

const MAX_GAP_SECONDS = 60;
const BIN_SECONDS = 0.1;
/**
 * Files timed by different people start the same line a few tenths apart:
 * a line "matches" within this tolerance, and votes are pooled as widely.
 */
const MATCH_TOLERANCE_SECONDS = 0.5;
const PEAK_HALF_WIDTH_BINS = 5;
/** Another peak this far away means another plausible alignment. */
const RIVAL_DISTANCE_BINS = 20;
const MIN_CUES = 20;
const MIN_MATCHED = 15;
const MIN_MATCHED_SHARE = 0.3;
/**
 * Smaller shifts are left alone: translations often start a little before
 * the voice, and the user finds such files already in time.
 */
const MIN_SHIFT_SECONDS = 1;
/** Two comparable peaks: the episode cut differs, a single shift would be wrong. */
const MIN_PEAK_RATIO = 1.6;

function sorted(values: number[]): number[] {
  return values.filter(Number.isFinite).sort((left, right) => left - right);
}

/** Japanese lines starting within the tolerance of a translated line, once shifted. */
function countMatches(japanese: number[], reference: number[], offset: number): number {
  let matched = 0;
  let from = 0;
  for (const start of japanese) {
    const target = start + offset;
    while (from < reference.length && (reference[from] ?? 0) < target - MATCH_TOLERANCE_SECONDS) from += 1;
    if (from < reference.length && Math.abs((reference[from] ?? 0) - target) <= MATCH_TOLERANCE_SECONDS) {
      matched += 1;
    }
  }
  return matched;
}

/**
 * Seconds to add to the Japanese file so it starts with the reference, 0 when
 * it already does, or null when the evidence is not clear enough to act.
 */
export function estimateSubtitleOffset(japaneseStarts: number[], referenceStarts: number[]): number | null {
  const japanese = sorted(japaneseStarts);
  const reference = sorted(referenceStarts);
  if (japanese.length < MIN_CUES || reference.length < MIN_CUES) return null;

  const binCount = Math.round((2 * MAX_GAP_SECONDS) / BIN_SECONDS) + 1;
  const votes = new Float64Array(binCount);
  let from = 0;
  for (const start of japanese) {
    while (from < reference.length && (reference[from] ?? 0) < start - MAX_GAP_SECONDS) from += 1;
    for (let index = from; index < reference.length; index += 1) {
      const gap = (reference[index] ?? 0) - start;
      if (gap > MAX_GAP_SECONDS) break;
      const bin = Math.round((gap + MAX_GAP_SECONDS) / BIN_SECONDS);
      votes[bin] = (votes[bin] ?? 0) + 1;
    }
  }
  // A true offset spreads over neighbouring bins: pool them.
  const score = (bin: number): number => {
    let total = 0;
    for (let near = bin - PEAK_HALF_WIDTH_BINS; near <= bin + PEAK_HALF_WIDTH_BINS; near += 1) {
      total += votes[near] ?? 0;
    }
    return total;
  };
  const scores = Array.from({ length: binCount }, (_, bin) => score(bin));
  let best = 0;
  for (let bin = 1; bin < binCount; bin += 1) if ((scores[bin] ?? 0) > (scores[best] ?? 0)) best = bin;
  let rival = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    if (Math.abs(bin - best) > RIVAL_DISTANCE_BINS) rival = Math.max(rival, scores[bin] ?? 0);
  }
  if ((scores[best] ?? 0) < MIN_PEAK_RATIO * rival) return null;

  // Refine on the gaps of the peak itself.
  const center = best * BIN_SECONDS - MAX_GAP_SECONDS;
  const gaps: number[] = [];
  for (const start of japanese) {
    for (const candidate of reference) {
      const gap = candidate - start;
      if (Math.abs(gap - center) <= (PEAK_HALF_WIDTH_BINS + 1) * BIN_SECONDS) gaps.push(gap);
    }
  }
  gaps.sort((left, right) => left - right);
  const offset = gaps[Math.floor(gaps.length / 2)] ?? center;

  const matched = countMatches(japanese, reference, offset);
  if (matched < MIN_MATCHED || matched / japanese.length < MIN_MATCHED_SHARE) return null;
  if (Math.abs(offset) < MIN_SHIFT_SECONDS) return 0;
  // The current alignment must be clearly worse than the shifted one.
  const unshifted = countMatches(japanese, reference, 0);
  if (matched < 1.5 * unshifted + 5) return 0;
  return Math.round(offset * 100) / 100;
}

// ---------------------------------------------------------------------------
// Applying it to a video's local Japanese track
// ---------------------------------------------------------------------------

export interface AutoSyncEvent {
  videoId: string;
  offsetSeconds: number;
}

const listeners = new Set<(event: AutoSyncEvent) => void>();

/** Told once each time a local Japanese track is shifted automatically. */
export function onLocalSubtitleAutoSync(listener: (event: AutoSyncEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shift a video's local Japanese file once, onto the player's translation.
 * Files whose offset the user set, or already shifted, are left alone.
 */
export class LocalSubtitleAutoSync {
  private attempted = "";

  /**
   * Call whenever the local Japanese track or the native translations change;
   * repeated calls with the same inputs do nothing.
   */
  run(videoId: string | null, primarySession: string | undefined, translations: SubtitleCue[][]): void {
    const reference = translations.find((cues) => cues.length >= MIN_CUES);
    if (!videoId || !primarySession || !reference) return;
    const key = `${videoId}\u0000${primarySession}\u0000${reference.length}\u0000${reference[0]?.source?.sessionId ?? ""}`;
    if (key === this.attempted) return;
    this.attempted = key;
    void this.align(videoId, reference).catch((error: unknown) => {
      console.warn("[SubJap] Synchronisation automatique impossible:", error);
    });
  }

  reset(): void {
    this.attempted = "";
  }

  private async align(videoId: string, reference: SubtitleCue[]): Promise<void> {
    const record = await getLocalSubtitle(videoId, "primary");
    if (!record || record.syncChecked || record.offsetSeconds !== 0) return;
    const japanese = parseSubtitleFile(record.fileName, record.content).map((cue) => cue.start);
    const offset = estimateSubtitleOffset(japanese, reference.map((cue) => cue.start));
    if (!offset) return;
    // The user may have replaced the file or set an offset meanwhile.
    const current = await getLocalSubtitle(videoId, "primary");
    if (!current || current.updatedAt !== record.updatedAt || current.offsetSeconds !== 0 || current.syncChecked) return;
    await saveLocalSubtitle(videoId, { ...current, offsetSeconds: offset, syncChecked: true }, "primary");
    console.info(`[SubJap] Sous-titres japonais recalés de ${offset} s sur la traduction.`);
    for (const listener of listeners) listener({ videoId, offsetSeconds: offset });
  }
}
