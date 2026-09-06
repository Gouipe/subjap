/** Data crossing from YouTube's page world into the isolated content script. */
export interface YouTubeCaptionTrack {
  id: string;
  language: string;
  automatic: boolean;
  url: string;
}

export interface YouTubePlaybackInfo {
  videoId: string;
  session: string;
  title: string;
  playingVideoId: string;
  live: boolean;
  tracks: YouTubeCaptionTrack[];
}

export interface YouTubeCaptionFile extends YouTubeCaptionTrack {
  videoId: string;
  session: string;
  body: string;
}

export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)youtube\.com$/i.test(parsed.hostname) || parsed.pathname !== "/watch") return null;
    const id = parsed.searchParams.get("v");
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
