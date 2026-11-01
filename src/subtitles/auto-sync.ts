// ---------------------------------------------------------------------------
// SubJap — Align an imported Japanese file on the player's own translation
//
// Japanese and translated lines rarely share their text, but most of them
// start together. Voting on the gap between nearby starts gives a peak at
// each true offset; random pairs spread out. Two releases of an episode may
// be cut differently (an opening of another length, a removed second), so the
// file is split into parts, each with its own offset, switching only when the
// new offset aligns many more lines. Nothing is shifted unless the result is
// clear and beats the current alignment by far: an already synchronised file
// is never touched.
// ---------------------------------------------------------------------------

import type { SubtitleCue } from "@/core/types";
import { getLocalSubtitle, saveLocalSubtitle, type SyncSegment } from "./local-storage";
import { parseSubtitleFile } from "./parse";

const MAX_GAP_SECONDS = 60;
const BIN_SECONDS = 0.1;
/**
 * Files timed by different people start the same line a few tenths apart:
 * a line "matches" within this tolerance, and votes are pooled as widely.
 */
const MATCH_TOLERANCE_SECONDS = 0.5;
const PEAK_HALF_WIDTH_BINS = 4;
/** Peaks closer than this are the same alignment. */
const DISTINCT_PEAK_BINS = 8;
/** Offsets tried for the parts: the strongest peaks of the vote. */
const MAX_CANDIDATE_OFFSETS = 4;
const MIN_CANDIDATE_SHARE = 0.2;
/** Each stretch of the file also proposes its own best offset. */
const STRETCH_SECONDS = 150;
const MIN_STRETCH_LINES = 6;
const PEAKS_PER_STRETCH = 2;
/** Lines a new part must align, beyond the current offset, to start. */
const SWITCH_PENALTY = 6;
const MIN_CUES = 20;
const MIN_MATCHED = 15;
const MIN_MATCHED_SHARE = 0.3;
/** Several parts must explain the file better than a single offset would. */
const MIN_MATCHED_SHARE_IN_PARTS = 0.4;
/**
 * Smaller shifts are left alone: translations often start a little before
 * the voice, and the user finds such files already in time.
 */
const MIN_SHIFT_SECONDS = 1;

function sorted(values: number[]): number[] {
  return values.filter(Number.isFinite).sort((left, right) => left - right);
}

/** Whether each Japanese line starts within the tolerance of a translated line, once shifted. */
function matchesAt(japanese: number[], reference: number[], offset: number): boolean[] {
  const matches: boolean[] = [];
  let from = 0;
  for (const start of japanese) {
    const target = start + offset;
    while (from < reference.length && (reference[from] ?? 0) < target - MATCH_TOLERANCE_SECONDS) from += 1;
    matches.push(from < reference.length && Math.abs((reference[from] ?? 0) - target) <= MATCH_TOLERANCE_SECONDS);
  }
  return matches;
}

function countTrue(values: boolean[]): number {
  return values.reduce((total, value) => total + (value ? 1 : 0), 0);
}

/**
 * Offsets tried for the parts: the strongest of the whole file, and the
 * strongest of each stretch, so that a short part (a recap before the
 * opening) has its own candidate.
 */
function candidateOffsets(japanese: number[], reference: number[]): number[] {
  const candidates = votePeaks(japanese, reference, MAX_CANDIDATE_OFFSETS);
  const last = japanese.at(-1) ?? 0;
  for (let from = 0; from <= last; from += STRETCH_SECONDS) {
    const stretch = japanese.filter((start) => start >= from && start < from + STRETCH_SECONDS);
    if (stretch.length < MIN_STRETCH_LINES) continue;
    for (const offset of votePeaks(stretch, reference, PEAKS_PER_STRETCH)) {
      if (candidates.every((candidate) => Math.abs(candidate - offset) > DISTINCT_PEAK_BINS * BIN_SECONDS)) {
        candidates.push(offset);
      }
    }
  }
  return candidates;
}

/** The strongest distinct offsets voted for by these lines' nearby starts, refined. */
function votePeaks(japanese: number[], reference: number[], maxPeaks: number): number[] {
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
  const scores = Array.from({ length: binCount }, (_, bin) => {
    let total = 0;
    for (let near = bin - PEAK_HALF_WIDTH_BINS; near <= bin + PEAK_HALF_WIDTH_BINS; near += 1) {
      total += votes[near] ?? 0;
    }
    return total;
  });
  const peaks: number[] = [];
  const order = scores.map((score, bin) => [score, bin] as const).sort((left, right) => right[0] - left[0]);
  const strongest = order[0]?.[0] ?? 0;
  for (const [score, bin] of order) {
    if (peaks.length >= maxPeaks || score < MIN_CANDIDATE_SHARE * strongest) break;
    if (peaks.some((peak) => Math.abs(peak - bin) <= DISTINCT_PEAK_BINS)) continue;
    peaks.push(bin);
  }
  // Refine each peak on its own gaps.
  return peaks.map((bin) => {
    const center = bin * BIN_SECONDS - MAX_GAP_SECONDS;
    const gaps: number[] = [];
    for (const start of japanese) {
      for (const candidate of reference) {
        const gap = candidate - start;
        if (Math.abs(gap - center) <= (PEAK_HALF_WIDTH_BINS + 1) * BIN_SECONDS) gaps.push(gap);
      }
    }
    gaps.sort((left, right) => left - right);
    return gaps[Math.floor(gaps.length / 2)] ?? center;
  });
}

/**
 * Best offset for each line among the candidates, changing offset only when
 * the new one aligns more than SWITCH_PENALTY additional lines (Viterbi).
 */
function labelLines(matches: boolean[][]): { labels: number[]; matched: number } {
  const lineCount = matches[0]?.length ?? 0;
  let scores: number[] = matches.map((line) => (line[0] ? 1 : 0));
  const previous: number[][] = [];
  for (let index = 1; index < lineCount; index += 1) {
    const bestState = scores.indexOf(Math.max(...scores));
    const back: number[] = [];
    scores = matches.map((line, state) => {
      const stay = scores[state] ?? 0;
      const move = (scores[bestState] ?? 0) - SWITCH_PENALTY;
      back.push(move > stay ? bestState : state);
      return Math.max(stay, move) + (line[index] ? 1 : 0);
    });
    previous.push(back);
  }
  let state = scores.indexOf(Math.max(...scores));
  const labels = new Array<number>(lineCount).fill(state);
  for (let index = lineCount - 1; index > 0; index -= 1) {
    state = previous[index - 1]?.[state] ?? state;
    labels[index - 1] = state;
  }
  const matched = labels.reduce((total, label, index) => total + (matches[label]?.[index] ? 1 : 0), 0);
  return { labels, matched };
}

/**
 * Parts of the Japanese file with the offset that aligns each on the
 * reference, "synced" when it already is, or null when the evidence is not
 * clear enough to act.
 */
export function estimateSubtitleSync(
  japaneseStarts: number[],
  referenceStarts: number[],
): SyncSegment[] | "synced" | null {
  const japanese = sorted(japaneseStarts);
  const reference = sorted(referenceStarts);
  if (japanese.length < MIN_CUES || reference.length < MIN_CUES) return null;

  const offsets = candidateOffsets(japanese, reference);
  if (!offsets.length) return null;
  const { labels, matched } = labelLines(offsets.map((offset) => matchesAt(japanese, reference, offset)));

  const segments: SyncSegment[] = [];
  labels.forEach((label, index) => {
    const offset = Math.round((offsets[label] ?? 0) * 100) / 100;
    if (segments.at(-1)?.offset === offset) return;
    // The first part also covers whatever precedes its first line.
    segments.push({ from: segments.length ? japanese[index] ?? 0 : 0, offset });
  });

  const share = segments.length > 1 ? MIN_MATCHED_SHARE_IN_PARTS : MIN_MATCHED_SHARE;
  if (matched < MIN_MATCHED || matched / japanese.length < share) return null;
  if (segments.every((segment) => Math.abs(segment.offset) < MIN_SHIFT_SECONDS)) return "synced";
  // The current alignment must be clearly worse than the shifted one.
  const unshifted = countTrue(matchesAt(japanese, reference, 0));
  if (matched < 1.5 * unshifted + 5) return "synced";
  return segments;
}

/**
 * Larger gaps are not the usual lead of a translation over the voice: two
 * releases cut differently are the automatic alignment's business.
 */
const MAX_TRANSLATION_SHIFT_SECONDS = 2;

/**
 * Seconds to add to the translation's lines so that they start with the
 * Japanese ones, measured on the whole episode; 0 when unclear. Translations
 * often start a little before the voice, which the Japanese follows.
 */
export function estimateTranslationShift(japaneseStarts: number[], translationStarts: number[]): number {
  const japanese = sorted(japaneseStarts);
  const reference = sorted(translationStarts);
  if (japanese.length < MIN_CUES || reference.length < MIN_CUES) return 0;
  const offset = votePeaks(japanese, reference, 1)[0];
  if (offset === undefined || Math.abs(offset) > MAX_TRANSLATION_SHIFT_SECONDS) return 0;
  const matched = countTrue(matchesAt(japanese, reference, offset));
  if (matched < MIN_MATCHED || matched / japanese.length < MIN_MATCHED_SHARE) return 0;
  return -offset;
}

// ---------------------------------------------------------------------------
// Applying it to a video's local Japanese track
// ---------------------------------------------------------------------------

export interface AutoSyncEvent {
  videoId: string;
  segments: SyncSegment[];
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
    const untouched = (record: Awaited<ReturnType<typeof getLocalSubtitle>>): boolean =>
      !!record && !record.syncChecked && record.offsetSeconds === 0 && !record.syncSegments?.length;
    const record = await getLocalSubtitle(videoId, "primary");
    if (!record || !untouched(record)) return;
    const japanese = parseSubtitleFile(record.fileName, record.content).map((cue) => cue.start);
    const segments = estimateSubtitleSync(japanese, reference.map((cue) => cue.start));
    if (!Array.isArray(segments)) return;
    // The user may have replaced the file or set an offset meanwhile.
    const current = await getLocalSubtitle(videoId, "primary");
    if (!current || current.updatedAt !== record.updatedAt || !untouched(current)) return;
    // The user's own offset stays at 0 and still adds to the parts.
    await saveLocalSubtitle(videoId, { ...current, syncSegments: segments, syncChecked: true }, "primary");
    console.info("[SubJap] Sous-titres japonais recalés sur la traduction:", segments);
    for (const listener of listeners) listener({ videoId, segments });
  }
}
