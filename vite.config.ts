import { defineConfig, type Plugin } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { readFile } from "fs/promises";
import { resolve } from "path";
import manifest from "./src/manifest";

/**
 * Vite 5 ignores `?inline` on font files and still emits a URL. Content
 * scripts need the bytes themselves (see src/ui/plex-latin.ts), so inline
 * `*.woff2?inline` imports as base64 data URLs.
 */
function inlineFonts(): Plugin {
  const suffix = ".woff2?inline";
  return {
    name: "subjap-inline-fonts",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(suffix)) return null;
      const bytes = await readFile(id.slice(0, -"?inline".length));
      return `export default "data:font/woff2;base64,${bytes.toString("base64")}";`;
    },
  };
}

export default defineConfig(({ mode }) => ({
  optimizeDeps: {
    // The package's generated WASM loader must remain a runtime module so it
    // can resolve its adjacent .wasm asset in the extension bundle.
    exclude: ["lindera-wasm-web-unidic"],
  },
  server: {
    cors: {
      origin: [/^chrome-extension:\/\//],
    },
  },
  plugins: [
    inlineFonts(),
    crx({
      manifest:
        mode === "development"
          ? {
              ...manifest,
              web_accessible_resources: manifest.web_accessible_resources?.filter(
                ({ resources }) => !resources.includes("netflix-bridge.js"),
              ),
            }
          : manifest,
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        offscreen: resolve(__dirname, "src/offscreen/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
        ...(mode === "production"
          ? { netflixBridge: resolve(__dirname, "src/netflix-bridge-entry.ts") }
          : {}),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "netflixBridge"
            ? "netflix-bridge.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
}));
