import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // kuromoji's DictionaryLoader uses Node's `path.join` — polyfill for the browser.
      path: "path-browserify",
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
