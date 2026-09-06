import type { CueReplaySession, EpisodeContext, PlatformAdapter, SecondarySubtitleLanguage, SubtitleCue } from "@/core/types";
import { youtubeVideoId, type YouTubeCaptionFile, type YouTubePlaybackInfo } from "@/core/youtube";
import { getLocalSubtitle, localSubtitleStorageKey } from "@/subtitles/local-storage";
import { parseSubtitleFile } from "@/subtitles/parse";
import { parseYouTubeCaptions } from "@/subtitles/youtube";
import { activeSubtitleCues, SubtitleTrackCatalog } from "@/subtitles/timeline";

const HIDE_CLASS = "subjap-youtube-hide-native";

/** One video, one Japanese caption file, shared by rendering, navigation and mining. */
export class YouTubeAdapter implements PlatformAdapter {
  readonly id = "youtube";
  private videoId: string | null = null;
  private session = "";
  private info: YouTubePlaybackInfo | null = null;
  private readonly catalog = new SubtitleTrackCatalog();
  private video: HTMLVideoElement | null = null;
  private callback: ((cues: SubtitleCue[]) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSignature = "";
  private preferredLanguage: SecondarySubtitleLanguage = "fr";
  private localCues: SubtitleCue[] = [];
  private localRevision = 0;
  private hideNative = false;
  private replay: CueReplaySession | null = null;
  private style: HTMLStyleElement | null = null;
  private lastRequestAt = 0;
  private navigating = false;

  isActive(_doc: Document, url: string): boolean {
    try { return /(^|\.)youtube\.com$/i.test(new URL(url).hostname); }
    catch { return false; }
  }

  getVideoElement(): HTMLVideoElement | null {
    if (!youtubeVideoId(location.href)) return null;
    // Restrict discovery to the actual player, excluding previews and tab capture.
    return document.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video");
  }

  subscribeCues(callback: (cues: SubtitleCue[]) => void): () => void {
    this.destroy();
    this.callback = callback;
    window.addEventListener("message", this.onMessage);
    document.addEventListener("yt-navigate-start", this.onNavigateStart);
    document.addEventListener("yt-navigate-finish", this.onNavigateFinish);
    window.addEventListener("popstate", this.onNavigateFinish);
    chrome.storage.onChanged.addListener(this.onStorageChange);
    this.style = document.createElement("style");
    this.style.textContent = `html.${HIDE_CLASS} #movie_player .ytp-caption-window-container,
      html.${HIDE_CLASS} #movie_player .ytp-caption-window-container * { visibility: hidden !important; }`;
    document.head.appendChild(this.style);
    this.tick();
    // Also works while paused and when YouTube reuses the same video element.
    this.timer = setInterval(this.tick, 100);
    return () => this.destroy();
  }

  getCurrentTime(): number { return this.getVideoElement()?.currentTime ?? 0; }
  isPaused(): boolean { return this.getVideoElement()?.paused ?? true; }
  getPlaybackRate(): number { return this.getVideoElement()?.playbackRate ?? 1; }

  getNavigationCues(): SubtitleCue[] {
    return this.canUsePlayback() ? this.catalog.cues("ja") : [];
  }

  getNavigationSessionId(): string {
    return `${this.session}:${this.info?.tracks.find((track) => track.language === "ja")?.id ?? "pending"}:${this.canUsePlayback() ? "video" : "inactive"}`;
  }

  setSecondarySubtitleLanguage(language: SecondarySubtitleLanguage): void {
    this.preferredLanguage = language;
    this.requestTracks();
    this.publish();
  }

  async seekTo(timeSeconds: number, resume: boolean): Promise<boolean> {
    const video = this.getVideoElement();
    if (!video || !this.canUsePlayback() || !Number.isFinite(timeSeconds)) return false;
    const session = this.session;
    const target = Math.max(0, Math.min(timeSeconds, Number.isFinite(video.duration) ? video.duration : timeSeconds));
    try {
      // Set up landing observation first: a paused seek must publish its target.
      const landed = new Promise<boolean>((resolve) => {
        const finish = (): void => {
          clearTimeout(timeout);
          video.removeEventListener("seeked", finish);
          resolve(session === this.session && this.canUsePlayback() && Math.abs(video.currentTime - target) < 0.1);
        };
        const timeout = setTimeout(finish, 3000);
        video.addEventListener("seeked", finish, { once: true });
        video.currentTime = target;
        if (!video.seeking && Math.abs(video.currentTime - target) < 0.002) finish();
      });
      if (!await landed) return false;
      if (resume) await video.play();
      else video.pause();
      this.publish();
      return true;
    } catch { return false; }
  }

  beginCueReplay(cue: SubtitleCue): CueReplaySession | null {
    if (!this.canUsePlayback() || cue.source?.sessionId !== this.session || cue.endConfirmed === false) return null;
    this.replay?.close();
    const session = this.session;
    const replay: CueReplaySession = {
      startObserving: () => {},
      waitForEnd: () => {
        if (session !== this.session || !this.canUsePlayback()) return Promise.reject(new Error("La vidéo YouTube a changé pendant la capture."));
        return Promise.resolve(cue.end);
      },
      close: () => {
        if (this.replay !== replay) return;
        this.replay = null;
        this.publish();
      },
    };
    this.replay = replay;
    return replay;
  }

  setNativeSubtitlesVisible(visible: boolean): void {
    this.hideNative = !visible;
    this.applyNativeVisibility();
  }

  getEpisodeContext(): EpisodeContext | null {
    if (!this.videoId || !this.canUsePlayback()) return null;
    return {
      platform: "youtube", title: this.info?.title || document.title.replace(/ - YouTube$/, ""),
      language: "ja", url: `https://www.youtube.com/watch?v=${this.videoId}`,
    };
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("message", this.onMessage);
    document.removeEventListener("yt-navigate-start", this.onNavigateStart);
    document.removeEventListener("yt-navigate-finish", this.onNavigateFinish);
    window.removeEventListener("popstate", this.onNavigateFinish);
    chrome.storage.onChanged.removeListener(this.onStorageChange);
    this.callback = null;
    this.video = null;
    this.videoId = null;
    this.info = null;
    this.replay = null;
    this.catalog.clear();
    this.localCues = [];
    this.localRevision++;
    this.lastSignature = "";
    this.hideNative = false;
    document.documentElement.classList.remove(HIDE_CLASS);
    this.style?.remove();
    this.style = null;
  }

  private canUsePlayback(): boolean {
    return !this.navigating && this.videoId !== null && youtubeVideoId(location.href) === this.videoId &&
      this.info?.playingVideoId === this.videoId && !this.info.live &&
      !document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting") &&
      (this.getVideoElement()?.readyState ?? 0) >= 1;
  }

  private onNavigateStart = (): void => {
    this.navigating = true;
    this.info = null;
    this.catalog.clear();
    this.replay = null;
    this.localCues = [];
    this.localRevision++;
    this.publish();
  };

  private onNavigateFinish = (): void => {
    this.navigating = false;
    // A → B → A gets a new generation even if requests from the first A remain.
    this.videoId = null;
    this.tick();
  };

  private tick = (): void => {
    if (this.navigating) { this.publish(); return; }
    const videoId = youtubeVideoId(location.href);
    if (videoId !== this.videoId) {
      this.videoId = videoId;
      this.session = `youtube:${videoId ?? "none"}:${crypto.randomUUID()}`;
      this.info = null;
      this.catalog.clear();
      this.localCues = [];
      this.replay = null;
      this.lastSignature = "";
      this.requestTracks();
      void this.loadLocalSubtitle();
    }
    const video = this.getVideoElement();
    if (video !== this.video) { this.video = video; this.lastSignature = ""; }
    if (!this.info && Date.now() - this.lastRequestAt > 5000) this.requestTracks();
    this.publish();
  };

  private requestTracks(): void {
    if (!this.videoId || !this.session || this.navigating) return;
    this.lastRequestAt = Date.now();
    window.postMessage({ source: "subjap", type: "subjap:youtube-request", payload: {
      videoId: this.videoId, session: this.session, preferredSecondaryLanguage: this.preferredLanguage,
    } }, location.origin);
  }

  private onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== location.origin || this.navigating) return;
    const data = event.data as { source?: unknown; type?: unknown; payload?: unknown } | null;
    const payload = data?.payload as Record<string, unknown> | null;
    if (data?.source !== "subjap-youtube" || payload?.session !== this.session ||
      payload?.videoId !== this.videoId || youtubeVideoId(location.href) !== this.videoId) return;
    if (data.type === "info") {
      const info = payload as unknown as YouTubePlaybackInfo;
      if (!Array.isArray(info.tracks) || info.tracks.length > 3 || typeof info.title !== "string" ||
        typeof info.playingVideoId !== "string" || typeof info.live !== "boolean") return;
      if (info.tracks.some((track) => !track || typeof track.id !== "string" || typeof track.url !== "string" ||
        !["ja", "fr", "en"].includes(track.language) || typeof track.automatic !== "boolean")) return;
      this.info = info;
      for (const track of info.tracks) this.catalog.selectTrack(track.language, track.id);
    } else if (data.type === "file") {
      const file = payload as unknown as YouTubeCaptionFile;
      if (typeof file.body !== "string" || file.body.length > 8_000_000) return;
      const track = this.info?.tracks.find((candidate) => candidate.id === file.id && candidate.url === file.url &&
        candidate.language === file.language && candidate.automatic === file.automatic);
      if (!track) return;
      try {
        this.catalog.store(track.language, track.id, track.url,
          parseYouTubeCaptions(file.body, track.automatic), this.session);
      } catch (error) { console.warn("[SubJap] Sous-titres YouTube illisibles:", error); }
    } else return;
    this.publish();
  };

  private publish(): void {
    if (!this.callback) return;
    const usable = this.canUsePlayback();
    this.applyNativeVisibility();
    if (this.replay && usable) return;
    if (!usable) this.replay = null;
    const time = this.getCurrentTime();
    const japanese = this.info?.tracks.some((track) => track.language === "ja") ? this.catalog.cues("ja") : [];
    const secondary = this.info?.tracks.find((track) => track.language !== "ja");
    const translation = this.localCues.length ? this.localCues : secondary ? this.catalog.cues(secondary.language) : [];
    const cues = usable ? [...activeSubtitleCues(japanese, time), ...activeSubtitleCues(translation, time)] : [];
    const signature = `${this.getNavigationSessionId()}:${japanese.length}:${cues.map((cue) => cue.id).join("|")}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.callback(cues);
  }

  private applyNativeVisibility(): void {
    document.documentElement.classList.toggle(HIDE_CLASS,
      this.hideNative && this.canUsePlayback() && this.catalog.cues("ja").length > 0);
  }

  private onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === "local" && this.videoId && changes[localSubtitleStorageKey(`youtube:${this.videoId}`)]) {
      void this.loadLocalSubtitle();
    }
  };

  private async loadLocalSubtitle(): Promise<void> {
    const revision = ++this.localRevision;
    const videoId = this.videoId;
    if (!videoId) return;
    try {
      const record = await getLocalSubtitle(`youtube:${videoId}`);
      if (revision !== this.localRevision || videoId !== this.videoId) return;
      this.localCues = record ? parseSubtitleFile(record.fileName, record.content).map((cue) => ({
        ...cue, id: `youtube-local:${revision}:${cue.id}`, language: "local",
        start: cue.start + record.offsetSeconds, end: cue.end + record.offsetSeconds,
      })) : [];
      this.lastSignature = "";
      this.publish();
    } catch (error) { console.warn("[SubJap] Traduction locale YouTube indisponible:", error); }
  }
}
