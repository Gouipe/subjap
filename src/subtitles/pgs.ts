// ---------------------------------------------------------------------------
// SubJap — Timing and place of a PGS (Blu-ray image) subtitle track
//
// PGS subtitles are pictures: their text cannot be read, but each display
// carries its time and where its pictures sit on the frame. A display starts
// when a composition shows objects, and ends at the next composition that
// shows none. Only these times and places are kept: a reference to align
// Japanese files on, and the room the player's lines take at the bottom.
// ---------------------------------------------------------------------------

const HEADER_LENGTH = 13;
const OBJECT_DEFINITION = 0x15;
const PRESENTATION_COMPOSITION = 0x16;
const END_OF_DISPLAY_SET = 0x80;
/** Normal case: the same picture updated (a fade, a move), not a new line. */
const NORMAL_STATE = 0x00;
const PTS_PER_SECOND = 90_000;
/** First fragment of an object: it carries the picture's size. */
const FIRST_IN_SEQUENCE = 0x80;
const OBJECT_CROPPED = 0x80;

export interface PgsDisplay {
  start: number;
  end: number;
  /**
   * Vertical extent of the display's pictures, as fractions of the frame
   * height from its top; absent when the stream does not tell.
   */
  top?: number;
  bottom?: number;
}

export function isPgsFileName(name: string): boolean {
  return /\.sup$/i.test(name);
}

/** Displays of a .sup file, in order; empty when it is not PGS. */
export function parsePgsDisplays(bytes: Uint8Array): PgsDisplay[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const displays: PgsDisplay[] = [];
  /** Picture heights by object id: a composition may reuse earlier pictures. */
  const objectHeights = new Map<number, number>();
  let open: PgsDisplay | null = null;
  /** Objects placed by the display set being read, for the display it opened. */
  let placed: { display: PgsDisplay; frameHeight: number; objects: Array<[number, number]> } | null = null;
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
      const frameHeight = view.getUint16(body + 2);
      const state = bytes[body + 7];
      const objects = bytes[body + 10] ?? 0;
      placed = null;
      if (objects === 0) {
        if (open) open.end = Math.max(open.start, time);
        open = null;
      } else if (!open || state !== NORMAL_STATE) {
        if (open) open.end = Math.max(open.start, time);
        open = { start: time, end: time };
        displays.push(open);
        placed = { display: open, frameHeight, objects: readPlacedObjects(view, body, size, objects) };
      }
    } else if (type === OBJECT_DEFINITION && body + 11 <= bytes.length) {
      if ((bytes[body + 3] ?? 0) & FIRST_IN_SEQUENCE) {
        objectHeights.set(view.getUint16(body), view.getUint16(body + 9));
      }
    } else if (type === END_OF_DISPLAY_SET && placed) {
      placeDisplay(placed.display, placed.frameHeight, placed.objects, objectHeights);
      placed = null;
    }
    position = body + size;
  }
  return displays.filter((display) => display.end > display.start);
}

/** Object ids and vertical positions of a presentation composition. */
function readPlacedObjects(
  view: DataView,
  body: number,
  size: number,
  count: number,
): Array<[number, number]> {
  const objects: Array<[number, number]> = [];
  let offset = body + 11;
  const end = Math.min(body + size, view.byteLength);
  for (let index = 0; index < count && offset + 8 <= end; index += 1) {
    objects.push([view.getUint16(offset), view.getUint16(offset + 6)]);
    offset += view.getUint8(offset + 3) & OBJECT_CROPPED ? 16 : 8;
  }
  return objects;
}

function placeDisplay(
  display: PgsDisplay,
  frameHeight: number,
  objects: Array<[number, number]>,
  objectHeights: Map<number, number>,
): void {
  if (!frameHeight) return;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [id, y] of objects) {
    const height = objectHeights.get(id);
    if (!height) continue;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + height);
  }
  if (bottom <= top) return;
  display.top = top / frameHeight;
  display.bottom = Math.min(1, bottom / frameHeight);
}

/** Dialogue sits at the bottom; signs and captions elsewhere are rarer. */
const DIALOGUE_BOTTOM_FROM = 0.75;
/** Most lines fit in two rows; a few taller ones may still cover SubJap. */
const ROOM_PERCENTILE = 0.95;

/**
 * Share of the frame height, from its bottom, that the track's dialogue lines
 * take up: tall enough for most of them. 0 without dialogue at the bottom.
 */
export function pgsDialogueRoom(displays: PgsDisplay[]): number {
  const rooms = displays
    .filter((display) => display.top !== undefined && (display.bottom ?? 0) >= DIALOGUE_BOTTOM_FROM)
    .map((display) => 1 - (display.top ?? 1))
    .filter((room) => room > 0 && room <= 0.5)
    .sort((a, b) => a - b);
  return rooms[Math.min(rooms.length - 1, Math.floor(rooms.length * ROOM_PERCENTILE))] ?? 0;
}
