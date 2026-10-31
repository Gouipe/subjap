// ---------------------------------------------------------------------------
// SubJap — Platform adapter registry
// ---------------------------------------------------------------------------

import type {
  EpisodeContext,
  PlatformAdapter,
  PlatformId,
  SecondarySubtitleLanguage,
  SubtitleCue,
} from "@/core/types";
import {
  getLocalSubtitle,
  localSubtitleStorageKey,
  localSubtitleVideoId,
  parseLocalSubtitleCues,
} from "@/subtitles/local-storage";
import { activeSubtitleCues, firstCueStartingIn } from "@/subtitles/timeline";

// ---------------------------------------------------------------------------
// Built-in generic HTML5 fallback adapter
// ---------------------------------------------------------------------------

export class GenericHtml5Adapter implements PlatformAdapter {
  readonly id: PlatformId = "generic-html5";
  private video: HTMLVideoElement | null = null;
  private videoId: string | null = null;
  private callback: ((cues: SubtitleCue[]) => void) | null = null;
  private localPrimaryCues: SubtitleCue[] = [];
  private localSecondaryCues: SubtitleCue[] = [];
  private preferredSecondaryLanguage: SecondarySubtitleLanguage = "fr";
  private loadRevision = 0;
  private lastSignature = "";
  private observer: MutationObserver | null = null;
  private readonly watchedVideos = new Set<HTMLVideoElement>();

  private readonly onVideoEvent = () => this.publish();
  private readonly onAnyVideoPlay = () => this.refreshVideo();
  private readonly onPageNavigation = () => {
    this.updateVideoId();
    this.refreshVideo();
  };
  private readonly onStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !this.videoId) return;
    if (
      changes[localSubtitleStorageKey(this.videoId, "primary")] ||
      changes[localSubtitleStorageKey(this.videoId, "secondary")]
    ) {
      void this.loadLocalSubtitles();
    }
  };

  isActive(_doc: Document, _url: string): boolean {
    return true;
  }

  getVideoElement(): HTMLVideoElement | null {
    if (this.video?.isConnected) return this.video;
    return this.findVisibleVideo();
  }

  subscribeCues(callback: (cues: SubtitleCue[]) => void): () => void {
    this.destroy();
    this.callback = callback;
    this.updateVideoId();
    this.refreshVideo();
    this.observer = new MutationObserver(() => {
      this.updateVideoId();
      this.refreshVideo();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", this.onPageNavigation);
    window.addEventListener("hashchange", this.onPageNavigation);
    chrome.storage.onChanged.addListener(this.onStorageChange);
    this.publish();
    return () => this.destroy();
  }

  getCurrentTime(): number {
    return this.getVideoElement()?.currentTime ?? 0;
  }

  isPaused(): boolean {
    return this.getVideoElement()?.paused ?? true;
  }

  getPlaybackRate(): number {
    return this.getVideoElement()?.playbackRate ?? 1;
  }

  getNavigationCues(): SubtitleCue[] {
    return this.localPrimaryCues;
  }

  getTranslationCueStartingIn(after: number, until: number): SubtitleCue | null {
    const video = this.getVideoElement();
    if (!video || video.readyState < 1 || this.preferredSecondaryLanguage === "none") return null;
    return firstCueStartingIn(this.localSecondaryCues, after, until);
  }

  getNavigationSessionId(): string {
    return this.localPrimaryCues[0]?.source?.sessionId ?? `${this.videoId ?? "page"}:local-primary`;
  }

  setSecondarySubtitleLanguage(language: SecondarySubtitleLanguage): void {
    if (this.preferredSecondaryLanguage === language) return;
    this.preferredSecondaryLanguage = language;
    this.lastSignature = "";
    this.publish();
  }

  seekTo(timeSeconds: number, resume: boolean): Promise<boolean> {
    const video = this.getVideoElement();
    if (!video || !Number.isFinite(timeSeconds)) return Promise.resolve(false);
    video.currentTime = Math.max(0, timeSeconds);
    if (resume) {
      void video.play().catch(() => {
        // Autoplay policy may reject play(); the seek itself still succeeded.
      });
    }
    return Promise.resolve(true);
  }

  setNativeSubtitlesVisible(_visible: boolean): void {
    // Native subtitle controls are player-specific.
  }

  getEpisodeContext(): EpisodeContext | null {
    if (!this.getVideoElement()) return null;
    return {
      platform: "generic-html5",
      title: document.title || "Unknown",
      language: "ja",
      url: window.location.href,
    };
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("popstate", this.onPageNavigation);
    window.removeEventListener("hashchange", this.onPageNavigation);
    chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.detachVideo();
    for (const video of this.watchedVideos) video.removeEventListener("play", this.onAnyVideoPlay);
    this.watchedVideos.clear();
    this.callback = null;
    this.videoId = null;
    this.localPrimaryCues = [];
    this.localSecondaryCues = [];
    this.loadRevision += 1;
    this.lastSignature = "";
  }

  private findVisibleVideo(): HTMLVideoElement | null {
    const visible = Array.from(document.querySelectorAll("video")).filter((video) => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    return visible.find((video) => !video.paused) ?? visible.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.width * bRect.height - aRect.width * aRect.height;
    })[0] ?? null;
  }

  private refreshVideo(): void {
    this.refreshPlayListeners();
    const next = this.findVisibleVideo();
    if (next === this.video) return;
    this.detachVideo();
    this.video = next;
    if (next) {
      for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play", "pause", "emptied"]) {
        next.addEventListener(event, this.onVideoEvent);
      }
    }
    this.lastSignature = "";
    this.publish();
  }

  private refreshPlayListeners(): void {
    const videos = new Set(document.querySelectorAll("video"));
    for (const video of videos) {
      if (this.watchedVideos.has(video)) continue;
      video.addEventListener("play", this.onAnyVideoPlay);
      this.watchedVideos.add(video);
    }
    for (const video of this.watchedVideos) {
      if (videos.has(video)) continue;
      video.removeEventListener("play", this.onAnyVideoPlay);
      this.watchedVideos.delete(video);
    }
  }

  private detachVideo(): void {
    if (!this.video) return;
    for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play", "pause", "emptied"]) {
      this.video.removeEventListener(event, this.onVideoEvent);
    }
    this.video = null;
  }

  private updateVideoId(): void {
    const next = localSubtitleVideoId(window.location.href);
    if (next === this.videoId) return;
    this.videoId = next;
    this.localPrimaryCues = [];
    this.localSecondaryCues = [];
    this.loadRevision += 1;
    this.lastSignature = "";
    void this.loadLocalSubtitles();
    this.publish();
  }

  private async loadLocalSubtitles(): Promise<void> {
    const revision = ++this.loadRevision;
    const videoId = this.videoId;
    if (!videoId) {
      this.localPrimaryCues = [];
      this.localSecondaryCues = [];
      this.publish();
      return;
    }
    try {
      const [primary, secondary] = await Promise.all([
        getLocalSubtitle(videoId, "primary"),
        getLocalSubtitle(videoId, "secondary"),
      ]);
      if (revision !== this.loadRevision || videoId !== this.videoId) return;
      this.localPrimaryCues = parseLocalSubtitleCues(videoId, "primary", primary);
      this.localSecondaryCues = parseLocalSubtitleCues(videoId, "secondary", secondary);
      this.lastSignature = "";
      this.publish();
    } catch (error) {
      console.warn("[SubJap] Sous-titres locaux illisibles:", error);
    }
  }

  private publish(): void {
    if (!this.callback) return;
    const video = this.getVideoElement();
    const time = video?.currentTime ?? 0;
    const usable = !!video && video.readyState >= 1;
    const japanese = usable ? activeSubtitleCues(this.localPrimaryCues, time) : [];
    const secondary = usable && this.preferredSecondaryLanguage !== "none"
      ? activeSubtitleCues(this.localSecondaryCues, time)
      : [];
    const cues = [...japanese, ...secondary];
    const signature = `${this.videoId ?? ""}:${cues.map((cue) => cue.id).join("|")}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.callback(cues);
  }
}

export const GENERIC_HTML5_ADAPTER: PlatformAdapter = new GenericHtml5Adapter();

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
