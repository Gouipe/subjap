// ---------------------------------------------------------------------------
// SubJap — Timing of a PGS (Blu-ray image) subtitle track
//
// PGS subtitles are pictures: their text cannot be read, but each display
// carries its time. A display starts when a composition shows objects, and
// ends at the next composition that shows none. Only these times are kept,
// as a reference to align Japanese files on.
// ---------------------------------------------------------------------------

const HEADER_LENGTH = 13;
const PRESENTATION_COMPOSITION = 0x16;
/** Normal case: the same picture updated (a fade, a move), not a new line. */
const NORMAL_STATE = 0x00;
const PTS_PER_SECOND = 90_000;

export interface PgsDisplay {
  start: number;
  end: number;
}

export function isPgsFileName(name: string): boolean {
  return /\.sup$/i.test(name);
}

/** Displays of a .sup file, in order; empty when it is not PGS. */
export function parsePgsDisplays(bytes: Uint8Array): PgsDisplay[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const displays: PgsDisplay[] = [];
  let open: PgsDisplay | null = null;
  let position = 0;
  while (
    position + HEADER_LENGTH <= bytes.length &&
    bytes[position] === 0x50 && bytes[position + 1] === 0x47 // "PG"
  ) {
    const time = view.getUint32(position + 2) / PTS_PER_SECOND;
    const type = bytes[position + 10];
    const size = view.getUint16(position + 11);
    const body = position + HEADER_LENGTH;
    if (type === PRESENTATION_COMPOSITION && body + 11 <= bytes.length) {
      const state = bytes[body + 7];
      const objects = bytes[body + 10] ?? 0;
      if (objects === 0) {
        if (open) open.end = Math.max(open.start, time);
        open = null;
      } else if (!open || state !== NORMAL_STATE) {
        if (open) open.end = Math.max(open.start, time);
        open = { start: time, end: time };
        displays.push(open);
      }
    }
    position = body + size;
  }
  return displays.filter((display) => display.end > display.start);
}
