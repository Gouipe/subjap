// ---------------------------------------------------------------------------
// SubJap — Release notes in the popup
// ---------------------------------------------------------------------------
//
// After an update, what it brought, shown once. Before one, a folded notice
// that GitHub holds a newer version, with what it would bring.

import React, { useEffect, useState } from "react";
import {
  acknowledgeReleaseNotes,
  availableUpdateNotes,
  countChangelogItems,
  unseenReleaseNotes,
  type ChangelogGroup,
} from "@/core/changelog";

export function ReleaseNotes(): JSX.Element | null {
  const [installed, setInstalled] = useState<ChangelogGroup[]>([]);
  const [available, setAvailable] = useState<ChangelogGroup[]>([]);
  const [updateOpen, setUpdateOpen] = useState(false);

  useEffect(() => {
    void unseenReleaseNotes().then(setInstalled, () => undefined);
    void availableUpdateNotes().then(setAvailable, () => undefined);
  }, []);

  const dismiss = (): void => {
    setInstalled([]);
    void acknowledgeReleaseNotes().catch(() => {
      // Not remembered: the notes come back at the next opening.
    });
  };

  if (installed.length === 0 && available.length === 0) return null;
  const availableCount = countChangelogItems(available);

  return (
    <>
      {installed.length > 0 && (
        <section style={styles.panel} aria-labelledby="sj-release-notes-title">
          <div style={styles.panelHeader}>
            <h2 id="sj-release-notes-title" style={styles.panelTitle}>
              Nouveautés de cette version
            </h2>
            <button type="button" style={styles.okButton} onClick={dismiss}>
              OK
            </button>
          </div>
          <NoteGroups groups={installed} />
        </section>
      )}

      {available.length > 0 && (
        <details
          style={styles.panel}
          open={updateOpen}
          onToggle={(event) => setUpdateOpen(event.currentTarget.open)}
        >
          <summary style={styles.updateSummary}>
            <span style={styles.updateLabel}>
              <span style={styles.updateDot} aria-hidden="true" />
              Mise à jour disponible
            </span>
            <span style={styles.summaryEnd}>
              <span style={styles.count}>
                {availableCount} nouveauté{availableCount > 1 ? "s" : ""}
              </span>
              <span
                aria-hidden="true"
                style={{ ...styles.chevron, transform: updateOpen ? "rotate(90deg)" : "none" }}
              >
                ›
              </span>
            </span>
          </summary>
          <div style={styles.updateBody}>
            <NoteGroups groups={available} />
            <p style={styles.howTo}>
              Pour l’installer, double-cliquez sur <code style={styles.code}>mettre-a-jour.cmd</code>{" "}
              dans le dossier de SubJap, puis rechargez l’extension depuis{" "}
              <code style={styles.code}>chrome://extensions</code>.
            </p>
          </div>
        </details>
      )}
    </>
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
  okButton: {
    flex: "0 0 auto",
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
  howTo: {
    margin: 0,
    padding: "10px 12px 12px",
    borderTop: "1px solid var(--sj-hairline-soft)",
    color: "var(--sj-muted)",
    fontSize: "var(--sj-size-small)",
    lineHeight: 1.45,
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
