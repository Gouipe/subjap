// Keep this entry self-contained: MAIN content scripts are classic scripts.
//
// Artplayer keeps its subtitle choices in page JavaScript objects that the
// isolated content script cannot read. This bridge only lists them; the
// isolated adapter chooses and downloads the files itself.
import type { ArtplayerSubtitleCandidate } from "./core/artplayer";

interface ArtplayerInstance {
  option?: { settings?: unknown; subtitle?: unknown };
  setting?: { option?: unknown };
}

(() => {
  const marker = "__subjapArtplayerBridge";
  const page = window as Window & {
    Artplayer?: { instances?: ArtplayerInstance[] };
    [marker]?: boolean;
  };
  if (page[marker]) return;
  page[marker] = true;

  const SUBTITLE_URL = /\.(?:srt|vtt|webvtt|ass|ssa)(?:[?#]|$)/i;
  const plainText = (value: unknown): string =>
    typeof value === "string"
      ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

  const collect = (): ArtplayerSubtitleCandidate[] => {
    const candidates = new Map<string, ArtplayerSubtitleCandidate>();
    const seen = new Set<object>();
    const visit = (value: unknown, depth: number): void => {
      if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      const item = value as Record<string, unknown>;
      if (typeof item.url === "string" && SUBTITLE_URL.test(item.url)) {
        try {
          const url = new URL(item.url, location.href);
          if (url.protocol === "https:" || url.protocol === "http:") {
            const label = plainText(item.html) || plainText(item.name) || plainText(item.label);
            const previous = candidates.get(url.href);
            if (!previous || (!previous.label && label)) candidates.set(url.href, { label, url: url.href });
          }
        } catch {
          // Ignore malformed player options.
        }
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

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { source?: unknown; type?: unknown; payload?: { session?: unknown } } | null;
    if (data?.source !== "subjap" || data.type !== "subjap:artplayer-request") return;
    const session = data.payload?.session;
    if (typeof session !== "string") return;
    window.postMessage({
      source: "subjap-artplayer",
      type: "tracks",
      payload: { session, found: !!page.Artplayer, candidates: collect() },
    }, location.origin);
  });
})();
