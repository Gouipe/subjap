// ---------------------------------------------------------------------------
// SubJap — Platform adapter registry
// ---------------------------------------------------------------------------

import type { PlatformAdapter, PlatformId, SubtitleCue, EpisodeContext } from "@/core/types";

// ---------------------------------------------------------------------------
// Built-in generic HTML5 fallback adapter
// ---------------------------------------------------------------------------

const GENERIC_HTML5_ADAPTER: PlatformAdapter = {
  id: "generic-html5" as PlatformId,

  isActive(_doc: Document, _url: string): boolean {
    // Always active — serves as ultimate fallback
    return true;
  },

  getVideoElement(): HTMLVideoElement | null {
    // Return the first visible video on the page
    const videos = document.querySelectorAll("video");
    for (const v of videos) {
      if (v.offsetWidth > 0 && v.offsetHeight > 0) return v;
    }
    return null;
  },

  subscribeCues(_cb: (cues: SubtitleCue[]) => void): () => void {
    // Generic HTML5 does not natively expose subtitle cues.
    // Return a no-op unsubscribe.
    return () => {};
  },

  getCurrentTime(): number {
    const video = document.querySelector("video");
    return video?.currentTime ?? 0;
  },

  getPlaybackRate(): number {
    const video = document.querySelector("video");
    return video?.playbackRate ?? 1;
  },

  setNativeSubtitlesVisible(_v: boolean): void {
    // Generic adapter cannot toggle native subtitles
  },

  getEpisodeContext(): EpisodeContext | null {
    return {
      platform: "generic-html5",
      title: document.title || "Unknown",
      language: "ja",
      url: window.location.href,
    };
  },

  destroy(): void {
    // no-op
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class AdapterRegistry {
  private adapters: PlatformAdapter[] = [];

  /** Register a platform adapter. Earlier registrations have higher priority. */
  register(adapter: PlatformAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Find the first adapter whose `isActive` returns true.
   * Falls back to the built-in generic-html5 adapter if nothing matches.
   */
  findActive(doc: Document, url: string): PlatformAdapter {
    for (const adapter of this.adapters) {
      try {
        if (adapter.isActive(doc, url)) {
          return adapter;
        }
      } catch (err) {
        console.warn(
          `[SubJap] Adapter "${adapter.id}" threw during isActive:`,
          err,
        );
      }
    }
    return GENERIC_HTML5_ADAPTER;
  }

  /** Return all registered adapters (useful for debugging). */
  list(): PlatformAdapter[] {
    return [...this.adapters];
  }
}

/** Singleton registry for use in content scripts. */
export const adapterRegistry = new AdapterRegistry();
