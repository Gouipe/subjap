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

export const DEFAULT_OPTIONS: OverlayOptions = {
  fontSize: 28,
  showFurigana: true,
  hideNativeSubtitles: true,
  secondarySubtitleLanguage: "fr",
  hideSecondarySubtitlesWhenAllKnown: false,
  activeListeningMode: false,
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

  if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)) {
    out.fontSize = Math.min(64, Math.max(12, raw.fontSize));
  }
  if (typeof raw.showFurigana === "boolean") {
    out.showFurigana = raw.showFurigana;
  }
  if (typeof raw.hideNativeSubtitles === "boolean") {
    out.hideNativeSubtitles = raw.hideNativeSubtitles;
  }
  if (
    raw.secondarySubtitleLanguage === "fr" ||
    raw.secondarySubtitleLanguage === "en" ||
    raw.secondarySubtitleLanguage === "none"
  ) {
    out.secondarySubtitleLanguage = raw.secondarySubtitleLanguage;
  }
  if (typeof raw.hideSecondarySubtitlesWhenAllKnown === "boolean") {
    out.hideSecondarySubtitlesWhenAllKnown =
      raw.hideSecondarySubtitlesWhenAllKnown;
  }
  if (typeof raw.activeListeningMode === "boolean") {
    out.activeListeningMode = raw.activeListeningMode;
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
