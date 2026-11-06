// ---------------------------------------------------------------------------
// SubJap — Options (overlay settings) shared storage module
// ---------------------------------------------------------------------------
//
// Single source of truth for the overlay settings persisted under
// `chrome.storage.local["subjap_options"]`. Used by the options page, the
// onboarding flow, the popup and the content script so every surface reads
// exactly the same merged defaults.

import type { OverlayOptions } from "@/core/types";

export const OPTIONS_STORAGE_KEY = "subjap_options";

export const SUBTITLE_SCALE_MIN = 50;
export const SUBTITLE_SCALE_MAX = 200;
/** Japanese line height at 100 %, as a share of the player height. */
export const SUBTITLE_HEIGHT_RATIO = 0.042;
/** Tiny embedded players still get readable subtitles. */
export const SUBTITLE_MIN_FONT_PX = 14;

/** Japanese subtitle font size for a player of the given height. */
export function subtitleFontSize(scale: number, playerHeight: number): number {
  return Math.max(SUBTITLE_MIN_FONT_PX, playerHeight * SUBTITLE_HEIGHT_RATIO * (scale / 100));
}

export const DEFAULT_OPTIONS: OverlayOptions = {
  // The former fixed `fontSize` (px) has no player-independent equivalent and
  // is dropped by sanitizeOptions, so existing installs start at 100 %.
  subtitleScale: 100,
  showFurigana: true,
  secondarySubtitleLanguage: "fr",
  knownSentenceSubtitles: "show",
  pauseAfterHiddenSentence: false,
  markYoungWords: true,
};

/**
 * Pure merge — defaults first, then any partial override. Exported for
 * unit-testing without a chrome runtime.
 */
export function mergeOptions(
  base: OverlayOptions,
  partial?: Partial<OverlayOptions>,
): OverlayOptions {
  return { ...base, ...(partial ?? {}) };
}

/**
 * Sanitize raw stored values: keep only fields with the expected types so a
 * corrupt/legacy storage payload cannot break the overlay renderer.
 */
export function sanitizeOptions(
  raw: Partial<OverlayOptions> | undefined | null,
): Partial<OverlayOptions> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<OverlayOptions> = {};

  if (typeof raw.subtitleScale === "number" && Number.isFinite(raw.subtitleScale)) {
    out.subtitleScale = Math.min(
      SUBTITLE_SCALE_MAX,
      Math.max(SUBTITLE_SCALE_MIN, Math.round(raw.subtitleScale)),
    );
  }
  if (typeof raw.showFurigana === "boolean") {
    out.showFurigana = raw.showFurigana;
  }
  if (typeof raw.pauseAfterHiddenSentence === "boolean") {
    out.pauseAfterHiddenSentence = raw.pauseAfterHiddenSentence;
  }
  if (typeof raw.markYoungWords === "boolean") {
    out.markYoungWords = raw.markYoungWords;
  }
  if (
    raw.secondarySubtitleLanguage === "fr" ||
    raw.secondarySubtitleLanguage === "en" ||
    raw.secondarySubtitleLanguage === "none"
  ) {
    out.secondarySubtitleLanguage = raw.secondarySubtitleLanguage;
  }
  if (
    raw.knownSentenceSubtitles === "show" ||
    raw.knownSentenceSubtitles === "hide-translation" ||
    raw.knownSentenceSubtitles === "hide-all"
  ) {
    out.knownSentenceSubtitles = raw.knownSentenceSubtitles;
  } else if (
    (raw as { hideSecondarySubtitlesWhenAllKnown?: unknown })
      .hideSecondarySubtitlesWhenAllKnown === true
  ) {
    // Settings saved before the three-level choice existed.
    out.knownSentenceSubtitles = "hide-translation";
  }

  return out;
}

/** Read the effective overlay options (stored values merged over defaults). */
export async function getOptions(): Promise<OverlayOptions> {
  const stored = await chrome.storage.local.get(OPTIONS_STORAGE_KEY);
  const raw = stored[OPTIONS_STORAGE_KEY] as
    | Partial<OverlayOptions>
    | undefined;
  return mergeOptions(DEFAULT_OPTIONS, sanitizeOptions(raw));
}

/** Persist a partial update and return the new merged options. */
export async function saveOptions(
  partial: Partial<OverlayOptions>,
): Promise<OverlayOptions> {
  const current = await getOptions();
  const next = mergeOptions(current, sanitizeOptions(partial));
  await chrome.storage.local.set({ [OPTIONS_STORAGE_KEY]: next });
  return next;
}
