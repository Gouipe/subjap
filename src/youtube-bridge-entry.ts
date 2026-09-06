// Keep this entry self-contained: MAIN content scripts are classic scripts.
import type { YouTubeCaptionTrack, YouTubePlaybackInfo } from "./core/youtube";

interface NativeTrack {
  baseUrl?: string;
  languageCode?: string;
  vssId?: string;
  kind?: string;
}
interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; isLive?: boolean };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: NativeTrack[] } };
}
interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?(): PlayerResponse;
  getVideoData?(): { video_id?: string };
  loadModule?(name: string): void;
  setOption?(module: string, option: string, value: unknown): void;
}

(() => {
  const marker = "__subjapYouTubeBridge";
  const page = window as Window & { ytInitialPlayerResponse?: PlayerResponse; [marker]?: boolean };
  if (page[marker]) return;
  page[marker] = true;
  const nativeFetch = window.fetch.bind(window);
  let videoId = "";
  let session = "";
  let preferred = "fr";
  let infoSignature = "";
  let tracks: YouTubeCaptionTrack[] = [];
  const files = new Map<string, string>();
  const attempts = new Map<string, { count: number; at: number }>();
  const controllers = new Set<AbortController>();
  let nativeSelection = "";
  let navigationGeneration = 0;
  const observedFiles = new Map<string, string>();

  const currentId = (): string => location.pathname === "/watch"
    ? new URLSearchParams(location.search).get("v") ?? "" : "";
  const emit = (type: string, payload: unknown): void => {
    window.postMessage({ source: "subjap-youtube", type, payload }, location.origin);
  };
  const validUrl = (value: string): URL | null => {
    try {
      const url = new URL(value, location.origin);
      return url.protocol === "https:" && /(^|\.)youtube\.com$/.test(url.hostname) &&
        url.pathname === "/api/timedtext" ? url : null;
    } catch { return null; }
  };
  const hasCaptions = (body: string): boolean => {
    if (body.length > 8_000_000) return false;
    try {
      if (body.trimStart().startsWith("{")) {
        const data = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
        return Array.isArray(data.events) && data.events.some((event) =>
          Array.isArray(event?.segs) && event.segs.some((seg) => typeof seg?.utf8 === "string" && seg.utf8.trim()));
      }
      return /<(?:p|text)\s[^>]*(?:t|start)=|WEBVTT/.test(body);
    } catch { return false; }
  };
  const publishFile = (track: YouTubeCaptionTrack, body: string, requestSession: string): void => {
    if (session !== requestSession || currentId() !== videoId || !hasCaptions(body)) return;
    if (!tracks.some((candidate) => candidate.id === track.id && candidate.url === track.url)) return;
    // The first usable complete file is stable for the session. Never combine
    // downloads from different representations of the same caption track.
    if (files.has(track.id)) return;
    files.set(track.id, body);
    emit("file", { ...track, videoId, session, body });
  };
  const captureResponse = (rawUrl: string, body: string, generation: number): void => {
    const url = validUrl(rawUrl);
    if (generation !== navigationGeneration || !url || url.searchParams.get("v") !== currentId() ||
      url.searchParams.has("tlang") || !hasCaptions(body)) return;
    // A caption may finish before document_end starts the isolated adapter.
    // Retain a small, navigation-scoped cache and associate it after discovery.
    const oldestUrl = observedFiles.keys().next().value;
    if (observedFiles.size >= 6 && !observedFiles.has(rawUrl) && oldestUrl) observedFiles.delete(oldestUrl);
    observedFiles.set(rawUrl, body);
    if (!session || videoId !== currentId()) return;
    const track = tracks.find((candidate) => {
      const base = validUrl(candidate.url);
      return base && ["lang", "kind", "name", "v"].every((key) =>
        (base.searchParams.get(key) ?? "") === (url.searchParams.get(key) ?? ""));
    });
    if (track) publishFile(track, body, session);
  };

  // Observe the actual signed caption requests, including the player's own
  // proof-of-origin parameters, without modifying requests or their responses.
  const wrappedFetch: typeof window.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const generation = navigationGeneration;
    const response = await nativeFetch(input, init);
    if (validUrl(rawUrl) && response.ok) {
      void response.clone().text().then((body) => captureResponse(rawUrl, body, generation)).catch(() => {});
    }
    return response;
  };
  window.fetch = wrappedFetch;
  // This original method is invoked with the request as its receiver below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeOpen = XMLHttpRequest.prototype.open;
  const pendingXhrLoads = new WeakMap<XMLHttpRequest, () => void>();
  const wrappedOpen: typeof nativeOpen = function (
    this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true,
    username?: string | null, password?: string | null,
  ) {
    const rawUrl = String(url);
    const generation = navigationGeneration;
    const previousListener = pendingXhrLoads.get(this);
    if (previousListener) this.removeEventListener("load", previousListener);
    pendingXhrLoads.delete(this);
    if (validUrl(rawUrl)) {
      const onLoad = (): void => {
        pendingXhrLoads.delete(this);
        try {
          if (this.status >= 200 && this.status < 300) {
            const body = this.responseType === "json" ? JSON.stringify(this.response) :
              !this.responseType || this.responseType === "text" ? this.responseText : "";
            captureResponse(rawUrl, body, generation);
          }
        } catch { /* Binary/non-caption responses are left untouched. */ }
      };
      pendingXhrLoads.set(this, onLoad);
      this.addEventListener("load", onLoad, { once: true });
    }
    nativeOpen.call(this, method, url, async, username, password);
  };
  XMLHttpRequest.prototype.open = wrappedOpen;

  const load = async (track: YouTubeCaptionTrack): Promise<void> => {
    if (files.has(track.id)) return;
    const attempt = attempts.get(track.url);
    if (attempt && (attempt.count >= 2 || Date.now() - attempt.at < 15_000)) return;
    attempts.set(track.url, { count: (attempt?.count ?? 0) + 1, at: Date.now() });
    const requestSession = session;
    const url = validUrl(track.url);
    if (!url) return;
    url.searchParams.set("fmt", "json3");
    const controller = new AbortController();
    controllers.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await nativeFetch(url.href, { credentials: "include", signal: controller.signal });
      if (response.ok) publishFile(track, await response.text(), requestSession);
    } catch { /* The player request is also observed as a fallback. */ }
    finally { clearTimeout(timer); controllers.delete(controller); }
  };

  const inspect = (): void => {
    if (!session || currentId() !== videoId) return;
    const player = document.querySelector<YouTubePlayer>("#movie_player");
    if (!player) return;
    let response: PlayerResponse | undefined;
    let playingVideoId = "";
    try {
      response = player.getPlayerResponse?.();
      playingVideoId = player.getVideoData?.().video_id ?? "";
    } catch { return; }
    if (response?.videoDetails?.videoId !== videoId) response = page.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== videoId) return;
    const available = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const choose = (language: string): YouTubeCaptionTrack | null => {
      const candidate = available.filter((track) => typeof track.languageCode === "string" &&
        track.languageCode.split(/[-_]/)[0] === language && typeof track.baseUrl === "string" &&
        validUrl(track.baseUrl)?.searchParams.get("v") === videoId)
        .sort((a, b) => Number(a.kind === "asr") - Number(b.kind === "asr"))[0];
      if (!candidate?.baseUrl) return null;
      return {
        id: candidate.vssId || `${candidate.languageCode}:${candidate.kind ?? "manual"}`,
        language, automatic: candidate.kind === "asr", url: candidate.baseUrl,
      };
    };
    const primary = choose("ja");
    const secondary = choose(preferred) ?? choose(preferred === "fr" ? "en" : "fr");
    tracks = [primary, secondary].filter((track): track is YouTubeCaptionTrack => track !== null);
    const info: YouTubePlaybackInfo = {
      videoId, session, title: response.videoDetails?.title ?? "YouTube",
      playingVideoId, live: response.videoDetails?.isLive === true, tracks,
    };
    const signature = JSON.stringify(info);
    if (signature !== infoSignature) { infoSignature = signature; emit("info", info); }
    if (info.live || playingVideoId !== videoId || player.matches(".ad-showing, .ad-interrupting")) return;
    for (const [url, body] of observedFiles) captureResponse(url, body, navigationGeneration);
    for (const track of tracks) void load(track);
    // If a plain download is unavailable, ask YouTube to load Japanese itself.
    // This happens once per selected track and leaves the player's timing intact.
    if (primary && !files.has(primary.id) && nativeSelection !== primary.id &&
      Date.now() - (attempts.get(primary.url)?.at ?? Date.now()) > 2000) {
      try {
        player.loadModule?.("captions");
        if (player.setOption) {
          player.setOption("captions", "track", {
            languageCode: available.find((track) => track.vssId === primary.id)?.languageCode ?? "ja",
            vssId: primary.id, kind: primary.automatic ? "asr" : "",
          });
          nativeSelection = primary.id;
        }
      } catch { /* Player modules can be unavailable during a navigation. */ }
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data as { source?: unknown; type?: unknown; payload?: unknown } | null;
    if (message?.source !== "subjap" || message.type !== "subjap:youtube-request") return;
    const payload = message.payload as Record<string, unknown> | null;
    if (typeof payload?.videoId !== "string" || payload.videoId !== currentId() ||
      !/^[\w-]{11}$/.test(payload.videoId) || typeof payload.session !== "string" || payload.session.length > 100) return;
    if (session !== payload.session) {
      for (const controller of controllers) controller.abort();
      files.clear(); attempts.clear(); tracks = []; nativeSelection = "";
      videoId = payload.videoId; session = payload.session;
    }
    preferred = payload.preferredSecondaryLanguage === "en" ? "en" : "fr";
    infoSignature = "";
    inspect();
    for (const track of tracks) {
      const body = files.get(track.id);
      if (body) emit("file", { ...track, videoId, session, body });
    }
  };
  window.addEventListener("message", onMessage);
  document.addEventListener("yt-navigate-start", () => {
    navigationGeneration++;
    observedFiles.clear();
    for (const controller of controllers) controller.abort();
    session = "";
    infoSignature = "";
  });
  document.addEventListener("yt-navigate-finish", inspect);
  window.setInterval(inspect, 1000);
})();
