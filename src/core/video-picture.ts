// ---------------------------------------------------------------------------
// SubJap — Where the picture sits inside a video element
// ---------------------------------------------------------------------------

/**
 * Viewport rectangle of the visible picture inside a video element. Players
 * often size the element to the window and let `object-fit` letterbox the
 * picture, so the element's own rectangle would include the black bars.
 */
export function videoPictureRect(video: HTMLVideoElement): DOMRect {
  const rect = video.getBoundingClientRect();
  const { videoWidth, videoHeight } = video;
  const fit = getComputedStyle(video).objectFit;
  if (!videoWidth || !videoHeight || rect.width <= 0 || rect.height <= 0) return rect;
  if (fit === "fill" || fit === "cover") return rect;

  const containScale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const scale = fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, containScale) : containScale;
  const width = Math.min(rect.width, videoWidth * scale);
  const height = Math.min(rect.height, videoHeight * scale);
  return new DOMRect(
    rect.left + (rect.width - width) / 2,
    rect.top + (rect.height - height) / 2,
    width,
    height,
  );
}
