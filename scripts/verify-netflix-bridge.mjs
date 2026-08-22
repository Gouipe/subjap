import { readFile } from "node:fs/promises";

const bundle = await readFile("dist/netflix-bridge.js", "utf8");
if (/\b(?:import|export)\b/.test(bundle)) {
  throw new Error(
    "dist/netflix-bridge.js must be a self-contained classic script without import/export",
  );
}

console.log("Netflix bridge bundle: classic self-contained script");
