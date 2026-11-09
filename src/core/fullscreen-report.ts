// ---------------------------------------------------------------------------
// SubJap — Tell the service worker about the page's HTML5 fullscreen
// ---------------------------------------------------------------------------

/**
 * Report this page entering and leaving fullscreen. Only the top frame needs
 * it: a frame's fullscreen also sets its ancestors' fullscreen element.
 *
 * The content script installs it on load. The service worker installs it again
 * through `chrome.scripting.executeScript` when a capture starts: after an
 * extension reload the content script of an already open page is dead, and the
 * popup can start a capture all the same. It must therefore stay
 * self-contained (no imports, no closures).
 */
export function installFullscreenReporter(): void {
  // One per page: a live content script shares this isolated world.
  const scope = globalThis as { subjapFullscreenReporter?: boolean };
  if (scope.subjapFullscreenReporter) return;
  scope.subjapFullscreenReporter = true;

  const report = (active: boolean): void => {
    try {
      void chrome.runtime.sendMessage({ type: "fullscreen:page", active }).catch(() => undefined);
    } catch {
      // The extension was reloaded since: its next capture installs a new reporter.
    }
  };
  document.addEventListener("fullscreenchange", () => {
    report(document.fullscreenElement !== null);
  });
  // Leaving the page drops its fullscreen without any fullscreenchange.
  window.addEventListener("pagehide", () => report(false));
}
