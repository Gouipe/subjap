import type { SubtitleCue } from "@/core/types";
import { detectCadenceRatio, rescaleCues } from "./cadence";
import { normalizeCueText } from "./normalize";

export function compactSubtitleText(text: string): string {
  return normalizeCueText(text).replace(/\s+/gu, "");
}

/** Overlapping speakers remain separate segments, in source order. */
export function activeSubtitleCues(cues: SubtitleCue[], time: number): SubtitleCue[] {
  return cues.filter((cue) => cue.start <= time && time < cue.end);
}

/** Earliest segment starting after `after`, up to `until` included. */
export function firstCueStartingIn(
  cues: SubtitleCue[],
  after: number,
  until: number,
): SubtitleCue | null {
  return cues.reduce<SubtitleCue | null>(
    (first, cue) =>
      cue.start > after && cue.start <= until && (!first || cue.start < first.start) ? cue : first,
    null,
  );
}

/** A newly started segment owns S; equal-start speakers share a seek position. */
export function primarySubtitleCue(cues: SubtitleCue[]): SubtitleCue | null {
  return cues.reduce<SubtitleCue | null>(
    (latest, cue) => (!latest || cue.start > latest.start ? cue : latest),
    null,
  );
}

export function subtitleCueKey(cue: SubtitleCue): string {
  return JSON.stringify([
    cue.source?.sessionId,
    cue.source?.kind,
    cue.source?.trackId,
    cue.source?.resourceId,
    cue.id,
    cue.source ? undefined : cue.start,
  ]);
}

interface TrackResource {
  language: string;
  trackId?: string;
  url: string;
  cues: SubtitleCue[];
}

/**
 * One complete representation of one track per language. Never splice variants
 * or deduplicate overlapping speakers by time. The selected Japanese track is
 * confirmed by the player, or by an unambiguous visible-text observation.
 */
export class SubtitleTrackCatalog {
  private readonly resources = new Map<string, TrackResource>();
  private readonly selectedTracks = new Map<string, string>();
  private readonly selectedResources = new Map<string, string>();
  private readonly empty: SubtitleCue[] = [];
  private aligned: { source: SubtitleCue[]; reference: SubtitleCue[]; cues: SubtitleCue[] } | null =
    null;

  clear(): void {
    this.resources.clear();
    this.selectedTracks.clear();
    this.selectedResources.clear();
    this.aligned = null;
  }

  selectTrack(language: string, trackId: string): void {
    if (this.selectedTracks.get(language) === trackId) return;
    this.selectedTracks.set(language, trackId);
    this.selectedResources.delete(language);
    this.resolveSelection(language);
  }

  store(
    language: string,
    trackId: string | undefined,
    url: string,
    parsed: SubtitleCue[],
    sessionId: string,
  ): void {
    // A slower request without metadata must not erase an identity learned
    // from the player while that request was in flight.
    trackId ??= this.resources.get(url)?.trackId;
    const cues = parsed
      .flatMap((cue, index): SubtitleCue[] => {
        if (
          !Number.isFinite(cue.start) ||
          !Number.isFinite(cue.end) ||
          cue.start < 0 ||
          cue.end <= cue.start ||
          !compactSubtitleText(cue.text)
        )
          return [];
        return [
          Object.freeze({
            ...cue,
            id: `${sessionId}:${trackId ?? url}:${index}:${cue.id}`,
            language,
            endConfirmed: true,
            source: Object.freeze({
              kind: "track" as const,
              sessionId,
              trackId,
              resourceId: url,
              segmentId: cue.id,
              startPrecision: "exact" as const,
            }),
          }),
        ];
      })
      .sort((a, b) => a.start - b.start);
    if (!cues.length) return;
    const previous = this.resources.get(url);
    if (
      previous?.language === language &&
      previous.trackId === trackId &&
      previous.cues.length === cues.length &&
      previous.cues.every((cue, index) => {
        const next = cues[index]!;
        return (
          cue.id === next.id &&
          cue.start === next.start &&
          cue.end === next.end &&
          cue.text === next.text
        );
      })
    )
      return;
    this.resources.set(url, { language, trackId, url, cues });
    this.resolveSelection(language);
  }

  /** Only elect a missing Japanese track when exactly one track matches. */
  observeJapanese(text: string, time: number): void {
    if (this.cues("ja").length || !compactSubtitleText(text)) return;
    const expectedTrack = this.selectedTracks.get("ja");
    const matches = [...this.resources.values()].filter((resource) => {
      if (resource.language !== "ja") return false;
      if (expectedTrack && resource.trackId !== expectedTrack) return false;
      const active = activeSubtitleCues(resource.cues, time);
      return (
        compactSubtitleText(active.map((cue) => cue.text).join("\n")) === compactSubtitleText(text)
      );
    });
    const tracks = new Set(matches.map((resource) => resource.trackId ?? resource.url));
    if (tracks.size !== 1) return;
    const resource = matches.sort((a, b) => a.url.localeCompare(b.url))[0]!;
    this.selectedResources.set("ja", resource.url);
  }

  cues(language: string): SubtitleCue[] {
    const cues = this.selectedCues(language);
    return language === "ja" ? this.alignJapanese(cues) : cues;
  }

  private selectedCues(language: string): SubtitleCue[] {
    const url = this.selectedResources.get(language);
    return (url ? this.resources.get(url)?.cues : undefined) ?? this.empty;
  }

  /**
   * Some Japanese files are timed for another frame rate than the video and
   * drift linearly, while the official translation follows the audio. Align
   * Japanese on the translation clock when a known ratio clearly fits. The
   * stable instance lets consumers skip identical snapshots.
   */
  private alignJapanese(cues: SubtitleCue[]): SubtitleCue[] {
    if (!cues.length) return cues;
    const reference =
      ["fr", "en"].map((language) => this.selectedCues(language)).find((c) => c.length) ??
      this.empty;
    if (this.aligned?.source === cues && this.aligned.reference === reference) {
      return this.aligned.cues;
    }
    const aligned = rescaleCues(cues, detectCadenceRatio(cues, reference));
    this.aligned = { source: cues, reference, cues: aligned };
    return aligned;
  }

  private resolveSelection(language: string): void {
    const currentUrl = this.selectedResources.get(language);
    const current = currentUrl ? this.resources.get(currentUrl) : undefined;
    const expected = this.selectedTracks.get(language);
    if (current?.language === language && (!expected || current.trackId === expected)) return;
    this.selectedResources.delete(language);
    const candidates = [...this.resources.values()].filter(
      (resource) => resource.language === language && (!expected || resource.trackId === expected),
    );
    // Japanese requires player identity or visible-text evidence. Translations
    // retain a single fallback resource until the bridge identifies their track.
    if (language === "ja" && !expected) return;
    const selected = candidates.sort((a, b) => a.url.localeCompare(b.url))[0];
    if (selected) this.selectedResources.set(language, selected.url);
  }
}
