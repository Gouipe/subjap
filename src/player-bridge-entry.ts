// Keep this entry self-contained: MAIN content scripts are classic scripts.
//
// Artplayer and Vidstack keep their subtitle choices in page JavaScript
// objects that the isolated content script cannot read. This bridge only
// lists them; the isolated adapter chooses and downloads the files itself.
import type { PlayerSubtitleCandidate } from "./core/player-subtitles";

interface ArtplayerInstance {
  option?: { settings?: unknown; subtitle?: unknown };
  setting?: { option?: unknown };
}

/** A track of Vidstack's own list: the `<track>` elements it leaves in the page have no file. */
interface VidstackTextTrack {
  kind?: unknown;
  label?: unknown;
  language?: unknown;
  src?: unknown;
}

(() => {
  const marker = "__subjapPlayerBridge";
  const page = window as Window & {
    Artplayer?: { instances?: ArtplayerInstance[] };
    [marker]?: boolean;
  };
  if (page[marker]) return;
  page[marker] = true;

  const SUBTITLE_URL = /\.(?:srt|vtt|webvtt|ass|ssa|sup)(?:[?#]|$)/i;
  const plainText = (value: unknown): string =>
    typeof value === "string"
      ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

  const fileUrl = (value: string): string | null => {
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      // Ignore malformed player options.
      return null;
    }
  };

  const collectArtplayer = (): PlayerSubtitleCandidate[] => {
    const candidates = new Map<string, PlayerSubtitleCandidate>();
    const seen = new Set<object>();
    const visit = (value: unknown, depth: number): void => {
      if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      const item = value as Record<string, unknown>;
      const url = typeof item.url === "string" && SUBTITLE_URL.test(item.url) ? fileUrl(item.url) : null;
      if (url) {
        const label = plainText(item.html) || plainText(item.name) || plainText(item.label);
        const previous = candidates.get(url);
        if (!previous || (!previous.label && label)) candidates.set(url, { label, url });
      }
      for (const key of ["selector", "settings", "option", "subtitle"]) visit(item[key], depth + 1);
    };
    for (const art of page.Artplayer?.instances ?? []) {
      visit(art?.option?.settings, 0);
      visit(art?.setting?.option, 0);
      visit(art?.option?.subtitle, 0);
    }
    return [...candidates.values()].slice(0, 50);
  };

  /** Vidstack's `<media-player>` elements, once the page has defined them. */
  const vidstackPlayers = (): { textTracks: Iterable<VidstackTextTrack> }[] =>
    Array.from(document.querySelectorAll("media-player")).filter(
      (player): player is Element & { textTracks: Iterable<VidstackTextTrack> } => {
        const tracks = (player as { textTracks?: unknown }).textTracks as Partial<Iterable<unknown>> | null;
        return typeof tracks?.[Symbol.iterator] === "function";
      },
    );

  const collectVidstack = (): PlayerSubtitleCandidate[] => {
    const candidates = new Map<string, PlayerSubtitleCandidate>();
    for (const player of vidstackPlayers()) {
      try {
        for (const track of player.textTracks) {
          // Chapters and thumbnails are text tracks too. Some files have no extension.
          if (track?.kind !== "subtitles" && track?.kind !== "captions") continue;
          const url = typeof track.src === "string" && track.src ? fileUrl(track.src) : null;
          if (!url || candidates.has(url)) continue;
          candidates.set(url, {
            label: plainText(track.label),
            url,
            language: plainText(track.language) || undefined,
          });
        }
      } catch {
        // A player that fails to list its tracks offers none.
      }
    }
    return [...candidates.values()].slice(0, 100);
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { source?: unknown; type?: unknown; payload?: { session?: unknown } } | null;
    if (data?.source !== "subjap" || data.type !== "subjap:player-tracks-request") return;
    const session = data.payload?.session;
    if (typeof session !== "string") return;
    const vidstack = vidstackPlayers().length > 0;
    window.postMessage({
      source: "subjap-player-bridge",
      type: "tracks",
      payload: {
        session,
        found: vidstack || !!page.Artplayer,
        candidates: vidstack ? collectVidstack() : collectArtplayer(),
      },
    }, location.origin);
  });
})();
