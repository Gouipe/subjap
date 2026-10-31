import { NetflixAdapter } from "../../src/adapters/netflix";
import { OverlayRenderer } from "../../src/overlay/renderer";
import { getPopover, hidePopover, showPopover } from "../../src/overlay/popover";
import {
  CueNavigator,
  installPlaybackShortcuts,
  installSubtitleCopyShortcut,
  subtitleTextForClipboard,
} from "../../src/content/shortcuts";
import { MiningModal } from "../../src/mining/modal";
import { groupTokens } from "../../src/tokenizer/group";
import { createTokenizer } from "../../src/tokenizer";
import { mergeFrequencyRanks } from "../../src/dictionary/frequency";
import { markParentheticalTokens, normalizeCueText } from "../../src/subtitles";
import { tokenCanonicalKey, tokenLookupTerms } from "../../src/core/types";
import type {
  DictionaryEntry,
  RenderedCue,
  SubtitleCue,
  SubtitleTranslation,
  Token,
  Tokenizer,
  WordState,
} from "../../src/core/types";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const nativeSubtitles = document.querySelector<HTMLDivElement>("#timedtext")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const furiganaToggle = document.querySelector<HTMLInputElement>("#furigana")!;
const hideSecondaryWhenKnownToggle = document.querySelector<HTMLInputElement>(
  "#hide-secondary-when-known",
)!;

const fixtureSeekTransport = {
  seek: async (timeSeconds: number, resume: boolean): Promise<boolean> => {
    const video = document.querySelector<HTMLVideoElement>("#video");
    if (!video || !Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return false;
    }
    video.currentTime = timeSeconds;
    if (resume) await video.play();
    return true;
  },
};

const adapter = new NetflixAdapter(fixtureSeekTransport);
const cueNavigator = new CueNavigator();
let overlay: OverlayRenderer | null = null;
let currentVideo: HTMLVideoElement | null = null;
let currentCues: SubtitleCue[] = [];
let currentTranslation: SubtitleTranslation | null = null;
// One known word gives deterministic green/blue/orange frequency bands.
let knownLemmas = new Set<string>(["日本語"]);
let ignoredLemmas = new Set<string>();
let unknownLemmas = new Set<string>();
const frequencyRanks = new Map<string, number>(
  mergeFrequencyRanks(
    [
      { key: "日本語", rank: 1 },
      { key: "を", rank: 8 },
      { key: "勉強", rank: 12 },
      { key: "する", rank: 3 },
      { key: "し", rank: 3 },
      { key: "ます", rank: 500 },
      { key: "やばい", rank: 4 },
      { key: "発表", rank: 1 },
    ],
    [
      { key: "日本語", rank: 8 },
      { key: "を", rank: 2 },
      { key: "勉強", rank: 1 },
      { key: "する", rank: 20 },
      { key: "し", rank: 20 },
      { key: "ます", rank: 900 },
      { key: "やばい", rank: 10 },
      { key: "発表", rank: 1 },
    ],
  ).map(({ key, rank }) => [key, rank] as const),
);
const ankiNoteCounts = new Map<string, number>([["勉強", 2]]);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hovered: HTMLElement | null = null;
let miningModal: MiningModal | null = null;
let nextRenderDelayMs = 0;
let unidicTokenizer: Tokenizer | null = null;
let unidicTokenizerPromise: Promise<Tokenizer> | null = null;

function tokenLookupKeys(token: Token): string[] {
  return [...new Set([tokenCanonicalKey(token), ...tokenLookupTerms(token)])];
}

function tokenMatches(keys: Set<string>, token: Token): boolean {
  return tokenLookupKeys(token).some((key) => keys.has(key));
}

function tokenAnkiNoteCount(token: Token): number {
  return tokenLookupKeys(token).reduce(
    (count, key) => count + (ankiNoteCounts.get(key) ?? 0),
    0,
  );
}

const FIXTURE_STATUS_PRIORITY: Record<WordState["status"], number> = {
  unknown: 1,
  known: 2,
  learning: 3,
  ignored: 4,
};

function fixtureWordState(token: Token): WordState | null {
  const candidates: WordState[] = [];
  if (tokenMatches(ignoredLemmas, token)) {
    candidates.push({ key: token.lemma, status: "ignored", source: "manual" });
  }
  if (tokenMatches(knownLemmas, token)) {
    candidates.push({ key: token.lemma, status: "known", source: "manual" });
  }
  if (tokenMatches(unknownLemmas, token) || token.lemma === "を") {
    candidates.push({ key: token.lemma, status: "unknown", source: "import" });
  }
  if (token.lemma === "する") {
    candidates.push({ key: token.lemma, status: "learning", source: "import" });
  }
  return (
    candidates.sort(
      (left, right) =>
        FIXTURE_STATUS_PRIORITY[right.status] -
        FIXTURE_STATUS_PRIORITY[left.status],
    )[0] ?? null
  );
}

const dictionaryEntry: DictionaryEntry = {
  headword: "日本語",
  reading: "ニホンゴ",
  partOfSpeech: ["名詞"],
  senses: [{ glosses: ["Japanese language"] }],
  common: true,
};

const yabaiDictionaryEntry: DictionaryEntry = {
  headword: "やばい",
  reading: "やばい",
  aliases: ["ヤバい", "ヤバイ"],
  partOfSpeech: ["形容詞"],
  senses: [{ glosses: ["dangerous; risky; awful; amazing"] }],
  common: true,
};

const longDictionaryEntry: DictionaryEntry = {
  headword: "為る",
  reading: "する",
  partOfSpeech: ["動詞"],
  senses: [
    {
      glosses: [
        "to carry out",
        "to perform",
        "to cause to become",
        "to make (into)",
        "to turn (into)",
        "to serve as",
        "to act as",
        "to work as",
        "to wear (clothes, a facial expression, etc.)",
        "to judge as being",
        "to view as being",
        "to think of as",
        "to treat as",
        "to use as",
        "to decide on",
        "to choose",
        "to be sensed (of a smell, noise, etc.)",
        "to be (in a state, condition, etc.)",
        "to be worth",
        "to cost",
        "to pass (of time)",
        "to elapse",
        "to place, or raise, person A to a post or status B",
        "to transform A to B",
        "to make A into B",
        "to exchange A for B",
        "to make use of A for B",
        "to view A as B",
        "to handle A as if it were B",
        "to feel A about B",
        "verbalizing suffix",
        "creates a humble verb",
        "to be just about to",
        "to be just starting to",
        "to try to",
        "to attempt to",
      ],
    },
  ],
  common: true,
};

const suruDictionaryEntry: DictionaryEntry = {
  headword: "する",
  reading: "する",
  partOfSpeech: ["動詞"],
  senses: [{ glosses: ["to do"] }],
  common: true,
};

const dictionaryEntries = new Map(
  [
    dictionaryEntry,
    yabaiDictionaryEntry,
    longDictionaryEntry,
    suruDictionaryEntry,
  ].map((entry) => [
    entry.headword,
    entry,
  ]),
);

const tokens: Token[] = [
  { surface: "日本語", lemma: "日本語", reading: "ニホンゴ", partOfSpeech: ["名詞"] },
  { surface: "を", lemma: "を", reading: "を", partOfSpeech: ["助詞"] },
  { surface: "勉強", lemma: "勉強", reading: "ベンキョウ", partOfSpeech: ["名詞"] },
  { surface: "し", lemma: "する", reading: "し", partOfSpeech: ["動詞"] },
  { surface: "ます", lemma: "ます", reading: "ます", partOfSpeech: ["助動詞"] },
  { surface: "。", lemma: "。", reading: "。", partOfSpeech: ["記号"] },
];
const candidateTokens = tokens.slice(0, 2);
const greenWhiteTokens: Token[] = [
  tokens[0]!,
  { surface: "発表", lemma: "発表", reading: "ハッピョウ", partOfSpeech: ["名詞"] },
];
const whitespaceCandidateTokens: Token[] = [
  { surface: "発表", lemma: "発表", reading: "ハッピョウ", partOfSpeech: ["名詞"] },
  { surface: " ", lemma: " ", reading: " ", partOfSpeech: ["記号"] },
];
const parentheticalTokens: Token[] = [
  { surface: "-（", lemma: "-（", reading: "-（", partOfSpeech: ["記号"] },
  { surface: "田中", lemma: "田中", reading: "タナカ", partOfSpeech: ["名詞"] },
  { surface: "）", lemma: "）", reading: "）", partOfSpeech: ["記号"] },
  ...tokens,
];
const longDefinitionTokens: Token[] = [
  { surface: "する", lemma: "為る", reading: "する", partOfSpeech: ["動詞"] },
];
let activeTokens: Token[] = [];

const groupedTokens = groupTokens([
  { surface: "じゃ", lemma: "だ", reading: "じゃ", partOfSpeech: ["助動詞"] },
  { surface: "なくっ", lemma: "ない", reading: "なくっ", partOfSpeech: ["形容詞"] },
  { surface: "て", lemma: "て", reading: "て", partOfSpeech: ["助詞"] },
]);

const explanatoryTokens = groupTokens([
  { surface: "孫", lemma: "孫", reading: "まご", partOfSpeech: ["名詞"] },
  { surface: "な", lemma: "だ", reading: "な", partOfSpeech: ["助動詞"] },
  { surface: "ん", lemma: "ん", reading: "ん", partOfSpeech: ["名詞"] },
  { surface: "です", lemma: "です", reading: "です", partOfSpeech: ["助動詞"] },
]);

const politeVerbTokens = groupTokens([
  { surface: "感動", lemma: "感動", reading: "かんどう", partOfSpeech: ["名詞"] },
  {
    surface: "し",
    lemma: "する",
    reading: "し",
    partOfSpeech: ["動詞"],
    partOfSpeechDetails: ["自立"],
  },
  {
    surface: "まし",
    lemma: "ます",
    reading: "まし",
    partOfSpeech: ["助動詞"],
    conjugationType: "特殊・マス",
  },
  {
    surface: "た",
    lemma: "た",
    reading: "た",
    partOfSpeech: ["助動詞"],
    conjugationType: "特殊・タ",
  },
]);

const passiveVerbTokens = groupTokens([
  {
    surface: "取材",
    lemma: "取材",
    reading: "しゅざい",
    partOfSpeech: ["名詞"],
    partOfSpeechDetails: ["サ変接続"],
  },
  {
    surface: "さ",
    lemma: "する",
    reading: "さ",
    partOfSpeech: ["動詞"],
    partOfSpeechDetails: ["自立"],
  },
  {
    surface: "れ",
    lemma: "れる",
    reading: "れ",
    partOfSpeech: ["動詞"],
    partOfSpeechDetails: ["接尾"],
    conjugationType: "一段",
  },
  {
    surface: "た",
    lemma: "た",
    reading: "た",
    partOfSpeech: ["助動詞"],
    conjugationType: "特殊・タ",
  },
]);

const mixedAdjectiveTokens: Token[] = [
  {
    surface: "ヤバくない",
    dictionaryForm: "やばい",
    canonicalKey: "やばい",
    lookupTerms: ["やばい", "ヤバくない"],
    lemma: "やばい",
    reading: "やばくない",
    partOfSpeech: ["形容詞"],
  },
];
const furiganaRuleTokens: Token[] = [
  { surface: "言っ", lemma: "言う", reading: "いっ", partOfSpeech: ["動詞"] },
  { surface: "てんだ", lemma: "てる", reading: "てるのだ", partOfSpeech: ["助動詞"] },
];

function installSimulatedMediaClock(video: HTMLVideoElement): void {
  let currentTime = 0;
  let paused = true;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    },
    paused: { configurable: true, get: () => paused },
  });
  video.play = () => {
    paused = false;
    return Promise.resolve();
  };
  video.pause = () => {
    paused = true;
  };
}

function setStatus(message: string): void {
  status.textContent = message;
}

function nativeLine(
  text: string,
  start: string | null = "12",
  end: string | null = "16",
): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  if (start !== null) line.dataset.start = start;
  if (end !== null) line.dataset.end = end;
  line.textContent = text;
  return line;
}

function renderedCue(cue: SubtitleCue): RenderedCue {
  const parentheticalFlags = markParentheticalTokens(activeTokens);
  return {
    cue,
    spans: activeTokens.map((token, index) => ({
      index,
      token,
      isParenthetical: parentheticalFlags[index],
      wordState: fixtureWordState(token),
      ankiNoteCount: tokenAnkiNoteCount(token),
      frequencyRank: frequencyRanks.get(token.lemma),
    })),
  };
}

function ensureOverlay(): OverlayRenderer | null {
  const video = adapter.getVideoElement();
  if (!video) return null;

  if (overlay && currentVideo !== video) {
    overlay.destroy();
    overlay = null;
  }
  if (!overlay) {
    overlay = new OverlayRenderer(video, {
      showFurigana: furiganaToggle.checked,
      knownSentenceSubtitles: hideSecondaryWhenKnownToggle.checked ? "hide-translation" : "show",
    });
    currentVideo = video;
  }
  return overlay;
}

function render(cues: SubtitleCue[]): void {
  cueNavigator.remember(adapter.getNavigationCues());
  currentCues = cues;
  const japaneseCues = cues.filter((cue) => /^ja(?:[-_]|$)/i.test(cue.language ?? ""));
  status.dataset.cue = japaneseCues[0]?.text ?? "";
  status.dataset.cueStart = String(japaneseCues[0]?.start ?? "");
  status.dataset.knownCount = String(knownLemmas.size);
  const renderer = ensureOverlay();
  if (!renderer) {
    setStatus("Aucune vidéo détectée");
    return;
  }
  if (japaneseCues.length === 0) {
    renderer.updateCues([]);
    renderer.updateTranslation(null);
    renderer.hide();
    hidePopover();
    cueNavigator.observe([]);
    setStatus("Cues reçus : 0 — overlay masqué");
    return;
  }
  renderer.setKnownWordCount(knownLemmas.size);
  renderer.updateCues(japaneseCues.map(renderedCue));
  renderer.updateTranslation(
    currentTranslation
      ? { ...currentTranslation, text: normalizeCueText(currentTranslation.text) }
      : null,
  );
  renderer.show();
  cueNavigator.observe(japaneseCues);
  setStatus(`Cues reçus : ${japaneseCues.length} — overlay visible`);
}

async function renderUniDic(sentence: string, scenario: string): Promise<void> {
  try {
    unidicTokenizerPromise ??= createTokenizer();
    unidicTokenizer = await unidicTokenizerPromise;
    activeTokens = groupTokens(unidicTokenizer.tokenize(sentence));
    const cue: SubtitleCue = {
      id: `unidic-${scenario}`,
      start: 12,
      end: 16,
      text: sentence,
      language: "ja",
    };
    nativeSubtitles.replaceChildren(nativeLine(sentence));
    render([cue]);
    status.dataset.scenario = scenario;
  } catch (error) {
    setStatus(`UniDic indisponible : ${error instanceof Error ? error.message : String(error)}`);
  }
}

const popoverCallbacks = {
  onToggleKnown: (lemma: string) => {
    ignoredLemmas.delete(lemma);
    if (knownLemmas.has(lemma)) knownLemmas.delete(lemma);
    else knownLemmas.add(lemma);
    render(currentCues);
    setStatus(`État modifié : ${lemma}`);
  },
  onToggleIgnored: (lemma: string, currentStatus: string | null) => {
    if (currentStatus === "ignored") {
      ignoredLemmas.delete(lemma);
    } else {
      knownLemmas.delete(lemma);
      ignoredLemmas.add(lemma);
    }
    render(currentCues);
    setStatus(`État modifié : ${lemma}`);
  },
  onMine: (minedToken: Token) => {
    const popover = document.querySelector<HTMLElement>("#subjap-popover");
    status.dataset.minePopoverHidden = String(
      !popover || getComputedStyle(popover).display === "none",
    );
    setStatus(`Mining demandé : ${minedToken.surface}`);
  },
};

function showPopoverForToken(anchor: HTMLElement, token: Token): void {
  const entry = dictionaryEntries.get(token.lemma) ?? null;
  const currentStatus = fixtureWordState(token)?.status ?? null;
  const frequencyRank = frequencyRanks.get(token.lemma);
  showPopover({
    anchor,
    token,
    entry,
    wordStatus: currentStatus,
    frequencyRank,
    ankiNoteCount: tokenAnkiNoteCount(token),
  });
}

function clearTimers(): void {
  if (hoverTimer !== null) clearTimeout(hoverTimer);
  if (hideTimer !== null) clearTimeout(hideTimer);
  hoverTimer = null;
  hideTimer = null;
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const span = target.closest<HTMLElement>(".subjap-token");
  if (!span) return;
  if (span.dataset.parenthetical === "true") return;
  const token = activeTokens[Number(span.dataset.index)];
  if (token) {
    clearTimers();
    showPopoverForToken(span, token);
  }
}, true);

document.addEventListener("mouseover", (event) => {
  const target = event.target as HTMLElement;
  const span = target.closest<HTMLElement>(".subjap-token");
  if (!span) return;
  if (span.dataset.parenthetical === "true") return;
  clearTimers();
  hovered = span;
  const token = activeTokens[Number(span.dataset.index)];
  if (!token) return;
  hoverTimer = setTimeout(() => {
    if (hovered === span) showPopoverForToken(span, token);
  }, 350);
}, true);

document.addEventListener("mouseout", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest(".subjap-token")) return;
  const related = event.relatedTarget as Node | null;
  if (related instanceof Element && related.closest(".subjap-token, #subjap-popover")) return;
  if (hoverTimer !== null) clearTimeout(hoverTimer);
  hideTimer = setTimeout(() => hidePopover(), 200);
}, true);

document.querySelector<HTMLButtonElement>("#next")!.addEventListener("click", () => {
  activeTokens = tokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。"));
});

document.querySelector<HTMLButtonElement>("#candidate")!.addEventListener("click", () => {
  activeTokens = candidateTokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("日本語を", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#green-white")!.addEventListener("click", () => {
  activeTokens = greenWhiteTokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("日本語発表", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#whitespace-candidate")!.addEventListener("click", () => {
  activeTokens = whitespaceCandidateTokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("発表 ", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#parenthetical")!.addEventListener("click", () => {
  activeTokens = parentheticalTokens;
  currentTranslation = null;
  nativeSubtitles.replaceChildren(nativeLine("-（田中）日本語を勉強します。"));
});

document.querySelector<HTMLButtonElement>("#bilingual")!.addEventListener("click", () => {
  activeTokens = tokens;
  currentTranslation = { language: "fr", text: "J’étudie le japonais." };
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#encoded-translation")!.addEventListener("click", () => {
  activeTokens = tokens;
  currentTranslation = {
    language: "fr",
    text: "&quot;Good luck,&quot; or something like that.",
  };
  nativeSubtitles.replaceChildren(nativeLine("日本語を勉強します。", "12", "16"));
});

document.querySelector<HTMLButtonElement>("#bilingual-known")!.addEventListener("click", () => {
  knownLemmas = new Set(["日本語", "勉強", "する", "ます"]);
  ignoredLemmas = new Set(["を"]);
  unknownLemmas = new Set();
  activeTokens = parentheticalTokens;
  currentTranslation = { language: "fr", text: "J’étudie le japonais." };
  nativeSubtitles.replaceChildren(
    nativeLine("-（田中）日本語を勉強します。", "12", "16"),
  );
});

document.querySelector<HTMLButtonElement>("#untimed")!.addEventListener("click", () => {
  activeTokens = tokens;
  nativeSubtitles.replaceChildren(
    nativeLine("日本語を勉強します。", null, null),
  );
});

document.querySelector<HTMLButtonElement>("#multiline")!.addEventListener("click", () => {
  activeTokens = tokens;
  nativeSubtitles.replaceChildren(
    nativeLine("日本語を", "20", "24"),
    nativeLine("勉強します。", "20", "24"),
  );
});

document.querySelector<HTMLButtonElement>("#rolling")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;
  video.currentTime = 40;
  nativeSubtitles.replaceChildren(
    nativeLine("生徒が起こした騒動については", null, null),
  );
  setTimeout(() => {
    video.currentTime = 42;
    nativeSubtitles.replaceChildren(
      nativeLine("生徒が起こした騒動については", null, null),
      nativeLine("不問ということにいたしましょう", null, null),
    );
  }, 100);
  setTimeout(() => {
    video.currentTime = 44;
    nativeSubtitles.replaceChildren(
      nativeLine("不問ということにいたしましょう", null, null),
    );
  }, 200);
});

document.querySelector<HTMLButtonElement>("#seek-rebuild")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  // Netflix can briefly remove and recreate one logical cue around a seek.
  // The two DOM builds differ only by presentation whitespace.
  video.currentTime = 50;
  nativeSubtitles.replaceChildren(nativeLine("本当の前の字幕", "50", "52"));
  setTimeout(() => {
    video.currentTime = 59.55;
    nativeSubtitles.replaceChildren(
      nativeLine("（篠原 ）でも すごいですね", null, null),
    );
  }, 100);
  setTimeout(() => {
    video.currentTime = 59.7;
    nativeSubtitles.replaceChildren();
  }, 200);
  setTimeout(() => {
    video.currentTime = 59.85;
    nativeSubtitles.replaceChildren(
      nativeLine("（篠原）でも すごいですね", null, null),
    );
  }, 300);
  setTimeout(() => {
    video.currentTime = 60.5;
    nativeSubtitles.replaceChildren();
  }, 400);
  setTimeout(() => {
    video.currentTime = 61;
    nativeSubtitles.replaceChildren(nativeLine("教育シンポジウムです", "61", "64"));
  }, 500);
});

document.querySelector<HTMLButtonElement>("#seek-overlap")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  video.currentTime = 109;
  nativeSubtitles.replaceChildren(
    nativeLine("廊下を走らないって言ってるでしょう", "105", "110.778"),
  );
  setTimeout(() => {
    video.currentTime = 111;
    nativeSubtitles.replaceChildren(
      nativeLine("困るんですよ 生徒に示しがつかないから", "110.778", "114"),
    );
  }, 100);
  setTimeout(() => {
    // A seek can flash the preceding cue again near its old end. Netflix does
    // not attach timings to this rebuilt DOM node, so the fallback start is
    // several seconds later than the real start at 105 seconds.
    video.currentTime = 110.639;
    nativeSubtitles.replaceChildren(
      nativeLine("廊下を走らないって言ってるでしょう", null, null),
    );
  }, 200);
  setTimeout(() => {
    video.currentTime = 111;
    nativeSubtitles.replaceChildren(
      nativeLine("困るんですよ生徒に示しがつかないから", "110.778", "114"),
    );
  }, 300);
  setTimeout(() => {
    status.dataset.scenario = "seek-overlap-complete";
  }, 400);
});

document.querySelector<HTMLButtonElement>("#authoritative-timing")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  // The content script attaches in the middle of this cue and initially has
  // only the late DOM observation time available.
  video.currentTime = 110.8;
  nativeSubtitles.replaceChildren(
    nativeLine("廊下を走らないって言ってるでしょう", null, null),
  );
  setTimeout(() => {
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
              "廊下を走らないって言ってるでしょう\n\n" +
              "00:01:51.000 --> 00:01:54.000\n" +
              "困るんですよ生徒に示しがつかないから",
          },
        },
      }),
    );
  }, 100);
  setTimeout(() => {
    video.currentTime = 111.2;
    nativeSubtitles.replaceChildren(
      nativeLine("困るんですよ生徒に示しがつかないから", "111", "114"),
    );
  }, 200);
  setTimeout(() => {
    status.dataset.scenario = "authoritative-timing-complete";
  }, 300);
});

document.querySelector<HTMLButtonElement>("#official-history")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  // Simulate a freshly reloaded content script: only the current DOM cue was
  // observed, but Netflix's official track already contains its predecessor.
  video.currentTime = 111.2;
  nativeSubtitles.replaceChildren(
    nativeLine("困るんですよ生徒に示しがつかないから", null, null),
  );
  setTimeout(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "subjap",
          type: "subjap:netflix-timed-text",
          payload: {
            url: "https://cdn.example/timedtext/ja-history.vtt",
            language: "ja",
            body:
              "WEBVTT\n\n00:01:45.000 --> 00:01:50.778\n" +
              "廊下を走らないって言ってるでしょう\n\n" +
              "00:01:50.778 --> 00:01:54.000\n" +
              "困るんですよ生徒に示しがつかないから",
          },
        },
      }),
    );
  }, 100);
  setTimeout(() => {
    status.dataset.scenario = "official-history-complete";
  }, 200);
});

document.querySelector<HTMLButtonElement>("#stale-dom-track")!.addEventListener("click", () => {
  activeTokens = tokens;
  const video = document.querySelector<HTMLVideoElement>("#video")!;

  // Netflix may keep the current DOM cue visible just after the authoritative
  // track says that occurrence has ended. The DOM cue has only a fallback
  // start, slightly later than the official start.
  video.currentTime = 111.064;
  nativeSubtitles.replaceChildren(
    nativeLine("困るんですよ生徒に示しがつかないから", null, null),
  );
  setTimeout(() => {
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
  }, 100);
  setTimeout(() => {
    status.dataset.scenario = "stale-dom-track-complete";
  }, 200);
});

document.querySelector<HTMLButtonElement>("#delayed")!.addEventListener("click", () => {
  activeTokens = tokens;
  nextRenderDelayMs = 400;
  nativeSubtitles.replaceChildren(
    nativeLine("遅れて表示される字幕", "20", "24"),
  );
});

document.querySelector<HTMLButtonElement>("#grouped")!.addEventListener("click", () => {
  activeTokens = groupedTokens;
  nativeSubtitles.replaceChildren(nativeLine("じゃなくって", "16", "20"));
});

document.querySelector<HTMLButtonElement>("#unidic")!.addEventListener("click", () => {
  void renderUniDic("こいつらみたいな生徒たちを見捨てないでください", "unidic-plurals");
});

document.querySelector<HTMLButtonElement>("#unidic-variants")!.addEventListener("click", () => {
  void renderUniDic("どいつらとコイツらしい彼ら生徒達", "unidic-variants");
});

function renderRubyCue(): void {
  activeTokens = [
    { surface: "親父", lemma: "親父", reading: "おやじ", partOfSpeech: ["名詞"] },
    { surface: "も", lemma: "も", reading: "も", partOfSpeech: ["助詞"] },
    { surface: "おふくろ", lemma: "御袋", reading: "おふくろ", partOfSpeech: ["名詞"] },
    { surface: "も", lemma: "も", reading: "も", partOfSpeech: ["助詞"] },
    { surface: "超", lemma: "超", reading: "ちょう", partOfSpeech: ["接頭辞"] },
    { surface: "喜ん", lemma: "喜ぶ", reading: "よろこん", partOfSpeech: ["動詞"] },
    { surface: "じゃっ", lemma: "ちゃう", reading: "じゃっ", partOfSpeech: ["助動詞"] },
    { surface: "て", lemma: "て", reading: "て", partOfSpeech: ["助詞"] },
  ];
  const line = document.createElement("div");
  line.className = "player-timedtext-text-container";
  line.dataset.start = "12";
  line.dataset.end = "16";
  const ruby = document.createElement("ruby");
  const base = document.createElement("span");
  base.lang = "ja";
  base.textContent = "親父";
  const rt = document.createElement("rt");
  const annotation = document.createElement("span");
  annotation.textContent = "おやじ";
  rt.appendChild(annotation);
  ruby.append(base, rt);
  line.append(ruby, "もおふくろも超喜んじゃって");
  nativeSubtitles.replaceChildren(line);
  render([{ id: "ruby", start: 12, end: 16, text: "親父もおふくろも超喜んじゃって", language: "ja" }]);
  status.dataset.scenario = "ruby-native-annotation";
}

document.querySelector<HTMLButtonElement>("#mixed-adjective")!.addEventListener("click", () => {
  activeTokens = mixedAdjectiveTokens;
  nativeSubtitles.replaceChildren(nativeLine("ヤバくない", "16", "20"));
});

document.querySelector<HTMLButtonElement>("#furigana-rule")!.addEventListener("click", () => {
  activeTokens = furiganaRuleTokens;
  nativeSubtitles.replaceChildren(nativeLine("言ってんだ", "16", "20"));
});

document.querySelector<HTMLButtonElement>("#explanatory")!.addEventListener("click", () => {
  activeTokens = explanatoryTokens;
  nativeSubtitles.replaceChildren(nativeLine("孫なんです", "20", "24"));
});

document.querySelector<HTMLButtonElement>("#long-definition")!.addEventListener("click", () => {
  activeTokens = longDefinitionTokens;
  nativeSubtitles.replaceChildren(nativeLine("する", "20", "24"));
});

document.querySelector<HTMLButtonElement>("#polite-verb")!.addEventListener("click", () => {
  activeTokens = politeVerbTokens;
  nativeSubtitles.replaceChildren(nativeLine("感動しました", "20", "24"));
});

document.querySelector<HTMLButtonElement>("#passive-verb")!.addEventListener("click", () => {
  activeTokens = passiveVerbTokens;
  nativeSubtitles.replaceChildren(nativeLine("取材された", "20", "24"));
});

document.querySelector<HTMLButtonElement>("#mine")!.addEventListener("click", () => {
  const video = adapter.getVideoElement();
  const cue = currentCues[0];
  if (!video || !cue || activeTokens.length === 0) return;

  const rendered = renderedCue(cue);
  miningModal?.destroy();
  miningModal = new MiningModal(video);
  miningModal.open({
    cue: rendered,
    targetToken: rendered.spans[0],
    lemmaReading: rendered.spans[0].token.reading,
    translation: currentTranslation?.text,
    episodeContext: {
      platform: "fixture",
      title: "Fixture episode",
      language: "ja",
      url: window.location.href,
    },
    definitions: ["fixture definition"],
  });
});

document.querySelector<HTMLButtonElement>("#clear")!.addEventListener("click", () => {
  currentTranslation = null;
  nativeSubtitles.replaceChildren();
});

document.querySelector<HTMLButtonElement>("#toggle-native")!.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const hidden = button.dataset.hidden !== "true";
  adapter.setNativeSubtitlesVisible(!hidden);
  button.dataset.hidden = String(hidden);
  button.textContent = hidden ? "Afficher les natifs" : "Masquer les natifs";
  setStatus(`Sous-titres natifs : ${hidden ? "masqués" : "visibles"}`);
});

document.querySelector<HTMLButtonElement>("#swap")!.addEventListener("click", () => {
  const oldVideo = document.querySelector("#video");
  oldVideo?.remove();
  cueNavigator.reset();
  const nextVideo = document.createElement("video");
  nextVideo.id = "video";
  nextVideo.setAttribute("aria-label", "Vidéo simulée remplacée");
  installSimulatedMediaClock(nextVideo);
  stage.insertBefore(nextVideo, nativeSubtitles);
  nativeSubtitles.replaceChildren(nativeLine("Lecteur remplacé, nouvelle phrase."));
  setStatus("Navigation SPA simulée : nouveau lecteur détecté");
});

furiganaToggle.addEventListener("change", () => {
  overlay?.setOptions({ showFurigana: furiganaToggle.checked });
});

hideSecondaryWhenKnownToggle.addEventListener("change", () => {
  overlay?.setOptions({
    knownSentenceSubtitles: hideSecondaryWhenKnownToggle.checked ? "hide-translation" : "show",
  });
});

getPopover(popoverCallbacks);
const removePlaybackShortcuts = installPlaybackShortcuts(document, adapter, cueNavigator);
const removeSubtitleCopyShortcut = installSubtitleCopyShortcut(document, {
  getText: () =>
    subtitleTextForClipboard(
      currentCues.filter((cue) => /^ja(?:[-_]|$)/i.test(cue.language ?? "")),
    ),
});
installSimulatedMediaClock(document.querySelector<HTMLVideoElement>("#video")!);

adapter.subscribeCues((cues) => {
  const delay = cues.length > 0 ? nextRenderDelayMs : 0;
  nextRenderDelayMs = 0;
  if (delay > 0) {
    setTimeout(() => render(cues), delay);
    return;
  }
  render(cues);
});
adapter.setNativeSubtitlesVisible(false);
nativeSubtitles.replaceChildren(nativeLine("待ってください。", "0", "4"));

const fixtureScenario = new URLSearchParams(window.location.search).get("scenario");
if (fixtureScenario === "lexical-alias") {
  // Simulate an Anki KNOWN note storing UniDic's displayed spelling while the
  // tokenizer exposes the canonical lexeme 色んな.
  knownLemmas.add("いろんな");
  unknownLemmas.add("色んな");
  void renderUniDic("いろんなことがあった", "unidic-lexical-alias");
} else if (fixtureScenario === "ruby-native-annotation") {
  renderRubyCue();
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  removePlaybackShortcuts();
  removeSubtitleCopyShortcut();
  overlay?.destroy();
  miningModal?.destroy();
  adapter.destroy();
});
