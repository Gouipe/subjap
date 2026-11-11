// ---------------------------------------------------------------------------
// SubJap — Videos whose automatically installed file the user removed
// ---------------------------------------------------------------------------

const MAX_DECLINED_VIDEOS = 300;

/** A list of videos kept in storage, so that a removed file is not installed again. */
export function declinedVideos(storageKey: string): {
  has(videoId: string): Promise<boolean>;
  add(videoId: string): Promise<void>;
  remove(videoId: string): Promise<void>;
} {
  const read = async (): Promise<string[]> => {
    const stored = await chrome.storage.local.get(storageKey);
    const value = stored[storageKey] as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return {
    has: async (videoId) => (await read()).includes(videoId),
    add: async (videoId) => {
      const declined = (await read()).filter((item) => item !== videoId);
      declined.push(videoId);
      await chrome.storage.local.set({ [storageKey]: declined.slice(-MAX_DECLINED_VIDEOS) });
    },
    remove: async (videoId) => {
      const declined = await read();
      if (!declined.includes(videoId)) return;
      await chrome.storage.local.set({ [storageKey]: declined.filter((item) => item !== videoId) });
    },
  };
}
