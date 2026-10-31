// ---------------------------------------------------------------------------
// SubJap — Subtitle file parsers (SRT / WebVTT / ASS)
// ---------------------------------------------------------------------------
//
// Convert subtitle file content into our shared `SubtitleCue[]` shape.
// Parsers keep the raw text (markup included); the pipeline normalizes it
// with `normalizeCueText()` before tokenization.

import type { SubtitleCue } from "@/core/types";

export type SubtitleFormat = "srt" | "vtt" | "ass" | "ttml";

// ── Timestamps ─────────────────────────────────────────────────────────────

/**
 * Parse an SRT/VTT timestamp ("HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm")
 * into seconds. Returns null when the format is invalid.
 */
export function parseTimestamp(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number(m[4]?.padEnd(3, "0") ?? "0");
  return h * 3600 + min * 60 + sec + ms / 1000;
}

/**
 * Parse an ASS/SSA timestamp ("H:MM:SS.cc" — hours may be multi-digit,
 * fraction is centiseconds) into seconds. Returns null when invalid.
 */
export function parseAssTimestamp(ts: string): number | null {
  const m = ts.trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const cs = Number(m[4]);
  return h * 3600 + min * 60 + sec + cs / 100;
}

// ── Shared block scanner ───────────────────────────────────────────────────

/**
 * Split content into blocks separated by blank lines and pick the time line
 * + payload from each block. Used by the SRT and VTT parsers.
 */
function scanBlocks(
  content: string,
  skipBlock: (firstLine: string) => boolean,
): { start: number; end: number; text: string; id: string }[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const out: { start: number; end: number; text: string; id: string }[] = [];
  let index = 0;

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";
    if (skipBlock(first)) continue;

    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;

    const timeParts = (lines[timeIdx] ?? "")
      .split("-->")
      .map((s) => s.trim());
    const startStr = timeParts[0] ?? "";
    // VTT cue settings (position:50%, align:… ) trail the end timestamp on
    // the same line — keep only the timestamp itself.
    const endStr = (timeParts[1] ?? "").split(/\s+/)[0] ?? "";
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);
    if (start == null || end == null) continue;

    const text = lines.slice(timeIdx + 1).join("\n").trim();
    if (!text) continue;

    index += 1;
    out.push({ start, end, text, id: String(index) });
  }
  return out;
}

/** Convert scanned blocks into SubtitleCue objects. */
function toCues(
  blocks: { start: number; end: number; text: string; id: string }[],
  language?: string,
): SubtitleCue[] {
  return blocks.map((b) => ({
    id: b.id,
    start: b.start,
    end: b.end,
    text: b.text,
    language,
  }));
}

// ── SRT ────────────────────────────────────────────────────────────────────

/** Parse SRT content into `SubtitleCue[]`. */
export function parseSRT(content: string): SubtitleCue[] {
  return toCues(scanBlocks(content, () => false));
}

// ── WebVTT ─────────────────────────────────────────────────────────────────

/** Parse WebVTT content into `SubtitleCue[]` (skips header/NOTE/STYLE/REGION). */
export function parseVTT(content: string): SubtitleCue[] {
  return toCues(
    scanBlocks(content, (first) => {
      if (first.startsWith("WEBVTT")) return true;
      if (first.startsWith("NOTE")) return true;
      if (/^(STYLE|REGION)\b/i.test(first)) return true;
      return false;
    }),
  );
}

// ── ASS / SSA ──────────────────────────────────────────────────────────────

/**
 * Split an ASS Dialogue line into fields, merging extra commas back into the
 * text field (ASS allows commas inside the text).
 */
function splitAssLine(line: string, fieldCount: number): string[] {
  const parts = line.split(",");
  if (parts.length <= fieldCount) return parts;
  const head = parts.slice(0, fieldCount - 1);
  head.push(parts.slice(fieldCount - 1).join(","));
  return head;
}

/**
 * Fansub ASS files also time signs, karaoke and drawn shapes: thousands of
 * events that are not dialogue. Their styles say so, or their tags do.
 */
const ASS_NON_DIALOGUE_STYLE =
  /sign|^(?:op|ed)\b|^(?:op|ed)[\s_-]|opening|ending|song|kara|insert|title|typeset|logo|eyecatch|note|^ts\b/i;
const ASS_DRAWING_OR_KARAOKE = /\\p[1-9]|\\k[fo]?\d/i;
/**
 * Positioned lines are signs in a fansub, but converted TV captions place
 * every line: positioning only marks a sign when it is the exception.
 */
const ASS_POSITIONED = /\\(?:pos|move|clip|iclip|org)\(/i;
const ASS_POSITIONED_DIALOGUE_SHARE = 0.5;

/** Parse ASS/SSA content into `SubtitleCue[]` (from the [Events] section). */
export function parseASS(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, "\n");

  const section = normalized.match(/\[Events\]([\s\S]*?)(?=\n\[|\s*$)/);
  if (!section) return [];
  const body = section[1] ?? "";

  const formatMatch = body.match(/^Format:\s*(.+)$/m);
  if (!formatMatch) return [];
  const fields = (formatMatch[1] ?? "")
    .split(",")
    .map((f) => f.trim().toLowerCase());
  const startIdx = fields.indexOf("start");
  const endIdx = fields.indexOf("end");
  const textIdx = fields.indexOf("text");
  const styleIdx = fields.indexOf("style");
  if (startIdx === -1 || endIdx === -1 || textIdx === -1) return [];

  const events: { start: number; end: number; text: string; positioned: boolean }[] = [];
  const seen = new Set<string>();

  for (const line of body.split("\n")) {
    const m = line.match(/^Dialogue:\s*(.*)$/);
    if (!m) continue;
    const raw = m[1] ?? "";
    const parts = splitAssLine(raw, fields.length);
    const start = parseAssTimestamp(parts[startIdx] ?? "");
    const end = parseAssTimestamp(parts[endIdx] ?? "");
    const text = (parts[textIdx] ?? "").trim();
    if (start == null || end == null || !text) continue;
    if (ASS_NON_DIALOGUE_STYLE.test((parts[styleIdx] ?? "").trim()) || ASS_DRAWING_OR_KARAOKE.test(text)) continue;
    // Layered effects repeat the same line.
    const key = `${start}|${end}|${text.replace(/\{[^}]*\}/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ start, end, text, positioned: ASS_POSITIONED.test(text) });
  }

  const positionedShare = events.filter((event) => event.positioned).length / Math.max(1, events.length);
  const keepPositioned = positionedShare > ASS_POSITIONED_DIALOGUE_SHARE;
  return events
    .filter((event) => keepPositioned || !event.positioned)
    .map((event, index): SubtitleCue => ({
      id: String(index + 1),
      start: event.start,
      end: event.end,
      text: event.text,
    }));
}

/** Parse the TTML/DFXP timed-text documents used by Netflix. */
export function parseTTML(content: string, language?: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const root = content.match(/<tt\b([^>]*)>/i)?.[1] ?? "";
  const tickRate = Number(root.match(/\btickRate=["']([^"']+)["']/i)?.[1]) || 1;

  const parseTime = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const value = raw.trim().replace(",", ".");
    const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
    if (clock) {
      const hours = Number(clock[1] ?? 0);
      const minutes = Number(clock[2]);
      const seconds = Number(clock[3]);
      const fraction = clock[4] ? Number(`0.${clock[4]}`) : 0;
      return hours * 3600 + minutes * 60 + seconds + fraction;
    }
    const unit = value.match(/^([\d.]+)(h|m|ms|s|t)$/i);
    if (!unit) return null;
    const amount = Number(unit[1]);
    switch (unit[2]?.toLowerCase()) {
      case "h": return amount * 3600;
      case "m": return amount * 60;
      case "ms": return amount / 1000;
      case "t": return amount / tickRate;
      default: return amount;
    }
  };

  const pPattern = /<(?:(?:[\w-]+):)?p\b([^>]*)>([\s\S]*?)<\/(?:(?:[\w-]+):)?p>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pPattern.exec(content))) {
    const attrs = match[1] ?? "";
    const begin = attrs.match(/\bbegin=["']([^"']+)["']/i)?.[1];
    const end = attrs.match(/\bend=["']([^"']+)["']/i)?.[1];
    const dur = attrs.match(/\bdur=["']([^"']+)["']/i)?.[1];
    const start = parseTime(begin);
    const parsedEnd = parseTime(end);
    const duration = parseTime(dur);
    const cueEnd = parsedEnd ?? (start !== null && duration !== null ? start + duration : null);
    const text = (match[2] ?? "")
      .replace(/<(?:(?:[\w-]+):)?br\s*\/?\s*>/gi, "\n")
      .replace(/<(?:[\w-]+:)?span\b[^>]*\btts:ruby\s*=\s*["'](?:text|delimiter)["'][^>]*>[\s\S]*?<\/(?:[\w-]+:)?span>/gi, "")
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (start === null || cueEnd === null || !text) continue;
    index += 1;
    cues.push({ id: `ttml-${index}`, start, end: cueEnd, text, language });
  }
  return cues;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/** Detect the subtitle format from the filename and/or content. */
export function detectFormat(
  filename: string,
  content: string,
): SubtitleFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "srt") return "srt";
  if (ext === "vtt" || ext === "webvtt") return "vtt";
  if (ext === "ass" || ext === "ssa") return "ass";
  if (ext === "ttml" || ext === "dfxp" || ext === "xml") return "ttml";

  // Sniff content when the extension is missing/unknown.
  if (content.trimStart().startsWith("WEBVTT")) return "vtt";
  if (/^\[Script Info\]/m.test(content)) return "ass";
  if (/<tt\b|<timedtext\b/i.test(content)) return "ttml";
  if (/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(content)) return "srt";
  return null;
}

/** Parse a subtitle file into `SubtitleCue[]`; empty array when unsupported. */
export function parseSubtitleFile(
  filename: string,
  content: string,
): SubtitleCue[] {
  const format = detectFormat(filename, content);
  switch (format) {
    case "srt":
      return parseSRT(content);
    case "vtt":
      return parseVTT(content);
    case "ass":
      return parseASS(content);
    case "ttml":
      return parseTTML(content);
    default:
      return [];
  }
}
