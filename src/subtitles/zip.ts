// ---------------------------------------------------------------------------
// SubJap — Minimal ZIP reader for subtitle archives
//
// Season packs on Jimaku are mostly ZIP files of a few hundred kilobytes:
// stored or deflated entries, no encryption, no ZIP64. Anything else is
// skipped rather than half-read.
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRY_SIZE = 8_000_000;

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes, followed by a comment of at most 65535 bytes.
  const last = view.byteLength - 22;
  for (let offset = last; offset >= Math.max(0, last - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Files of a ZIP archive, without folders; throws when it is not one. */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  if (end < 0) throw new Error("Archive ZIP illisible.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) break;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    const encrypted = (flags & 1) !== 0;
    if (name.endsWith("/") || encrypted || (method !== 0 && method !== 8) || size > MAX_ENTRY_SIZE) continue;
    entries.push({
      name,
      size,
      read: async () => {
        if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
          throw new Error("Archive ZIP illisible.");
        }
        const start = localOffset + 30 +
          view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressedSize);
        return method === 0 ? data : inflateRaw(data);
      },
    });
  }
  return entries;
}

/**
 * Subtitle text from raw bytes. Recent files are UTF-8; older Japanese ones
 * are often Shift_JIS or UTF-16 with a byte order mark.
 */
export function decodeSubtitleText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}
