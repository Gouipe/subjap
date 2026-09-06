const surfaces = new Set<HTMLElement>();
let listening = false;

/** Stay above the player normally, and inside the browser's fullscreen layer. */
export function mountVideoSurface(element: HTMLElement): void {
  const parent = document.fullscreenElement instanceof HTMLElement &&
    !(document.fullscreenElement instanceof HTMLVideoElement)
    ? document.fullscreenElement : document.body;
  if (element.parentElement !== parent) parent.appendChild(element);
  surfaces.add(element);
  if (listening) return;
  listening = true;
  document.addEventListener("fullscreenchange", () => {
    for (const surface of surfaces) {
      if (surface.isConnected) mountVideoSurface(surface);
      else surfaces.delete(surface);
    }
  });
}

export function forgetVideoSurface(element: HTMLElement): void {
  surfaces.delete(element);
}
