// ---------------------------------------------------------------------------
// Tests for the jmdict-simplified conversion & tar parsing
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { convertJmdictWord, JMDICT_PACKS, parseTar } from "./jmdict";

interface TarFile {
  name: string;
  content: Uint8Array;
  /** POSIX typeflag character, e.g. "0" (file), "5" (directory). */
  type?: string;
}

/** Build a minimal POSIX tar byte buffer for testing. */
function buildTar(files: TarFile[]): ArrayBuffer {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];

  for (const file of files) {
    const header = new Uint8Array(512);
    header.set(enc.encode(file.name), 0);
    header.set(enc.encode("0000644\0"), 100); // mode
    const sizeOctal = file.content.length.toString(8).padStart(11, "0") + "\0";
    header.set(enc.encode(sizeOctal), 124); // size (octal)
    header.set(enc.encode("00000000000\0"), 136); // mtime
    header[156] = (file.type ?? "0").charCodeAt(0); // typeflag
    blocks.push(header);
    blocks.push(file.content);
    const pad = (512 - (file.content.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512)); // end-of-archive marker

  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out.buffer;
}

describe("convertJmdictWord", () => {
  it("converts gloss objects and plain strings", () => {
    const entry = convertJmdictWord({
      id: "1",
      kanji: [{ common: true, text: "猫", tags: [] }],
      kana: [{ common: true, text: "ねこ", tags: [] }],
      sense: [
        {
          partOfSpeech: ["n"],
          gloss: [{ lang: "eng", text: "cat" }, "kitten"],
        },
      ],
    });

    expect(entry).toEqual({
      headword: "猫",
      reading: "ねこ",
      spellings: ["猫"],
      readings: ["ねこ"],
      partOfSpeech: ["n"],
      senses: [{ glosses: ["cat", "kitten"], tags: [] }],
      common: true,
    });
  });

  it("falls back to kana when there is no kanji form", () => {
    const entry = convertJmdictWord({
      id: "2",
      kana: [{ common: false, text: "カタカナ", tags: [] }],
      sense: [{ gloss: ["katakana"] }],
    });

    expect(entry?.headword).toBe("カタカナ");
    expect(entry?.reading).toBe("カタカナ");
    expect(entry?.common).toBe(false);
  });

  it("preserves every alternative JMdict spelling as an alias", () => {
    const entry = convertJmdictWord({
      id: "variants",
      kana: [
        { common: true, text: "やばい", tags: [] },
        { common: false, text: "ヤバい", tags: [] },
        { common: false, text: "ヤバイ", tags: [] },
      ],
      sense: [{ partOfSpeech: ["adj-i"], gloss: ["dangerous"] }],
    });

    expect(entry).toMatchObject({
      headword: "やばい",
      reading: "やばい",
      aliases: ["ヤバい", "ヤバイ"],
    });
  });

  it("returns null for entries with no headword at all", () => {
    expect(convertJmdictWord({ id: "3", kana: [], sense: [] })).toBeNull();
  });

  it("aggregates sense tags and misc into one tags array", () => {
    const entry = convertJmdictWord({
      id: "4",
      kana: [{ common: false, text: "ア", tags: [] }],
      sense: [{ gloss: ["a"], tags: ["ichi1"], misc: ["abbr"] }],
    });

    expect(entry?.senses[0]?.tags).toEqual(["ichi1", "abbr"]);
  });

  it("drops empty glosses", () => {
    const entry = convertJmdictWord({
      id: "5",
      kana: [{ common: false, text: "イ", tags: [] }],
      sense: [{ gloss: ["", { lang: "eng", text: "i" }] }],
    });

    expect(entry?.senses[0]?.glosses).toEqual(["i"]);
  });
});

describe("parseTar", () => {
  it("extracts regular files with their content", () => {
    const enc = new TextEncoder();
    const tar = buildTar([{ name: "dict.json", content: enc.encode('{"a":1}') }]);

    const files = parseTar(tar);

    expect([...files.keys()]).toEqual(["dict.json"]);
    expect(new TextDecoder().decode(files.get("dict.json"))).toBe('{"a":1}');
  });

  it("skips directories and non-regular entries", () => {
    const enc = new TextEncoder();
    const tar = buildTar([
      { name: "sub/", content: new Uint8Array(0), type: "5" },
      { name: "sub/dict.json", content: enc.encode("[]") },
    ]);

    const files = parseTar(tar);

    expect([...files.keys()]).toEqual(["sub/dict.json"]);
  });

  it("handles content that is not block-aligned", () => {
    const enc = new TextEncoder();
    // 600 bytes of content → 88 bytes of padding after the first block.
    const content = enc.encode("x".repeat(600));
    const tar = buildTar([{ name: "big.json", content }]);

    const files = parseTar(tar);

    expect(files.get("big.json")?.length).toBe(600);
  });
});

describe("JMDICT_PACKS", () => {
  it("pins each asset to the release with the same version", () => {
    for (const pack of JMDICT_PACKS) {
      const url = new URL(pack.url);
      const match = url.pathname.match(
        /^\/scriptin\/jmdict-simplified\/releases\/download\/([^/]+)\/jmdict-eng(?:-common)?-(.+)\.json\.tgz$/,
      );

      expect(match, pack.url).not.toBeNull();
      expect(decodeURIComponent(match?.[1] ?? ""), pack.url).toBe(
        decodeURIComponent(match?.[2] ?? ""),
      );
    }
  });
});
