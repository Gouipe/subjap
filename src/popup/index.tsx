// ---------------------------------------------------------------------------
// SubJap — Popup entry point (React)
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/theme.css";
import { sendMessage } from "@/core/messaging";
import {
  getOptions,
  saveOptions,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
} from "@/core/options";
import { isSubJapEnabled, setSubJapEnabled } from "@/core/enabled";
import type {
  KnownSentenceSubtitles,
  OverlayOptions,
  SecondarySubtitleLanguage,
} from "@/core/types";
import { isOnboardingComplete } from "@/onboarding";
import {
  getJapaneseOffset,
  getLinkedOffsets,
  getTranslationOffset,
  isTranslationOffsetAutomatic,
  isTranslationOffsetOriginChange,
  markTranslationOffsetSetByUser,
  saveJapaneseOffset,
  saveLinkedOffsets,
  saveTranslationOffset,
  translationOffsetStorageKey,
} from "@/subtitles/video-offset";
import {
  getLocalSubtitle,
  localSubtitleVideoId,
  parseSubtitleFile,
  removeLocalSubtitle,
  saveLocalSubtitle,
  type LocalSubtitleRecord,
  type LocalSubtitleRole,
} from "@/subtitles";
import { getJimakuApiKey, undeclineJimaku, type JimakuChoice } from "@/subtitles/jimaku";
import {
  KNOWN_SENTENCE_CHOICES,
  PAUSE_AFTER_HIDDEN_SENTENCE_LABEL,
  SECONDARY_LANGUAGE_CHOICES,
} from "@/ui/labels";

interface Stats {
  knownWords: number;
  totalCards: number;
  cardsDue: number;
}

interface DictStatus {
  count: number;
  installed: boolean;
}

type DisplayOptions = Pick<OverlayOptions, "subtitleScale" | "showFurigana">;

const SUBTITLE_SCALE_STEP = 10;
/** Below this many known words, the popup points to the known-word triage. */
const KNOWN_WORDS_LINK_THRESHOLD = 100;

const LOCAL_SUBTITLE_ROLES: LocalSubtitleRole[] = ["primary", "secondary"];
/** The offset menu reopens as the user last left it. */
const OFFSET_MENU_OPEN_KEY = "subjap_popup_offset_open";
const EMPTY_LOCAL_SUBTITLES: Record<LocalSubtitleRole, LocalSubtitleRecord | null> = {
  primary: null,
  secondary: null,
};
const WORD_COLOR_GUIDE = [
  {
    word: "大切",
    color: "#78d6a3",
    underline: "2px solid #78d6a3",
    label: "À miner, très fréquent",
  },
  {
    word: "便利",
    color: "#55b8ff",
    underline: "2px solid #55b8ff",
    label: "À miner, fréquent",
  },
  {
    word: "難しい",
    color: "#9ca1aa",
    underline: "2px solid transparent",
    label: "Inconnu",
  },
  {
    word: "覚える",
    color: "#f4f1ea",
    underline: "3px dotted rgba(255, 255, 255, 0.9)",
    label: "En cours : carte Anki étudiée, pas encore mûre",
  },
  {
    word: "知る",
    color: "#f4f1ea",
    underline: "2px solid transparent",
    label: "Connu ou ignoré",
  },
] as const;

const SHORTCUT_GUIDE = [
  { key: "Q", action: "Revenir au sous-titre précédent" },
  { key: "S", action: "Rejouer le sous-titre courant" },
  { key: "D", action: "Aller au sous-titre suivant" },
  { key: "C", action: "Copier le japonais affiché" },
  { key: "X", action: "Révéler le sous-titre masqué" },
] as const;

/** Offset of one subtitle track on one line: typed value, ±0.1 s steps and reset. */
function OffsetRow(props: {
  label: string;
  input: string;
  value: number;
  disabled: boolean;
  onInput: (value: string) => void;
  onCommit: (seconds: number) => void;
  /** Back to 0 for this track only, even when the offsets are linked. */
  onReset: () => void;
}): JSX.Element {
  return (
    <div style={styles.offsetRow}>
      <span style={styles.offsetRowLabel}>{props.label}</span>
      <input
        style={styles.offsetInput}
        type="text"
        inputMode="decimal"
        aria-label={`Décalage ${props.label.toLowerCase()} (s)`}
        value={props.input.replace(".", ",")}
        disabled={props.disabled}
        onChange={(event) => props.onInput(event.target.value)}
        onBlur={() => props.onCommit(Number(props.input.replace(",", ".")))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <button style={styles.smallButton} disabled={props.disabled} onClick={() => props.onCommit(props.value - 0.1)}>
        −0,1
      </button>
      <button style={styles.smallButton} disabled={props.disabled} onClick={() => props.onCommit(props.value + 0.1)}>
        +0,1
      </button>
      <button
        style={styles.smallButton}
        disabled={props.disabled}
        title="Réinitialiser"
        aria-label={`Réinitialiser le décalage ${props.label.toLowerCase()}`}
        onClick={props.onReset}
      >
        <span style={styles.resetGlyph}>↺</span>
      </button>
    </div>
  );
}

const Popup: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dict, setDict] = useState<DictStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<"idle" | "activating" | "active">("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [secondarySubtitleLanguage, setSecondarySubtitleLanguage] =
    useState<SecondarySubtitleLanguage>("fr");
  const [knownSentenceSubtitles, setKnownSentenceSubtitles] =
    useState<KnownSentenceSubtitles>("show");
  const [pauseAfterHiddenSentence, setPauseAfterHiddenSentence] = useState(false);
  const [savingSubtitlePreference, setSavingSubtitlePreference] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [display, setDisplay] = useState<DisplayOptions | null>(null);
  const [localSubtitles, setLocalSubtitles] = useState(EMPTY_LOCAL_SUBTITLES);
  const [offsetInputs, setOffsetInputs] = useState<Record<LocalSubtitleRole, string>>({
    primary: "0.00",
    secondary: "0.00",
  });
  const [localSubtitleBusy, setLocalSubtitleBusy] = useState(false);
  const [localSubtitleError, setLocalSubtitleError] = useState<string | null>(null);
  /** Offsets of the tracks the player provides, when no file replaces them. */
  const [playerOffsets, setPlayerOffsets] = useState<Record<LocalSubtitleRole, number>>({
    primary: 0,
    secondary: 0,
  });
  /** Changing one track's offset changes the other by as much. */
  const [linkedOffsets, setLinkedOffsets] = useState(false);
  /** The player's translation offset was set by the automatic alignment. */
  const [translationOffsetAutomatic, setTranslationOffsetAutomatic] = useState(false);
  /** Player of the video under the popup when it has no Japanese subtitles. */
  const [missingJapanese, setMissingJapanese] = useState<{ tabId: number; player: string } | null>(null);
  const [hasJimakuKey, setHasJimakuKey] = useState(false);
  const [tabId, setTabId] = useState<number | null>(null);
  /** The other Jimaku files of the episode are listed under the Japanese track. */
  const [jimakuListOpen, setJimakuListOpen] = useState(false);
  /** Words set aside with « Plus tard », cards not created yet. */
  const [pendingMineCount, setPendingMineCount] = useState(0);
  const [pendingMineError, setPendingMineError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [statsResult, dictResult, onboardedResult, optionsResult, pendingMines] = await Promise.all([
      sendMessage("stats:get", {}),
      sendMessage("dict:status", {}),
      isOnboardingComplete(),
      getOptions(),
      sendMessage("mineLater:list", {}),
    ]);
    setStats(statsResult);
    setPendingMineCount(pendingMines.ids.length);
    setDict(dictResult);
    setOnboarded(onboardedResult);
    setKnownSentenceSubtitles(optionsResult.knownSentenceSubtitles);
    setPauseAfterHiddenSentence(optionsResult.pauseAfterHiddenSentence);
    setSecondarySubtitleLanguage(optionsResult.secondarySubtitleLanguage);
    setDisplay({
      subtitleScale: optionsResult.subtitleScale,
      showFurigana: optionsResult.showFurigana,
    });
    setConnected(true);
    setError(null);
  }, []);

  useEffect(() => {
    void isSubJapEnabled().then(setEnabled, () => setEnabled(true));
  }, []);

  useEffect(() => {
    void chrome.storage.local.get(OFFSET_MENU_OPEN_KEY).then((stored) => {
      if (stored[OFFSET_MENU_OPEN_KEY] === true) setOffsetOpen(true);
    }, () => {
      // Unknown state: the menu stays folded.
    });
  }, []);

  // The translation's offset can be set automatically while the popup is open.
  useEffect(() => {
    if (!videoId) return;
    const key = translationOffsetStorageKey(videoId);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (isTranslationOffsetOriginChange(changes, videoId)) {
        void isTranslationOffsetAutomatic(videoId).then(setTranslationOffsetAutomatic, () => undefined);
      }
      if (!changes[key]) return;
      const value = changes[key].newValue as unknown;
      const seconds = typeof value === "number" && Number.isFinite(value) ? value : 0;
      setPlayerOffsets((current) => ({ ...current, secondary: seconds }));
      if (!localSubtitles.secondary) {
        setOffsetInputs((current) => ({ ...current, secondary: seconds.toFixed(2) }));
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [localSubtitles.secondary, videoId]);

  const toggleOffsetMenu = useCallback((open: boolean) => {
    setOffsetOpen(open);
    void chrome.storage.local.set({ [OFFSET_MENU_OPEN_KEY]: open }).catch(() => {
      // Not remembered: the menu still opens and closes.
    });
  }, []);

  const toggleEnabled = useCallback(async (next: boolean) => {
    setEnabled(next);
    setSavingEnabled(true);
    setError(null);
    try {
      await setSubJapEnabled(next);
    } catch (err: unknown) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEnabled(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null || !tab.url) return;
      let hasVisibleVideo = false;
      try {
        const [videoProbe] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => Array.from(document.querySelectorAll("video")).some((video) => {
            const rect = video.getBoundingClientRect();
            const style = getComputedStyle(video);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }),
        });
        hasVisibleVideo = videoProbe?.result === true;
      } catch {
        // Browser-restricted pages do not expose their DOM to extensions.
      }
      if (!hasVisibleVideo) {
        // Players are often embedded in a frame. Injecting into every frame
        // fails as a whole on one inaccessible frame, so ask SubJap instead:
        // only a frame showing a video answers. Imports stay keyed on the tab URL.
        try {
          const answer: unknown = await chrome.tabs.sendMessage(tab.id, { type: "video:probe" });
          hasVisibleVideo = (answer as { hasVideo?: unknown } | undefined)?.hasVideo === true;
        } catch {
          // No frame answered: there is no visible video.
        }
      }
      const currentVideoId = hasVisibleVideo ? localSubtitleVideoId(tab.url) : null;
      setHasVideo(hasVisibleVideo);
      setVideoId(currentVideoId);
      setTabId(tab.id);
      if (!currentVideoId) return;
      void getJimakuApiKey().then((key) => setHasJimakuKey(!!key), () => undefined);
      // Only the frame playing a video without Japanese subtitles answers.
      void chrome.tabs.sendMessage(tab.id, { type: "subtitles:status" }).then((answer: unknown) => {
        const status = answer as { missing?: unknown; player?: unknown } | undefined;
        if (status?.missing === true && typeof status.player === "string" && tab.id != null) {
          setMissingJapanese({ tabId: tab.id, player: status.player });
        }
      }, () => {
        // No frame answered: Japanese subtitles are available or still unknown.
      });
      const [primary, secondary, japaneseOffset, translationOffset, linked, automatic] = await Promise.all([
        getLocalSubtitle(currentVideoId, "primary"),
        getLocalSubtitle(currentVideoId, "secondary"),
        getJapaneseOffset(currentVideoId),
        getTranslationOffset(currentVideoId),
        getLinkedOffsets(),
        isTranslationOffsetAutomatic(currentVideoId),
      ]);
      setTranslationOffsetAutomatic(automatic);
      setLocalSubtitles({ primary, secondary });
      setPlayerOffsets({ primary: japaneseOffset, secondary: translationOffset });
      setLinkedOffsets(linked);
      setOffsetInputs({
        primary: (primary?.offsetSeconds ?? japaneseOffset).toFixed(2),
        secondary: (secondary?.offsetSeconds ?? translationOffset).toFixed(2),
      });
    })().catch((err: unknown) => {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const importLocalSubtitle = useCallback(
    async (role: LocalSubtitleRole, file: File | undefined) => {
      if (!file || !videoId) return;
      setLocalSubtitleBusy(true);
      setLocalSubtitleError(null);
      try {
        const content = await file.text();
        if (parseSubtitleFile(file.name, content).length === 0) {
          throw new Error("Fichier SRT, VTT ou ASS invalide ou vide.");
        }
        const record: LocalSubtitleRecord = {
          fileName: file.name,
          content,
          offsetSeconds: 0,
          updatedAt: Date.now(),
        };
        await saveLocalSubtitle(videoId, record, role);
        if (role === "primary") setMissingJapanese(null);
        setLocalSubtitles((current) => ({ ...current, [role]: record }));
        setOffsetInputs((current) => ({ ...current, [role]: "0.00" }));
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [videoId],
  );

  /** Offset in force for a track: its file's, otherwise the player track's. */
  const trackOffset = useCallback(
    (role: LocalSubtitleRole) => localSubtitles[role]?.offsetSeconds ?? playerOffsets[role],
    [localSubtitles, playerOffsets],
  );

  const persistOffset = useCallback(
    async (role: LocalSubtitleRole, seconds: number) => {
      if (!videoId) return;
      const localSubtitle = localSubtitles[role];
      setOffsetInputs((current) => ({ ...current, [role]: seconds.toFixed(2) }));
      if (localSubtitle) {
        // An offset the user set is never replaced by the automatic alignment.
        const next = { ...localSubtitle, offsetSeconds: seconds, syncChecked: true };
        setLocalSubtitles((current) => ({ ...current, [role]: next }));
        await saveLocalSubtitle(videoId, next, role);
      } else {
        setPlayerOffsets((current) => ({ ...current, [role]: seconds }));
        await (role === "primary" ? saveJapaneseOffset : saveTranslationOffset)(videoId, seconds);
      }
    },
    [localSubtitles, videoId],
  );

  const showTranslationOffset = !!localSubtitles.secondary || secondarySubtitleLanguage !== "none";

  /** What the folded « Pistes et décalage » row hides, when it departs from the player. */
  const trackSummary = [
    localSubtitles.primary ? "Fichier japonais" : null,
    trackOffset("primary") !== 0 || (showTranslationOffset && trackOffset("secondary") !== 0)
      ? "Décalé"
      : null,
  ].filter(Boolean).join(", ");

  /** Sets one track's offset; linked, the other moves by as much unless `alone`. */
  const changeOffset = useCallback(
    async (role: LocalSubtitleRole, value: number, alone = false) => {
      if (!Number.isFinite(value)) {
        setOffsetInputs((current) => ({ ...current, [role]: trackOffset(role).toFixed(2) }));
        return;
      }
      const rounded = Math.round(value * 100) / 100;
      const delta = rounded - trackOffset(role);
      const other: LocalSubtitleRole = role === "primary" ? "secondary" : "primary";
      setLocalSubtitleBusy(true);
      setLocalSubtitleError(null);
      try {
        // The user's own translation offset is never replaced automatically.
        if (role === "secondary" && videoId) await markTranslationOffsetSetByUser(videoId);
        await Promise.all([
          persistOffset(role, rounded),
          linkedOffsets && !alone && showTranslationOffset && delta !== 0
            ? persistOffset(other, Math.round((trackOffset(other) + delta) * 100) / 100)
            : Promise.resolve(),
        ]);
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [linkedOffsets, persistOffset, showTranslationOffset, trackOffset, videoId],
  );

  const chooseLinkedOffsets = useCallback(async (linked: boolean) => {
    setLinkedOffsets(linked);
    try {
      await saveLinkedOffsets(linked);
    } catch (err: unknown) {
      setLinkedOffsets(!linked);
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Back to the file's own timing; the user's offset stays. */
  const removeAutoSync = useCallback(async (role: LocalSubtitleRole) => {
    const localSubtitle = localSubtitles[role];
    if (!videoId || !localSubtitle) return;
    const next = { ...localSubtitle, syncSegments: undefined, syncChecked: true };
    setLocalSubtitles((current) => ({ ...current, [role]: next }));
    setLocalSubtitleError(null);
    try {
      await saveLocalSubtitle(videoId, next, role);
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    }
  }, [localSubtitles, videoId]);

  const deleteLocalSubtitle = useCallback(async (role: LocalSubtitleRole) => {
    if (!videoId) return;
    setLocalSubtitleBusy(true);
    setLocalSubtitleError(null);
    try {
      await removeLocalSubtitle(videoId, role);
      setLocalSubtitles((current) => ({ ...current, [role]: null }));
      setOffsetInputs((current) => ({ ...current, [role]: playerOffsets[role].toFixed(2) }));
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalSubtitleBusy(false);
    }
  }, [playerOffsets, videoId]);

  /** Installs another Jimaku file of the episode in place of the Japanese track. */
  const chooseJimakuVersion = useCallback(async (choice: JimakuChoice) => {
    if (!videoId) return;
    setLocalSubtitleBusy(true);
    setLocalSubtitleError(null);
    try {
      const result = await sendMessage("jimaku:install", { videoId, choice, tabId: tabId ?? undefined });
      if (result.status !== "installed") {
        throw new Error(
          result.status === "error" ? result.message
            : result.status === "no-key" ? "Clé Jimaku absente des options."
            : result.status === "bad-key" ? "Clé Jimaku refusée."
            : "Fichier introuvable sur Jimaku.",
        );
      }
      const primary = await getLocalSubtitle(videoId, "primary");
      setLocalSubtitles((current) => ({ ...current, primary }));
      setOffsetInputs((current) => ({
        ...current,
        primary: (primary?.offsetSeconds ?? playerOffsets.primary).toFixed(2),
      }));
      setJimakuListOpen(false);
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalSubtitleBusy(false);
    }
  }, [playerOffsets, tabId, videoId]);

  /** Installs the episode's file as if automatically, even after the user removed one. */
  const installJimaku = useCallback(async () => {
    if (!videoId || !missingJapanese) return;
    setLocalSubtitleBusy(true);
    setLocalSubtitleError(null);
    try {
      await undeclineJimaku(videoId);
      const result = await sendMessage("jimaku:install", { videoId, tabId: missingJapanese.tabId });
      if (result.status !== "installed") {
        throw new Error(
          result.status === "error" ? result.message
            : result.status === "no-key" ? "Clé Jimaku absente des options."
            : result.status === "bad-key" ? "Clé Jimaku refusée."
            : "Introuvable sur Jimaku pour cet épisode.",
        );
      }
      const primary = await getLocalSubtitle(videoId, "primary");
      setLocalSubtitles((current) => ({ ...current, primary }));
      setOffsetInputs((current) => ({ ...current, primary: (primary?.offsetSeconds ?? 0).toFixed(2) }));
      setMissingJapanese(null);
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalSubtitleBusy(false);
    }
  }, [missingJapanese, videoId]);

  const searchJimaku = useCallback(async () => {
    if (!missingJapanese) return;
    try {
      await sendMessage("jimaku:search", { tabId: missingJapanese.tabId });
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    }
  }, [missingJapanese]);

  /** Display changes apply live to the video under the popup. */
  const updateDisplay = useCallback(
    async (next: Partial<DisplayOptions>) => {
      if (!display) return;
      const previous = display;
      setDisplay({ ...display, ...next });
      setError(null);
      try {
        await saveOptions(next);
      } catch (err: unknown) {
        setDisplay(previous);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [display],
  );

  const chooseKnownSentenceSubtitles = useCallback(
    async (mode: KnownSentenceSubtitles) => {
      const previous = knownSentenceSubtitles;
      setKnownSentenceSubtitles(mode);
      setSavingSubtitlePreference(true);
      setError(null);
      try {
        await saveOptions({ knownSentenceSubtitles: mode });
      } catch (err: unknown) {
        setKnownSentenceSubtitles(previous);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingSubtitlePreference(false);
      }
    },
    [knownSentenceSubtitles],
  );

  const choosePauseAfterHiddenSentence = useCallback(
    async (next: boolean) => {
      setPauseAfterHiddenSentence(next);
      setSavingSubtitlePreference(true);
      setError(null);
      try {
        await saveOptions({ pauseAfterHiddenSentence: next });
      } catch (err: unknown) {
        setPauseAfterHiddenSentence(!next);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingSubtitlePreference(false);
      }
    },
    [],
  );

  const chooseSecondarySubtitleLanguage = useCallback(
    async (language: SecondarySubtitleLanguage) => {
      const previous = secondarySubtitleLanguage;
      setSecondarySubtitleLanguage(language);
      setSavingSubtitlePreference(true);
      setError(null);
      try {
        await saveOptions({ secondarySubtitleLanguage: language });
      } catch (err: unknown) {
        setSecondarySubtitleLanguage(previous);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingSubtitlePreference(false);
      }
    },
    [secondarySubtitleLanguage],
  );

  const activateCapture = useCallback(async () => {
    setCaptureStatus("activating");
    setCaptureError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) throw new Error("Aucun onglet actif");
      const getStreamId = (): Promise<string> =>
        new Promise<string>((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: tab.id },
            (id) => {
              const runtimeError = chrome.runtime.lastError;
              if (runtimeError) {
                reject(new Error(runtimeError.message));
                return;
              }
              resolve(id);
            },
          );
        });

      // A tab can only have one active capture stream. Keep it in the
      // offscreen document for both playback and phrase recording.
      const offscreenStreamId = await getStreamId();
      await sendMessage("tabCapture:offscreen", { streamId: offscreenStreamId });
      // Same badge as the service worker: the words set aside, else "ON".
      const { ids } = await sendMessage("mineLater:list", {});
      await chrome.action.setBadgeText({ tabId: tab.id, text: ids.length > 0 ? String(ids.length) : "ON" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#78d6a3" });
      setCaptureStatus("active");
    } catch (err: unknown) {
      setCaptureStatus("idle");
      setCaptureError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reviewPendingMines = useCallback(async () => {
    setPendingMineError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) throw new Error("Aucun onglet actif");
      // Only the frame playing the SubJap video answers.
      const answer: unknown = await chrome.tabs.sendMessage(tab.id, { type: "mineLater:review" });
      if ((answer as { started?: unknown } | undefined)?.started === true) {
        window.close();
        return;
      }
    } catch {
      // No frame answered: no SubJap video in this tab.
    }
    setPendingMineError("Lancez la vidéo avec ses sous-titres SubJap, puis réessayez.");
  }, []);

  const installDictionary = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const result = await sendMessage("dict:download", {});
      if (!result || typeof result.count !== "number") {
        throw new Error("Réponse invalide du service worker");
      }
      await refresh();
      setDict((prev) =>
        prev ? { count: result.count, installed: true } : prev,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [refresh]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.brandLockup}>
          <span style={styles.brandMark} aria-hidden="true">字</span>
          <h1 style={styles.title}>SubJap</h1>
        </div>
        <div style={styles.headerEnd}>
          {/* Only a problem is worth a status: a ready extension stays quiet. */}
          {connected === false && (
            <span style={styles.connectionStatus}>
              <span style={styles.offlineDot} aria-hidden="true" />
              Hors ligne
            </span>
          )}
          {enabled !== null && (
            <Switch
              checked={enabled}
              disabled={savingEnabled}
              label={enabled ? "Activé" : "Désactivé"}
              ariaLabel="Activer SubJap"
              onChange={(next) => void toggleEnabled(next)}
            />
          )}
        </div>
      </header>

      {enabled === false && (
        <p style={styles.disabledNote}>
          SubJap est en pause : sous-titres natifs, aucun raccourci, sur tous les sites.
        </p>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {enabled !== false && (<>
      {!onboarded ? (
        <div style={styles.setupBox}>
          <p style={styles.setupText}>
            Configuration non terminée : le dictionnaire est nécessaire aux définitions.
          </p>
          <button style={styles.primaryButton} onClick={() => void chrome.runtime.openOptionsPage()}>
            Terminer la configuration
          </button>
        </div>
      ) : dict !== null && !dict.installed && (
        <div style={styles.setupBox}>
          <p style={styles.setupText}>Sans dictionnaire, les mots n’ont pas de définition.</p>
          <button
            style={styles.primaryButton}
            onClick={() => void installDictionary()}
            disabled={downloading}
          >
            {downloading ? "Téléchargement…" : "Installer le dictionnaire (~22k mots)"}
          </button>
        </div>
      )}

      {/* The learning gesture of the session leads; the audio capture it needs follows. */}
      {pendingMineCount > 0 && (
        <div style={styles.sessionBlock}>
          {hasVideo ? (
            <button style={styles.primaryButton} onClick={() => void reviewPendingMines()}>
              Créer {pendingMineCount > 1 ? `les ${pendingMineCount} cartes mises de côté` : "la carte mise de côté"}
            </button>
          ) : (
            <p style={styles.pendingHint}>
              {pendingMineCount} mot{pendingMineCount > 1 ? "s" : ""} mis de côté : ouvrez une vidéo
              pour créer {pendingMineCount > 1 ? "leurs cartes" : "sa carte"}.
            </p>
          )}
          {pendingMineError && <p style={styles.inlineError}>{pendingMineError}</p>}
        </div>
      )}

      {hasVideo && (
        <div style={styles.audioRow}>
          <div style={styles.audioText}>
            <span style={styles.audioLabel}>Audio de l’onglet</span>
            <span style={styles.audioHint}>
              {captureStatus === "active"
                ? "Les phrases minées sont enregistrées."
                : "Nécessaire pour enregistrer la phrase d’un mot miné."}
            </span>
          </div>
          {captureStatus === "active" ? (
            <span style={styles.audioActive}>✓ Actif</span>
          ) : (
            <button
              style={styles.secondaryButton}
              onClick={() => void activateCapture()}
              disabled={captureStatus !== "idle"}
            >
              {captureStatus === "activating" ? "Activation…" : "Activer"}
            </button>
          )}
        </div>
      )}
      {captureError && <p style={styles.inlineError}>{captureError}</p>}

      <h2 style={styles.groupLabel}>Sous-titres</h2>
      <div style={styles.card}>
        {missingJapanese && videoId && (
          <div style={styles.missingJapanese}>
            <p style={styles.missingJapaneseText}>Pas de sous-titres japonais pour cette vidéo.</p>
            <div style={styles.missingJapaneseActions}>
              {missingJapanese.player === "artplayer" && hasJimakuKey && (
                <button
                  style={styles.compactPrimary}
                  disabled={localSubtitleBusy}
                  onClick={() => void installJimaku()}
                >
                  Installer depuis Jimaku
                </button>
              )}
              {missingJapanese.player === "artplayer" && (
                <button
                  style={hasJimakuKey ? styles.compactButton : styles.compactPrimary}
                  onClick={() => void searchJimaku()}
                >
                  Chercher sur Jimaku
                </button>
              )}
              <label style={styles.compactButton}>
                {localSubtitleBusy ? "Chargement…" : "Importer un fichier"}
                <input
                  type="file"
                  accept=".srt,.vtt,.webvtt,.ass,.ssa"
                  hidden
                  disabled={localSubtitleBusy}
                  onChange={(event) => {
                    void importLocalSubtitle("primary", event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        )}
        <label style={{
          ...styles.cardRow,
          ...(missingJapanese && videoId ? styles.cardRowDivided : {}),
        }}>
          <span>Traduction</span>
          <select
            style={styles.select}
            value={secondarySubtitleLanguage}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void chooseSecondarySubtitleLanguage(
                event.target.value as SecondarySubtitleLanguage,
              )
            }
          >
            {SECONDARY_LANGUAGE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </label>
        <label style={{ ...styles.cardRow, ...styles.cardRowDivided }}>
          <span>Phrases connues</span>
          <select
            style={styles.select}
            value={knownSentenceSubtitles}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void chooseKnownSentenceSubtitles(
                event.target.value as KnownSentenceSubtitles,
              )
            }
          >
            {KNOWN_SENTENCE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </label>
        {knownSentenceSubtitles !== "show" && (
          <div
            style={{ ...styles.cardRow, ...styles.cardRowDivided }}
            title="À la fin d’une phrase masquée : X révèle, S rejoue. Les phrases de deux mots ou moins ne s’arrêtent pas."
          >
            <span>{PAUSE_AFTER_HIDDEN_SENTENCE_LABEL}</span>
            <Switch
              checked={pauseAfterHiddenSentence}
              disabled={savingSubtitlePreference}
              ariaLabel={PAUSE_AFTER_HIDDEN_SENTENCE_LABEL}
              onChange={(next) => void choosePauseAfterHiddenSentence(next)}
            />
          </div>
        )}
        {videoId && (
          <details open={offsetOpen} onToggle={(event) => toggleOffsetMenu(event.currentTarget.open)}>
            <summary style={{ ...styles.cardRow, ...styles.cardRowDivided, ...styles.cardSummary }}>
              <span>Pistes et décalage</span>
              <span style={styles.summaryEnd}>
                {!offsetOpen && trackSummary && <span style={styles.summaryValue}>{trackSummary}</span>}
                <span
                  aria-hidden="true"
                  style={{
                    ...styles.chevron,
                    transform: offsetOpen ? "rotate(90deg)" : "none",
                  }}
                >
                  ›
                </span>
              </span>
            </summary>
            <div style={styles.disclosureContent}>
              {LOCAL_SUBTITLE_ROLES.map((role) => {
                const localSubtitle = localSubtitles[role];
                const playerTrack = role === "primary"
                  ? "Piste du lecteur"
                  : secondarySubtitleLanguage === "none" ? "Aucune" : "Traduction du lecteur";
                return (
                  <div key={role} style={styles.trackRow}>
                    <span
                      style={styles.trackLabel}
                      title={role === "primary"
                        ? "Traitée comme du japonais ; sur Netflix et YouTube, elle remplace la piste japonaise native."
                        : "Affichée avec le japonais ; sur Netflix et YouTube, elle remplace la traduction native."}
                    >
                      {role === "primary" ? "Japonais" : "Traduction"}
                    </span>
                    <div style={styles.trackBody}>
                      <span
                        style={localSubtitle ? styles.fileName : styles.playerTrackName}
                        title={localSubtitle?.fileName}
                      >
                        {localSubtitle?.fileName ?? playerTrack}
                      </span>
                      {role === "primary" && localSubtitle?.jimakuChoices && localSubtitle.jimakuChoices.length > 1 ? (
                        <p style={styles.trackHint}>
                          Jimaku{" · "}
                          <button
                            style={styles.inlineLink}
                            disabled={localSubtitleBusy}
                            aria-expanded={jimakuListOpen}
                            onClick={() => setJimakuListOpen((open) => !open)}
                          >
                            {localSubtitle.jimakuChoices.length - 1}{" "}
                            {localSubtitle.jimakuChoices.length > 2 ? "autres fichiers" : "autre fichier"}
                          </button>
                        </p>
                      ) : null}
                      {role === "primary" && jimakuListOpen && localSubtitle?.jimakuChoices ? (
                        <div style={styles.jimakuChoices}>
                          {localSubtitle.jimakuChoices.slice(0, 8).map((choice) => {
                            const current = choice.name === localSubtitle.fileName;
                            return (
                              <button
                                key={`${choice.url}|${choice.inner ?? ""}`}
                                style={current ? { ...styles.jimakuChoice, ...styles.jimakuChoiceCurrent } : styles.jimakuChoice}
                                title={choice.name}
                                aria-current={current ? "true" : undefined}
                                disabled={localSubtitleBusy || current}
                                onClick={() => void chooseJimakuVersion(choice)}
                              >
                                {current ? `✓ ${choice.name}` : choice.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {localSubtitle?.syncSegments?.length ? (
                        <p style={styles.trackHint}>
                          Synchronisé{localSubtitle.syncSegments.length > 1 ? " par parties" : ""}
                          {" · "}
                          <button
                            style={styles.inlineLink}
                            disabled={localSubtitleBusy}
                            onClick={() => void removeAutoSync(role)}
                          >
                            Annuler
                          </button>
                        </p>
                      ) : null}
                      <div style={styles.fileActions}>
                        <label style={styles.compactButton}>
                          {localSubtitleBusy
                            ? "Chargement…"
                            : localSubtitle ? "Remplacer" : "Importer un fichier"}
                          <input
                            type="file"
                            accept=".srt,.vtt,.webvtt,.ass,.ssa"
                            hidden
                            disabled={localSubtitleBusy}
                            onChange={(event) => {
                              void importLocalSubtitle(role, event.target.files?.[0]);
                              event.target.value = "";
                            }}
                          />
                        </label>
                        {localSubtitle && (
                          <button
                            style={styles.dangerButton}
                            disabled={localSubtitleBusy}
                            onClick={() => void deleteLocalSubtitle(role)}
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <h3 style={styles.subheading}>Décalage</h3>
              {/* Linked offsets share one outlined panel, so the link is visible. */}
              <div style={{
                ...styles.offsetPanel,
                ...(linkedOffsets && showTranslationOffset ? styles.offsetPanelLinked : {}),
              }}>
                {(showTranslationOffset ? LOCAL_SUBTITLE_ROLES : ["primary" as const]).map((role) => (
                  <OffsetRow
                    key={role}
                    label={role === "primary" ? "Japonais" : "Traduction"}
                    input={offsetInputs[role]}
                    value={trackOffset(role)}
                    disabled={localSubtitleBusy}
                    onInput={(value) => setOffsetInputs((current) => ({ ...current, [role]: value }))}
                    onCommit={(value) => void changeOffset(role, value)}
                    onReset={() => void changeOffset(role, 0, true)}
                  />
                ))}
                {showTranslationOffset && (
                  <label style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={linkedOffsets}
                      onChange={(event) => void chooseLinkedOffsets(event.target.checked)}
                    />
                    <span>Décaler les deux ensemble</span>
                  </label>
                )}
              </div>
              {showTranslationOffset && translationOffsetAutomatic && !localSubtitles.secondary && (
                <p style={styles.offsetHint}>Traduction synchronisée automatiquement.</p>
              )}
              <p style={styles.offsetHint}>
                Valeur positive : le sous-titre s’affiche plus tard.
              </p>
            </div>
          </details>
        )}
      </div>
      {localSubtitleError && <p style={styles.inlineError}>{localSubtitleError}</p>}

      {display && (
        <>
          <h2 style={styles.groupLabel}>Affichage</h2>
          <div style={styles.card}>
            <div style={styles.cardRow}>
              <span>Taille</span>
              <div style={styles.stepper}>
                <button
                  type="button"
                  style={styles.stepperButton}
                  aria-label="Réduire les sous-titres"
                  disabled={display.subtitleScale <= SUBTITLE_SCALE_MIN}
                  onClick={() =>
                    void updateDisplay({
                      subtitleScale: Math.max(
                        SUBTITLE_SCALE_MIN,
                        display.subtitleScale - SUBTITLE_SCALE_STEP,
                      ),
                    })
                  }
                >
                  −
                </button>
                <span style={styles.stepperValue}>{display.subtitleScale} %</span>
                <button
                  type="button"
                  style={styles.stepperButton}
                  aria-label="Agrandir les sous-titres"
                  disabled={display.subtitleScale >= SUBTITLE_SCALE_MAX}
                  onClick={() =>
                    void updateDisplay({
                      subtitleScale: Math.min(
                        SUBTITLE_SCALE_MAX,
                        display.subtitleScale + SUBTITLE_SCALE_STEP,
                      ),
                    })
                  }
                >
                  +
                </button>
              </div>
            </div>
            <div style={{ ...styles.cardRow, ...styles.cardRowDivided }}>
              <span>Furigana</span>
              <Switch
                checked={display.showFurigana}
                ariaLabel="Furigana"
                onChange={(next) => void updateDisplay({ showFurigana: next })}
              />
            </div>
          </div>
        </>
      )}
      </>)}

      {enabled !== false && onboarded && stats && stats.knownWords < KNOWN_WORDS_LINK_THRESHOLD && (
        <button
          style={styles.knownWordsLink}
          onClick={() => {
            void sendMessage("options:open", { section: "mots-connus" }).then(() => window.close());
          }}
        >
          Indiquer les mots que je connais déjà
        </button>
      )}

      <footer style={styles.footer}>
        <span style={styles.footerStat}>
          {stats && (
            <>
              <strong style={styles.footerFigure}>{stats.knownWords.toLocaleString("fr-FR")}</strong>{" "}
              mot{stats.knownWords > 1 ? "s" : ""} connu{stats.knownWords > 1 ? "s" : ""}
              {stats.totalCards > 0 && (
                <>
                  {", "}
                  <strong style={styles.footerFigure}>{stats.totalCards.toLocaleString("fr-FR")}</strong>{" "}
                  carte{stats.totalCards > 1 ? "s" : ""} créée{stats.totalCards > 1 ? "s" : ""}
                </>
              )}
            </>
          )}
        </span>
        <span style={styles.footerLinks}>
          <button
            style={{ ...styles.footerLink, ...(showHelp ? styles.footerLinkActive : {}) }}
            aria-expanded={showHelp}
            onClick={() => setShowHelp((visible) => !visible)}
          >
            Aide
          </button>
          <button style={styles.footerLink} onClick={() => void chrome.runtime.openOptionsPage()}>
            Réglages
          </button>
        </span>
      </footer>

      {showHelp && (
        <div style={styles.guideContent}>
          <section style={styles.guideSection}>
            <h2 style={styles.guideHeading}>Couleurs des mots</h2>
            <p style={styles.guideHint}>
              Seul le mot à miner est coloré : l’unique inconnu de sa phrase.
            </p>
            <div style={styles.guideColorList}>
              {WORD_COLOR_GUIDE.map((item) => (
                <div key={item.label} style={styles.guideColorRow}>
                  <span
                    style={{
                      ...styles.guideWord,
                      color: item.color,
                      borderBottom: item.underline,
                    }}
                  >
                    {item.word}
                  </span>
                  <span style={styles.guideColorLabel}>{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.guideSection}>
            <h2 style={styles.guideHeading}>Raccourcis vidéo</h2>
            <p style={styles.guideHint}>Dans l’onglet vidéo, hors des champs de saisie.</p>
            <div style={styles.guideShortcutList}>
              {SHORTCUT_GUIDE.map((item) => (
                <div key={item.key} style={styles.guideShortcutRow}>
                  <kbd style={styles.guideKey}>{item.key}</kbd>
                  <span style={styles.guideShortcutAction}>{item.action}</span>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.guideSection}>
            <h2 style={styles.guideHeading}>Sous-titres</h2>
            <dl style={styles.guideTerms}>
              <dt style={styles.guideTerm}>Traduction</dt>
              <dd style={styles.guideDefinition}>l’autre langue sert de repli, sauf avec « Aucune ».</dd>
              <dt style={styles.guideTerm}>Phrases connues</dt>
              <dd style={styles.guideDefinition}>
                tous leurs mots sont connus ou ignorés. Survol ou X pour révéler : le japonais
                d’abord, puis la traduction.
              </dd>
              <dt style={styles.guideTerm}>YouTube</dt>
              <dd style={styles.guideDefinition}>
                sous-titres japonais du créateur en priorité, automatiques en repli.
              </dd>
              <dt style={styles.guideTerm}>Audio de l’onglet</dt>
              <dd style={styles.guideDefinition}>
                à activer une fois par onglet vidéo pour enregistrer les phrases minées.
              </dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
};

/** On/off control: a labelled button with the `switch` role. */
function Switch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  label?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      style={styles.switchButton}
      onClick={() => props.onChange(!props.checked)}
    >
      {props.label && (
        <span style={{ ...styles.switchLabel, color: props.checked ? "var(--sj-text)" : "var(--sj-muted)" }}>
          {props.label}
        </span>
      )}
      <span
        aria-hidden="true"
        style={{
          ...styles.switchTrack,
          background: props.checked ? "var(--sj-accent)" : "var(--sj-hairline)",
        }}
      >
        <span
          style={{
            ...styles.switchKnob,
            background: props.checked ? "var(--sj-canvas)" : "var(--sj-text)",
            transform: props.checked ? "translateX(14px)" : "none",
          }}
        />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles — colours, sizes and radii come from the tokens of src/ui/theme.css.
// ---------------------------------------------------------------------------

const control: React.CSSProperties = {
  border: "1px solid var(--sj-hairline)",
  borderRadius: "var(--sj-radius-control)",
  background: "var(--sj-surface-raised)",
  color: "var(--sj-text)",
  fontFamily: "inherit",
  fontSize: "var(--sj-size-label)",
  fontWeight: 500,
  cursor: "pointer",
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 360,
    padding: "16px 16px 14px",
    boxSizing: "border-box",
    fontFamily: "var(--sj-font)",
    backgroundColor: "var(--sj-canvas)",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-compact)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  brandLockup: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 26,
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-accent)",
    color: "var(--sj-canvas)",
    fontSize: 15,
    fontWeight: 700,
  },
  title: {
    margin: 0,
    fontSize: "var(--sj-size-title)",
    lineHeight: 1.1,
    fontWeight: 600,
  },
  headerEnd: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  connectionStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    borderRadius: 999,
    background: "var(--sj-surface-raised)",
    color: "var(--sj-danger)",
    fontSize: "var(--sj-size-small)",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--sj-danger)",
  },
  switchButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    border: "none",
    background: "transparent",
    fontFamily: "inherit",
    cursor: "pointer",
  },
  switchLabel: {
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
  },
  switchTrack: {
    position: "relative",
    flexShrink: 0,
    width: 32,
    height: 18,
    borderRadius: 999,
    transition: "background-color 160ms var(--sj-ease)",
  },
  switchKnob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    transition: "transform 160ms var(--sj-ease), background-color 160ms var(--sj-ease)",
  },
  disabledNote: {
    margin: "0 0 4px",
    padding: "10px 12px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-dense)",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.45,
  },
  setupBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-surface)",
    border: "1px solid var(--sj-hairline)",
  },
  setupText: {
    margin: "0 0 10px",
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.45,
  },
  sessionBlock: {
    marginBottom: 10,
  },
  primaryButton: {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    border: "none",
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-accent)",
    color: "var(--sj-canvas)",
    fontFamily: "inherit",
    fontSize: "var(--sj-size-compact)",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    ...control,
    flex: "0 0 auto",
    minHeight: 30,
    padding: "5px 12px",
  },
  pendingHint: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-surface)",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.45,
  },
  audioRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-surface)",
  },
  audioText: {
    display: "grid",
    gap: 2,
    minWidth: 0,
  },
  audioLabel: {
    fontSize: "var(--sj-size-compact)",
  },
  audioHint: {
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.35,
  },
  audioActive: {
    flex: "0 0 auto",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
  },
  inlineError: {
    margin: "6px 2px 0",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.4,
    color: "var(--sj-danger)",
    wordBreak: "break-word",
  },
  groupLabel: {
    margin: "18px 2px 6px",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
  },
  card: {
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-surface)",
    overflow: "hidden",
  },
  cardRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 42,
    padding: "0 12px",
    boxSizing: "border-box",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-compact)",
  },
  cardRowDivided: {
    borderTop: "1px solid var(--sj-hairline-soft)",
  },
  cardSummary: {
    cursor: "pointer",
    listStyle: "none",
  },
  summaryEnd: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  summaryValue: {
    overflow: "hidden",
    maxWidth: 180,
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-label)",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  select: {
    width: 176,
    padding: "5px 6px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-input)",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
  },
  stepper: {
    display: "flex",
    alignItems: "center",
    width: 176,
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-input)",
    overflow: "hidden",
  },
  stepperButton: {
    width: 36,
    height: 28,
    border: "none",
    background: "transparent",
    color: "var(--sj-text)",
    fontFamily: "inherit",
    fontSize: 15,
    cursor: "pointer",
  },
  stepperValue: {
    flex: 1,
    textAlign: "center",
    fontSize: "var(--sj-size-label)",
    fontVariantNumeric: "tabular-nums",
  },
  chevron: {
    display: "inline-block",
    width: 12,
    color: "var(--sj-muted)",
    fontSize: 16,
    lineHeight: 1,
    textAlign: "center",
    transition: "transform 160ms var(--sj-ease)",
  },
  disclosureContent: {
    padding: "4px 12px 12px",
  },
  trackRow: {
    display: "flex",
    gap: 8,
    padding: "8px 0",
  },
  trackLabel: {
    flex: "0 0 70px",
    paddingTop: 1,
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-label)",
  },
  trackBody: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    display: "block",
    overflow: "hidden",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  playerTrackName: {
    display: "block",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
  },
  trackHint: {
    margin: "4px 0 0",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.35,
    color: "var(--sj-muted)",
  },
  fileActions: {
    display: "flex",
    gap: 6,
    marginTop: 8,
  },
  compactButton: {
    ...control,
    flex: "1 1 auto",
    padding: "6px 8px",
    whiteSpace: "nowrap",
    textAlign: "center",
  },
  compactPrimary: {
    ...control,
    flex: "1 1 auto",
    padding: "6px 8px",
    border: "1px solid var(--sj-accent)",
    background: "var(--sj-accent)",
    color: "var(--sj-canvas)",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  dangerButton: {
    ...control,
    flex: "0 0 auto",
    padding: "6px 10px",
    // Outlined in the danger colour: recognisable without competing with the main actions.
    border: "1px solid var(--sj-danger)",
    background: "transparent",
    color: "var(--sj-danger)",
  },
  missingJapanese: {
    padding: 12,
  },
  missingJapaneseText: {
    margin: 0,
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-compact)",
    fontWeight: 500,
    lineHeight: 1.4,
  },
  missingJapaneseActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  subheading: {
    margin: "10px 0 6px",
    paddingTop: 10,
    borderTop: "1px solid var(--sj-hairline-soft)",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
  },
  offsetRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  offsetRowLabel: {
    flex: "0 0 70px",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
  },
  offsetInput: {
    width: 60,
    flex: "0 0 auto",
    minHeight: 28,
    padding: "4px 6px",
    boxSizing: "border-box",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-input)",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-compact)",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  },
  smallButton: {
    ...control,
    flex: 1,
    minHeight: 28,
    padding: "4px 3px",
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  resetGlyph: {
    fontSize: 15,
    lineHeight: 1,
  },
  offsetPanel: {
    padding: "8px 8px 6px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-input)",
  },
  offsetPanelLinked: {
    borderColor: "rgb(255 98 77 / 60%)",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    borderTop: "1px solid var(--sj-hairline-soft)",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    cursor: "pointer",
  },
  offsetHint: {
    margin: "6px 2px 0",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.35,
  },
  inlineLink: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--sj-text)",
    fontFamily: "inherit",
    fontSize: "var(--sj-size-small)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
  },
  jimakuChoices: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 6,
  },
  jimakuChoice: {
    ...control,
    padding: "5px 8px",
    fontSize: "var(--sj-size-small)",
    fontWeight: 400,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  /** Added to `jimakuChoice` for the installed file. */
  jimakuChoiceCurrent: {
    borderColor: "var(--sj-accent)",
    cursor: "default",
  },
  knownWordsLink: {
    display: "block",
    marginTop: 12,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--sj-text)",
    fontFamily: "inherit",
    fontSize: "var(--sj-size-label)",
    textAlign: "left",
    textDecoration: "underline",
    textDecorationColor: "var(--sj-accent)",
    textUnderlineOffset: 3,
    cursor: "pointer",
  },
  error: {
    margin: "0 0 10px",
    fontSize: "var(--sj-size-small)",
    color: "var(--sj-danger)",
    wordBreak: "break-word",
  },
  footer: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTop: "1px solid var(--sj-hairline-soft)",
    fontSize: "var(--sj-size-label)",
  },
  footerStat: {
    color: "var(--sj-muted)",
  },
  footerFigure: {
    color: "var(--sj-text)",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  footerLinks: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  footerLink: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--sj-text)",
    fontFamily: "inherit",
    fontSize: "var(--sj-size-label)",
    cursor: "pointer",
  },
  footerLinkActive: {
    textDecoration: "underline",
    textDecorationColor: "var(--sj-accent)",
    textUnderlineOffset: 3,
  },
  guideContent: {
    paddingTop: 12,
  },
  guideSection: {
    paddingBottom: 14,
  },
  guideHeading: {
    margin: "0 0 4px",
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    fontWeight: 600,
  },
  guideHint: {
    margin: 0,
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
  },
  guideColorList: {
    display: "grid",
    gap: 6,
    marginTop: 8,
  },
  guideColorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 24,
  },
  guideWord: {
    display: "inline-block",
    minWidth: 46,
    paddingBottom: 1,
    fontSize: 14,
    fontWeight: 700,
    textAlign: "center",
  },
  guideColorLabel: {
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.35,
  },
  guideShortcutList: {
    display: "grid",
    gap: 6,
    marginTop: 8,
  },
  guideShortcutRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 20,
  },
  guideKey: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    padding: "2px 5px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: 4,
    background: "var(--sj-surface-raised)",
    color: "var(--sj-text)",
    fontFamily: "var(--sj-font)",
    fontSize: "var(--sj-size-small)",
    fontWeight: 600,
    lineHeight: 1.2,
  },
  guideShortcutAction: {
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.35,
  },
  guideTerms: {
    display: "grid",
    gap: 2,
    margin: "6px 0 0",
  },
  guideTerm: {
    marginTop: 4,
    color: "var(--sj-text)",
    fontSize: "var(--sj-size-small)",
    fontWeight: 600,
  },
  guideDefinition: {
    margin: 0,
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
