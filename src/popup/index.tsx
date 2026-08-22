// ---------------------------------------------------------------------------
// SubJap — Popup entry point (React)
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendMessage } from "@/core/messaging";
import { isOnboardingComplete } from "@/onboarding";

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

  const refresh = useCallback(async () => {
    const [statsResult, dictResult, onboardedResult] = await Promise.all([
      sendMessage("stats:get", {}),
      sendMessage("dict:status", {}),
      isOnboardingComplete(),
    ]);
    setStats(statsResult);
    setDict(dictResult);
    setOnboarded(onboardedResult);
    setConnected(true);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    });

    // Opening this popup is the user's explicit invocation of the extension.
    // Use that gesture to authorize and start the rendered-tab audio buffer
    // before the next mining action; failures remain silent on non-video tabs.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs[0];
        if (tab?.id == null) return;
        return sendMessage("tabCapture:prepare", { tabId: tab.id });
      })
      .catch(() => undefined);
  }, [refresh]);

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
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Cartes</span>
            <span style={styles.statValue}>{stats.totalCards}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>À réviser</span>
            <span style={styles.statValue}>{stats.cardsDue}</span>
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
