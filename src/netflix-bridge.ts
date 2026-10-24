export const NETFLIX_SEEK_EVENT = "subjap:netflix-seek";
export const NETFLIX_SEEK_RESULT_EVENT = "subjap:netflix-seek-result";
export const NETFLIX_TIMED_TEXT_URL_EVENT = "subjap:netflix-timed-text-url";
export const NETFLIX_TIMED_TEXT_REQUEST_EVENT = "subjap:netflix-timed-text-request";
export const NETFLIX_SELECTED_TRACK_EVENT = "subjap:netflix-selected-track";

type SecondarySubtitleLanguage = "fr" | "en" | "none";

export interface NetflixTimedTextTrack {
  episodeId: string;
  language: string;
  trackId?: string;
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
  trackType?: unknown;
  rawTrackType?: unknown;
  isNoneTrack?: unknown;
  id?: unknown;
  new_track_id?: unknown;
  newTrackId?: unknown;
  track_id?: unknown;
  trackId?: unknown;
}

interface NetflixTimedTextSession extends NetflixPlayer {
  getMovieId?: () => unknown;
  getTimedTextTrackList?: () => NetflixTimedTextTrackOption[];
  getTimedTextTrack?: () => NetflixTimedTextTrackOption | null | undefined;
  setTimedTextTrack?: (track: NetflixTimedTextTrackOption) => unknown;
}

export function selectNetflixSecondaryTrack(
  tracks: NetflixTimedTextTrackOption[],
  current?: NetflixTimedTextTrackOption | null,
  preferredLanguage: Exclude<SecondarySubtitleLanguage, "none"> = "fr",
): { native: NetflixTimedTextTrackOption; secondary: NetflixTimedTextTrackOption } | null {
  const native =
    current && /^ja(?:-|_|$)/i.test(readTimedTextLanguage(current))
      ? current
      : tracks.find((track) => /^ja(?:-|_|$)/i.test(readTimedTextLanguage(track)));
  const preferredTranslations = tracks.filter(isPreferredTranslationTrack);
  const fallbackTranslations = tracks.filter((track) => !isPreferredTranslationTrack(track));
  const findTranslation = (language: RegExp): NetflixTimedTextTrackOption | undefined =>
    preferredTranslations.find((track) => language.test(readTimedTextLanguage(track))) ??
    fallbackTranslations.find((track) => language.test(readTimedTextLanguage(track)));
  const fallbackLanguage = preferredLanguage === "fr" ? "en" : "fr";
  const secondary = findTranslation(new RegExp(`^${preferredLanguage}(?:-|_|$)`, "i")) ??
    findTranslation(new RegExp(`^${fallbackLanguage}(?:-|_|$)`, "i"));
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
const EXPLICIT_TIMED_TEXT_URL_PATTERN =
  /timedtext|subtitle|caption|dfxp|ttml|webvtt|(?:^|[/.?&_-])vtt(?:[/.?&_-]|$)|imsc/i;
const JSON_METADATA_PATTERN =
  /json|api|metadata|manifest|playback|session|shakti|pathevaluator/i;
const SUBTITLE_CONTENT_TYPE_PATTERN = /ttml|vtt|dfxp|subtitle|caption|xml/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNetflixEpisodeId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const normalized = String(value).trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizeNetflixTrackId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}

function readNetflixEpisodeId(
  node: Record<string, unknown>,
  inheritedEpisodeId: string,
): string {
  for (const key of ["playableId", "videoId", "episodeId", "movieId"] as const) {
    const episodeId = normalizeNetflixEpisodeId(node[key]);
    if (episodeId) return episodeId;
  }

  // Netflix manifest viewables commonly expose their playable identity as a
  // plain `id`. Only accept it on a playback-shaped object so unrelated
  // catalogue/request IDs cannot scope subtitle tracks accidentally.
  const isPlaybackRecord =
    "timedtexttracks" in node ||
    "video_tracks" in node ||
    "audio_tracks" in node ||
    "playbackContextId" in node;
  if (isPlaybackRecord) {
    const episodeId = normalizeNetflixEpisodeId(node.id);
    if (episodeId) return episodeId;
  }

  return inheritedEpisodeId;
}

function readWatchEpisodeId(page: Window): string {
  return page.location.pathname.match(/\/watch\/([^/?#]+)/i)?.[1] ?? "";
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
  const readTrackId = (track: Record<string, unknown>): string =>
    normalizeNetflixTrackId(
      track.trackId ??
        track.track_id ??
        track.new_track_id ??
        track.newTrackId ??
        track.id,
    );

  const walkTrackUrls = (
    node: unknown,
    path: string,
    language: string,
    episodeId: string,
    trackId: string,
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
        tracks.push({ episodeId, language, trackId: trackId || undefined, url: node });
      }
      return;
    }
    if (!isRecord(node) && !Array.isArray(node)) return;
    if (typeof node === "object" && node !== null) {
      if (seenNodes.has(node)) return;
      seenNodes.add(node);
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) =>
        walkTrackUrls(child, `${path}[${index}]`, language, episodeId, trackId, depth + 1),
      );
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walkTrackUrls(child, `${path}.${key}`, language, episodeId, trackId, depth + 1);
    }
  };

  const walk = (
    node: unknown,
    path: string,
    depth: number,
    inheritedEpisodeId: string,
  ): void => {
    if (depth > 12 || node == null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      node.forEach((child, index) =>
        walk(child, `${path}[${index}]`, depth + 1, inheritedEpisodeId),
      );
      return;
    }
    if (!isRecord(node)) return;

    const episodeId = readNetflixEpisodeId(node, inheritedEpisodeId);

    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (key.toLowerCase() === "timedtexttracks" && Array.isArray(child)) {
        child.forEach((track, index) => {
          if (!isRecord(track)) return;
          const language = readLanguage(track);
          const trackId = readTrackId(track);
          walkTrackUrls(
            track.ttDownloadables ?? track.downloadables,
            `${childPath}[${index}]`,
            language,
            episodeId,
            trackId,
            0,
          );
        });
      }
      walk(child, childPath, depth + 1, episodeId);
    }
  };

  walk(value, "$", 0, "");
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

  const discoveredTracks = new Map<string, NetflixTimedTextTrack>();
  const subtitleTrackCandidates = new Map<string, NetflixTimedTextTrack>();
  let discoveredEpisodeId = readWatchEpisodeId(page);
  let preferredSecondaryLanguage: SecondarySubtitleLanguage = "fr";
  let pendingSecondaryLanguage = "";
  let pendingNativeTrack: NetflixTimedTextTrackOption | null = null;
  let pendingSecondaryRestore: number | null = null;
  let pendingSecondaryAssociation: NetflixTimedTextTrack | null = null;
  let pendingSecondaryAssociationExpiry: number | null = null;
  let pendingNativeAssociation: NetflixTimedTextTrack | null = null;
  let pendingNativeAssociationExpiry: number | null = null;
  let uiProbeAttempted = false;
  let uiProbeDiagnosticLogged = false;
  let uiNativeRestore: number | null = null;
  const probedSessions = new WeakMap<object, SecondarySubtitleLanguage>();
  const loggedTrackLists = new WeakSet<object>();
  let lastNativeSelection = "";

  const announceTrack = (
    session: NetflixTimedTextSession,
    track: NetflixTimedTextTrackOption,
  ): void => {
    const episodeId = readNetflixSessionEpisodeId(session, page);
    const language = readTimedTextLanguage(track);
    const trackId = readTimedTextTrackId(track);
    if (!episodeId || !trackId || !language) return;
    emit(NETFLIX_SELECTED_TRACK_EVENT, { episodeId, language, trackId });
  };

  const observeNativeTrack = (force = false): void => {
    const session = resolveNetflixTimedTextSession(page);
    if (!session) return;
    try {
      const track = session.getTimedTextTrack?.();
      if (!track || !languagesMatch(readTimedTextLanguage(track), "ja")) return;
      const episodeId = readNetflixSessionEpisodeId(session, page);
      const trackId = readTimedTextTrackId(track);
      if (!episodeId || !trackId) return;
      const key = `${episodeId}:${trackId}`;
      if (!force && key === lastNativeSelection) return;
      lastNativeSelection = key;
      announceTrack(session, track);
      scopeActiveSessionTrack(session, track);
    } catch {
      // A session may disappear while the player changes episode.
    }
  };

  const associateNextTrackRequest = (
    language: string,
    episodeId = readWatchEpisodeId(page),
    kind: "secondary" | "native" = "secondary",
    trackId?: string,
  ): void => {
    if (!episodeId || !language) return;
    const expiry = kind === "secondary"
      ? pendingSecondaryAssociationExpiry
      : pendingNativeAssociationExpiry;
    if (expiry !== null) {
      page.clearTimeout(expiry);
    }
    const association = { episodeId, language, trackId, url: "" };
    if (kind === "secondary") {
      pendingSecondaryAssociation = association;
    } else {
      pendingNativeAssociation = association;
    }
    const timer = page.setTimeout(() => {
      if (kind === "secondary") {
        pendingSecondaryAssociation = null;
        pendingSecondaryAssociationExpiry = null;
      } else {
        pendingNativeAssociation = null;
        pendingNativeAssociationExpiry = null;
      }
    }, 2500);
    if (kind === "secondary") {
      pendingSecondaryAssociationExpiry = timer;
    } else {
      pendingNativeAssociationExpiry = timer;
    }
  };

  const clearPendingAssociations = (): void => {
    if (pendingSecondaryAssociationExpiry !== null) {
      page.clearTimeout(pendingSecondaryAssociationExpiry);
      pendingSecondaryAssociationExpiry = null;
    }
    if (pendingNativeAssociationExpiry !== null) {
      page.clearTimeout(pendingNativeAssociationExpiry);
      pendingNativeAssociationExpiry = null;
    }
    pendingSecondaryAssociation = null;
    pendingNativeAssociation = null;
  };

  const consumeTrackAssociation = (
    url: string,
    language = "",
    secondaryOnly = false,
  ): NetflixTimedTextTrack | null => {
    const activeEpisodeId = readWatchEpisodeId(page);
    const associations = secondaryOnly
      ? [pendingSecondaryAssociation]
      : [pendingSecondaryAssociation, pendingNativeAssociation];
    const association = associations.find(
      (candidate) =>
        candidate &&
        candidate.episodeId === activeEpisodeId &&
        (!language || languagesMatch(candidate.language, language)),
    );
    if (!association) return null;
    if (association === pendingSecondaryAssociation) {
      pendingSecondaryAssociation = null;
      if (pendingSecondaryAssociationExpiry !== null) {
        page.clearTimeout(pendingSecondaryAssociationExpiry);
        pendingSecondaryAssociationExpiry = null;
      }
    } else {
      pendingNativeAssociation = null;
      if (pendingNativeAssociationExpiry !== null) {
        page.clearTimeout(pendingNativeAssociationExpiry);
        pendingNativeAssociationExpiry = null;
      }
    }
    return { ...association, url };
  };

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
      associateNextTrackRequest(
        readTimedTextLanguage(nativeTrack),
        readWatchEpisodeId(page),
        "native",
        readTimedTextTrackId(nativeTrack) || undefined,
      );
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
    const activeEpisodeId = readWatchEpisodeId(page);
    if (activeEpisodeId !== discoveredEpisodeId) {
      discoveredTracks.clear();
      subtitleTrackCandidates.clear();
      clearPendingAssociations();
      discoveredEpisodeId = activeEpisodeId;
    }
    const previousCandidate = subtitleTrackCandidates.get(track.url);
    subtitleTrackCandidates.set(track.url, {
      ...previousCandidate,
      ...track,
      episodeId: track.episodeId || previousCandidate?.episodeId || "",
      language: track.language || previousCandidate?.language || "",
      trackId: track.trackId || previousCandidate?.trackId,
    });
    if (!activeEpisodeId || track.episodeId !== activeEpisodeId) return;

    const previous = discoveredTracks.get(track.url);
    const discovered = {
      ...previous, ...track,
      language: track.language || previous?.language || "",
      trackId: track.trackId || previous?.trackId,
    };
    if (previous?.language === discovered.language && previous?.trackId === discovered.trackId) return;
    discoveredTracks.set(track.url, discovered);
    if (!discovered.language) return;
    // Let the isolated content script perform the request. Some privacy
    // extensions block page-world fetches to Netflix's CDN, while an
    // extension content script can use the page session without that clash.
    console.log(`[SubJap] Netflix timed-text track discovered: ${discovered.language}`);
    emit(NETFLIX_TIMED_TEXT_URL_EVENT, discovered);
  };

  const scopeActiveSessionTrack = (
    session: NetflixTimedTextSession,
    track: NetflixTimedTextTrackOption,
  ): number => {
    const episodeId = readNetflixSessionEpisodeId(session, page);
    const language = readTimedTextLanguage(track);
    const trackId = readTimedTextTrackId(track);
    if (!episodeId || !language) return 0;

    let scoped = 0;
    for (const directTrack of collectNetflixTimedTextTracks({
      movieId: episodeId,
      timedtexttracks: [track],
    })) {
      fetchTrack(directTrack);
      scoped += 1;
    }

    if (trackId) {
      for (const candidate of [...subtitleTrackCandidates.values()]) {
        if (
          candidate.trackId !== trackId ||
          (candidate.episodeId && candidate.episodeId !== episodeId) ||
          (candidate.language &&
            !languagesMatch(candidate.language, language))
        ) {
          continue;
        }
        fetchTrack({ ...candidate, episodeId, language, trackId });
        scoped += 1;
      }
    }

    return scoped;
  };
  /**
   * The Japanese track the player shows, or restores after a translation
   * probe. Netflix downloads it before SubJap can announce its URL.
   */
  const readNativeJapaneseTrack = (
    requestEpisodeId: string,
  ): NetflixTimedTextTrack | null => {
    const session = resolveNetflixTimedTextSession(page);
    if (!session) return null;
    let track: NetflixTimedTextTrackOption | null | undefined;
    try {
      track = session.getTimedTextTrack?.();
    } catch {
      return null;
    }
    if (!track || !languagesMatch(readTimedTextLanguage(track), "ja")) track = pendingNativeTrack;
    if (!track || !languagesMatch(readTimedTextLanguage(track), "ja")) return null;
    const episodeId = readNetflixSessionEpisodeId(session, page);
    const trackId = readTimedTextTrackId(track);
    // A response requested for the previous episode must not be relabelled.
    if (!episodeId || !trackId || episodeId !== requestEpisodeId) return null;
    return { episodeId, language: readTimedTextLanguage(track), trackId, url: "" };
  };

  const emitTimedTextUrl = (
    url: string,
    language = "",
    validatedSubtitleBody = false,
    requestEpisodeId = "",
  ): void => {
    const candidate = subtitleTrackCandidates.get(url);
    if (candidate) {
      const authoritativeJapaneseLanguage =
        validatedSubtitleBody && languagesMatch(language, "ja") ? language : "";
      fetchTrack({
        ...candidate,
        language: authoritativeJapaneseLanguage || candidate.language || language,
      });
      return;
    }
    const associated = validatedSubtitleBody
      ? consumeTrackAssociation(url, language, true)
      : EXPLICIT_TIMED_TEXT_URL_PATTERN.test(url)
        ? consumeTrackAssociation(url, language)
        : null;
    if (associated) {
      fetchTrack({
        ...associated,
        language: language || associated.language,
      });
      return;
    }
    const discovered = discoveredTracks.get(url);
    if (!discovered) {
      // The body itself proves a Japanese subtitle file with an unannounced
      // URL: it belongs to the Japanese track selected in the player.
      const native = validatedSubtitleBody && languagesMatch(language, "ja")
        ? readNativeJapaneseTrack(requestEpisodeId)
        : null;
      if (native) fetchTrack({ ...native, url });
      return;
    }
    fetchTrack({
      ...discovered,
      language: discovered.language || language,
    });
  };
  const inspectSubtitleBody = (
    url: string,
    body: string,
    contentType: string,
    requestEpisodeId: string,
  ): void => {
    if (
      !SUBTITLE_CONTENT_TYPE_PATTERN.test(contentType) &&
      !TIMED_TEXT_URL_PATTERN.test(url) &&
      !pendingSecondaryLanguage
    ) return;
    if (!looksLikeSubtitleBody(body)) return;
    const bodyLanguage = inferSubtitleBodyLanguage(body);
    const requestedLanguage = inferLanguage(url) || pendingSecondaryLanguage;
    emitTimedTextUrl(
      url,
      languagesMatch(bodyLanguage, "ja")
        ? "ja"
        : requestedLanguage || bodyLanguage,
      true,
      requestEpisodeId,
    );
    if (pendingSecondaryLanguage) {
      const session = resolveNetflixTimedTextSession(page);
      if (session && pendingNativeTrack) {
        scheduleNativeTrackRestore(session, pendingNativeTrack);
      }
    }
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
    const inspectJsonResponse = (
      response: Response,
      url: string,
      requestEpisodeId: string,
    ): void => {
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !JSON_METADATA_PATTERN.test(`${contentType} ${url}`) &&
        !SUBTITLE_CONTENT_TYPE_PATTERN.test(contentType) &&
        !pendingSecondaryLanguage
      ) {
        return;
      }
      void response.clone().text().then((body) => {
        inspectSubtitleBody(url, body, contentType, requestEpisodeId);
        if (!JSON_METADATA_PATTERN.test(`${contentType} ${url}`)) return;
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
      const requestEpisodeId = readWatchEpisodeId(page);
      if (
        subtitleTrackCandidates.has(url) ||
        EXPLICIT_TIMED_TEXT_URL_PATTERN.test(url)
      ) {
        emitTimedTextUrl(url, inferLanguage(url));
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
      inspectJsonResponse(response, url, requestEpisodeId);
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
      const requestEpisodeId = readWatchEpisodeId(page);
      this.addEventListener("load", () => {
        const url = this.responseURL || xhrUrls.get(this) || "";
        if (
          subtitleTrackCandidates.has(url) ||
          EXPLICIT_TIMED_TEXT_URL_PATTERN.test(url)
        ) {
          emitTimedTextUrl(url, inferLanguage(url));
          if (pendingSecondaryLanguage) {
            const session = resolveNetflixTimedTextSession(page);
            if (session && pendingNativeTrack) {
              scheduleNativeTrackRestore(session, pendingNativeTrack);
            }
          }
        }
        const contentType = this.getResponseHeader("content-type") ?? "";
        const responseBody =
          this.responseType === "" || this.responseType === "text"
            ? this.responseText
            : "";
        inspectSubtitleBody(url, responseBody, contentType, requestEpisodeId);
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
    if (preferredSecondaryLanguage === "none") return;
    const session = resolveNetflixTimedTextSession(page);
    if (!session) {
      probeSecondaryTrackThroughUi();
      return;
    }
    if (probedSessions.get(session) === preferredSecondaryLanguage) return;
    let tracks: NetflixTimedTextTrackOption[] = [];
    try {
      tracks = session.getTimedTextTrackList?.() ?? [];
    } catch {
      return;
    }
    if (!Array.isArray(tracks) || tracks.length === 0) {
      probeSecondaryTrackThroughUi();
      return;
    }
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
    const selectedTracks = selectNetflixSecondaryTrack(
      tracks,
      currentTrack,
      preferredSecondaryLanguage,
    );
    if (!selectedTracks || typeof session.setTimedTextTrack !== "function") {
      probedSessions.set(session, preferredSecondaryLanguage);
      return;
    }
    const nativeTrack = selectedTracks.native;
    const secondaryTrack = selectedTracks.secondary;
    try {
      pendingSecondaryLanguage = readTimedTextLanguage(secondaryTrack);
      pendingNativeTrack = nativeTrack;
      const episodeId = readNetflixSessionEpisodeId(session, page);
      if (!episodeId) {
        console.log("[SubJap] Netflix secondary probe skipped: player episode mismatch");
        probedSessions.set(session, preferredSecondaryLanguage);
        pendingSecondaryLanguage = "";
        pendingNativeTrack = null;
        return;
      }
      announceTrack(session, nativeTrack);
      announceTrack(session, secondaryTrack);
      scopeActiveSessionTrack(session, nativeTrack);
      if (scopeActiveSessionTrack(session, secondaryTrack) > 0) {
        probedSessions.set(session, preferredSecondaryLanguage);
        pendingSecondaryLanguage = "";
        pendingNativeTrack = null;
        console.log(`[SubJap] Netflix scoped secondary track: ${readTimedTextLanguage(secondaryTrack)}`);
        return;
      }
      associateNextTrackRequest(pendingSecondaryLanguage, episodeId, "secondary", readTimedTextTrackId(secondaryTrack) || undefined);
      session.setTimedTextTrack(secondaryTrack);
      page.setTimeout(() => {
        try {
          const selectedTrack = session.getTimedTextTrack?.();
          if (selectedTrack) scopeActiveSessionTrack(session, selectedTrack);
        } catch {
          // The session can be replaced while the probe is in flight.
        }
      }, 100);
      probedSessions.set(session, preferredSecondaryLanguage);
      scheduleNativeTrackRestore(session, nativeTrack);
      console.log(`[SubJap] Netflix probing secondary track: ${pendingSecondaryLanguage}`);
    } catch {
      pendingSecondaryLanguage = "";
      pendingNativeTrack = null;
    }
  };

  const restoreNativeTrackThroughUi = (): void => {
    if (uiNativeRestore !== null) {
      page.clearTimeout(uiNativeRestore);
      uiNativeRestore = null;
    }
    const audioButton = findNetflixUiElement(page, "Audio & Subtitles");
    if (!audioButton) {
      pendingSecondaryLanguage = "";
      return;
    }
    audioButton.click();
    page.setTimeout(() => {
      const nativeTrack =
        findNetflixUiElement(page, "Japanese (CC)") ??
        findNetflixUiElement(page, "Japanese");
      associateNextTrackRequest("ja", readWatchEpisodeId(page), "native");
      nativeTrack?.click();
      pendingSecondaryLanguage = "";
    }, 250);
  };

  function probeSecondaryTrackThroughUi(): void {
    if (uiProbeAttempted) return;
    const audioButton = findNetflixUiElement(page, "Audio & Subtitles");
    if (!audioButton) {
      revealNetflixControls(page);
      if (!uiProbeDiagnosticLogged) {
        uiProbeDiagnosticLogged = true;
        console.log(
          `[SubJap] Netflix secondary probe waiting: netflix=${typeof pageWithNetflix.netflix}`,
        );
      }
      return;
    }
    uiProbeAttempted = true;
    pendingSecondaryLanguage = preferredSecondaryLanguage;
    audioButton.click();
    page.setTimeout(() => {
      const preferredLabel = preferredSecondaryLanguage === "fr" ? "French" : "English";
      const fallbackLanguage: SecondarySubtitleLanguage =
        preferredSecondaryLanguage === "fr" ? "en" : "fr";
      const fallbackLabel = fallbackLanguage === "fr" ? "French" : "English";
      const secondaryTrack = findNetflixUiElement(page, preferredLabel) ?? (() => {
        pendingSecondaryLanguage = fallbackLanguage;
        return findNetflixUiElement(page, fallbackLabel);
      })();
      if (!secondaryTrack) {
        console.log("[SubJap] Netflix secondary probe: French/English option not found");
        pendingSecondaryLanguage = "";
        return;
      }
      associateNextTrackRequest(
        pendingSecondaryLanguage,
        readWatchEpisodeId(page),
        "secondary",
      );
      secondaryTrack.click();
      uiNativeRestore = page.setTimeout(restoreNativeTrackThroughUi, 1800);
      console.log(`[SubJap] Netflix probing secondary track through UI: ${pendingSecondaryLanguage}`);
    }, 250);
  }

  let trackProbeCount = 0;
  const setInterval = page.setInterval?.bind(page);
  if (setInterval) {
    // Track selection can change long after the initial translation probe.
    // This cheap identity read stays active for the lifetime of the page.
    setInterval(() => observeNativeTrack(), 500);
    const trackProbeTimer = setInterval(() => {
      probeSecondaryTimedTextTrack();
      trackProbeCount += 1;
      if (trackProbeCount >= 120) page.clearInterval(trackProbeTimer);
    }, 500);
  }

  page.addEventListener("message", (event) => {
    if (event.source !== page) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      payload?: {
        episodeId?: unknown;
        preferredSecondaryLanguage?: unknown;
      };
    };
    if (
      data?.source !== "subjap" ||
      data.type !== NETFLIX_TIMED_TEXT_REQUEST_EVENT
    ) {
      return;
    }
    const episodeId =
      typeof data.payload?.episodeId === "string"
        ? data.payload.episodeId
        : "";
    if (!episodeId || episodeId !== readWatchEpisodeId(page)) return;
    observeNativeTrack(true);
    const requestedLanguage = data.payload?.preferredSecondaryLanguage;
    if (requestedLanguage === "fr" || requestedLanguage === "en" || requestedLanguage === "none") {
      if (preferredSecondaryLanguage !== requestedLanguage) {
        preferredSecondaryLanguage = requestedLanguage;
        uiProbeAttempted = false;
        if (requestedLanguage === "none") {
          const session = resolveNetflixTimedTextSession(page);
          clearPendingAssociations();
          if (session && pendingNativeTrack) {
            restoreNativeTrack(session, pendingNativeTrack);
          } else if (uiNativeRestore !== null) {
            restoreNativeTrackThroughUi();
          } else {
            pendingSecondaryLanguage = "";
            pendingNativeTrack = null;
          }
        }
      }
    }
    for (const track of discoveredTracks.values()) {
      if (track.episodeId === episodeId) {
        emit(NETFLIX_TIMED_TEXT_URL_EVENT, track);
      }
    }
    probeSecondaryTimedTextTrack();
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

function isPreferredTranslationTrack(track: NetflixTimedTextTrackOption): boolean {
  const trackType = String(track.trackType ?? "").trim().toUpperCase();
  const rawTrackType = String(track.rawTrackType ?? "").trim().toUpperCase();
  return trackType === "PRIMARY" || rawTrackType === "SUBTITLES";
}

function readTimedTextTrackId(track: NetflixTimedTextTrackOption): string {
  return normalizeNetflixTrackId(
    track.trackId ??
      track.track_id ??
      track.new_track_id ??
      track.newTrackId ??
      track.id,
  );
}

function languagesMatch(left: string, right: string): boolean {
  const normalize = (language: string): string =>
    language.trim().toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";
  return Boolean(normalize(left)) && normalize(left) === normalize(right);
}

function readNetflixSessionEpisodeId(
  session: NetflixTimedTextSession,
  page: Window,
): string {
  let sessionEpisodeId = "";
  try {
    sessionEpisodeId = normalizeNetflixEpisodeId(session.getMovieId?.());
  } catch {
    return "";
  }
  const watchEpisodeId = readWatchEpisodeId(page);
  return sessionEpisodeId && sessionEpisodeId === watchEpisodeId
    ? sessionEpisodeId
    : "";
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
      continue;
    }
  }
  return null;
}

function looksLikeSubtitleBody(body: string): boolean {
  const head = body.trim().slice(0, 12000);
  return (
    /^WEBVTT(?:\s|$)/i.test(head) ||
    /<tt(?:\s|>|\/)/i.test(head) ||
    /<p\s[^>]*(?:begin|start)=/i.test(head)
  );
}

export function inferSubtitleBodyLanguage(body: string): string {
  const declared = body.match(/(?:xml:lang|\blang|\blanguage)\s*=\s*["']([^"']+)["']/i)?.[1];
  if (declared) return declared;
  const visibleText = body.replace(/<[^>]*>/g, " ");
  const japaneseCharacters = visibleText.match(/[\u3040-\u30ff\u3400-\u9fff]/gu)?.length ?? 0;
  const latinCharacters = visibleText.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/gu)?.length ?? 0;
  if (japaneseCharacters >= 4 && japaneseCharacters >= latinCharacters) return "ja";
  // Netflix's CDN URLs often omit the language. In that case a subtitle body
  // without Japanese characters is the translation candidate. The selected
  // French track is preferred, while English remains a valid fallback.
  if (latinCharacters > 0) return "fr";
  return "";
}

function revealNetflixControls(page: Window): void {
  const target =
    page.document.querySelector<HTMLElement>("video") ??
    page.document.querySelector<HTMLElement>('[class*="watch-video"]');
  target?.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 500, clientY: 500 }),
  );
}

function findNetflixUiElement(page: Window, label: string): HTMLElement | null {
  const wanted = label.trim().replace(/\s+/g, " ").toLowerCase();
  const visited = new WeakSet<object>();
  const roots: Array<Document | ShadowRoot | Element> = [page.document];

  while (roots.length > 0) {
    const root = roots.shift();
    if (!root || visited.has(root)) continue;
    visited.add(root);
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      const aria = element.getAttribute("aria-label")?.trim().toLowerCase();
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").toLowerCase();
      if (aria === wanted || text === wanted) return element;
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return null;
}
