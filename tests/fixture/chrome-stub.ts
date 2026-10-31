// The fixture runs the real modules outside an extension. Provide the small
// part of the `chrome` API they touch: no local subtitles stored, and no
// service worker behind runtime messages (tests may replace `runtime`).
const fixtureWindow = window as unknown as { chrome?: unknown };

fixtureWindow.chrome ??= {
  runtime: {
    sendMessage: async () => undefined,
  },
  storage: {
    local: {
      get: async () => ({}),
    },
    onChanged: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  },
};

export {};
