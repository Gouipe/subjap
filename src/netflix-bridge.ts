export const NETFLIX_SEEK_EVENT = "subjap:netflix-seek";
export const NETFLIX_SEEK_RESULT_EVENT = "subjap:netflix-seek-result";
export const NETFLIX_TIMED_TEXT_URL_EVENT = "subjap:netflix-timed-text-url";
export const NETFLIX_TIMED_TEXT_REQUEST_EVENT = "subjap:netflix-timed-text-request";

export interface NetflixTimedTextTrack {
  language: string;
  url: string;
}

interface NetflixPlayer {
  seek?: (timeMs: number) => unknown;
  play?: () => unknown;
}

interface NetflixVideoPlayerApi extends NetflixPlayer {
  getAllPlayerSessionIds?: () => string[];
  getVideoPlayerBySessionId?: (
    sessionId: string,
  ) => NetflixPlayer | null | undefined;
}

interface NetflixTimedTextTrackOption {
  bcp47?: unknown;
  language?: unknown;
  locale?: unknown;
  displayName?: unknown;
  isNoneTrack?: unknown;
}

interface NetflixTimedTextSession extends NetflixPlayer {
  getTimedTextTrackList?: () => NetflixTimedTextTrackOption[];
  getTimedTextTrack?: () => NetflixTimedTextTrackOption | null | undefined;
  setTimedTextTrack?: (track: NetflixTimedTextTrackOption) => unknown;
}

export function selectNetflixSecondaryTrack(
  tracks: NetflixTimedTextTrackOption[],
  current?: NetflixTimedTextTrackOption | null,
): { native: NetflixTimedTextTrackOption; secondary: NetflixTimedTextTrackOption } | null {
  const native =
    current && !isNoneTimedTextTrack(current)
      ? current
      : tracks.find((track) => /^ja(?:-|_|$)/i.test(readTimedTextLanguage(track)));
  const secondary =
    tracks.find((track) => /^fr(?:-|_|$)/i.test(readTimedTextLanguage(track))) ??
    tracks.find((track) => /^en(?:-|_|$)/i.test(readTimedTextLanguage(track)));
  return native && secondary ? { native, secondary } : null;
}

interface NetflixPageWindow extends Window {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: {
          getAPI?: () => { videoPlayer?: NetflixVideoPlayerApi };
        };
      };
    };
  };
}

interface SeekRequestDetail {
  source?: unknown;
  requestId?: unknown;
  timeMs?: unknown;
  resume?: unknown;
}

const installedDocuments = new WeakSet<Document>();

const TIMED_TEXT_URL_PATTERN =
  /nflxvideo\.net|timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt|imsc/i;
const JSON_METADATA_PATTERN =
  /json|api|metadata|manifest|playback|session|shakti|pathevaluator/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extract official timed-text URLs from the `timedtexttracks` data Netflix
 * sends to the page. This is intentionally pure so the page-world bridge can
 * be tested without a real Netflix response.
 */
export function collectNetflixTimedTextTracks(value: unknown): NetflixTimedTextTrack[] {
  const tracks: NetflixTimedTextTrack[] = [];
  const seenNodes = new WeakSet<object>();
  const seenUrls = new Set<string>();

  const readLanguage = (track: Record<string, unknown>): string =>
    String(track.bcp47 ?? track.language ?? track.locale ?? track.languageTag ?? "").trim();

  const walkTrackUrls = (
    node: unknown,
    path: string,
    language: string,
    depth: number,
  ): void => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") {
      if (
        /^https?:\/\//i.test(node) &&
        TIMED_TEXT_URL_PATTERN.test(node) &&
        /ttDownloadables|downloadables|timedtext|subtitle|caption/i.test(path) &&
        !seenUrls.has(node)
      ) {
        seenUrls.add(node);
        tracks.push({ language, url: node });
      }
      return;
    }
    if (!isRecord(node) && !Array.isArray(node)) return;
    if (typeof node === "object" && node !== null) {
      if (seenNodes.has(node)) return;
      seenNodes.add(node);
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walkTrackUrls(child, `${path}[${index}]`, language, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walkTrackUrls(child, `${path}.${key}`, language, depth + 1);
    }
  };

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 12 || node == null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (key.toLowerCase() === "timedtexttracks" && Array.isArray(child)) {
        child.forEach((track, index) => {
          if (!isRecord(track)) return;
          const language = readLanguage(track);
          if (!language) return;
          walkTrackUrls(track.ttDownloadables ?? track.downloadables, `${childPath}[${index}]`, language, 0);
        });
      }
      walk(child, childPath, depth + 1);
    }
  };

  walk(value, "$", 0);
  return tracks;
}

export function resolveNetflixPlayer(
  page: Window,
): NetflixPlayer | null {
  const netflixPage = page as NetflixPageWindow;
  let videoPlayer: NetflixVideoPlayerApi | undefined;
  try {
    videoPlayer = netflixPage.netflix?.appContext?.state?.playerApp
      ?.getAPI?.().videoPlayer;
  } catch {
    return null;
  }
  if (!videoPlayer) return null;
  if (typeof videoPlayer.seek === "function") return videoPlayer;

  const getPlayer = videoPlayer.getVideoPlayerBySessionId;
  if (typeof getPlayer !== "function") return null;

  let sessionIds: string[] = [];
  try {
    sessionIds = videoPlayer.getAllPlayerSessionIds?.() ?? [];
  } catch {
    return null;
  }
  const selectedIds = [
    ...sessionIds.filter((id) => /watch/i.test(id)),
    ...sessionIds.filter((id) => !/watch/i.test(id)),
  ];
  if (selectedIds.length === 0) selectedIds.push("watch");
  for (const sessionId of selectedIds) {
    try {
      const player = getPlayer.call(videoPlayer, sessionId);
      if (player && typeof player.seek === "function") return player;
    } catch {
      // A stale session can disappear while Netflix navigates between episodes.
    }
  }
  return null;
}

export function handleNetflixSeek(
  event: Event,
  doc: Document,
  page: Window,
): void {
  const detail = (event as CustomEvent<SeekRequestDetail>).detail;
  const requestId = detail?.requestId;
  const timeMs = detail?.timeMs;
  const valid =
    detail?.source === "subjap" &&
    typeof requestId === "string" &&
    Number.isFinite(timeMs) &&
    (timeMs as number) >= 0 &&
    typeof detail.resume === "boolean";

  let ok = false;
  let error: string | undefined;
  if (!valid) {
    error = "Invalid seek request";
  } else {
    try {
      const player = resolveNetflixPlayer(page);
      if (!player || typeof player.seek !== "function") {
        error = "Netflix player API unavailable";
      } else {
        player.seek(timeMs as number);
        if (detail.resume && typeof player.play === "function") {
          void player.play();
        }
        ok = true;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  if (typeof requestId === "string") {
    doc.dispatchEvent(
      new CustomEvent(NETFLIX_SEEK_RESULT_EVENT, {
        detail: {
          source: "subjap",
          requestId,
          ok,
          ...(error ? { error } : {}),
        },
      }),
    );
  }
}

export function installNetflixBridge(
  doc: Document = document,
  page: Window = window,
): void {
  if (installedDocuments.has(doc)) return;
  installedDocuments.add(doc);
  doc.addEventListener(NETFLIX_SEEK_EVENT, (event) =>
    handleNetflixSeek(event, doc, page),
  );
  installTimedTextCapture(page);
  doc.documentElement.dataset.subjapNetflixBridge = "ready";
}

function installTimedTextCapture(page: Window): void {
  const marker = "__subjapNetflixTimedTextCapture";
  const pageState = page as Window & { [marker]?: boolean };
  if (pageState[marker]) return;
  pageState[marker] = true;
  const pageWithJson = page as Window & { JSON?: JSON };
  if (!pageWithJson.JSON || typeof pageWithJson.JSON.parse !== "function") return;

  const emit = (type: string, payload: unknown): void => {
    page.postMessage(
      { source: "subjap", type, payload },
      page.location.origin,
    );
  };

  const seenUrls = new Set<string>();
  const discoveredTracks = new Map<string, NetflixTimedTextTrack>();
  let pendingSecondaryLanguage = "";
  let pendingNativeTrack: NetflixTimedTextTrackOption | null = null;
  let pendingSecondaryRestore: number | null = null;
  const probedSessions = new WeakSet<object>();
  const loggedTrackLists = new WeakSet<object>();

  const restoreNativeTrack = (
    session: NetflixTimedTextSession,
    nativeTrack: NetflixTimedTextTrackOption,
  ): void => {
    if (pendingSecondaryRestore !== null) {
      page.clearTimeout(pendingSecondaryRestore);
      pendingSecondaryRestore = null;
    }
    pendingSecondaryLanguage = "";
    pendingNativeTrack = null;
    try {
      session.setTimedTextTrack?.(nativeTrack);
    } catch {
      // Netflix can replace the session while a track request is in flight.
    }
  };

  const scheduleNativeTrackRestore = (
    session: NetflixTimedTextSession,
    nativeTrack: NetflixTimedTextTrackOption,
  ): void => {
    if (pendingSecondaryRestore !== null) page.clearTimeout(pendingSecondaryRestore);
    pendingSecondaryRestore = page.setTimeout(() => {
      pendingSecondaryRestore = null;
      restoreNativeTrack(session, nativeTrack);
    }, 1800);
  };

  const fetchTrack = (track: NetflixTimedTextTrack): void => {
    if (seenUrls.has(track.url)) return;
    seenUrls.add(track.url);
    discoveredTracks.set(track.url, track);
    // Let the isolated content script perform the request. Some privacy
    // extensions block page-world fetches to Netflix's CDN, while an
    // extension content script can use the page session without that clash.
    console.log(`[SubJap] Netflix timed-text track discovered: ${track.language}`);
    emit(NETFLIX_TIMED_TEXT_URL_EVENT, track);
  };
  const emitTimedTextUrl = (url: string, language = ""): void => {
    fetchTrack({
      url,
      language: language || pendingSecondaryLanguage,
    });
  };
  const inspectTimedTextValue = (value: unknown): void => {
    for (const track of collectNetflixTimedTextTracks(value)) fetchTrack(track);
  };

  const nativeParse = pageWithJson.JSON.parse.bind(pageWithJson.JSON);
  pageWithJson.JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
    const value: unknown = nativeParse(text, reviver) as unknown;
    inspectTimedTextValue(value);
    return value;
  }) as typeof pageWithJson.JSON.parse;

  const pageWithNetflix = page as Window & {
    netflix?: {
      appContext?: { state?: unknown };
    };
  };
  const inspectNetflixState = (): void => {
    inspectTimedTextValue(pageWithNetflix.netflix?.appContext?.state);
  };
  inspectNetflixState();
  let stateInspections = 0;
  const stateTimer = page.setInterval(() => {
    inspectNetflixState();
    stateInspections += 1;
    if (stateInspections >= 120) page.clearInterval(stateTimer);
  }, 500);

  const fetchImpl = page.fetch?.bind(page);
  if (fetchImpl) {
    const inspectJsonResponse = (response: Response, url: string): void => {
      const contentType = response.headers.get("content-type") ?? "";
      if (!JSON_METADATA_PATTERN.test(`${contentType} ${url}`)) return;
      void response.clone().text().then((body) => {
        const trimmed = body.trim().replace(/^\)\]\}',?\s*/, "");
        if (trimmed[0] !== "{" && trimmed[0] !== "[") return;
        try {
          inspectTimedTextValue(nativeParse(trimmed) as unknown);
        } catch {
          // Not every API response that looks like JSON is parseable text.
        }
      }).catch(() => undefined);
    };
    page.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (TIMED_TEXT_URL_PATTERN.test(url)) {
        const language = inferLanguage(url) || pendingSecondaryLanguage;
        emitTimedTextUrl(url, language);
        if (pendingSecondaryLanguage) {
          // The service worker has already received the URL message; restoring
          // the native track here prevents the temporary probe from changing
          // what the user sees.
          const session = resolveNetflixTimedTextSession(page);
          if (session && pendingNativeTrack) {
            scheduleNativeTrackRestore(session, pendingNativeTrack);
          }
        }
      }
      const response = await fetchImpl(input, init);
      inspectJsonResponse(response, url);
      return response;
    }) as typeof page.fetch;
  }

  const NativeXhr = (page as Window & { XMLHttpRequest?: typeof XMLHttpRequest })
    .XMLHttpRequest;
  if (NativeXhr) {
    const xhrUrls = new WeakMap<XMLHttpRequest, string>();
    // The native overload cannot be expressed as a safely bound method.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeOpen = NativeXhr.prototype.open;
    NativeXhr.prototype.open = function (
      this: XMLHttpRequest,
      ...args: Parameters<typeof nativeOpen>
    ) {
      xhrUrls.set(this, String(args[1]));
      return nativeOpen.apply(this, args);
    } as typeof NativeXhr.prototype.open;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      this.addEventListener("load", () => {
        const url = this.responseURL || xhrUrls.get(this) || "";
        if (TIMED_TEXT_URL_PATTERN.test(url)) {
          const language = inferLanguage(url) || pendingSecondaryLanguage;
          emitTimedTextUrl(url, language);
          if (pendingSecondaryLanguage) {
            const session = resolveNetflixTimedTextSession(page);
            if (session && pendingNativeTrack) {
              scheduleNativeTrackRestore(session, pendingNativeTrack);
            }
          }
        }
        const contentType = this.getResponseHeader("content-type") ?? "";
        if (!JSON_METADATA_PATTERN.test(`${contentType} ${url}`)) {
          return;
        }
        let value: unknown;
        try {
          if (this.responseType === "json") {
            value = this.response;
          } else if (this.responseType === "" || this.responseType === "text") {
            const body = this.responseText.trim().replace(/^\)\]\}',?\s*/, "");
            if (body[0] !== "{" && body[0] !== "[") return;
            value = nativeParse(body) as unknown;
          }
        } catch {
          return;
        }
        inspectTimedTextValue(value);
      });
      return nativeSend.call(this, body);
    };
  }

  const probeSecondaryTimedTextTrack = (): void => {
    const session = resolveNetflixTimedTextSession(page);
    if (!session || probedSessions.has(session)) return;
    let tracks: NetflixTimedTextTrackOption[] = [];
    try {
      tracks = session.getTimedTextTrackList?.() ?? [];
    } catch {
      return;
    }
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    if (!loggedTrackLists.has(session)) {
      loggedTrackLists.add(session);
      console.log(
        `[SubJap] Netflix timed-text tracks: ${tracks
          .map((track) => readTimedTextLanguage(track) || "none")
          .join(", ")}`,
      );
    }
    let currentTrack: NetflixTimedTextTrackOption | null | undefined;
    try {
      currentTrack = session.getTimedTextTrack?.();
    } catch {
      currentTrack = null;
    }
    const selectedTracks = selectNetflixSecondaryTrack(tracks, currentTrack);
    if (!selectedTracks || typeof session.setTimedTextTrack !== "function") {
      probedSessions.add(session);
      return;
    }
    const nativeTrack = selectedTracks.native;
    const secondaryTrack = selectedTracks.secondary;
    try {
      pendingSecondaryLanguage = readTimedTextLanguage(secondaryTrack);
      pendingNativeTrack = nativeTrack;
      session.setTimedTextTrack(secondaryTrack);
      probedSessions.add(session);
      scheduleNativeTrackRestore(session, nativeTrack);
      console.log(`[SubJap] Netflix probing secondary track: ${pendingSecondaryLanguage}`);
    } catch {
      pendingSecondaryLanguage = "";
      pendingNativeTrack = null;
    }
  };

  let trackProbeCount = 0;
  const setInterval = page.setInterval?.bind(page);
  if (setInterval) {
    const trackProbeTimer = setInterval(() => {
      probeSecondaryTimedTextTrack();
      trackProbeCount += 1;
      if (trackProbeCount >= 120) page.clearInterval(trackProbeTimer);
    }, 500);
  }

  page.addEventListener("message", (event) => {
    if (event.source !== page) return;
    const data = event.data as { source?: unknown; type?: unknown };
    if (
      data?.source !== "subjap" ||
      data.type !== NETFLIX_TIMED_TEXT_REQUEST_EVENT
    ) {
      return;
    }
    for (const track of discoveredTracks.values()) {
      emit(NETFLIX_TIMED_TEXT_URL_EVENT, track);
    }
  });
}

function inferLanguage(url: string): string {
  const encoded = url.match(/[?&](?:lang|language|locale|bcp47)=([^&]+)/i)?.[1];
  if (!encoded) {
    return url.match(/(?:^|[/_.-])((?:fr|en|ja)(?:[-_][a-z]{2,})?)(?=[/_.?&-]|$)/i)?.[1] ?? "";
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }

}

function readTimedTextLanguage(track: NetflixTimedTextTrackOption): string {
  return String(track.bcp47 ?? track.language ?? track.locale ?? "").trim();
}

function isNoneTimedTextTrack(track: NetflixTimedTextTrackOption): boolean {
  return track.isNoneTrack === true || /^none|off$/i.test(readTimedTextLanguage(track));
}

function resolveNetflixTimedTextSession(page: Window): NetflixTimedTextSession | null {
  const netflixPage = page as NetflixPageWindow;
  let videoPlayer: NetflixVideoPlayerApi | undefined;
  try {
    videoPlayer = netflixPage.netflix?.appContext?.state?.playerApp
      ?.getAPI?.().videoPlayer;
  } catch {
    return null;
  }
  if (!videoPlayer || typeof videoPlayer.getVideoPlayerBySessionId !== "function") {
    return null;
  }
  let sessionIds: string[] = [];
  try {
    sessionIds = videoPlayer.getAllPlayerSessionIds?.() ?? [];
  } catch {
    return null;
  }
  if (sessionIds.length === 0) sessionIds.push("watch");
  const selectedIds = [
    ...sessionIds.filter((id) => /watch/i.test(id)),
    ...sessionIds.filter((id) => !/watch/i.test(id)),
  ];
  for (const sessionId of selectedIds) {
    try {
      const session = videoPlayer.getVideoPlayerBySessionId(sessionId);
      if (
        session &&
        (typeof (session as NetflixTimedTextSession).getTimedTextTrackList === "function" ||
          typeof (session as NetflixTimedTextSession).setTimedTextTrack === "function")
      ) {
        return session as NetflixTimedTextSession;
      }
    } catch {
      // A stale session can disappear while Netflix navigates between episodes.
    }
  }
  return null;
}
