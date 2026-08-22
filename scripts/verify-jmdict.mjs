// ---------------------------------------------------------------------------
// Verify the jmdict-simplified .tgz asset: download, gunzip, parse tar,
// parse JSON, and report shape/count. Mirrors the SW download pipeline.
//
// Usage: node scripts/verify-jmdict.mjs [url]
// ---------------------------------------------------------------------------

const DEFAULT_URL =
  "https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20260817122448/jmdict-eng-common-3.6.2%2B20260817122448.json.tgz";

function parseTar(buffer) {
  const files = new Map();
  const decoder = new TextDecoder();
  const view = new DataView(buffer);
  let offset = 0;

  while (offset + 512 <= buffer.byteLength) {
    const name = decoder
      .decode(new Uint8Array(buffer, offset, 100))
      .replace(/\0.*$/, "")
      .trim();
    if (name === "") break;

    const sizeStr = decoder
      .decode(new Uint8Array(buffer, offset + 124, 12))
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeStr, 8);
    if (Number.isNaN(size)) break;

    const type = String.fromCharCode(view.getUint8(offset + 156));
    const dataStart = offset + 512;

    if (type === "0" || type === "\0" || type === "") {
      files.set(name, new Uint8Array(buffer.slice(dataStart, dataStart + size)));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  console.log(`Fetching ${url} ...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const compressed = await res.arrayBuffer();
  console.log(`Downloaded ${(compressed.byteLength / 1024 / 1024).toFixed(1)} MiB (compressed)`);

  const ds = new DecompressionStream("gzip");
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const decompressed = await new Response(stream).arrayBuffer();
  console.log(`Gunzipped to ${(decompressed.byteLength / 1024 / 1024).toFixed(1)} MiB`);

  const files = parseTar(decompressed);
  console.log("Tar entries:", [...files.keys()]);

  const jsonFile = [...files.keys()].find((n) => n.endsWith(".json"));
  if (!jsonFile) throw new Error("No .json file found in tar");
  const parsed = JSON.parse(new TextDecoder().decode(files.get(jsonFile)));

  // v3.x wraps the entry list in an object ({ version, languages, tags, words }).
  const raw = Array.isArray(parsed) ? parsed : parsed.words;
  if (!Array.isArray(raw)) {
    console.log("Keys:", Object.keys(parsed).slice(0, 10));
    console.log("Head:", JSON.stringify(parsed).slice(0, 600));
    return;
  }

  console.log(`Entries: ${raw.length}`);
  console.log("First entry:", JSON.stringify(raw[0], null, 2).slice(0, 900));
  console.log("Last entry id:", raw[raw.length - 1].id);

  // Shape check on a sample
  let withKanji = 0, withGloss = 0, emptyHeadword = 0;
  for (const e of raw.slice(0, 20000)) {
    if (e.kanji?.length) withKanji++;
    if (e.sense?.some((s) => (s.gloss ?? []).length)) withGloss++;
    if (!e.kanji?.length && !e.kana?.length) emptyHeadword++;
  }
  console.log(`Sample 20k: withKanji=${withKanji} withGloss=${withGloss} emptyHeadword=${emptyHeadword}`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
