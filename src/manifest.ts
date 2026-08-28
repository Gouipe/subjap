import { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "SubJap",
  version: "0.1.0",
  description: "Apprendre le japonais en regardant des anime",
  permissions: [
    "storage",
    "alarms",
    "scripting",
    "activeTab",
    "nativeMessaging",
    "tabCapture",
    "offscreen",
    "clipboardWrite",
  ],
  host_permissions: [
    // Required by tabs.captureVisibleTab; the extension only captures the
    // active tab after the user starts mining a card.
    "<all_urls>",
    "*://*.netflix.com/*",
    "*://*.nflxvideo.net/*",
    "*://*.nflxext.com/*",
    "*://*.youtube.com/*",
    "*://*.crunchyroll.com/*",
    "*://*.primevideo.com/*",
    "*://*.disneyplus.com/*",
    "http://127.0.0.1:8765/*",
    "http://127.0.0.1:50021/*",
    // Dictionary downloads: GitHub Release "latest" URLs redirect to the
    // versioned asset on objects/release-assets.githubusercontent.com. Both
    // hosts must be permitted or the SW fetch is CORS-blocked.
    "https://github.com/*",
    "https://raw.githubusercontent.com/*",
    "https://objects.githubusercontent.com/*",
    "https://release-assets.githubusercontent.com/*",
  ],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
  content_scripts: [
    {
      // The page-world hook must run before Netflix parses playback metadata;
      // the isolated content script remains responsible for rendering.
      matches: ["*://*.netflix.com/*"],
      js: ["src/netflix-bridge-entry.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: [
        "*://*.netflix.com/*",
        "*://*.youtube.com/*",
        "*://*.crunchyroll.com/*",
        "*://*.primevideo.com/*",
        "*://*.disneyplus.com/*",
      ],
      js: ["src/content/index.ts"],
      run_at: "document_end",
    },
  ],
  action: {
    default_popup: "src/popup/index.html",
    default_title: "SubJap",
  },
  options_page: "src/options/index.html",
  web_accessible_resources: [
    {
      // Netflix's page-world bridge must be loadable by the content script.
      resources: ["netflix-bridge.js"],
      matches: ["*://*.netflix.com/*"],
    },
  ],
};

export default manifest;
