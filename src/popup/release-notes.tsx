// ---------------------------------------------------------------------------
// SubJap — Release notes in the popup
// ---------------------------------------------------------------------------
//
// After an update, what it brought, shown once. Before one, a folded notice
// that GitHub holds a newer version, with what it would bring and the
// « Mettre à jour » button when the local updater is registered.

import React, { useEffect, useState } from "react";
import {
  acknowledgeReleaseNotes,
  availableUpdateNotes,
  countChangelogItems,
  unseenReleaseNotes,
  type ChangelogGroup,
} from "@/core/changelog";
import { sendMessage } from "@/core/messaging";
import {
  UPDATE_STATE_KEY,
  UPDATE_STEP_LABELS,
  readUpdateState,
  type UpdateState,
} from "@/core/self-update";

export function ReleaseNotes(): JSX.Element | null {
  const [installed, setInstalled] = useState<ChangelogGroup[]>([]);
  const [available, setAvailable] = useState<ChangelogGroup[]>([]);
  const [updateOpen, setUpdateOpen] = useState(false);
  /** Whether the local updater answers; null until asked. */
  const [updaterAvailable, setUpdaterAvailable] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  useEffect(() => {
    void unseenReleaseNotes().then(setInstalled, () => undefined);
    void availableUpdateNotes().then(setAvailable, () => undefined);
    void chrome.storage.local.get(UPDATE_STATE_KEY).then((stored) => {
      const state = readUpdateState(stored[UPDATE_STATE_KEY]);
      setUpdateState(state);
      if (state) setUpdateOpen(true);
    }, () => undefined);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area === "local" && changes[UPDATE_STATE_KEY]) {
        setUpdateState(readUpdateState(changes[UPDATE_STATE_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const showUpdate = available.length > 0 || updateState !== null;

  useEffect(() => {
    if (!showUpdate || updaterAvailable !== null) return;
    void sendMessage("update:probe", {}).then(
      (result) => setUpdaterAvailable(result.available),
      () => setUpdaterAvailable(false),
    );
  }, [showUpdate, updaterAvailable]);

  const dismiss = (): void => {
    setInstalled([]);
    void acknowledgeReleaseNotes().catch(() => {
      // Not remembered: the notes come back at the next opening.
    });
  };

  const startUpdate = (): void => {
    setUpdateState({ status: "running", step: "pull", startedAt: Date.now() });
    void sendMessage("update:start", {}).catch((err: unknown) => {
      setUpdateState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    });
  };

  if (installed.length === 0 && !showUpdate) return null;
  const availableCount = countChangelogItems(available);
  const running = updateState?.status === "running";
  const failure = updateState?.status === "error" ? updateState.message : null;

  return (
    <>
      {installed.length > 0 && (
        <section style={styles.panel} aria-labelledby="sj-release-notes-title">
          <div style={styles.panelHeader}>
            <h2 id="sj-release-notes-title" style={styles.panelTitle}>
              Nouveautés de cette version
            </h2>
            <button type="button" style={styles.secondaryButton} onClick={dismiss}>
              OK
            </button>
          </div>
          <NoteGroups groups={installed} />
          <p style={styles.footnote}>
            Rechargez les onglets vidéo déjà ouverts pour y retrouver SubJap.
          </p>
        </section>
      )}

      {showUpdate && (
        <details
          style={styles.panel}
          open={updateOpen}
          onToggle={(event) => setUpdateOpen(event.currentTarget.open)}
        >
          <summary style={styles.updateSummary}>
            <span style={styles.updateLabel}>
              <span style={styles.updateDot} aria-hidden="true" />
              {running ? "Mise à jour en cours" : "Mise à jour disponible"}
            </span>
            <span style={styles.summaryEnd}>
              {availableCount > 0 && (
                <span style={styles.count}>
                  {availableCount} nouveauté{availableCount > 1 ? "s" : ""}
                </span>
              )}
              <span
                aria-hidden="true"
                style={{ ...styles.chevron, transform: updateOpen ? "rotate(90deg)" : "none" }}
              >
                ›
              </span>
            </span>
          </summary>
          <div style={styles.updateBody}>
            {available.length > 0 && <NoteGroups groups={available} />}
            {(updaterAvailable !== null || running) && (
              <div style={styles.updateFooter} aria-live="polite">
                {(updaterAvailable || running) && (
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    disabled={running}
                    onClick={startUpdate}
                  >
                    {updateState?.status === "running"
                      ? UPDATE_STEP_LABELS[updateState.step]
                      : failure
                        ? "Réessayer"
                        : "Mettre à jour"}
                  </button>
                )}
                {running && (
                  <p style={styles.footerNote}>
                    Vous pouvez fermer cette fenêtre : SubJap se rechargera tout seul à la fin.
                  </p>
                )}
                {failure && (
                  <p style={styles.error} role="alert">
                    {failure}
                  </p>
                )}
                {!running && (failure || updaterAvailable === false) && <ManualUpdate />}
              </div>
            )}
          </div>
        </details>
      )}
    </>
  );
}

function ManualUpdate(): JSX.Element {
  return (
    <p style={styles.footerNote}>
      Pour l’installer à la main, double-cliquez sur{" "}
      <code style={styles.code}>mettre-a-jour.cmd</code> dans le dossier de SubJap, puis
      rechargez l’extension depuis <code style={styles.code}>chrome://extensions</code>.
    </p>
  );
}

function NoteGroups(props: { groups: ChangelogGroup[] }): JSX.Element {
  return (
    <div style={styles.groups}>
      {props.groups.map((group, index) => (
        <div key={group.category} style={index > 0 ? styles.groupSpaced : undefined}>
          <h3 style={styles.category}>{group.category}</h3>
          <ul style={styles.list}>
            {group.items.map((item) => (
              <li key={item} style={styles.item}>
                <span style={styles.bullet} aria-hidden="true" />
                <span>
                  <NoteText text={item} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A changelog line, its `code` spans kept apart. */
function NoteText(props: { text: string }): JSX.Element {
  return (
    <>
      {props.text.split("`").map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} style={styles.code}>{part}</code>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

// Colours, sizes and radii come from the tokens of src/ui/theme.css.
const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginBottom: 12,
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-dense)",
    background: "var(--sj-surface)",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px 0",
  },
  panelTitle: {
    margin: 0,
    fontSize: "var(--sj-size-compact)",
    fontWeight: 600,
    lineHeight: 1.4,
  },
  secondaryButton: {
    flex: "0 0 auto",
    justifySelf: "start",
    minHeight: 28,
    padding: "4px 14px",
    border: "1px solid var(--sj-hairline)",
    borderRadius: "var(--sj-radius-control)",
    background: "var(--sj-surface-raised)",
    color: "var(--sj-text)",
    fontFamily: "inherit",
    fontSize: "var(--sj-size-label)",
    fontWeight: 500,
    cursor: "pointer",
  },
  updateSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 42,
    padding: "0 12px",
    boxSizing: "border-box",
    cursor: "pointer",
    listStyle: "none",
    fontSize: "var(--sj-size-compact)",
  },
  updateLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  updateDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--sj-accent)",
  },
  summaryEnd: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  count: {
    color: "var(--sj-muted)",
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
  updateBody: {
    borderTop: "1px solid var(--sj-hairline-soft)",
  },
  groups: {
    maxHeight: 260,
    overflowY: "auto",
    padding: "10px 12px 12px",
  },
  groupSpaced: {
    marginTop: 10,
  },
  category: {
    margin: "0 0 4px",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    fontWeight: 500,
    lineHeight: 1.35,
  },
  list: {
    display: "grid",
    gap: 5,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: "var(--sj-size-label)",
    lineHeight: 1.45,
  },
  bullet: {
    flex: "0 0 auto",
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: "var(--sj-muted)",
    transform: "translateY(-2px)",
  },
  updateFooter: {
    display: "grid",
    gap: 8,
    padding: "10px 12px 12px",
    borderTop: "1px solid var(--sj-hairline-soft)",
  },
  footerNote: {
    margin: 0,
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
  },
  footnote: {
    margin: 0,
    padding: "0 12px 12px",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
  },
  error: {
    margin: 0,
    color: "var(--sj-danger)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
    wordBreak: "break-word",
  },
  code: {
    padding: "0 4px",
    borderRadius: 4,
    background: "var(--sj-surface-raised)",
    color: "var(--sj-text)",
    fontFamily: "Consolas, \"Cascadia Mono\", monospace",
    fontSize: "0.95em",
  },
};
