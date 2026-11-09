export interface NetflixTimedTextRequest {
  url: string;
  language: string;
}

export interface NetflixTimedTextResponse extends NetflixTimedTextRequest {
  body: string;
}

/**
 * The request carries the Netflix session: only a Netflix page may ask for it,
 * not the content script of another site.
 */
export function isNetflixOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && /(?:^|\.)netflix\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function assertAllowedTimedTextUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid Netflix timed-text URL");
  }

  if (
    parsed.protocol !== "https:" ||
    !/(?:^|\.)nflxvideo\.net$|(?:^|\.)netflix\.com$|(?:^|\.)nflxext\.com$/i.test(
      parsed.hostname,
    )
  ) {
    throw new Error("Unsupported Netflix timed-text host");
  }
}

export async function fetchNetflixTimedText(
  request: NetflixTimedTextRequest,
): Promise<NetflixTimedTextResponse> {
  assertAllowedTimedTextUrl(request.url);
  const response = await fetch(request.url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Netflix timed-text HTTP ${response.status}`);
  }

  return {
    ...request,
    body: await response.text(),
  };
}
