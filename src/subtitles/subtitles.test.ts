// ---------------------------------------------------------------------------
// SubJap — subtitle normalization / segmentation / parsing tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  normalizeCueText,
  splitIntoSentences,
  stripAssOverrides,
  stripHtmlTags,
  parseSRT,
  parseVTT,
  parseASS,
  parseTimestamp,
  parseAssTimestamp,
  detectFormat,
  parseSubtitleFile,
} from "@/subtitles";

describe("normalizeCueText", () => {
  it("strips HTML tags", () => {
    expect(stripHtmlTags("<i>こんにちは</i>")).toBe("こんにちは");
    expect(stripHtmlTags('<c.yellow>色付き</c>')).toBe("色付き");
  });

  it("strips ASS override blocks and converts line breaks", () => {
    expect(stripAssOverrides("{\\an8}こんにちは")).toBe("こんにちは");
    expect(stripAssOverrides("{\\i1}強調{\\i0}")).toBe("強調");
    expect(stripAssOverrides("行1\\N行2")).toBe("行1\n行2");
  });

  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&amp; &lt; &gt; &quot;")).toBe("& < > \"");
    expect(decodeEntities("&#12388;")).toBe("つ");
    expect(decodeEntities("&#x4f60;")).toBe("你");
    expect(decodeEntities("&nbsp;前&nbsp;")).toBe(" 前 ");
  });

  it("full pipeline: tags + entities + whitespace collapse", () => {
    expect(normalizeCueText("  <i>こんにちは</i>、&amp;世界  ")).toBe(
      "こんにちは、&世界",
    );
    expect(normalizeCueText("{\\an8}行1\n行2")).toBe("行1\n行2");
  });
});

describe("splitIntoSentences", () => {
  it("splits on Japanese sentence-final punctuation", () => {
    expect(splitIntoSentences("こんにちは。元気ですか？")).toEqual([
      "こんにちは。",
      "元気ですか？",
    ]);
  });

  it("keeps trailing closing brackets attached", () => {
    expect(splitIntoSentences("彼は言った。「元気だよ！」")).toEqual([
      "彼は言った。",
      "「元気だよ！」",
    ]);
  });

  it("treats newlines as hard boundaries", () => {
    expect(splitIntoSentences("一行目\n二行目")).toEqual(["一行目", "二行目"]);
  });

  it("splits over-long chunks at a break character", () => {
    const long = "あ".repeat(100);
    const parts = splitIntoSentences(long, 80);
    expect(parts.length).toBe(2);
    expect(parts[0]?.length).toBe(80);
    expect(parts[1]?.length).toBe(20);
  });

  it("splits over-long chunks with spaces near the boundary", () => {
    const long = "あ".repeat(70) + " い".repeat(10);
    const parts = splitIntoSentences(long, 80);
    // No part exceeds the cap
    expect(parts.every((p) => p.length <= 80)).toBe(true);
  });

  it("returns [] for empty/whitespace text", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   \n  ")).toEqual([]);
  });
});

describe("parseSRT", () => {
  const SRT = `1
00:00:01,000 --> 00:00:03,000
こんにちは、世界

2
00:00:04,500 --> 00:00:06,000
<i>元気ですか？</i>
`;

  it("parses two cues with correct timing", () => {
    const cues = parseSRT(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start: 1,
      end: 3,
      text: "こんにちは、世界",
    });
    expect(cues[1]).toMatchObject({ start: 4.5, end: 6 });
  });

  it("keeps raw markup in the text (normalized later)", () => {
    expect(parseSRT(SRT)[1]?.text).toBe("<i>元気ですか？</i>");
  });

  it("returns [] for garbage content", () => {
    expect(parseSRT("pas de sous-titres ici")).toEqual([]);
  });
});

describe("parseVTT", () => {
  const VTT = `WEBVTT - test

NOTE this is a comment

STYLE
::cue { color: yellow }

00:00:01.000 --> 00:00:03.000
こんにちは

00:00:04.000 --> 00:00:06.000 position:50%
元気？
`;

  it("parses cues and skips header/NOTE/STYLE blocks", () => {
    const cues = parseVTT(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3, text: "こんにちは" });
    expect(cues[1]).toMatchObject({ start: 4, end: 6, text: "元気？" });
  });
});

describe("parseASS", () => {
  const ASS = `[Script Info]
Title: test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,こんにちは{\\i1}世界{\\i0}
Dialogue: 0,0:00:04.50,0:00:06.00,Default,,0,0,0,,元気、元気ですか
Dialogue: 0,0:00:07.00,0:00:09.00,Default,,0,0,0,,a, b, c
`;

  it("parses dialogues and keeps text with commas intact", () => {
    const cues = parseASS(ASS);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({
      start: 1,
      end: 3,
      text: "こんにちは{\\i1}世界{\\i0}",
    });
    expect(cues[2]?.text).toBe("a, b, c");
  });

  it("parses centisecond timestamps", () => {
    expect(parseAssTimestamp("0:00:04.50")).toBeCloseTo(4.5, 5);
    expect(parseAssTimestamp("1:02:03.25")).toBeCloseTo(3723.25, 5);
    expect(parseAssTimestamp("bad")).toBeNull();
  });
});

describe("timestamps", () => {
  it("parses SRT and VTT forms", () => {
    expect(parseTimestamp("00:00:01,000")).toBe(1);
    expect(parseTimestamp("00:01:02.500")).toBeCloseTo(62.5, 5);
    expect(parseTimestamp("01:02.250")).toBeCloseTo(62.25, 5);
    expect(parseTimestamp("nope")).toBeNull();
  });
});

describe("detectFormat / parseSubtitleFile", () => {
  it("detects by extension", () => {
    expect(detectFormat("ep1.srt", "")).toBe("srt");
    expect(detectFormat("ep1.vtt", "")).toBe("vtt");
    expect(detectFormat("ep1.ass", "")).toBe("ass");
    expect(detectFormat("ep1.ssa", "")).toBe("ass");
  });

  it("sniffs content when the extension is unknown", () => {
    expect(detectFormat("ep1.txt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx")).toBe("vtt");
    expect(detectFormat("ep1.txt", "[Script Info]\nTitle: x")).toBe("ass");
    expect(detectFormat("ep1.txt", "1\n00:00:01,000 --> 00:00:02,000\nx")).toBe("srt");
    expect(detectFormat("ep1.txt", "n'importe quoi")).toBeNull();
  });

  it("dispatches to the right parser", () => {
    const srt = parseSubtitleFile("ep.srt", "1\n00:00:01,000 --> 00:00:02,000\nこんにちは");
    expect(srt).toHaveLength(1);
    expect(parseSubtitleFile("ep.txt", "rien")).toEqual([]);
  });
});
