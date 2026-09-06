import type { SubtitleCue } from "@/core/types";
import { normalizeCueText } from "./normalize";
import { parseVTT } from "./parse";

interface CaptionEvent {
  tStartMs?: number;
  dDurationMs?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: Array<{ utf8?: string }>;
}

/** Read both downloadable captions and the JSON3/SRV3 files used by the player. */
export function parseYouTubeCaptions(body: string, automatic: boolean): SubtitleCue[] {
  const input = body.trim();
  if (input.startsWith("WEBVTT")) return parseVTT(input);
  let events: CaptionEvent[];
  if (input.startsWith("{")) {
    const json = JSON.parse(input) as { events?: CaptionEvent[] };
    if (!Array.isArray(json.events)) return [];
    events = json.events;
  } else {
    const xml = new DOMParser().parseFromString(input, "text/xml");
    if (xml.querySelector("parsererror")) return [];
    // SRV3 uses milliseconds; the legacy transcript format uses seconds.
    events = Array.from(xml.querySelectorAll("body > p, transcript > text")).map((node) => {
      const legacy = node.tagName === "text";
      const start = node.getAttribute(legacy ? "start" : "t");
      const duration = node.getAttribute(legacy ? "dur" : "d");
      for (const br of node.querySelectorAll("br")) br.replaceWith("\n");
      return {
        tStartMs: start === null ? undefined : Number(start) * (legacy ? 1000 : 1),
        dDurationMs: duration === null ? undefined : Number(duration) * (legacy ? 1000 : 1),
        wWinId: Number(node.getAttribute("w") ?? 0),
        aAppend: Number(node.getAttribute("a") ?? 0),
        segs: [{ utf8: node.textContent ?? "" }],
      };
    });
  }

  const cues: SubtitleCue[] = [];
  const windows = new Map<number, SubtitleCue>();
  for (const [index, event] of events.entries()) {
    if (!event || !Array.isArray(event.segs) || typeof event.tStartMs !== "number" || !Number.isFinite(event.tStartMs)) continue;
    const start = event.tStartMs / 1000;
    if (start < 0) continue;
    const text = normalizeCueText(event.segs.map((seg) => typeof seg?.utf8 === "string" ? seg.utf8 : "").join(""));
    const windowId = event.wWinId ?? 0;
    const previous = windows.get(windowId);
    const duration = (event.dDurationMs ?? 0) / 1000;
    const end = start + duration;
    if (event.aAppend && previous && start <= previous.end) {
      // Append events belong to the same source caption window. New windows
      // below stay separate; ASR's rolling display must not duplicate phrases.
      if (text) previous.text = `${previous.text}\n${text}`;
      if (Number.isFinite(end) && duration > 0) previous.end = Math.max(previous.end, end);
      continue;
    }
    if (automatic && previous && previous.end > start) previous.end = start;
    if (!text || !Number.isFinite(end) || end <= start) continue;
    const cue: SubtitleCue = { id: `yt-${index}`, start, end, text, endConfirmed: true };
    windows.set(windowId, cue);
    cues.push(cue);
  }
  return cues.filter((cue) => cue.end > cue.start).sort((a, b) => a.start - b.start);
}
