// ---------------------------------------------------------------------------
// SubJap — Global on/off switch
// ---------------------------------------------------------------------------
//
// Persisted under `chrome.storage.local["subjap_enabled"]`, separately from
// the overlay options: while it is off, SubJap does nothing on any page.

export const ENABLED_STORAGE_KEY = "subjap_enabled";

/** SubJap is on unless the user switched it off. */
export function isEnabledValue(value: unknown): boolean {
  return value !== false;
}

export async function isSubJapEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(ENABLED_STORAGE_KEY);
  return isEnabledValue(stored[ENABLED_STORAGE_KEY]);
}

export async function setSubJapEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_STORAGE_KEY]: enabled });
}
