// ---------------------------------------------------------------------------
// SubJap — Platform adapter registry
// ---------------------------------------------------------------------------

import type {
  EpisodeContext,
  JapaneseSubtitleStatus,
  PlatformAdapter,
  PlatformId,
  SecondarySubtitleLanguage,
  SubtitleCue,
} from "@/core/types";
import {
  artplayerSubtitleFileName,
  selectArtplayerSubtitleTracks,
  selectArtplayerTimingTrack,
  type ArtplayerSubtitleCandidate,
  type ArtplayerSubtitleTrack,
} from "@/core/artplayer";
import { sendMessage } from "@/core/messaging";
import { cleanJapaneseSubtitleCues } from "@/subtitles/japanese-cleanup";
import {
  getLocalSubtitle,
  localSubtitleStorageKey,
  localSubtitleVideoId,
  parseLocalSubtitleCues,
} from "@/subtitles/local-storage";
import { parseSubtitleFile } from "@/subtitles/parse";
import { parsePgsDisplays } from "@/subtitles/pgs";
import { activeSubtitleCues, cuesOverlapping, firstCueStartingIn } from "@/subtitles/timeline";
import { LocalSubtitleAutoSync } from "@/subtitles/auto-sync";
import { VideoOffsetWatcher } from "@/subtitles/video-offset";

const ARTPLAYER_HIDE_CLASS = "subjap-artplayer-hide-native";
const ARTPLAYER_REQUEST_INTERVAL_MS = 2_000;
/** Sites change episode without reloading the player frame: follow the tab URL. */
const TOP_URL_REFRESH_MS = 2_000;
/** Fansub ASS files with heavy typesetting reach a dozen megabytes. */
const MAX_SUBTITLE_FILE_LENGTH = 20_000_000;
/** Subtitles in pictures weigh about 10 MB an episode. */
const MAX_IMAGE_SUBTITLE_BYTES = 60_000_000;
/** A player answering with no usable file this long has no subtitle menu at all. */
const ARTPLAYER_NO_TRACKS_AFTER_MS = 15_000;

/** Subtitle files offered by an Artplayer instance for the current video source. */
interface ArtplayerSubtitles {
  session: string;
  source: string;
  startedAt: number;
  /** True once the page bridge answered from a page that runs Artplayer. */
  found: boolean;
  /** True once the page bridge listed at least one usable file. */
  listed: boolean;
  /** Whether the listed files include a Japanese one. */
  offersJapanese: boolean;
  japanese: SubtitleCue[];
  translations: Partial<Record<"fr" | "en", SubtitleCue[]>>;
  /**
   * Without a translation in text, the times of the translation in pictures:
   * never shown, only a reference to align Japanese files on.
   */
  timing: SubtitleCue[];
}

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
  /** Tab URL for players embedded in a frame: local imports are keyed on it. */
  private topUrl: string | null = null;
  private artplayer: ArtplayerSubtitles | null = null;
  private lastArtplayerRequestAt = 0;
  private lastTopUrlRequestAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hideNative = false;
  private style: HTMLStyleElement | null = null;
  private readonly autoSync = new LocalSubtitleAutoSync();
  private readonly offsets = new VideoOffsetWatcher(() => {
    this.lastSignature = "";
    this.publish();
  });

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
    window.addEventListener("message", this.onArtplayerMessage);
    chrome.storage.onChanged.addListener(this.onStorageChange);
    this.style = document.createElement("style");
    this.style.textContent = `html.${ARTPLAYER_HIDE_CLASS} .art-subtitle,
      html.${ARTPLAYER_HIDE_CLASS} .libassjs-canvas-parent,
      html.${ARTPLAYER_HIDE_CLASS} .libassjs-canvas { visibility: hidden !important; }`;
    (document.head ?? document.documentElement).appendChild(this.style);
    this.timer = setInterval(this.tick, 1_000);
    this.refreshTopUrl();
    this.tick();
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
    return this.japaneseCues();
  }

  getTranslationCueStartingIn(after: number, until: number): SubtitleCue | null {
    const video = this.getVideoElement();
    if (!video || video.readyState < 1) return null;
    return firstCueStartingIn(this.translationCues(), after, until);
  }

  getTranslationCuesIn(start: number, end: number): SubtitleCue[] {
    return cuesOverlapping(this.translationCues(), start, end);
  }

  getNavigationSessionId(): string {
    return this.localPrimaryCues[0]?.source?.sessionId ??
      this.artplayer?.japanese[0]?.source?.sessionId ??
      `${this.videoId ?? "page"}:local-primary`;
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

  setNativeSubtitlesVisible(visible: boolean): void {
    // Only Artplayer's own subtitle layers are known; other players keep theirs.
    this.hideNative = !visible;
    this.applyNativeVisibility();
  }

  getJapaneseSubtitleStatus(): JapaneseSubtitleStatus {
    const artplayer = this.artplayer;
    const player = artplayer ? "artplayer" : "other";
    const status = (availability: JapaneseSubtitleStatus["availability"]): JapaneseSubtitleStatus =>
      ({ availability, player, videoId: this.videoId });
    if (this.localPrimaryCues.length) return status("available");
    if (!artplayer) return status("unknown");
    if (artplayer.listed) return status(artplayer.offersJapanese ? "available" : "missing");
    return status(
      artplayer.found && Date.now() - artplayer.startedAt > ARTPLAYER_NO_TRACKS_AFTER_MS
        ? "missing"
        : "unknown",
    );
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
    this.offsets.destroy();
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("popstate", this.onPageNavigation);
    window.removeEventListener("hashchange", this.onPageNavigation);
    window.removeEventListener("message", this.onArtplayerMessage);
    chrome.storage.onChanged.removeListener(this.onStorageChange);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.artplayer = null;
    this.lastArtplayerRequestAt = 0;
    this.lastTopUrlRequestAt = 0;
    this.hideNative = false;
    document.documentElement.classList.remove(ARTPLAYER_HIDE_CLASS);
    this.style?.remove();
    this.style = null;
    this.topUrl = null;
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
    const next = localSubtitleVideoId(
      window.top === window ? window.location.href : this.topUrl ?? window.location.href,
    );
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

  /** Imported files win over the player's own tracks, role by role. */
  private japaneseCues(): SubtitleCue[] {
    this.offsets.setVideo(this.videoId);
    return this.localPrimaryCues.length
      ? this.localPrimaryCues
      : this.offsets.shiftPlayerJapanese(this.artplayer?.japanese ?? []);
  }

  private translationCues(): SubtitleCue[] {
    if (this.preferredSecondaryLanguage === "none") return [];
    if (this.localSecondaryCues.length) return this.localSecondaryCues;
    this.offsets.setVideo(this.videoId);
    const translations = this.artplayer?.translations ?? {};
    const fallback = this.preferredSecondaryLanguage === "fr" ? "en" : "fr";
    return this.offsets.shiftPlayerTranslation(
      translations[this.preferredSecondaryLanguage] ?? translations[fallback] ?? [],
    );
  }

  /** Local imports of an embedded player are keyed on the tab URL, which can change under it. */
  private refreshTopUrl(): void {
    if (window.top === window) return;
    this.lastTopUrlRequestAt = Date.now();
    void sendMessage("tab:url", {}).then(({ url }) => {
      if (!this.callback || !url || url === this.topUrl) return;
      this.topUrl = url;
      this.updateVideoId();
    }).catch(() => {
      // Without the tab URL, local imports stay keyed on the frame URL.
    });
  }

  private readonly tick = (): void => {
    if (Date.now() - this.lastTopUrlRequestAt >= TOP_URL_REFRESH_MS) this.refreshTopUrl();
    const video = this.getVideoElement();
    if (!video || !document.querySelector(".art-video-player")) return;
    const source = video.currentSrc || video.src;
    if (!source) return;
    if (this.artplayer?.source !== source) {
      this.artplayer = {
        session: `artplayer:${crypto.randomUUID()}`,
        source,
        startedAt: Date.now(),
        found: false,
        listed: false,
        offersJapanese: false,
        japanese: [],
        translations: {},
        timing: [],
      };
      this.lastArtplayerRequestAt = 0;
      this.lastSignature = "";
      this.publish();
    }
    if (this.artplayer.listed || Date.now() - this.lastArtplayerRequestAt < ARTPLAYER_REQUEST_INTERVAL_MS) return;
    this.lastArtplayerRequestAt = Date.now();
    window.postMessage({
      source: "subjap",
      type: "subjap:artplayer-request",
      payload: { session: this.artplayer.session },
    }, location.origin);
  };

  private readonly onArtplayerMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { source?: unknown; type?: unknown; payload?: unknown } | null;
    if (data?.source !== "subjap-artplayer" || data.type !== "tracks") return;
    const payload = data.payload as { session?: unknown; candidates?: unknown } | null;
    const artplayer = this.artplayer;
    if (!artplayer || artplayer.listed || payload?.session !== artplayer.session ||
      !Array.isArray(payload.candidates)) return;
    if ((payload as { found?: unknown }).found === true) artplayer.found = true;
    const candidates = (payload.candidates as unknown[]).filter(
      (candidate): candidate is ArtplayerSubtitleCandidate => {
        const value = candidate as Partial<ArtplayerSubtitleCandidate> | null;
        return typeof value?.label === "string" && typeof value.url === "string";
      },
    );
    const tracks = selectArtplayerSubtitleTracks(candidates);
    const timing = tracks.fr || tracks.en ? null : selectArtplayerTimingTrack(candidates);
    // The subtitle menu can be built after the player: keep asking until it lists a file.
    if (!tracks.ja && !tracks.fr && !tracks.en && !timing) return;
    artplayer.listed = true;
    artplayer.offersJapanese = !!tracks.ja;
    for (const track of Object.values(tracks)) void this.loadArtplayerTrack(artplayer, track);
    if (timing) void this.loadArtplayerTiming(artplayer, timing);
  };

  private async loadArtplayerTiming(
    artplayer: ArtplayerSubtitles,
    track: ArtplayerSubtitleTrack,
  ): Promise<void> {
    try {
      const response = await fetch(track.url, { credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length"));
      if (length > MAX_IMAGE_SUBTITLE_BYTES) throw new Error("fichier trop volumineux");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_SUBTITLE_BYTES) throw new Error("fichier trop volumineux");
      if (this.artplayer !== artplayer) return;
      const sessionId = `${artplayer.session}:timing`;
      artplayer.timing = parsePgsDisplays(bytes).map((display, index): SubtitleCue => ({
        id: `${sessionId}:${index}`,
        start: display.start,
        end: display.end,
        text: "",
        language: track.language,
        source: {
          kind: "track",
          sessionId,
          trackId: "artplayer-timing",
          resourceId: track.url,
          segmentId: String(index),
          startPrecision: "exact",
        },
      }));
      this.lastSignature = "";
      this.publish();
    } catch (error) {
      console.warn("[SubJap] Horaires de la traduction en images indisponibles:", error);
    }
  }

  private async loadArtplayerTrack(
    artplayer: ArtplayerSubtitles,
    track: ArtplayerSubtitleTrack,
  ): Promise<void> {
    try {
      const response = await fetch(track.url, { credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > MAX_SUBTITLE_FILE_LENGTH) throw new Error("fichier trop volumineux");
      if (this.artplayer !== artplayer) return;
      const sessionId = `${artplayer.session}:${track.language}`;
      const parsed = parseSubtitleFile(artplayerSubtitleFileName(track.url), body);
      const cues = (track.language === "ja" ? cleanJapaneseSubtitleCues(parsed, track.sdh) : parsed)
        .map((cue, index): SubtitleCue => ({
          ...cue,
          id: `${sessionId}:${index}:${cue.id}`,
          language: track.language,
          source: {
            kind: "track",
            sessionId,
            trackId: `artplayer-${track.language}`,
            resourceId: track.url,
            segmentId: cue.id,
            startPrecision: "exact",
          },
        }));
      if (track.language === "ja") artplayer.japanese = cues;
      else artplayer.translations[track.language] = cues;
      this.lastSignature = "";
      this.publish();
    } catch (error) {
      console.warn(`[SubJap] Sous-titres Artplayer (${track.language}) indisponibles:`, error);
    }
  }

  private applyNativeVisibility(): void {
    document.documentElement.classList.toggle(
      ARTPLAYER_HIDE_CLASS,
      this.hideNative &&
        this.japaneseCues().length > 0 &&
        !!document.querySelector(".art-video-player"),
    );
  }

  private publish(): void {
    if (!this.callback) return;
    this.applyNativeVisibility();
    const translations = this.artplayer?.translations ?? {};
    this.offsets.setVideo(this.videoId);
    this.autoSync.run(
      this.videoId,
      this.localPrimaryCues[0]?.source?.sessionId,
      [
        ...[translations.fr ?? [], translations.en ?? []].map((cues) => this.offsets.shiftPlayerTranslation(cues)),
        // Shown by the player itself, never shifted.
        this.artplayer?.timing ?? [],
      ],
    );
    if (!this.localSecondaryCues.length) {
      this.offsets.alignTranslation(this.japaneseCues(), this.translationCues());
    }
    const video = this.getVideoElement();
    const time = video?.currentTime ?? 0;
    const usable = !!video && video.readyState >= 1;
    const japaneseCues = this.japaneseCues();
    const japanese = usable ? activeSubtitleCues(japaneseCues, time) : [];
    const secondary = usable ? activeSubtitleCues(this.translationCues(), time) : [];
    const cues = [...japanese, ...secondary];
    const signature = `${this.videoId ?? ""}:${this.getNavigationSessionId()}:${japaneseCues.length}:${cues.map((cue) => cue.id).join("|")}`;
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
