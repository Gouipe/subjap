// ---------------------------------------------------------------------------
// SubJap — Popup entry point (React)
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendMessage } from "@/core/messaging";
import { getOptions, saveOptions } from "@/core/options";
import { isOnboardingComplete } from "@/onboarding";
import {
  getLocalSubtitle,
  netflixWatchId,
  parseSubtitleFile,
  removeLocalSubtitle,
  saveLocalSubtitle,
  type LocalSubtitleRecord,
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

const Popup: React.FC = () => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dict, setDict] = useState<DictStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<"idle" | "activating" | "active">("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [hideSecondarySubtitlesWhenAllKnown, setHideSecondarySubtitlesWhenAllKnown] =
    useState(false);
  const [activeListeningMode, setActiveListeningMode] = useState(false);
  const [savingSubtitlePreference, setSavingSubtitlePreference] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [localSubtitle, setLocalSubtitle] = useState<LocalSubtitleRecord | null>(null);
  const [offsetInput, setOffsetInput] = useState("0.00");
  const [localSubtitleBusy, setLocalSubtitleBusy] = useState(false);
  const [localSubtitleError, setLocalSubtitleError] = useState<string | null>(null);

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
    setHideSecondarySubtitlesWhenAllKnown(
      optionsResult.hideSecondarySubtitlesWhenAllKnown,
    );
    setActiveListeningMode(optionsResult.activeListeningMode);
    setConnected(true);
    setError(null);
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
      const currentWatchId = netflixWatchId(tab?.url ?? "");
      setWatchId(currentWatchId);
      if (!currentWatchId) return;
      const record = await getLocalSubtitle(currentWatchId);
      setLocalSubtitle(record);
      setOffsetInput((record?.offsetSeconds ?? 0).toFixed(2));
    })().catch((err: unknown) => {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const importLocalSubtitle = useCallback(
    async (file: File | undefined) => {
      if (!file || !watchId) return;
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
        await saveLocalSubtitle(watchId, record);
        setLocalSubtitle(record);
        setOffsetInput("0.00");
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [watchId],
  );

  const persistOffset = useCallback(
    async (value: number) => {
      if (!watchId || !localSubtitle || !Number.isFinite(value)) return;
      const rounded = Math.round(value * 100) / 100;
      const next = { ...localSubtitle, offsetSeconds: rounded };
      setLocalSubtitle(next);
      setOffsetInput(rounded.toFixed(2));
      setLocalSubtitleBusy(true);
      setLocalSubtitleError(null);
      try {
        await saveLocalSubtitle(watchId, next);
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [localSubtitle, watchId],
  );

  const deleteLocalSubtitle = useCallback(async () => {
    if (!watchId) return;
    setLocalSubtitleBusy(true);
    setLocalSubtitleError(null);
    try {
      await removeLocalSubtitle(watchId);
      setLocalSubtitle(null);
      setOffsetInput("0.00");
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalSubtitleBusy(false);
    }
  }, [watchId]);

  const toggleSecondarySubtitles = useCallback(
    async (enabled: boolean) => {
      const previous = hideSecondarySubtitlesWhenAllKnown;
      setHideSecondarySubtitlesWhenAllKnown(enabled);
      setSavingSubtitlePreference(true);
      setError(null);
      try {
        await saveOptions({ hideSecondarySubtitlesWhenAllKnown: enabled });
      } catch (err: unknown) {
        setHideSecondarySubtitlesWhenAllKnown(previous);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingSubtitlePreference(false);
      }
    },
    [hideSecondarySubtitlesWhenAllKnown],
  );

  const toggleActiveListeningMode = useCallback(
    async (enabled: boolean) => {
      const previous = activeListeningMode;
      setActiveListeningMode(enabled);
      setSavingSubtitlePreference(true);
      setError(null);
      try {
        await saveOptions({ activeListeningMode: enabled });
      } catch (err: unknown) {
        setActiveListeningMode(previous);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingSubtitlePreference(false);
      }
    },
    [activeListeningMode],
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
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#22c55e" });
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
        <h1 style={styles.title}>SubJap</h1>
        <span
          style={{
            ...styles.dot,
            backgroundColor:
              connected === null
                ? "#f0ad4e" // loading
                : connected
                  ? "#5cb85c" // connected
                  : "#d9534f", // disconnected
          }}
        />
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.captureBox}>
        <button
          style={styles.captureButton}
          onClick={() => void activateCapture()}
          disabled={captureStatus !== "idle"}
        >
          {captureStatus === "activating"
            ? "Activation…"
            : captureStatus === "active"
              ? "✓ Audio Netflix actif"
              : "Activer l’audio Netflix"}
        </button>
        {captureError && <p style={styles.captureError}>{captureError}</p>}
        <p style={styles.captureHint}>À faire une seule fois par onglet Netflix.</p>
      </div>

      <div style={styles.subtitleBox}>
        <div style={styles.localSubtitleSection}>
          <span style={styles.sectionLabel}>Sous-titres locaux</span>
          {watchId ? (
            <>
              <label style={styles.fileButton}>
                {localSubtitleBusy
                  ? "Chargement…"
                  : localSubtitle
                    ? "Remplacer le fichier"
                    : "Choisir un fichier"}
                <input
                  type="file"
                  accept=".srt,.vtt,.webvtt,.ass,.ssa"
                  hidden
                  disabled={localSubtitleBusy}
                  onChange={(event) => {
                    void importLocalSubtitle(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {localSubtitle && (
                <>
                  <p style={styles.fileName}>{localSubtitle.fileName}</p>
                  <label style={styles.offsetLabel}>
                    <span>Décalage (s)</span>
                    <input
                      style={styles.offsetInput}
                      type="number"
                      step="0.01"
                      value={offsetInput}
                      disabled={localSubtitleBusy}
                      onChange={(event) => setOffsetInput(event.target.value)}
                      onBlur={() => void persistOffset(Number(offsetInput.replace(",", ".")))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                  <p style={styles.localSubtitleHint}>
                    Une valeur positive affiche le texte plus tard.
                  </p>
                  <div style={styles.offsetActions}>
                    <button
                      style={styles.smallButton}
                      disabled={localSubtitleBusy}
                      onClick={() => void persistOffset(localSubtitle.offsetSeconds - 0.1)}
                    >
                      − 0,1 s
                    </button>
                    <button
                      style={styles.smallButton}
                      disabled={localSubtitleBusy}
                      onClick={() => void persistOffset(localSubtitle.offsetSeconds + 0.1)}
                    >
                      + 0,1 s
                    </button>
                    <button
                      style={styles.smallButton}
                      disabled={localSubtitleBusy}
                      onClick={() => void persistOffset(0)}
                    >
                      Réinitialiser
                    </button>
                  </div>
                  <button
                    style={styles.deleteButton}
                    disabled={localSubtitleBusy}
                    onClick={() => void deleteLocalSubtitle()}
                  >
                    Supprimer le fichier
                  </button>
                </>
              )}
            </>
          ) : (
            <p style={styles.localSubtitleHint}>
              Ouvre un épisode Netflix pour importer un fichier.
            </p>
          )}
          {localSubtitleError && <p style={styles.captureError}>{localSubtitleError}</p>}
        </div>
        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={hideSecondarySubtitlesWhenAllKnown}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void toggleSecondarySubtitles(event.target.checked)
            }
          />
          <span>Masquer FR/EN si tout est connu ou ciblé</span>
        </label>
        <p style={styles.subtitleHint}>
          Aussi actif avec un seul mot bleu ou vert à apprendre.
        </p>
        <label style={{ ...styles.checkLabel, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={activeListeningMode}
            disabled={savingSubtitlePreference}
            onChange={(event) =>
              void toggleActiveListeningMode(event.target.checked)
            }
          />
          <span>Activer l’écoute active</span>
        </label>
        <p style={styles.subtitleHint}>
          Pause automatiquement les phrases éligibles, sans texte au départ.
        </p>
      </div>

      {!onboarded && (
        <div style={styles.onboardingBox}>
          <p style={styles.onboardingText}>
            Configuration non terminée — quelques étapes rapides pour activer le
            dictionnaire.
          </p>
          <button
            style={styles.button}
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            Commencer la configuration
          </button>
        </div>
      )}

      {stats && (
        <div style={styles.statsBox}>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Mots connus</span>
            <span style={styles.statValue}>{stats.knownWords}</span>
          </div>
        </div>
      )}

      <div style={styles.dictBox}>
        {dict === null ? (
          <span style={styles.dictStatus}>Dictionnaire : …</span>
        ) : dict.installed ? (
          <span style={styles.dictStatus}>
            Dictionnaire : {dict.count.toLocaleString()} entrées
          </span>
        ) : (
          <button
            style={styles.button}
            onClick={() => void installDictionary()}
            disabled={downloading}
          >
            {downloading
              ? "Téléchargement…"
              : "Installer le dictionnaire (~22k mots)"}
          </button>
        )}
      </div>

      <button style={styles.linkButton} onClick={() => void chrome.runtime.openOptionsPage()}>
        Options
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 240,
    padding: 16,
    fontFamily: "system-ui, -apple-system, sans-serif",
    backgroundColor: "#1e1e2e",
    color: "#cdd6f4",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: "#cba6f7",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  statsBox: {
    marginTop: 6,
  },
  statRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: 13,
  },
  statLabel: {
    color: "#94a3b8",
  },
  statValue: {
    fontWeight: 600,
  },
  dictBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #334155",
  },
  captureBox: {
    marginTop: 10,
    padding: "10px 0",
    borderTop: "1px solid #334155",
    borderBottom: "1px solid #334155",
  },
  captureButton: {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #22c55e",
    borderRadius: 6,
    background: "#166534",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  captureHint: {
    margin: "6px 0 0",
    fontSize: 10,
    color: "#94a3b8",
  },
  captureError: {
    margin: "6px 0 0",
    fontSize: 10,
    color: "#f38ba8",
    wordBreak: "break-word",
  },
  subtitleBox: {
    marginTop: 10,
    padding: "10px 0",
    borderBottom: "1px solid #334155",
  },
  localSubtitleSection: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: "1px solid #334155",
  },
  sectionLabel: {
    display: "block",
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 600,
  },
  fileButton: {
    display: "block",
    padding: "7px 10px",
    border: "1px solid #818cf8",
    borderRadius: 6,
    color: "#c7d2fe",
    fontSize: 11,
    textAlign: "center",
    cursor: "pointer",
  },
  fileName: {
    margin: "7px 0",
    color: "#a6e3a1",
    fontSize: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  offsetLabel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 11,
  },
  offsetInput: {
    width: 78,
    padding: "4px 6px",
    border: "1px solid #475569",
    borderRadius: 4,
    background: "#111827",
    color: "#fff",
  },
  localSubtitleHint: {
    margin: "6px 0 0",
    fontSize: 10,
    lineHeight: 1.35,
    color: "#94a3b8",
  },
  offsetActions: {
    display: "flex",
    gap: 4,
    marginTop: 8,
  },
  smallButton: {
    flex: 1,
    padding: "5px 3px",
    border: "1px solid #475569",
    borderRadius: 4,
    background: "#273449",
    color: "#cdd6f4",
    fontSize: 9,
    cursor: "pointer",
  },
  deleteButton: {
    width: "100%",
    marginTop: 7,
    padding: "5px 8px",
    border: "none",
    background: "transparent",
    color: "#f38ba8",
    fontSize: 10,
    cursor: "pointer",
  },
  checkLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.35,
    cursor: "pointer",
  },
  subtitleHint: {
    margin: "6px 0 0 24px",
    fontSize: 10,
    lineHeight: 1.35,
    color: "#94a3b8",
  },
  dictStatus: {
    fontSize: 12,
    color: "#94a3b8",
  },
  button: {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #3b82f6",
    borderRadius: 6,
    background: "#3b82f6",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  linkButton: {
    marginTop: 12,
    width: "100%",
    padding: "6px 12px",
    border: "1px solid #475569",
    borderRadius: 6,
    background: "transparent",
    color: "#a5b4fc",
    fontSize: 12,
    cursor: "pointer",
  },
  error: {
    marginTop: 8,
    fontSize: 11,
    color: "#f38ba8",
    wordBreak: "break-all",
  },
  onboardingBox: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 8,
    backgroundColor: "rgba(203,166,247,0.12)",
    border: "1px solid #cba6f7",
  },
  onboardingText: {
    margin: "0 0 8px",
    fontSize: 11,
    lineHeight: 1.4,
    color: "#cdd6f4",
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
