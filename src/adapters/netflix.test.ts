import { afterEach, describe, expect, it, vi } from "vitest";
import { NetflixAdapter } from "@/adapters/netflix";
import type { SubtitleCue } from "@/core/types";

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

    expect(received.at(-1)).toEqual({ start: 19.85, end: 19.85 });

    unsubscribe();
    adapter.destroy();
  });

  it("remplace le timestamp DOM tardif par celui de la piste japonaise", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 110.8;
    addLine(
      timedtext,
      "廊下を走らないって言ってるでしょう",
      null,
      null,
    );
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    await flushCueDebounce();
    const domCue = received.at(-1)?.[0];
    expect(domCue?.start).toBeCloseTo(110.65, 5);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "subjap",
          type: "subjap:netflix-timed-text",
          payload: {
            url: "https://cdn.example/timedtext/ja.vtt",
            language: "ja",
            body:
              "WEBVTT\n\n00:01:45.000 --> 00:01:51.000\n" +
              "廊下を走らないって言ってるでしょう",
          },
        },
      }),
    );

    expect(received.at(-1)?.[0]).toBe(domCue);
    expect(domCue).toMatchObject({
      start: 105,
      end: 111,
      endConfirmed: true,
    });

    unsubscribe();
    adapter.destroy();
  });

  it("regroupe les lignes simultanées en un seul cue", async () => {
    const { timedtext } = installNetflixPlayer();
    addLine(timedtext, "Première ligne", "4", "7");
    addLine(timedtext, "Deuxième ligne", "4.2", "7.5");
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];

    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));
    await flushCueDebounce();

    expect(received.at(-1)).toHaveLength(1);
    expect(received.at(-1)?.[0]).toMatchObject({
      text: "Première ligne\nDeuxième ligne",
      start: 4,
      end: 7.5,
      endConfirmed: true,
    });

    unsubscribe();
    adapter.destroy();
  });

  it("conserve une phrase longue quand Netflix fait défiler ses deux lignes", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 40;
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    addLine(timedtext, "生徒が起こした騒動については", null, null);
    await flushCueDebounce();
    const phrase = received.at(-1)?.[0];

    video.currentTime = 42;
    timedtext.replaceChildren();
    addLine(timedtext, "生徒が起こした騒動については", null, null);
    addLine(timedtext, "不問ということにいたしましょう", null, null);
    await flushCueDebounce();

    video.currentTime = 44;
    timedtext.replaceChildren();
    addLine(timedtext, "不問ということにいたしましょう", null, null);
    await flushCueDebounce();

    expect(received.at(-1)?.[0]).toBe(phrase);
    expect(phrase).toMatchObject({
      start: 39.85,
      endConfirmed: false,
      text: "生徒が起こした騒動については\n不問ということにいたしましょう",
    });

    video.currentTime = 46;
    timedtext.replaceChildren();
    await flushCueDebounce();
    expect(phrase).toMatchObject({ end: 46, endConfirmed: true });

    unsubscribe();
    adapter.destroy();
  });

  it("finalise un cue sans timestamps lors de sa disparition réelle", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 30;
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];

    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));
    addLine(timedtext, "Une phrase longue", null, null);
    await flushCueDebounce();

    const activeCue = received.at(-1)?.[0];
    expect(activeCue).toMatchObject({
      start: 29.85,
      end: 29.85,
      endConfirmed: false,
    });

    video.currentTime = 36.4;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(activeCue).toMatchObject({ end: 36.4, endConfirmed: true });
    expect(received.at(-1)).toEqual([]);

    unsubscribe();
    adapter.destroy();
  });

  it("distingue deux occurrences éloignées qui ont le même texte", async () => {
    const { video, timedtext } = installNetflixPlayer();
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    video.currentTime = 10;
    addLine(timedtext, "はい", null, null);
    await flushCueDebounce();
    const first = received.at(-1)?.[0];

    video.currentTime = 12;
    timedtext.replaceChildren();
    await flushCueDebounce();
    video.currentTime = 20;
    addLine(timedtext, "はい", null, null);
    await flushCueDebounce();
    const second = received.at(-1)?.[0];

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(second?.id).not.toBe(first?.id);

    unsubscribe();
    adapter.destroy();
  });

  it("ne prend pas la disparition transitoire d'un seek pour la fin du cue", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 10;
    const transport = { seek: vi.fn().mockResolvedValue(true) };
    const adapter = new NetflixAdapter(transport);
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    video.currentTime = 10;
    addLine(timedtext, "Phrase rejouée", null, null);
    await flushCueDebounce();
    const cue = received.at(-1)?.[0];

    await adapter.seekTo(9.85, true);
    video.currentTime = 9.85;
    timedtext.replaceChildren();
    await flushCueDebounce();
    expect(cue?.endConfirmed).toBe(false);

    video.currentTime = 10;
    addLine(timedtext, "Phrase rejouée", null, null);
    await flushCueDebounce();
    video.currentTime = 12;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(cue).toMatchObject({ end: 12, endConfirmed: true });

    unsubscribe();
    adapter.destroy();
  });

  it("ignore la phrase précédente brièvement affichée en rejouant le cue actif", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 10;
    const transport = { seek: vi.fn().mockResolvedValue(true) };
    const adapter = new NetflixAdapter(transport);
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    addLine(timedtext, "Phrase minée", null, null);
    await flushCueDebounce();
    const cue = received.at(-1)?.[0];
    expect(cue?.start).toBe(9.85);

    await adapter.seekTo(9.85, false);
    video.currentTime = 9.85;
    timedtext.replaceChildren();
    addLine(timedtext, "Phrase précédente", null, null);
    await flushCueDebounce();

    expect(received.at(-1)?.[0]).toBe(cue);
    expect(cue?.endConfirmed).toBe(false);

    video.currentTime = 10;
    timedtext.replaceChildren();
    addLine(timedtext, "Phrase minée", null, null);
    await flushCueDebounce();
    video.currentTime = 12;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(cue).toMatchObject({ end: 12, endConfirmed: true });

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

  it("combine la piste japonaise et la traduction française capturées", async () => {
    installNetflixPlayer();
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));
    const sendTimedText = (language: string, text: string) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            source: "subjap",
            type: "subjap:netflix-timed-text",
            payload: {
              url: `https://cdn.example/timedtext/${language}.vtt`,
              language,
              body: `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${text}`,
            },
          },
        }),
      );
    };

    sendTimedText("ja", "日本語の字幕");
    sendTimedText("fr", "Sous-titre français");
    sendTimedText("en", "English subtitle");
    await flushCueDebounce();

    expect(received.at(-1)).toEqual([
      expect.objectContaining({ language: "ja", text: "日本語の字幕" }),
      expect.objectContaining({ language: "fr", text: "Sous-titre français" }),
    ]);
    expect(received.at(-1)?.some((cue) => cue.language === "en")).toBe(false);

    unsubscribe();
    adapter.destroy();
  });

  it("télécharge les pistes annoncées par le bridge dans le content script", async () => {
    installNetflixPlayer();
    const sendMessageMock = vi.fn().mockResolvedValue({
      url: "https://cdn.nflxvideo.net/timedtext/fr.vtt",
      language: "fr-FR",
      body: "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nSous-titre français",
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage: sendMessageMock } });
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "subjap",
          type: "subjap:netflix-timed-text-url",
          payload: {
            url: "https://cdn.nflxvideo.net/timedtext/fr.vtt",
            language: "fr-FR",
          },
        },
      }),
    );
    await flushCueDebounce();

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: "netflix:timedTextFetch",
      url: "https://cdn.nflxvideo.net/timedtext/fr.vtt",
      language: "fr-FR",
    });
    expect(received.at(-1)).toEqual([
      expect.objectContaining({ language: "fr", text: "Sous-titre français" }),
    ]);

    unsubscribe();
    adapter.destroy();
    vi.unstubAllGlobals();
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
