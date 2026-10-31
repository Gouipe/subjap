import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function addRubyLine(
  timedtext: HTMLElement,
  text: string,
  reading: string,
): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  line.dataset.start = "12.5";
  line.dataset.end = "15.25";

  const ruby = document.createElement("ruby");
  const base = document.createElement("span");
  base.lang = "ja";
  base.textContent = text;
  const rt = document.createElement("rt");
  const annotation = document.createElement("span");
  annotation.textContent = reading;
  rt.appendChild(annotation);
  ruby.append(base, rt);
  line.append(ruby, "もおふくろも超喜んじゃって");
  timedtext.appendChild(line);
  return line;
}

function stubChrome(sendMessage = vi.fn().mockResolvedValue(undefined)): void {
  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

function historyCue(adapter: NetflixAdapter, id: string | undefined): SubtitleCue | undefined {
  return adapter.getNavigationCues().find((cue) => cue.id === id);
}

async function flushCueDebounce(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 70));
}

describe("NetflixAdapter", () => {
  beforeEach(() => stubChrome());

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("ignore les cues textTracks composées uniquement d’espaces", () => {
    const { video } = installNetflixPlayer();
    const blankCue = {
      id: "blank",
      startTime: 4,
      endTime: 5,
      text: " \u00a0 ",
    };
    const meaningfulCue = {
      id: "meaningful",
      startTime: 5,
      endTime: 7,
      text: "日本語です。",
    };
    const track = {
      language: "ja",
      mode: "showing",
      cues: [blankCue, meaningfulCue],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as TextTrack;
    Object.defineProperty(video, "textTracks", {
      configurable: true,
      value: [track],
    });

    video.currentTime = 4.5;
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    video.dispatchEvent(new Event("cuechange"));
    expect(received.at(-1)).toEqual([]);

    video.currentTime = 6;
    video.dispatchEvent(new Event("cuechange"));

    expect(received.at(-1)).toEqual([
      expect.objectContaining({ text: "日本語です。", start: 5, end: 7 }),
    ]);

    unsubscribe();
    adapter.destroy();
  });

  it("ignore les annotations ruby Netflix dans le texte de la cue", async () => {
    const { timedtext } = installNetflixPlayer();
    addRubyLine(timedtext, "親父", "おやじ");
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];

    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));
    await flushCueDebounce();

    expect(received.at(-1)?.[0]).toMatchObject({
      text: "親父もおふくろも超喜んじゃって",
      start: 12.5,
      end: 15.25,
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
    // retain the transition time, not this later time.
    await Promise.resolve();
    video.currentTime = 20.5;
    await flushCueDebounce();

    expect(received.at(-1)).toEqual({ start: 20, end: 20 });

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
    expect(domCue?.start).toBeCloseTo(110.8, 5);

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

    await flushCueDebounce();

    // The official segment becomes the active source; the snapshot already
    // handed out (possibly frozen in mining) is left untouched.
    expect(received.at(-1)?.[0]).toMatchObject({
      text: "廊下を走らないって言ってるでしょう",
      start: 105,
      end: 111,
      endConfirmed: true,
      source: expect.objectContaining({ kind: "track" }),
    });
    expect(domCue).toMatchObject({ start: 110.8, endConfirmed: false });

    unsubscribe();
    adapter.destroy();
  });

  it("n'affiche plus une cue DOM encore visible après la fin officielle", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 110.9;
    addLine(timedtext, "困るんですよ生徒に示しがつかないから", null, null);
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    await flushCueDebounce();
    const domCue = received.at(-1)?.[0];
    expect(domCue?.start).toBeCloseTo(110.9, 5);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "subjap",
          type: "subjap:netflix-timed-text",
          payload: {
            url: "https://cdn.example/timedtext/stale-dom.vtt",
            language: "ja",
            body:
              "WEBVTT\n\n00:01:45.000 --> 00:01:50.778\n" +
              "廊下を走らないって言ってるでしょう\n\n" +
              "00:01:50.778 --> 00:01:51.000\n" +
              "困るんですよ生徒に示しがつかないから",
          },
        },
      }),
    );

    await flushCueDebounce();
    expect(received.at(-1)?.[0]).toMatchObject({ start: 110.778, end: 111 });

    // The official track is authoritative: past its end, the stale DOM text
    // is a silence, and navigation uses the official segment bounds.
    video.currentTime = 111.064;
    video.dispatchEvent(new Event("timeupdate"));
    await flushCueDebounce();
    expect(received.at(-1)).toEqual([]);
    expect(adapter.getNavigationCues().at(-1)).toMatchObject({
      text: "困るんですよ生徒に示しがつかないから",
      start: 110.778,
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

  it("distingue chaque état DOM quand Netflix fait défiler ses deux lignes", async () => {
    const { video, timedtext } = installNetflixPlayer();
    video.currentTime = 40;
    const adapter = new NetflixAdapter();
    const received: SubtitleCue[][] = [];
    const unsubscribe = adapter.subscribeCues((cues) => received.push(cues));

    addLine(timedtext, "生徒が起こした騒動については", null, null);
    await flushCueDebounce();

    video.currentTime = 42;
    timedtext.replaceChildren();
    addLine(timedtext, "生徒が起こした騒動については", null, null);
    addLine(timedtext, "不問ということにいたしましょう", null, null);
    await flushCueDebounce();

    video.currentTime = 44;
    timedtext.replaceChildren();
    addLine(timedtext, "不問ということにいたしましょう", null, null);
    await flushCueDebounce();

    video.currentTime = 46;
    timedtext.replaceChildren();
    await flushCueDebounce();

    // A → A+B → B stays three observations, never a permanent A+B.
    expect(adapter.getNavigationCues().map(({ text, start, end, endConfirmed }) =>
      ({ text, start, end, endConfirmed }))).toEqual([
      { text: "生徒が起こした騒動については", start: 40, end: 42, endConfirmed: true },
      {
        text: "生徒が起こした騒動については\n不問ということにいたしましょう",
        start: 42, end: 44, endConfirmed: true,
      },
      { text: "不問ということにいたしましょう", start: 44, end: 46, endConfirmed: true },
    ]);

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
      start: 30,
      end: 30,
      endConfirmed: false,
    });

    video.currentTime = 36.4;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(historyCue(adapter, activeCue?.id)).toMatchObject({ end: 36.4, endConfirmed: true });
    expect(activeCue).toMatchObject({ end: 30, endConfirmed: false });
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

    // Replay from later in the subtitle, as the Q/S shortcuts do.
    video.currentTime = 11;
    await adapter.seekTo(10, true);
    video.currentTime = 10;
    timedtext.replaceChildren();
    await flushCueDebounce();
    expect(historyCue(adapter, cue?.id)?.endConfirmed).toBe(false);

    video.currentTime = 10;
    addLine(timedtext, "Phrase rejouée", null, null);
    await flushCueDebounce();
    video.currentTime = 12;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(historyCue(adapter, cue?.id)).toMatchObject({ end: 12, endConfirmed: true });

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
    expect(cue?.start).toBe(10);

    // Replay from later in the subtitle, as the Q/S shortcuts do.
    video.currentTime = 11;
    await adapter.seekTo(10, false);
    video.currentTime = 10;
    timedtext.replaceChildren();
    addLine(timedtext, "Phrase précédente", null, null);
    await flushCueDebounce();

    // The remembered start is a seek target: nothing is published until
    // Netflix shows its text again.
    expect(received.at(-1)).toEqual([]);
    expect(historyCue(adapter, cue?.id)?.endConfirmed).toBe(false);

    video.currentTime = 10;
    timedtext.replaceChildren();
    addLine(timedtext, "Phrase minée", null, null);
    await flushCueDebounce();
    video.currentTime = 12;
    timedtext.replaceChildren();
    await flushCueDebounce();

    expect(historyCue(adapter, cue?.id)).toMatchObject({ end: 12, endConfirmed: true });

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
    const { timedtext } = installNetflixPlayer();
    // Without the player's track identity, the visible text elects the
    // Japanese file.
    addLine(timedtext, "日本語の字幕", null, null);
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
    stubChrome(sendMessageMock);
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
