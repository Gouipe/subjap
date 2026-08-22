import { afterEach, describe, expect, it, vi } from "vitest";
import { NetflixAdapter } from "@/adapters/netflix";

function installNetflixPlayer(): {
  video: HTMLVideoElement;
  timedtext: HTMLDivElement;
} {
  const player = document.createElement("div");
  player.className = "watch-video";

  const video = document.createElement("video");
  player.appendChild(video);

  const timedtext = document.createElement("div");
  timedtext.className = "player-timedtext";

  document.body.append(player, timedtext);
  return { video, timedtext };
}

function addLine(
  timedtext: HTMLElement,
  text: string,
  start: string | null = "12.5",
  end: string | null = "15.25",
): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  if (start !== null) line.dataset.start = start;
  if (end !== null) line.dataset.end = end;
  line.textContent = text;
  timedtext.appendChild(line);
  return line;
}

async function flushCueDebounce(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 70));
}

describe("NetflixAdapter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.className = "";
    vi.useRealTimers();
  });

  it("détecte Netflix avant que le player ne soit monté", () => {
    const adapter = new NetflixAdapter();

    expect(adapter.isActive(document, "https://www.netflix.com/watch/123"))
      .toBe(true);
  });

  it("lit les cues rendus dans le DOM Netflix et leurs timestamps", async () => {
    const { timedtext } = installNetflixPlayer();
    addLine(timedtext, "日本語を勉強しています。", "4", "7.5");
    const adapter = new NetflixAdapter();
    const received: Array<{ text: string; start: number; end: number }> = [];

    const unsubscribe = adapter.subscribeCues((cues) => {
      received.push(
        ...cues.map(({ text, start, end }) => ({ text, start, end })),
      );
    });

    await flushCueDebounce();

    expect(received.at(-1)).toEqual({
      text: "日本語を勉強しています。",
      start: 4,
      end: 7.5,
    });

    const line = timedtext.querySelector<HTMLElement>(
      ".player-timedtext-text-container",
    );
    if (!line) throw new Error("Netflix cue line was not found");
    line.textContent = "次の字幕です。";
    line.dataset.start = "8";
    line.dataset.end = "10";

    await flushCueDebounce();

    expect(received.at(-1)).toEqual({
      text: "次の字幕です。",
      start: 8,
      end: 10,
    });

    unsubscribe();
    adapter.destroy();
  });

  it("ancre un cue sans timestamps au changement DOM, avant le debounce", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 20;
    const adapter = new NetflixAdapter();
    const received: Array<{ start: number; end: number }> = [];

    const unsubscribe = adapter.subscribeCues((cues) => {
      received.push(...cues.map(({ start, end }) => ({ start, end })));
    });
    addLine(timedtext, "字幕 sans timestamps", null, null);

    // Playback keeps moving while DOM mutations are debounced. The cue must
    // retain the transition time (with a small preroll), not this later time.
    await Promise.resolve();
    video.currentTime = 20.5;
    await flushCueDebounce();

    expect(received.at(-1)).toEqual({ start: 19.85, end: 21.85 });

    unsubscribe();
    adapter.destroy();
  });

  it("masque les natifs avec une règle globale résistante aux styles inline", () => {
    installNetflixPlayer();
    const adapter = new NetflixAdapter();
    const timedtext = document.querySelector<HTMLElement>(".player-timedtext");
    if (!timedtext) throw new Error("Netflix timed-text container was not found");
    const child = document.createElement("span");
    child.style.visibility = "visible";
    timedtext.appendChild(child);

    adapter.setNativeSubtitlesVisible(false);

    expect(document.documentElement.classList.contains("subjap-hide-native-subs"))
      .toBe(true);
    expect(
      document.getElementById("subjap-netflix-hide-native-styles")?.textContent,
    ).toContain("visibility: hidden !important");

    adapter.setNativeSubtitlesVisible(true);
    expect(document.documentElement.classList.contains("subjap-hide-native-subs"))
      .toBe(false);
    adapter.destroy();
  });

  it("délègue le seek au transport sans écrire currentTime", async () => {
    const { video } = installNetflixPlayer();
    const currentTimeSetter = vi.spyOn(video, "currentTime", "set");
    const transport = { seek: vi.fn().mockResolvedValue(true) };
    const adapter = new NetflixAdapter(transport);

    await expect(adapter.seekTo(9.5, true)).resolves.toBe(true);

    expect(transport.seek).toHaveBeenCalledWith(9.5, true);
    expect(currentTimeSetter).not.toHaveBeenCalled();
    adapter.destroy();
  });
});
