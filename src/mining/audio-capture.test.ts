import { describe, expect, it } from "vitest";
import { encodeWavDataUrl } from "@/mining/audio-capture";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe("encodeWavDataUrl", () => {
  it("creates a mono PCM WAV suitable for Anki media", () => {
    const bytes = decodeDataUrl(encodeWavDataUrl(new Float32Array([0, -1, 1]), 8000));
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(bytes.length).toBe(50);
  });
});
