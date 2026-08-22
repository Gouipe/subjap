import { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "SubJap",
  version: "0.1.0",
  description: "Apprendre le japonais en regardant des anime",
  permissions: ["storage", "scripting", "activeTab", "nativeMessaging", "tabCapture"],
  host_permissions: [
    "*://*.netflix.com/*",
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
  content_scripts: [
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
    {
      // kuromoji dictionary files are copied from node_modules into public/dict
      // and land in dist/dict; the tokenizer loads them from the extension origin.
      resources: ["dict/*"],
      matches: ["<all_urls>"],
    },
  ],
};

export default manifest;
