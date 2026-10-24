import regular from "./fonts/ibm-plex-sans-latin-400-normal.woff2?inline";
import medium from "./fonts/ibm-plex-sans-latin-500-normal.woff2?inline";
import semibold from "./fonts/ibm-plex-sans-latin-600-normal.woff2?inline";

/**
 * Only the Latin part of IBM Plex is bundled: the full Japanese family weighs
 * several megabytes. It is registered under the name every SubJap font stack
 * starts with, so Latin text (translations, popover, mining) renders in Plex
 * while Japanese falls through to the system fonts of the same stack.
 *
 * Keep in sync with the @font-face rules of `theme.css`.
 */
const FAMILY = "IBM Plex Sans JP";

/**
 * Fontsource's Latin range, minus ― (U+2015) and ‥… (U+2025-2026): Japanese
 * subtitles use them and they must keep their centred, full-width form.
 */
const LATIN_UNICODE_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, " +
  "U+0304, U+0308, U+0329, U+2000-2014, U+2016-2024, U+2027-206F, U+20AC, " +
  "U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

const WEIGHTS = [
  { weight: "400", dataUrl: regular, localName: "IBMPlexSansJP-Regular" },
  { weight: "500", dataUrl: medium, localName: "IBMPlexSansJP-Medium" },
  { weight: "600", dataUrl: semibold, localName: "IBMPlexSansJP-SemiBold" },
];

let registered = false;

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Adds the Latin Plex faces to the host page. Faces are built from bytes, not
 * URLs, so the page's font-src CSP does not apply and no extension resource
 * needs to be web-accessible.
 */
export function registerPlexLatinFont(): void {
  if (registered || typeof FontFace === "undefined" || !document.fonts) return;
  registered = true;

  for (const { weight, dataUrl, localName } of WEIGHTS) {
    // Declaring the family hides an installed IBM Plex Sans JP: re-expose it
    // for Japanese. Added first, so the bundled Latin face wins on overlap.
    const local = new FontFace(FAMILY, `local("${localName}")`, { weight });
    document.fonts.add(local);
    local.load().catch(() => {
      // Not installed: the stack falls back to the system Japanese fonts.
    });

    const latin = new FontFace(FAMILY, dataUrlToBuffer(dataUrl), {
      weight,
      unicodeRange: LATIN_UNICODE_RANGE,
      display: "swap",
    });
    document.fonts.add(latin);
  }
}
