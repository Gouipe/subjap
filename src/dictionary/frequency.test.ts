import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CEJC_FREQUENCY_URL,
  fetchCejcFrequencyRanks,
  mergeFrequencyRanks,
  parseCejcFrequencyArchive,
  parseCejcFrequencyList,
  parseTubelexFrequencyList,
} from "@/dictionary/frequency";

const CEJC_TEST_ARCHIVE_BASE64 =
  "UEsDBBQAAAAIAApqFl3+6J1qQwAAAEYAAAAhAAAAQ0VKQy9jZWpjX2ZyZXF1ZW5jeWxpc3RfdG9rZW4udHN2K0rMy+Z8sWre070zn29Z8GLV2seN+xF8zqeTG1+snMdlzvm4uf9xc9fjpp2cL1ZufNw4k/Np91SgjO6THQ0vOtYAAFBLAwQUAAAACAAKahZdRPTJAhAAAADQBwAADwAAAENFSkMvbGFyZ2UueGxzeGMYBaNgFIyCUTAKRsGQBwBQSwECFAAUAAAACAAKahZd/uidakMAAABGAAAAIQAAAAAAAAAAAAAAAAAAAAAAQ0VKQy9jZWpjX2ZyZXF1ZW5jeWxpc3RfdG9rZW4udHN2UEsBAhQAFAAAAAgACmoWXUT0yQIQAAAA0AcAAA8AAAAAAAAAAAAAAAAAggAAAENFSkMvbGFyZ2UueGxzeFBLBQYAAAAAAgACAIwAAAC/AAAAAAA=";

function cejcTestArchive(): Uint8Array {
  return Uint8Array.from(atob(CEJC_TEST_ARCHIVE_BASE64), (character) =>
    character.charCodeAt(0),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Japanese frequency lists", () => {
  it("parses the compact TUBELEX lemma ranks", () => {
    expect(
      parseTubelexFrequencyList("食べる\t42\n映画\t9\n食べる\t50\ninvalid\n"),
    ).toEqual([
      { key: "映画", rank: 9 },
      { key: "食べる", rank: 42 },
    ]);
  });

  it("uses the official CEJC rank and ignores symbols and proper nouns", () => {
    const text = [
      "rank\t語彙素読み\t語彙素\t品詞\tfrequency\tpmw",
      "12\tタベル\t食べる\t動詞-一般\t50\t40",
      "4\tタベル\t食べる\t動詞-一般\t80\t60",
      "2\tトウキョウ\t東京\t名詞-固有名詞-地名\t100\t80",
      "1\tマル\t。\t補助記号-句点\t200\t160",
    ].join("\n");

    expect(parseCejcFrequencyList(text)).toEqual([
      { key: "食べる", rank: 4 },
    ]);
  });

  it("extracts the ranked TSV directly from the official ZIP shape", () => {
    expect(parseCejcFrequencyArchive(cejcTestArchive())).toEqual([
      { key: "話す", rank: 7 },
    ]);
  });

  it("downloads only the CEJC ZIP header and compressed TSV entry", async () => {
    const archive = cejcTestArchive();
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(CEJC_FREQUENCY_URL);
        const range = new Headers(init?.headers).get("Range") ?? "";
        requests.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (!match) return Promise.resolve(new Response(null, { status: 400 }));

        const start = Number(match[1]);
        const end = Number(match[2]);
        const body = new Uint8Array(end - start + 1);
        body.set(archive.subarray(start, Math.min(end + 1, archive.length)));
        return Promise.resolve(new Response(body, { status: 206 }));
      }),
    );

    await expect(fetchCejcFrequencyRanks()).resolves.toEqual([
      { key: "話す", rank: 7 },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe("bytes=0-262143");
    expect(requests[1]).toMatch(/^bytes=\d+-\d+$/);
  });

  it("keeps the lowest rank found in TUBELEX or CEJC", () => {
    expect(
      mergeFrequencyRanks(
        [
          { key: "食べる", rank: 800 },
          { key: "映画", rank: 120 },
        ],
        [
          { key: "食べる", rank: 90 },
          { key: "映画", rank: 2_000 },
          { key: "買い物", rank: 300 },
        ],
      ),
    ).toEqual([
      { key: "食べる", rank: 90 },
      { key: "映画", rank: 120 },
      { key: "買い物", rank: 300 },
    ]);
  });
});
