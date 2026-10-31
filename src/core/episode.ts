// ---------------------------------------------------------------------------
// SubJap — Anime episode named by the page, for subtitle searches
// ---------------------------------------------------------------------------

/** Anime and episode the page says it plays; any field can be unknown. */
export interface PageEpisode {
  series: string | null;
  episode: number | null;
  /** AniList id, when the page uses an AniList cover or link. */
  anilistId: number | null;
}

/**
 * Read the episode from the top page. Players are often embedded in a frame
 * from another site, so this runs through `chrome.scripting.executeScript` in
 * the tab's top frame: it must stay self-contained (no imports, no closures).
 */
export function readPageEpisode(): PageEpisode {
  const result: PageEpisode = { series: null, episode: null, anilistId: null };
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null;
  const anilist = (value: unknown): number | null => {
    if (typeof value !== "string") return null;
    const match = value.match(/anilist\.co\/anime\/(\d+)/i) ??
      value.match(/anilistcdn\/media\/anime\/(?:cover|banner)\/[a-z]+\/[a-z]*(\d+)-/i);
    return match ? Number(match[1]) : null;
  };
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const item = node as Record<string, unknown>;
    const type = String(item["@type"] ?? "");
    if (type === "TVEpisode") {
      const number = Number(item.episodeNumber);
      if (Number.isFinite(number) && number > 0) result.episode ??= number;
      const series = item.partOfSeries as Record<string, unknown> | undefined;
      result.series ??= text(series?.name);
      result.anilistId ??= anilist(item.image) ?? anilist(item.thumbnailUrl);
      const name = text(item.name)?.match(/^(.*?)\s+-\s+Episode\s+\d+/i)?.[1];
      if (name) result.series ??= name;
    } else if (type === "TVSeries") {
      result.series ??= text(item.name);
      result.anilistId ??= anilist(item.image);
    } else if (type === "BreadcrumbList" && Array.isArray(item.itemListElement)) {
      // Home › Search › Series › Episode N: the series is just before the episode.
      const names = item.itemListElement.map((entry) => text((entry as Record<string, unknown>)?.name));
      const episodeIndex = names.findIndex((name) => !!name && /^Episode\s+\d+$/i.test(name));
      if (episodeIndex > 0) result.series ??= names[episodeIndex - 1] ?? null;
    }
    if (item["@graph"]) visit(item["@graph"], depth + 1);
  };
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(script.textContent ?? ""), 0);
    } catch {
      // Ignore malformed structured data.
    }
  }
  if (!result.series || !result.episode) {
    // "Series - Episode 6 | Site"
    const title = document.title.match(/^(.*?)\s+-\s+Episode\s+(\d+)/i);
    if (title) {
      result.series ??= text(title[1]);
      result.episode ??= Number(title[2]);
    }
  }
  if (!result.anilistId) {
    for (const element of Array.from(document.querySelectorAll('a[href*="anilist.co/anime/"], img[src*="anilistcdn/media/anime/cover"]'))) {
      result.anilistId = anilist(element.getAttribute("href") ?? element.getAttribute("src"));
      if (result.anilistId) break;
    }
  }
  return result;
}

/** Jimaku page listing the subtitles of this anime, or its search when unknown. */
export function jimakuSearchUrl(episode: PageEpisode | null): string {
  const query = episode?.anilistId
    ? `https://anilist.co/anime/${episode.anilistId}`
    : episode?.series ?? "";
  if (!query) return "https://jimaku.cc/";
  return `https://jimaku.cc/opensearch/redirect?anime=true&query=${encodeURIComponent(query)}`;
}
