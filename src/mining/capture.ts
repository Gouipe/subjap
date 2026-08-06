// ---------------------------------------------------------------------------
// SubJap — video frame capture via <canvas>
// ---------------------------------------------------------------------------

/**
 * Capture a frame from a video element and return it as a JPEG data URL.
 *
 * If `time` is provided the video is temporarily seeked to that timestamp,
 * the frame is drawn, and playback position is restored.
 *
 * @param video  The source HTMLVideoElement
 * @param time   Optional seek timestamp in seconds
 * @returns      A JPEG data URL (base64-encoded, quality 0.8)
 */
export function captureFrame(
  video: HTMLVideoElement,
  time?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get 2d context from canvas"));
      return;
    }

    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };

    if (time !== undefined && Math.abs(video.currentTime - time) > 0.25) {
      const prevTime = video.currentTime;
      const wasPaused = video.paused;

      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        draw();
        // Restore previous position
        if (Math.abs(video.currentTime - prevTime) > 0.25) {
          video.currentTime = prevTime;
        }
        if (wasPaused) video.pause();
      };

      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    } else {
      draw();
    }
  });
}
