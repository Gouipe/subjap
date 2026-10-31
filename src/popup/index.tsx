// ---------------------------------------------------------------------------
// SubJap — Popup entry point (React)
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/theme.css";
import { sendMessage } from "@/core/messaging";
import { getOptions, saveOptions } from "@/core/options";
import { isSubJapEnabled, setSubJapEnabled } from "@/core/enabled";
import type { KnownSentenceSubtitles, SecondarySubtitleLanguage } from "@/core/types";
import { isOnboardingComplete } from "@/onboarding";
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
  const [localSubtitles, setLocalSubtitles] = useState(EMPTY_LOCAL_SUBTITLES);
  const [offsetInputs, setOffsetInputs] = useState<Record<LocalSubtitleRole, string>>({
    primary: "0.00",
    secondary: "0.00",
  });
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
    setKnownSentenceSubtitles(optionsResult.knownSentenceSubtitles);
    setSecondarySubtitleLanguage(optionsResult.secondarySubtitleLanguage);
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
      const currentVideoId = hasVisibleVideo ? localSubtitleVideoId(tab.url) : null;
      setVideoId(currentVideoId);
      if (!currentVideoId) return;
      const [primary, secondary] = await Promise.all([
        getLocalSubtitle(currentVideoId, "primary"),
        getLocalSubtitle(currentVideoId, "secondary"),
      ]);
      setLocalSubtitles({ primary, secondary });
      setOffsetInputs({
        primary: (primary?.offsetSeconds ?? 0).toFixed(2),
        secondary: (secondary?.offsetSeconds ?? 0).toFixed(2),
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

  const persistOffset = useCallback(
    async (role: LocalSubtitleRole, value: number) => {
      const localSubtitle = localSubtitles[role];
      if (!videoId || !localSubtitle || !Number.isFinite(value)) return;
      const rounded = Math.round(value * 100) / 100;
      const next = { ...localSubtitle, offsetSeconds: rounded };
      setLocalSubtitles((current) => ({ ...current, [role]: next }));
      setOffsetInputs((current) => ({ ...current, [role]: rounded.toFixed(2) }));
      setLocalSubtitleBusy(true);
      setLocalSubtitleError(null);
      try {
        await saveLocalSubtitle(videoId, next, role);
      } catch (err: unknown) {
        setLocalSubtitleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLocalSubtitleBusy(false);
      }
    },
    [localSubtitles, videoId],
  );

  const deleteLocalSubtitle = useCallback(async (role: LocalSubtitleRole) => {
    if (!videoId) return;
    setLocalSubtitleBusy(true);
    setLocalSubtitleError(null);
    try {
      await removeLocalSubtitle(videoId, role);
      setLocalSubtitles((current) => ({ ...current, [role]: null }));
      setOffsetInputs((current) => ({ ...current, [role]: "0.00" }));
    } catch (err: unknown) {
      setLocalSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalSubtitleBusy(false);
    }
  }, [videoId]);

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
        <span style={styles.connectionStatus}>
          <span
            style={{
              ...styles.dot,
              backgroundColor:
                connected === null
                  ? "#f1b46d"
                  : connected
                    ? "#78d6a3"
                    : "#ff8490",
            }}
          />
          {connected === null ? "Connexion" : connected ? "Prêt" : "Hors ligne"}
        </span>
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
        <p style={styles.captureHint}>À faire une seule fois par onglet vidéo.</p>
      </div>

      <div style={styles.subtitleBox}>
        {videoId?.startsWith("youtube:") && (
          <p style={styles.captureHint}>
            YouTube : sous-titres japonais du créateur en priorité, automatiques en repli.
          </p>
        )}

        <div style={styles.languageSection}>
          <div style={styles.languageRow}>
            <span>Principal</span>
            <strong>Japonais</strong>
          </div>
          <label style={styles.languageRow}>
            <span>Secondaire</span>
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
              <option value="none">Aucun</option>
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
            </select>
          </label>
          <p style={styles.languageHint}>
            L’autre langue est utilisée automatiquement si nécessaire, sauf avec « Aucun ».
          </p>
        </div>
        <div>
          <label style={styles.languageRow}>
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
          <p style={styles.languageHint}>
            Phrase dont tous les mots sont connus ou ignorés. Survol ou X pour
            révéler : le japonais d’abord, puis la traduction.
          </p>
        </div>
      </div>

      <details style={styles.disclosureSection}>
        <summary style={styles.localSubtitleSummary}>Sous-titres locaux</summary>
        <div style={styles.localSubtitleContent}>
          {videoId ? (
            LOCAL_SUBTITLE_ROLES.map((role) => {
              const localSubtitle = localSubtitles[role];
              const roleTitle = role === "primary"
                ? "Piste principale · japonais"
                : "Piste secondaire · traduction";
              const roleHint = role === "primary"
                ? "Traitée comme du japonais ; sur Netflix et YouTube, elle remplace la piste japonaise native."
                : "Affichée avec le japonais ; sur Netflix et YouTube, elle remplace la traduction native.";
              return (
                <div key={role} style={styles.localSubtitleTrack}>
                  <span style={styles.localSubtitleRole}>{roleTitle}</span>
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
                        void importLocalSubtitle(role, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <p style={styles.localSubtitleHint}>{roleHint}</p>
                  {localSubtitle && (
                    <>
                      <p style={styles.fileName}>{localSubtitle.fileName}</p>
                      <label style={styles.offsetLabel}>
                        <span>Décalage (s)</span>
                        <input
                          style={styles.offsetInput}
                          type="number"
                          step="0.01"
                          value={offsetInputs[role]}
                          disabled={localSubtitleBusy}
                          onChange={(event) => setOffsetInputs((current) => ({
                            ...current,
                            [role]: event.target.value,
                          }))}
                          onBlur={() => void persistOffset(
                            role,
                            Number(offsetInputs[role].replace(",", ".")),
                          )}
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
                          onClick={() => void persistOffset(role, localSubtitle.offsetSeconds - 0.1)}
                        >
                          − 0,1 s
                        </button>
                        <button
                          style={styles.smallButton}
                          disabled={localSubtitleBusy}
                          onClick={() => void persistOffset(role, localSubtitle.offsetSeconds + 0.1)}
                        >
                          + 0,1 s
                        </button>
                        <button
                          style={styles.smallButton}
                          disabled={localSubtitleBusy}
                          onClick={() => void persistOffset(role, 0)}
                        >
                          Réinitialiser
                        </button>
                      </div>
                      <button
                        style={styles.deleteButton}
                        disabled={localSubtitleBusy}
                        onClick={() => void deleteLocalSubtitle(role)}
                      >
                        Supprimer la piste
                      </button>
                    </>
                  )}
                </div>
              );
            })
          ) : (
            <p style={styles.localSubtitleHint}>
              Ouvre une page avec un lecteur vidéo HTML5 visible. Les fichiers sont associés à son adresse.
            </p>
          )}
          {localSubtitleError && <p style={styles.captureError}>{localSubtitleError}</p>}
        </div>
      </details>

      <details style={styles.disclosureSection}>
        <summary style={styles.guideSummary}>Comprendre les couleurs et les raccourcis</summary>
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
        </div>
      </details>

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

      {!dict?.installed && dict !== null && (
        <div style={styles.dictBox}>
          <button
            style={styles.button}
            onClick={() => void installDictionary()}
            disabled={downloading}
          >
            {downloading
              ? "Téléchargement…"
              : "Installer le dictionnaire (~22k mots)"}
          </button>
        </div>
      )}

      <button style={styles.linkButton} onClick={() => void chrome.runtime.openOptionsPage()}>
        Options
      </button>
      </>)}
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
    color: "#b2b6bf",
  },
  statValue: {
    fontWeight: 600,
  },
  dictBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #343842",
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
    padding: "8px 10px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#14161b",
    color: "#f4f1ea",
    fontFamily: "inherit",
    fontSize: 12,
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
    padding: "10px 0",
    borderTop: "1px solid #343842",
    borderBottom: "1px solid #343842",
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
  subtitleBox: {
    marginTop: 10,
    padding: "10px 0",
    borderBottom: "1px solid #343842",
  },
  disclosureSection: {
    padding: "8px 0",
    borderBottom: "1px solid #343842",
  },
  localSubtitleSummary: {
    color: "#f4f1ea",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  localSubtitleContent: {
    paddingTop: 4,
  },
  localSubtitleTrack: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid #343842",
  },
  localSubtitleRole: {
    display: "block",
    marginBottom: 6,
    fontSize: 11,
    fontWeight: 600,
  },
  languageSection: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: "1px solid #343842",
  },
  languageRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 7,
    fontSize: 11,
  },
  languageSelect: {
    minWidth: 96,
    padding: "4px 6px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#101216",
    color: "#f4f1ea",
    fontSize: 11,
  },
  languageHint: {
    margin: 0,
    color: "#b2b6bf",
    fontSize: 10,
    lineHeight: 1.35,
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
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontSize: 11,
    textAlign: "center",
    cursor: "pointer",
  },
  fileName: {
    margin: "7px 0",
    color: "#78d6a3",
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
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#101216",
    color: "#f4f1ea",
  },
  localSubtitleHint: {
    margin: "6px 0 0",
    fontSize: 10,
    lineHeight: 1.35,
    color: "#b2b6bf",
  },
  offsetActions: {
    display: "flex",
    gap: 4,
    marginTop: 8,
  },
  smallButton: {
    flex: 1,
    padding: "5px 3px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "#1b1e24",
    color: "#f4f1ea",
    fontSize: 9,
    cursor: "pointer",
  },
  deleteButton: {
    width: "100%",
    marginTop: 7,
    padding: "5px 8px",
    border: "none",
    background: "transparent",
    color: "#ff8490",
    fontSize: 10,
    cursor: "pointer",
  },
  guideSummary: {
    color: "#f4f1ea",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.4,
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
  linkButton: {
    marginTop: 12,
    width: "100%",
    padding: "6px 12px",
    border: "1px solid #343842",
    borderRadius: 6,
    background: "transparent",
    color: "#f4f1ea",
    fontSize: 12,
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
