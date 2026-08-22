export const NETFLIX_SEEK_EVENT = "subjap:netflix-seek";
export const NETFLIX_SEEK_RESULT_EVENT = "subjap:netflix-seek-result";

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
  doc.documentElement.dataset.subjapNetflixBridge = "ready";
}
