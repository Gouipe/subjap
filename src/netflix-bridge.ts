export const NETFLIX_SEEK_EVENT = "subjap:netflix-seek";
export const NETFLIX_SEEK_RESULT_EVENT = "subjap:netflix-seek-result";
export const NETFLIX_TIMED_TEXT_EVENT = "subjap:netflix-timed-text";
export const NETFLIX_TIMED_TEXT_URL_EVENT = "subjap:netflix-timed-text-url";
export const NETFLIX_TIMED_TEXT_REQUEST_EVENT = "subjap:netflix-timed-text-request";

export interface NetflixTimedTextTrack {
  language: string;
  url: string;
}

export interface NetflixTimedTextPayload {
  url: string;
  language: string;
  body: string;
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
  const fetchTrack = (track: NetflixTimedTextTrack): void => {
    if (seenUrls.has(track.url)) return;
    seenUrls.add(track.url);
    discoveredTracks.set(track.url, track);
    // Let the isolated content script perform the request. Some privacy
    // extensions block page-world fetches to Netflix's CDN, while an
    // extension content script can use the page session without that clash.
    emit(NETFLIX_TIMED_TEXT_URL_EVENT, track);
  };

  const nativeParse = pageWithJson.JSON.parse.bind(pageWithJson.JSON);
  pageWithJson.JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
    const value: unknown = nativeParse(text, reviver) as unknown;
    for (const track of collectNetflixTimedTextTracks(value)) fetchTrack(track);
    return value;
  }) as typeof pageWithJson.JSON.parse;

  const fetchImpl = page.fetch?.bind(page);
  if (fetchImpl) {
    page.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (TIMED_TEXT_URL_PATTERN.test(url)) {
        void response.clone().text().then((body) => {
          if (body) {
            emit(NETFLIX_TIMED_TEXT_EVENT, {
              url,
              language: inferLanguage(url),
              body,
            });
          }
        }).catch(() => undefined);
      }
      return response;
    }) as typeof page.fetch;
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
  if (!encoded) return "";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
