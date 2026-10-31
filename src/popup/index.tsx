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
  saveJapaneseOffset,
  saveLinkedOffsets,
  saveTranslationOffset,
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

const LOCAL_SUBTITLE_ROLES: LocalSubtitleRole[] = ["primary", "secondary"];
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
    label: "Inconnu ou en apprentissage",
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
}): JSX.Element {
  return (
    <div style={styles.offsetRow}>
      <span style={styles.offsetRowLabel}>{props.label}</span>
      <input
        style={styles.offsetInput}
        type="number"
        step="0.01"
        aria-label={`Décalage ${props.label.toLowerCase()} (s)`}
        value={props.input}
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
        onClick={() => props.onCommit(0)}
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
  const [savingSubtitlePreference, setSavingSubtitlePreference] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [localSubtitlesOpen, setLocalSubtitlesOpen] = useState(false);
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
  /** Player of the video under the popup when it has no Japanese subtitles. */
  const [missingJapanese, setMissingJapanese] = useState<{ tabId: number; player: string } | null>(null);

  const refresh = useCallback(async () => {
    const [statsResult, dictResult, onboardedResult, optionsResult] = await Promise.all([
      sendMessage("stats:get", {}),
      sendMessage("dict:status", {}),
      isOnboardingComplete(),
      getOptions(),
    ]);
    setStats(statsResult);
    setDict(dictResult);
    setOnboarded(onboardedResult);
    setKnownSentenceSubtitles(optionsResult.knownSentenceSubtitles);
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
      if (!currentVideoId) return;
      // Only the frame playing a video without Japanese subtitles answers.
      void chrome.tabs.sendMessage(tab.id, { type: "subtitles:status" }).then((answer: unknown) => {
        const status = answer as { missing?: unknown; player?: unknown } | undefined;
        if (status?.missing === true && typeof status.player === "string" && tab.id != null) {
          setMissingJapanese({ tabId: tab.id, player: status.player });
        }
      }, () => {
        // No frame answered: Japanese subtitles are available or still unknown.
      });
      const [primary, secondary, japaneseOffset, translationOffset, linked] = await Promise.all([
        getLocalSubtitle(currentVideoId, "primary"),
        getLocalSubtitle(currentVideoId, "secondary"),
        getJapaneseOffset(currentVideoId),
        getTranslationOffset(currentVideoId),
        getLinkedOffsets(),
      ]);
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

  /** Sets one track's offset; linked, the other moves by as much. */
  const changeOffset = useCallback(
    async (role: LocalSubtitleRole, value: number) => {
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
        await Promise.all([
          persistOffset(role, rounded),
          linkedOffsets && showTranslationOffset && delta !== 0
            ? persistOffset(other, Math.round((trackOffset(other) + delta) * 100) / 100)
            : Promise.resolve(),
        ]);
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [linkedOffsets, persistOffset, showTranslationOffset, trackOffset],
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
      await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#78d6a3" });
      setCaptureStatus("active");
    } catch (err: unknown) {
      setCaptureStatus("idle");
      setCaptureError(err instanceof Error ? err.message : String(err));
    }
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
      <div style={styles.header}>
        <div style={styles.brandLockup}>
          <span style={styles.brandMark} aria-hidden="true">字</span>
          <div>
            <h1 style={styles.title}>SubJap</h1>
            <p style={styles.brandLine}>L’Après-séance</p>
          </div>
        </div>
        {/* Only a problem is worth a status: a ready extension stays quiet. */}
        {connected === false && (
          <span style={styles.connectionStatus}>
            <span style={{ ...styles.dot, backgroundColor: "#ff8490" }} />
            Hors ligne
          </span>
        )}
      </div>

      {enabled !== null && (
        <div style={styles.enabledBox}>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            style={styles.enabledSwitch}
            disabled={savingEnabled}
            onClick={() => void toggleEnabled(!enabled)}
          >
            <span>{enabled ? "SubJap activé" : "SubJap désactivé"}</span>
            <span
              aria-hidden="true"
              style={{
                ...styles.switchTrack,
                background: enabled ? "#ff624d" : "#343842",
              }}
            >
              <span
                style={{
                  ...styles.switchKnob,
                  transform: enabled ? "translateX(14px)" : "none",
                }}
              />
            </span>
          </button>
          {!enabled && (
            <p style={styles.captureHint}>
              Aucun sous-titre ni raccourci SubJap sur les vidéos jusqu’à la réactivation.
            </p>
          )}
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {enabled !== false && (<>
      {!onboarded ? (
        <div style={styles.onboardingBox}>
          <p style={styles.onboardingText}>
            Configuration non terminée : le dictionnaire est nécessaire aux définitions.
          </p>
          <button style={styles.button} onClick={() => void chrome.runtime.openOptionsPage()}>
            Terminer la configuration →
          </button>
        </div>
      ) : dict !== null && !dict.installed && (
        <div style={styles.onboardingBox}>
          <button
            style={styles.button}
            onClick={() => void installDictionary()}
            disabled={downloading}
          >
            {downloading ? "Téléchargement…" : "Installer le dictionnaire (~22k mots)"}
          </button>
        </div>
      )}

      {hasVideo && (
        <div style={styles.captureBox}>
          <button
            style={styles.captureButton}
            onClick={() => void activateCapture()}
            disabled={captureStatus !== "idle"}
          >
            {captureStatus === "activating"
              ? "Activation…"
              : captureStatus === "active"
                ? "✓ Audio de l’onglet actif"
                : "Activer l’audio de l’onglet"}
          </button>
          {captureError && <p style={styles.captureError}>{captureError}</p>}
        </div>
      )}

      <h2 style={styles.groupLabel}>Sous-titres</h2>
      <div style={styles.card}>
        {missingJapanese && videoId && (
          <div style={styles.missingJapanese}>
            <p style={styles.missingJapaneseText}>Pas de sous-titres japonais pour cette vidéo.</p>
            <div style={styles.missingJapaneseActions}>
              {missingJapanese.player === "artplayer" && (
                <button style={styles.missingJapanesePrimary} onClick={() => void searchJimaku()}>
                  Chercher sur Jimaku
                </button>
              )}
              <label style={styles.missingJapaneseButton}>
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
            {localSubtitleError && !localSubtitlesOpen && (
              <p style={styles.captureError}>{localSubtitleError}</p>
            )}
          </div>
        )}
        <label style={{
          ...styles.cardRow,
          ...(missingJapanese && videoId ? styles.cardRowDivided : {}),
        }}>
          <span>Traduction</span>
          <select
            style={styles.languageSelect}
            value={secondarySubtitleLanguage}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void chooseSecondarySubtitleLanguage(
                event.target.value as SecondarySubtitleLanguage,
              )
            }
          >
            <option value="none">Aucune</option>
            <option value="fr">Français</option>
            <option value="en">Anglais</option>
          </select>
        </label>
        <label style={{ ...styles.cardRow, ...styles.cardRowDivided }}>
          <span>Phrases connues</span>
          <select
            style={styles.languageSelect}
            value={knownSentenceSubtitles}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void chooseKnownSentenceSubtitles(
                event.target.value as KnownSentenceSubtitles,
              )
            }
          >
            <option value="show">Tout afficher</option>
            <option value="hide-translation">Masquer la traduction</option>
            <option value="hide-all">Masquer tout (écoute)</option>
          </select>
        </label>
        {videoId && (
          <details onToggle={(event) => setLocalSubtitlesOpen(event.currentTarget.open)}>
            <summary style={{ ...styles.cardRow, ...styles.cardRowDivided, ...styles.cardSummary }}>
              <span>Pistes et décalage</span>
              <span
                aria-hidden="true"
                style={{
                  ...styles.chevron,
                  transform: localSubtitlesOpen ? "rotate(90deg)" : "none",
                }}
              >
                ›
              </span>
            </summary>
            <div style={styles.localSubtitleContent}>
              <span style={styles.subsectionLabel}>Décalage (secondes)</span>
              {(showTranslationOffset ? LOCAL_SUBTITLE_ROLES : ["primary" as const]).map((role) => (
                <OffsetRow
                  key={role}
                  label={role === "primary" ? "Japonais" : "Traduction"}
                  input={offsetInputs[role]}
                  value={trackOffset(role)}
                  disabled={localSubtitleBusy}
                  onInput={(value) => setOffsetInputs((current) => ({ ...current, [role]: value }))}
                  onCommit={(value) => void changeOffset(role, value)}
                />
              ))}
              <p style={styles.offsetHint}>
                Valeur positive : le sous-titre s’affiche plus tard.
              </p>
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

              <span style={{ ...styles.subsectionLabel, ...styles.subsectionDivided }}>Fichiers</span>
              {LOCAL_SUBTITLE_ROLES.map((role) => {
                const localSubtitle = localSubtitles[role];
                const playerTrack = role === "primary"
                  ? "Piste du lecteur"
                  : secondarySubtitleLanguage === "none" ? "Aucune" : "Traduction du lecteur";
                return (
                  <div key={role} style={styles.fileRow}>
                    <div style={styles.fileRowHead}>
                      <span
                        style={styles.offsetRowLabel}
                        title={role === "primary"
                          ? "Traitée comme du japonais ; sur Netflix et YouTube, elle remplace la piste japonaise native."
                          : "Affichée avec le japonais ; sur Netflix et YouTube, elle remplace la traduction native."}
                      >
                        {role === "primary" ? "Japonais" : "Traduction"}
                      </span>
                      <span
                        style={localSubtitle ? styles.fileName : styles.playerTrackName}
                        title={localSubtitle?.fileName}
                      >
                        {localSubtitle?.fileName ?? playerTrack}
                      </span>
                    </div>
                    {localSubtitle?.syncSegments?.length ? (
                      <p style={styles.localSubtitleHint}>
                        Recalé{localSubtitle.syncSegments.length > 1 ? " par parties" : ""}
                        {" ("}
                        {localSubtitle.syncSegments
                          .map((segment) => `${segment.offset > 0 ? "+" : ""}${segment.offset.toFixed(1).replace(".", ",")} s`)
                          .join(", ")}
                        {") · "}
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
                      <label style={styles.fileButton}>
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
                          style={styles.deleteButton}
                          disabled={localSubtitleBusy}
                          onClick={() => void deleteLocalSubtitle(role)}
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {localSubtitleError && <p style={styles.captureError}>{localSubtitleError}</p>}
            </div>
          </details>
        )}
      </div>

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
            <button
              type="button"
              role="switch"
              aria-checked={display.showFurigana}
              style={{ ...styles.cardRow, ...styles.cardRowDivided, ...styles.cardSwitchRow }}
              onClick={() => void updateDisplay({ showFurigana: !display.showFurigana })}
            >
              <span>Furigana</span>
              <span
                aria-hidden="true"
                style={{
                  ...styles.switchTrack,
                  background: display.showFurigana ? "#ff624d" : "#343842",
                }}
              >
                <span
                  style={{
                    ...styles.switchKnob,
                    transform: display.showFurigana ? "translateX(14px)" : "none",
                  }}
                />
              </span>
            </button>
          </div>
        </>
      )}
      </>)}

      <div style={styles.footer}>
        <span style={styles.footerStat}>
          {stats ? `${stats.knownWords.toLocaleString("fr-FR")} mots connus` : ""}
        </span>
        <span style={styles.footerLinks}>
          <button
            style={styles.footerLink}
            aria-expanded={showHelp}
            onClick={() => setShowHelp((visible) => !visible)}
          >
            Aide
          </button>
          <span aria-hidden="true">·</span>
          <button style={styles.footerLink} onClick={() => void chrome.runtime.openOptionsPage()}>
            Réglages
          </button>
        </span>
      </div>

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
            <p style={styles.guideHint}>
              <strong>Traduction</strong> : l’autre langue sert de repli, sauf avec « Aucune ».
            </p>
            <p style={styles.guideHint}>
              <strong>Phrases connues</strong> : phrase dont tous les mots sont connus ou ignorés.
              Survol ou X pour révéler : le japonais d’abord, puis la traduction.
            </p>
            <p style={styles.guideHint}>
              <strong>YouTube</strong> : sous-titres japonais du créateur en priorité, automatiques
              en repli.
            </p>
            <p style={styles.guideHint}>
              <strong>Audio de l’onglet</strong> : à activer une fois par onglet vidéo pour
              capturer l’audio des phrases minées.
            </p>
          </section>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 312,
    padding: 18,
    fontFamily: "var(--sj-font)",
    backgroundColor: "#0c0d10",
    color: "#f4f1ea",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
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
    width: 34,
    height: 28,
    borderRadius: 6,
    background: "#ff624d",
    color: "#0c0d10",
    fontSize: 17,
    fontWeight: 700,
  },
  title: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.1,
    fontWeight: 600,
    color: "#f4f1ea",
  },
  brandLine: {
    margin: "3px 0 0",
    color: "#b2b6bf",
    fontSize: 10,
    lineHeight: 1.2,
  },
  connectionStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    background: "#1b1e24",
    color: "#b2b6bf",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  enabledBox: {
    marginBottom: 10,
  },
  enabledSwitch: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #343842",
    borderRadius: 8,
    background: "#14161b",
    color: "#f4f1ea",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  switchTrack: {
    position: "relative",
    flexShrink: 0,
    width: 32,
    height: 18,
    borderRadius: 999,
    transition: "background-color 150ms ease",
  },
  switchKnob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#f4f1ea",
    transition: "transform 150ms ease",
  },
  captureBox: {
    marginTop: 10,
  },
  captureButton: {
    width: "100%",
    padding: "8px 12px",
    border: "none",
    borderRadius: 6,
    background: "#ff624d",
    color: "#0c0d10",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  captureHint: {
    margin: "6px 0 0",
    fontSize: 10,
    color: "#b2b6bf",
  },
  captureError: {
    margin: "6px 0 0",
    fontSize: 10,
    color: "#ff8490",
    wordBreak: "break-word",
  },
  localSubtitleContent: {
    padding: "0 12px 12px",
  },
  groupLabel: {
    margin: "18px 2px 6px",
    color: "#b2b6bf",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  card: {
    border: "1px solid #343842",
    borderRadius: 8,
    background: "#14161b",
    overflow: "hidden",
  },
  cardRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 40,
    padding: "0 12px",
    boxSizing: "border-box",
    color: "#f4f1ea",
    fontSize: 13,
  },
  cardRowDivided: {
    borderTop: "1px solid #343842",
  },
  cardSummary: {
    cursor: "pointer",
    listStyle: "none",
  },
  cardSwitchRow: {
    width: "100%",
    // Longhands only: a `border` shorthand would erase the row divider.
    borderRight: "none",
    borderBottom: "none",
    borderLeft: "none",
    background: "transparent",
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  stepper: {
    display: "flex",
    alignItems: "center",
    width: 150,
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#101216",
    overflow: "hidden",
  },
  stepperButton: {
    width: 36,
    height: 28,
    border: "none",
    background: "transparent",
    color: "#f4f1ea",
    fontFamily: "inherit",
    fontSize: 15,
    cursor: "pointer",
  },
  stepperValue: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  chevron: {
    display: "inline-block",
    width: 12,
    color: "#b2b6bf",
    fontSize: 16,
    lineHeight: 1,
    textAlign: "center",
    transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
  },
  subsectionLabel: {
    display: "block",
    margin: "4px 0 6px",
    color: "#b2b6bf",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
  },
  subsectionDivided: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid #343842",
  },
  offsetRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  offsetRowLabel: {
    flex: "0 0 70px",
    color: "#f4f1ea",
    fontSize: 12,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#f4f1ea",
    fontSize: 12,
    cursor: "pointer",
  },
  fileRow: {
    marginBottom: 12,
  },
  fileRowHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },
  fileActions: {
    display: "flex",
    gap: 6,
    marginTop: 8,
  },
  playerTrackName: {
    flex: 1,
    minWidth: 0,
    color: "#b2b6bf",
    fontSize: 12,
  },
  languageSelect: {
    width: 150,
    padding: "5px 6px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#101216",
    color: "#f4f1ea",
    fontSize: 12,
  },
  missingJapanese: {
    padding: "10px 12px",
  },
  missingJapaneseText: {
    margin: 0,
    color: "#f1b46d",
    fontSize: 12,
    lineHeight: 1.4,
  },
  missingJapaneseActions: {
    display: "flex",
    gap: 6,
    marginTop: 8,
  },
  missingJapanesePrimary: {
    flex: 1,
    padding: "7px 8px",
    border: "1px solid #ff624d",
    borderRadius: 6,
    background: "#ff624d",
    color: "#0c0d10",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  missingJapaneseButton: {
    flex: 1,
    padding: "7px 8px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontSize: 11,
    textAlign: "center",
    cursor: "pointer",
  },
  fileButton: {
    flex: 1,
    padding: "7px 10px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontSize: 12,
    textAlign: "center",
    cursor: "pointer",
  },
  fileName: {
    flex: 1,
    minWidth: 0,
    color: "#78d6a3",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  offsetInput: {
    width: 58,
    flex: "0 0 auto",
    minHeight: 28,
    padding: "4px 6px",
    boxSizing: "border-box",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#101216",
    color: "#f4f1ea",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
  },
  offsetHint: {
    margin: "0 0 8px",
    color: "#b2b6bf",
    fontSize: 11,
    lineHeight: 1.35,
  },
  resetGlyph: {
    fontSize: 15,
    lineHeight: 1,
  },
  localSubtitleHint: {
    margin: "6px 0 0",
    fontSize: 11,
    lineHeight: 1.35,
    color: "#b2b6bf",
  },
  smallButton: {
    flex: 1,
    minHeight: 28,
    padding: "4px 3px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontSize: 12,
    cursor: "pointer",
  },
  inlineLink: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#ff624d",
    fontSize: 11,
    textDecoration: "underline",
    cursor: "pointer",
  },
  deleteButton: {
    flex: "0 0 auto",
    padding: "6px 10px",
    // Outlined in the danger colour, like the options' danger buttons:
    // recognisable as a button without competing with the main actions.
    border: "1px solid #ff8490",
    borderRadius: 6,
    background: "transparent",
    color: "#ff8490",
    fontSize: 12,
    cursor: "pointer",
  },
  guideContent: {
    paddingTop: 12,
  },
  guideSection: {
    paddingBottom: 12,
  },
  guideHeading: {
    margin: "0 0 4px",
    color: "#f4f1ea",
    fontSize: 11,
    fontWeight: 600,
  },
  guideHint: {
    display: "block",
    margin: 0,
    color: "#b2b6bf",
    fontSize: 10,
    lineHeight: 1.4,
  },
  guideColorList: {
    display: "grid",
    gap: 7,
    marginTop: 9,
  },
  guideColorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 25,
  },
  guideWord: {
    display: "inline-block",
    minWidth: 46,
    paddingBottom: 1,
    fontSize: 14,
    fontWeight: 600,
    textAlign: "center",
  },
  guideColorLabel: {
    color: "#f4f1ea",
    fontSize: 12,
    fontWeight: 500,
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
    gap: 9,
    minHeight: 20,
  },
  guideKey: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 24,
    padding: "2px 5px",
    border: "1px solid #343842",
    borderRadius: 4,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontFamily: "var(--sj-font)",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  },
  guideShortcutAction: {
    color: "#b2b6bf",
    fontSize: 10,
    lineHeight: 1.35,
  },
  button: {
    width: "100%",
    padding: "8px 12px",
    border: "none",
    borderRadius: 6,
    background: "#ff624d",
    color: "#0c0d10",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: {
    marginTop: 8,
    fontSize: 11,
    color: "#ff8490",
    wordBreak: "break-all",
  },
  onboardingBox: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 8,
    backgroundColor: "#14161b",
    border: "1px solid #343842",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    fontSize: 12,
  },
  footerStat: {
    color: "#b2b6bf",
  },
  footerLinks: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#b2b6bf",
  },
  footerLink: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#f4f1ea",
    fontSize: 12,
    cursor: "pointer",
  },
  onboardingText: {
    margin: "0 0 8px",
    fontSize: 11,
    lineHeight: 1.4,
    color: "#f4f1ea",
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
