import type { SubtitleCue } from "@/core/types";

/**
 * Frame-rate conversions that stretch a whole subtitle file: NTSC 24 ↔ 23.976
 * and PAL speed-up 24/23.976 ↔ 25. A track timed against the other cadence
 * drifts linearly (≈1 s every 17 min for NTSC).
 */
const CADENCE_RATIOS = [
  1001 / 1000, 1000 / 1001,
  25 / 24, 24 / 25,
  25_025 / 24_000, 24_000 / 25_025,
];

const MATCH_TOLERANCE_SECONDS = 0.12;
const MIN_REFERENCE_CUES = 20;
const MIN_MATCH_SHARE = 0.35;
const MIN_GAIN_OVER_IDENTITY = 0.25;

function nearestDistance(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  let distance = Infinity;
  if (low > 0) distance = value - sorted[low - 1]!;
  if (low < sorted.length) distance = Math.min(distance, sorted[low]! - value);
  return distance;
}

/**
 * Ratio r such that `track` times ≈ r × `reference` times, or 1. Two tracks
 * segment dialogue differently, so only a clear majority of matching starts
 * under one known ratio, far better than under the original times, counts.
 */
export function detectCadenceRatio(track: SubtitleCue[], reference: SubtitleCue[]): number {
  if (reference.length < MIN_REFERENCE_CUES || track.length < MIN_REFERENCE_CUES) return 1;
  const starts = track.map((cue) => cue.start).sort((a, b) => a - b);
  const share = (ratio: number): number =>
    reference.filter((cue) =>
      nearestDistance(starts, cue.start * ratio) <= MATCH_TOLERANCE_SECONDS).length /
    reference.length;
  const identity = share(1);
  let best = { ratio: 1, share: identity };
  for (const ratio of CADENCE_RATIOS) {
    const candidate = share(ratio);
    if (candidate > best.share) best = { ratio, share: candidate };
  }
  return best.share >= MIN_MATCH_SHARE && best.share - identity >= MIN_GAIN_OVER_IDENTITY
    ? best.ratio
    : 1;
}

/** Rescale a track measured by `detectCadenceRatio` onto its reference clock. */
export function rescaleCues(cues: SubtitleCue[], ratio: number): SubtitleCue[] {
  if (ratio === 1) return cues;
  return cues.map((cue) =>
    Object.freeze({ ...cue, start: cue.start / ratio, end: cue.end / ratio }));
}
