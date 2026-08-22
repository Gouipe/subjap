import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./src/manifest";

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
