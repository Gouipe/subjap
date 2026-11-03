// ---------------------------------------------------------------------------
// SubJap — Options page (React)
//
// Two modes:
//   • Onboarding wizard (4 setup steps, 5 explanation slides) when the user hasn't completed setup yet —
//     the service worker opens this page on first install.
//   • Full settings panel once onboarding is complete: dictionary, Anki,
//     overlay display options and data management.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/theme.css";
import { sendMessage } from "@/core/messaging";
import {
  getOptions,
  saveOptions,
  DEFAULT_OPTIONS,
  SUBTITLE_HEIGHT_RATIO,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
} from "@/core/options";
import {
  DEFAULT_ENRICHMENT_PROMPT,
  getAiSettings,
  saveAiSettings,
} from "@/core/ai-settings";
import { JMDICT_PACKS } from "@/dictionary/jmdict";
import type { JmdictPack } from "@/dictionary/jmdict";
import {
  getOnboardingState,
  saveOnboardingState,
  completeDictionaryStep,
  completeAnkiStep,
  skipAnkiStep,
  completeOptionsStep,
  completeKnownWordsStep,
  resetOnboarding,
} from "@/onboarding";
import type { OnboardingState } from "@/onboarding";
import type { KnownTriageBatch, OverlayOptions } from "@/core/types";
import { getJimakuApiKey, saveJimakuApiKey } from "@/subtitles/jimaku";

interface DictStatus {
  count: number;
  installed: boolean;
}

interface AnkiStatus {
  connected: boolean;
  deckNames: string[];
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const C = {
  bg: "#0c0d10",
  panel: "#14161b",
  panelRaised: "#1b1e24",
  panelBorder: "#343842",
  text: "#f4f1ea",
  muted: "#b2b6bf",
  accent: "#ff624d",
  blue: "#ff624d",
  green: "#78d6a3",
  red: "#ff8490",
  amber: "#f1b46d",
  priorityBlue: "#55b8ff",
  unknownGrey: "#9ca1aa",
};

/** Target word colour of the mining dialog (its accent hover tone). */
const MOCK_TARGET = "#ff7966";

/** Video-tab shortcuts shown at the end of onboarding (see README). */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["Q", "sous-titre précédent"],
  ["S", "rejouer le sous-titre"],
  ["D", "sous-titre suivant"],
  ["C", "copier le japonais"],
  ["X", "révéler la traduction masquée"],
];

/** Sample subtitle of the size preview: an unknown name, a word to mine. */
const PREVIEW_TOKENS: ReadonlyArray<{
  text: string;
  reading?: string;
  color?: string;
  underline?: boolean;
}> = [
  { text: "小雪", reading: "こゆき", color: C.unknownGrey },
  { text: "ちゃん" },
  { text: "、" },
  { text: "何", reading: "なに" },
  { text: "が" },
  { text: "怖い", reading: "こわい", color: C.green, underline: true },
  { text: "の" },
  { text: "？" },
];

/**
 * A miniature 16:9 player with one subtitle, sized like the overlay:
 * container query units keep the subtitle proportional to the frame.
 */
function SubtitlePreview(props: { scale: number; showFurigana: boolean }): JSX.Element {
  const fontSize = `${(SUBTITLE_HEIGHT_RATIO * props.scale).toFixed(2)}cqh`;
  return (
    <div style={s.preview} aria-label="Aperçu de la taille des sous-titres" role="img">
      <div style={{ ...s.previewSubtitles, fontSize }}>
        <div style={s.previewJapanese}>
          {PREVIEW_TOKENS.map((token, index) => (
            <span
              key={index}
              style={{
                ...s.previewToken,
                color: token.color ?? "#ffffff",
                borderBottomColor: token.underline ? "currentColor" : "transparent",
              }}
            >
              {props.showFurigana && token.reading && (
                <span style={s.previewFurigana}>{token.reading}</span>
              )}
              {token.text}
            </span>
          ))}
        </div>
        <div style={s.previewTranslation}>Koyuki, de quoi as-tu peur ?</div>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode; id?: string }): JSX.Element {
  return (
    <section style={s.section} id={props.id}>
      <h2 style={s.sectionTitle}>{props.title}</h2>
      {props.children}
    </section>
  );
}

/**
 * Jimaku API key: lets SubJap install the Japanese subtitles of anime
 * videos that have none. Opened from the video notice at #jimaku.
 */
function JimakuSettings(): JSX.Element {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getJimakuApiKey().then((value) => {
      setKey(value);
      setSaved(value);
      // Opened from the video notice: go straight to the field, once the
      // sections above have their final height.
      if (location.hash === "#jimaku") {
        setTimeout(() => {
          input.current?.scrollIntoView({ block: "center" });
          input.current?.focus({ preventScroll: true });
        }, 300);
      }
    });
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const trimmed = key.trim();
      if (trimmed && !(await sendMessage("jimaku:check", { key: trimmed })).valid) {
        setNote({ ok: false, text: "Clé refusée par Jimaku. Vérifiez-la sur votre page de compte." });
        return;
      }
      await saveJimakuApiKey(trimmed);
      setSaved(trimmed);
      setNote({
        ok: true,
        text: trimmed
          ? "Clé enregistrée : les sous-titres japonais manquants seront installés automatiquement."
          : "Clé retirée : l’installation automatique est désactivée.",
      });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [key]);

  return (
    <Section title="Sous-titres japonais (Jimaku)" id="jimaku">
      <p style={s.muted}>
        Quand une vidéo d’anime (Re:ANIME…) n’a pas de sous-titres japonais, SubJap
        peut les installer depuis Jimaku. Créez un compte gratuit sur{" "}
        <a href="https://jimaku.cc/login" target="_blank" rel="noreferrer" style={s.link}>jimaku.cc</a>,
        puis copiez la clé API depuis votre{" "}
        <a href="https://jimaku.cc/account" target="_blank" rel="noreferrer" style={s.link}>page de compte</a>.
      </p>
      <Row label="Clé API Jimaku">
        <input
          ref={input}
          type="password"
          value={key}
          placeholder="Collez la clé ici"
          autoComplete="off"
          spellCheck={false}
          style={s.input}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <Btn onClick={() => void save()} disabled={busy || key.trim() === saved}>
          {busy ? "Vérification…" : "Enregistrer"}
        </Btn>
      </Row>
      {note && <p style={{ ...s.mutedSmall, color: note.ok ? C.green : C.red }}>{note.text}</p>}
    </Section>
  );
}

function Row(props: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return (
    <div style={s.row}>
      <div style={s.rowLabel}>
        <span>{props.label}</span>
        {props.hint && <span style={s.rowHint}>{props.hint}</span>}
      </div>
      <div style={s.rowControl}>{props.children}</div>
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label style={s.toggleWrap}>
      <input
        type="checkbox"
        style={s.toggle}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span
        style={{
          ...s.toggleTrack,
          backgroundColor: props.checked ? C.accent : C.panelBorder,
        }}
      >
        <span
          style={{
            ...s.toggleThumb,
            transform: props.checked ? "translateX(18px)" : "translateX(2px)",
          }}
        />
      </span>
    </label>
  );
}

function Btn(props: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
  style?: React.CSSProperties;
}): JSX.Element {
  const variant =
    props.variant === "danger"
      ? s.btnDanger
      : props.variant === "ghost"
        ? s.btnGhost
        : s.btnPrimary;
  return (
    <button
      style={{ ...s.btn, ...variant, ...(props.style ?? {}) }}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App root: decide between onboarding wizard and settings panel
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [forceOptions, setForceOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const o = await getOnboardingState();
    setOnboarding(o);
  }, []);

  useEffect(() => {
    void refresh().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [refresh]);

  /** Reset onboarding state so the 3-step wizard shows again. */
  const startOnboarding = useCallback(async () => {
    setError(null);
    try {
      await resetOnboarding();
      await refresh();
      setForceOptions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  if (error) {
    return (
      <Page>
        <div style={{ color: C.red }}>Erreur : {error}</div>
      </Page>
    );
  }

  if (onboarding === null) {
    return (
      <Page>
        <div style={s.muted}>Chargement…</div>
      </Page>
    );
  }

  if (!onboarding.completed && !forceOptions) {
    return (
      <OnboardingWizard
        state={onboarding}
        setState={setOnboarding}
        onFinished={() => setForceOptions(true)}
      />
    );
  }

  return <SettingsPanel onStartOnboarding={() => void startOnboarding()} />;
};

function Page(props: { children: React.ReactNode; maxWidth?: number }): JSX.Element {
  return <div style={{ ...s.page, maxWidth: props.maxWidth ?? 720 }}>{props.children}</div>;
}

function Header(props: { children?: React.ReactNode }): JSX.Element {
  return (
    <header style={s.header}>
      <div style={s.brandLockup}>
        <span style={s.brandMark} aria-hidden="true">字</span>
        <div>
          <h1 style={s.logo}>SubJap</h1>
          <p style={s.tagline}>Du japonais vécu à l’écran au japonais retenu.</p>
        </div>
      </div>
      {props.children}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Words already known: triage of the frequency list, batch after batch
// ---------------------------------------------------------------------------

/** Below this share of checked words, the learner is nearing their level. */
const KNOWN_TRIAGE_LEVEL_HINT_RATIO = 0.3;

function KnownWordsTriage(props: {
  /** Onboarding: ends the wizard, after saving the current batch or skipping. */
  onFinish?: () => void;
}): JSX.Element {
  const [batch, setBatch] = useState<KnownTriageBatch | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [status, setStatus] = useState<"syncing" | "loading" | "ready" | "saving">("syncing");
  const [validated, setValidated] = useState(0);
  const [nearLevel, setNearLevel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const loadBatch = useCallback(async () => {
    setStatus("loading");
    const next = await sendMessage("knownTriage:batch", {});
    setBatch(next);
    setChecked(new Set(next.items.map((item) => item.key)));
    setFocused(null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    void (async () => {
      // Words already acquired in Anki must not be offered.
      try {
        if ((await sendMessage("anki:status", {})).connected) {
          await sendMessage("anki:syncKnown", {});
        }
      } catch (err) {
        console.info("[SubJap] Anki sync before known-word triage unavailable:", err);
      }
      await loadBatch();
      // Opened from the popup link.
      if (location.hash === "#mots-connus") {
        setTimeout(() => container.current?.parentElement?.scrollIntoView({ block: "start" }), 300);
      }
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("ready");
    });
  }, [loadBatch]);

  const commit = useCallback(async () => {
    if (!batch) return;
    const known = batch.items.filter((item) => checked.has(item.key));
    await sendMessage("knownTriage:commit", {
      keys: known.flatMap((item) => [item.key, ...(item.alsoKeys ?? [])]),
      throughRank: batch.throughRank,
    });
    setValidated((count) => count + 1);
    setNearLevel(known.length < batch.items.length * KNOWN_TRIAGE_LEVEL_HINT_RATIO);
  }, [batch, checked]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setStatus("saving");
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("ready");
    }
  }, []);

  const toggle = (key: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const items = batch?.items ?? [];
  const allChecked = items.length > 0 && items.every((item) => checked.has(item.key));
  const busy = status !== "ready";

  return (
    <div ref={container}>
      {error && <div style={s.errorBox}>{error}</div>}
      {status === "syncing" ? (
        <p style={s.muted}>Synchronisation avec Anki…</p>
      ) : batch === null ? (
        <p style={s.muted}>Chargement…</p>
      ) : (
        <>
          {nearLevel && items.length > 0 && (
            <div style={s.noticeBox}>
              Vous approchez de votre niveau : la suite se fera en regardant.
            </div>
          )}
          {items.length === 0 ? (
            <p style={s.muted}>Toute la liste de fréquence a été triée.</p>
          ) : (
            <>
              <div style={s.triageHeader}>
                <span style={s.triageProgress}>
                  Les {items.length} mots les plus fréquents pas encore marqués comme connus
                </span>
                <button
                  type="button"
                  style={s.textLink}
                  onClick={() =>
                    setChecked(allChecked ? new Set() : new Set(items.map((item) => item.key)))
                  }
                  disabled={busy}
                >
                  {allChecked ? "Tout décocher" : "Tout cocher"}
                </button>
              </div>
              <div style={s.triageList} onMouseLeave={() => setFocused(null)}>
                {items.map((item) => {
                  const known = checked.has(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="checkbox"
                      aria-checked={known}
                      style={{
                        ...s.triageRow,
                        ...(known ? s.triageRowKnown : s.triageRowUnknown),
                      }}
                      onClick={() => toggle(item.key)}
                      onMouseEnter={() => setFocused(item.key)}
                      onFocus={() => setFocused(item.key)}
                      onBlur={() => setFocused(null)}
                    >
                      <span
                        aria-hidden="true"
                        style={{ ...s.triageBox, ...(known ? s.triageBoxChecked : {}) }}
                      >
                        {known ? "✓" : ""}
                      </span>
                      <span style={s.triageWord}>{item.key}</span>
                      <span style={s.triageReading}>{item.reading ?? ""}</span>
                      <span style={s.triageMeaning}>
                        {focused === item.key ? item.meaning ?? "pas de définition" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div style={s.btnRow}>
            {items.length > 0 && (
              <Btn
                onClick={() =>
                  void run(async () => {
                    await commit();
                    await loadBatch();
                  })
                }
                disabled={busy}
              >
                {status === "saving" ? "Enregistrement…" : "Valider et passer au lot suivant →"}
              </Btn>
            )}
            {props.onFinish && (
              <Btn
                variant={items.length > 0 ? "ghost" : "primary"}
                onClick={() =>
                  void run(async () => {
                    if (items.length > 0) await commit();
                    props.onFinish?.();
                  })
                }
                disabled={busy}
              >
                {items.length > 0 ? "Valider et terminer ✓" : "Terminer ✓"}
              </Btn>
            )}
          </div>
          {props.onFinish && validated === 0 && items.length > 0 && (
            <button
              type="button"
              style={{ ...s.textLink, ...s.skipLink }}
              onClick={props.onFinish}
              disabled={busy}
            >
              Passer sans enregistrer
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding wizard: stepper and mining-screen preview
// ---------------------------------------------------------------------------

const WIZARD_STEP_GROUPS: ReadonlyArray<{ label: string; steps: number[] }> = [
  { label: "Configuration", steps: [1, 2, 3, 4] },
  { label: "Découverte", steps: [5, 6, 7, 8, 9] },
];

/** Progress through the 4 setup steps, then the 5 explanation slides. */
function WizardStepper(props: { current: number }): JSX.Element {
  return (
    <div style={s.stepper} aria-label={`Étape ${props.current} sur 9`}>
      {WIZARD_STEP_GROUPS.map((group, groupIndex) => (
        <React.Fragment key={group.label}>
          {groupIndex > 0 && <div style={s.stepGroupSeparator} aria-hidden="true" />}
          <div style={{ ...s.stepGroup, flex: group.steps.length }}>
            <span style={s.stepGroupLabel}>{group.label}</span>
            <div style={s.stepGroupDots}>
              {group.steps.map((n, index) => (
                <React.Fragment key={n}>
                  <div
                    style={{
                      ...s.stepDot,
                      backgroundColor: props.current >= n ? C.accent : C.panelBorder,
                    }}
                    aria-current={props.current === n ? "step" : undefined}
                  >
                    {n}
                  </div>
                  {index < group.steps.length - 1 && <div style={s.stepLine} />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

const MINING_CALLOUTS: ReadonlyArray<readonly [string, React.ReactNode]> = [
  ["Corriger au clic", "le mot, la lecture, la phrase et la traduction se modifient directement"],
  ["Sens", "cochez celui qui correspond à la scène"],
  [
    "Scène",
    <>
      image et audio sont capturés automatiquement ; <MockKbd>Q</MockKbd> réécoute la phrase
    </>,
  ],
  [
    "IA (facultatif)",
    <>
      <MockKbd>I</MockKbd> ajoute la décomposition des kanjis, des synonymes et une association,
      si l’IA est configurée dans les réglages
    </>,
  ],
  [
    "Créer",
    <>
      <MockKbd>Ctrl+Entrée</MockKbd> envoie la carte dans Anki ; <MockKbd>Échap</MockKbd> ne
      ferme jamais la fenêtre, seule la croix ✕ la ferme
    </>,
  ],
];

const ANKI_CALLOUTS: ReadonlyArray<readonly [string, React.ReactNode]> = [
  ["Recto", "retrouvez le sens du mot, puis retournez la carte"],
  ["Verso", "le sens retenu au minage, puis la scène et vos notes"],
  [
    "Production orale (facultatif)",
    "crée une carte sœur où il faut dire le mot à voix haute à partir de ses définitions ; à réserver aux mots utiles à l’oral, de préférence déjà bien acquis",
  ],
  [
    "Raccourcis",
    <>
      <MockKbd>Q</MockKbd> rejoue la phrase (▶ au bout de la phrase), <MockKbd>W</MockKbd> (ou un clic) défloute la traduction
    </>,
  ],
  [
    "Notation au clavier",
    <>
      <MockKbd>&amp;</MockKbd> À revoir · <MockKbd>é</MockKbd> Difficile ·{" "}
      <MockKbd>&quot;</MockKbd> Correct · <MockKbd>&apos;</MockKbd> Facile
    </>,
  ],
];

function Callout(props: { n: number }): JSX.Element {
  return (
    <span style={s.callout} aria-hidden="true">
      {props.n}
    </span>
  );
}

/** Numbered explanations matching the callouts of a mock-up. */
function CalloutList(props: {
  items: ReadonlyArray<readonly [string, React.ReactNode]>;
}): JSX.Element {
  return (
    <ol style={s.calloutList}>
      {props.items.map(([title, text], index) => (
        <li key={title} style={s.calloutItem}>
          <Callout n={index + 1} />
          <div>
            <span style={s.lifecycleTitle}>{title}</span>
            <span style={s.legendText}> · {text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Static, simplified replica of a comprehension card, front then back. */
function AnkiCardPreview(): JSX.Element {
  return (
    <div style={s.mock} role="img" aria-label="Aperçu d’une carte Anki, recto puis verso">
      <span style={s.mockLabel}>RECTO</span>
      <div style={{ ...s.mockSheet, ...s.mockFront }}>
        <span style={{ ...s.mockWord, color: C.text }}>大切</span>
        <span style={s.mockReading}>たいせつ</span>
        <span style={s.mockCornerCallout}>
          <Callout n={1} />
        </span>
      </div>

      <span style={s.mockLabel}>VERSO</span>
      <div style={s.mockSheet}>
        <div style={{ ...s.mockRow, justifyContent: "space-between" }}>
          <span style={s.mockWord}>大切</span>
          <span style={s.mockRow}>
            <span style={s.mockButton}>Activer la production orale</span>
            <Callout n={3} />
          </span>
        </div>
        <div style={{ ...s.mockRow, marginTop: 6 }}>
          <span>important · precious · valuable</span>
          <Callout n={2} />
        </div>
      </div>
      <div style={s.mockSheet}>
        <div style={{ ...s.mockImage, aspectRatio: "auto", height: 48 }}>Image de la scène</div>
        <div style={{ ...s.mockRow, ...s.mockSentence, marginTop: 6 }}>
          <span>
            これは<span style={{ color: MOCK_TARGET, fontWeight: 600 }}>大切</span>な本だ
          </span>
          <span style={{ ...s.mockButton, gap: 4, padding: "2px 4px", borderRadius: 999, fontSize: 12 }}>
            <span style={s.mockPlay}>▶</span>
            <MockKbd>Q</MockKbd>
          </span>
          <Callout n={4} />
        </div>
        <div style={{ ...s.mockRow, marginTop: 4 }}>
          <span style={{ ...s.mockTranslation, filter: "blur(3px)" }}>C’est un livre précieux.</span>
          <MockKbd>W</MockKbd>
        </div>
      </div>
      <div style={{ ...s.mockSheet, ...s.mockRow }}>
        <span style={s.mockLabel}>Notes</span>
        <span style={s.mockTranslation}>…</span>
      </div>

      <div style={{ ...s.mockFooter, justifyContent: "center", flexWrap: "wrap" }}>
        <span style={s.mockButton}>
          À revoir <MockKbd>&amp;</MockKbd>
        </span>
        <span style={s.mockButton}>
          Difficile <MockKbd>é</MockKbd>
        </span>
        <span style={s.mockButton}>
          Correct <MockKbd>&quot;</MockKbd>
        </span>
        <span style={s.mockButton}>
          Facile <MockKbd>&apos;</MockKbd>
        </span>
        <Callout n={5} />
      </div>
    </div>
  );
}

function MockKbd(props: { children: React.ReactNode; onAccent?: boolean }): JSX.Element {
  return (
    <span
      style={{
        ...s.mockKbd,
        ...(props.onAccent ? { borderColor: "rgba(12,13,16,0.35)", color: C.bg } : {}),
      }}
    >
      {props.children}
    </span>
  );
}

/** A player frame: hovering a subtitle word opens its popover with « Miner ». */
function MinePreview(): JSX.Element {
  return (
    <div
      style={s.minePlayer}
      role="img"
      aria-label="Aperçu : survol d’un mot du sous-titre et bouton Miner"
    >
      <div style={s.minePopover}>
        <div style={s.mockRow}>
          <span style={{ ...s.mockWord, color: C.text, fontSize: 22 }}>怖い</span>
          <span style={s.mockReading}>こわい</span>
        </div>
        <div style={{ ...s.mockTranslation, marginTop: 4 }}>scary · frightening</div>
        <div style={s.minePopoverActions}>
          <span style={s.minePopoverBtn}>Connu</span>
          <span style={s.minePopoverBtn}>Ignorer</span>
          <span style={{ ...s.minePopoverBtn, ...s.mockSend, padding: "4px 8px" }}>⛏ Miner</span>
          <span style={{ ...s.minePopoverBtn, borderColor: C.accent }}>Plus tard</span>
        </div>
      </div>
      <div style={s.mineSubtitle}>
        小雪ちゃん、何が
        <span style={s.mineTarget}>
          怖い
          <span style={s.mineCursor} aria-hidden="true">
            ↖
          </span>
        </span>
        の？
      </div>
    </div>
  );
}

/** Static, simplified replica of the « Créer une carte » dialog with numbered callouts. */
function MiningPreview(): JSX.Element {
  return (
    <div style={s.mock} role="img" aria-label="Aperçu de l’écran Créer une carte">
      <div style={s.mockHeader}>
        <span>
          <span style={s.mockTitle}>Créer une carte</span>
          <span style={s.mockSource}>Mon anime · épisode 3</span>
        </span>
        <span style={s.mockSource}>✕</span>
      </div>

      <div style={s.mockSheet}>
        <div style={s.mockRow}>
          <span style={s.mockWord}>大切</span>
          <span style={s.mockReading}>たいせつ</span>
          <Callout n={1} />
        </div>
        <div style={{ ...s.mockRow, ...s.mockDefinitions }}>
          <span style={s.mockSense}>✓ important · precious · valuable</span>
          <span style={{ ...s.mockSense, ...s.mockSenseOff }}>careful</span>
          <Callout n={2} />
        </div>
      </div>

      <div style={{ ...s.mockSheet, ...s.mockScene }}>
        <div style={s.mockImage}>Image de la scène</div>
        <div>
          <div style={s.mockSentence}>
            これは<span style={{ color: MOCK_TARGET, fontWeight: 600 }}>大切</span>な本だ
          </div>
          <div style={{ ...s.mockRow, margin: "6px 0" }}>
            <span style={s.mockButton}>
              ▶ Phrase <MockKbd>Q</MockKbd>
            </span>
            <Callout n={3} />
          </div>
          <div style={s.mockTranslation}>C’est un livre précieux.</div>
        </div>
      </div>

      <div style={{ ...s.mockSheet, ...s.mockRow, justifyContent: "space-between" }}>
        <span style={s.mockLabel}>Notes</span>
        <span style={s.mockRow}>
          <span style={s.mockButton}>
            ✨ Enrichir avec l’IA <MockKbd>I</MockKbd>
          </span>
          <Callout n={4} />
        </span>
      </div>

      <div style={s.mockFooter}>
        <span style={{ ...s.mockButton, ...s.mockSend }}>
          Créer dans Anki <MockKbd onAccent>Ctrl+Entrée</MockKbd>
        </span>
        <Callout n={5} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding wizard (4 setup steps, then 5 explanation slides)
// ---------------------------------------------------------------------------

function OnboardingWizard(props: {
  state: OnboardingState;
  setState: React.Dispatch<React.SetStateAction<OnboardingState | null>>;
  onFinished: () => void;
}): JSX.Element {
  const { state } = props;
  const [dict, setDict] = useState<DictStatus | null>(null);
  const [anki, setAnki] = useState<AnkiStatus | null>(null);
  const [options, setOptions] = useState<OverlayOptions>(DEFAULT_OPTIONS);
  const [downloading, setDownloading] = useState(false);
  const [checkingAnki, setCheckingAnki] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Explanation screens shown once the four steps are done. */
  const [endScreen, setEndScreen] = useState<"colors" | "mine" | "mining" | "anki" | "ready" | null>(null);

  const step = Math.min(state.currentStep + 1, 4);

  const refreshStatus = useCallback(async () => {
    try {
      const [d, a, o] = await Promise.all([
        sendMessage("dict:status", {}),
        sendMessage("anki:status", {}),
        getOptions(),
      ]);
      setDict(d);
      setAnki(a);
      setOptions(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const advanceTo = useCallback(
    async (nextStep: number) => {
      const next = { ...props.state, currentStep: nextStep };
      props.setState(next);
      await saveOnboardingState(next);
    },
    [props],
  );

  const installDictionary = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const result = await sendMessage("dict:download", {});
      if (!result || typeof result.count !== "number") {
        throw new Error("Réponse invalide du service worker");
      }
      setDict({ count: result.count, installed: true });
      await completeDictionaryStep();
      await advanceTo(1);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [advanceTo, refreshStatus]);

  const checkAnki = useCallback(async () => {
    setCheckingAnki(true);
    setError(null);
    try {
      const ok = await completeAnkiStep();
      const status = await sendMessage("anki:status", {});
      setAnki(status);
      if (ok) await advanceTo(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingAnki(false);
    }
  }, [advanceTo]);

  const saveDisplayOptions = useCallback(async () => {
    setError(null);
    try {
      await completeOptionsStep(options);
      await advanceTo(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [advanceTo, options]);

  const finish = useCallback(async () => {
    setError(null);
    try {
      await completeKnownWordsStep();
      setAnki(await sendMessage("anki:status", {}));
      setEndScreen("colors");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const strong = (text: string): JSX.Element => (
    <strong style={{ color: C.text }}>{text}</strong>
  );

  if (endScreen === "colors") {
    return (
      <Page maxWidth={560}>
        <Header />
        <WizardStepper current={5} />
        <div style={s.card}>
          <h2 style={s.cardTitle}>5 · Les couleurs des mots</h2>

          <div style={s.lifecycle}>
            <span style={{ ...s.legendWord, color: C.unknownGrey }}>単語</span>
            <div>
              <div style={s.lifecycleTitle}>Inconnu</div>
              <div style={s.legendText}>
                Y compris un mot miné dont vous n’avez pas encore étudié la carte dans Anki.
              </div>
            </div>

            <span style={{ ...s.legendWord, color: C.green, borderBottomColor: C.green }}>
              単語
            </span>
            <div>
              <div style={s.lifecycleTitle}>À miner, très fréquent</div>
              <div style={s.legendText}>
                Son rang de fréquence est inférieur à votre nombre de mots connus.
              </div>
            </div>

            <span
              style={{ ...s.legendWord, color: C.priorityBlue, borderBottomColor: C.priorityBlue }}
            >
              単語
            </span>
            <div>
              <div style={s.lifecycleTitle}>À miner, un peu moins fréquent</div>
              <div style={s.legendText}>
                Il fait partie des 300 mots suivants de la liste de fréquence.
              </div>
            </div>

            <span
              style={{
                ...s.legendWord,
                color: C.text,
                borderBottom: "3px dotted rgba(255, 255, 255, 0.9)",
              }}
            >
              単語
            </span>
            <div>
              <div style={s.lifecycleTitle}>En cours</div>
              <div style={s.legendText}>
                Carte Anki étudiée, pas encore mûre (moins de 21 jours). Désactivable dans les
                réglages.
              </div>
            </div>

            <span style={{ ...s.legendWord, color: C.text }}>単語</span>
            <div>
              <div style={s.lifecycleTitle}>Mot connu</div>
            </div>
          </div>

          <p style={s.mutedSmall}>
            Le vert et le bleu n’apparaissent que si c’est le seul mot inconnu de la phrase.
          </p>

          <p style={s.mutedSmall}>
            {strong("Connu")} rend un mot blanc tout de suite, sans carte. {strong("Ignorer")}{" "}
            fait de même pour les noms propres ou les onomatopées.
          </p>

          {!anki?.connected && (
            <div style={s.warningBox}>
              Anki n’est pas connecté : {strong("Miner")} ne crée pas de carte à réviser, donc
              aucun mot ne devient acquis par ce chemin. Utilisez {strong("Connu")}, ou
              connectez Anki dans les réglages.
            </div>
          )}

          <div style={s.btnRow}>
            <Btn onClick={() => setEndScreen("mine")}>Continuer →</Btn>
          </div>
        </div>
      </Page>
    );
  }

  if (endScreen === "mine") {
    return (
      <Page maxWidth={560}>
        <Header />
        <WizardStepper current={6} />
        <div style={s.card}>
          <h2 style={s.cardTitle}>6 · Miner un mot</h2>
          <p style={s.muted}>
            Survolez un mot du sous-titre, puis cliquez sur {strong("⛏ Miner")}.
          </p>
          <MinePreview />
          <p style={s.mutedSmall}>
            Pour ne pas couper la scène, {strong("Plus tard")} met le mot de côté avec son image
            et son audio. Les cartes se créent ensuite à la suite, depuis la popup ou le bandeau
            au début de la vidéo suivante.
          </p>
          <div style={s.btnRow}>
            <Btn variant="ghost" onClick={() => setEndScreen("colors")}>
              ← Précédent
            </Btn>
            <Btn onClick={() => setEndScreen("mining")}>Continuer →</Btn>
          </div>
        </div>
      </Page>
    );
  }

  if (endScreen === "mining") {
    return (
      <Page maxWidth={560}>
        <Header />
        <WizardStepper current={7} />
        <div style={s.card}>
          <h2 style={s.cardTitle}>7 · Créer une carte</h2>
          <p style={s.muted}>
            Après {strong("Miner")}, cet écran prépare la carte Anki à partir de la scène.
          </p>
          <MiningPreview />
          <CalloutList items={MINING_CALLOUTS} />
          <div style={s.btnRow}>
            <Btn variant="ghost" onClick={() => setEndScreen("mine")}>
              ← Précédent
            </Btn>
            <Btn onClick={() => setEndScreen("anki")}>Continuer →</Btn>
          </div>
        </div>
      </Page>
    );
  }

  if (endScreen === "anki") {
    return (
      <Page maxWidth={560}>
        <Header />
        <WizardStepper current={8} />
        <div style={s.card}>
          <h2 style={s.cardTitle}>8 · Dans Anki</h2>
          <p style={s.muted}>
            Vos cartes arrivent dans {strong("日本語::Vocabulaire::Compréhension")}.
          </p>
          <AnkiCardPreview />
          <CalloutList items={ANKI_CALLOUTS} />
          <div style={s.btnRow}>
            <Btn variant="ghost" onClick={() => setEndScreen("mining")}>
              ← Précédent
            </Btn>
            <Btn onClick={() => setEndScreen("ready")}>Continuer →</Btn>
          </div>
        </div>
      </Page>
    );
  }

  if (endScreen === "ready") {
    return (
      <Page maxWidth={560}>
        <Header />
        <WizardStepper current={9} />
        <div style={s.card}>
          <h2 style={s.cardTitle}>9 · SubJap est prêt</h2>
          <p style={s.muted}>
            Ouvrez une vidéo Re:ANIME, YouTube ou Netflix qui a des sous-titres japonais.
          </p>

          <h3 style={s.guideTitle}>Raccourcis</h3>
          <div style={s.legend}>
            {SHORTCUTS.map(([key, label]) => (
              <React.Fragment key={key}>
                <kbd style={s.kbd}>{key}</kbd>
                <span style={s.legendText}>{label}</span>
              </React.Fragment>
            ))}
          </div>
          <p style={s.mutedSmall}>
            Sur YouTube, cliquez sur « Activer l'audio de l'onglet » dans la popup avant de miner
            pour capturer l'audio de la phrase.
          </p>

          <div style={s.btnRow}>
            <Btn variant="ghost" onClick={() => setEndScreen("anki")}>
              ← Précédent
            </Btn>
            <Btn
              onClick={() => {
                void chrome.tabs.create({ url: "https://reanime.to/" });
              }}
            >
              Ouvrir Re:ANIME
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                void chrome.tabs.create({ url: "https://www.youtube.com/" });
              }}
            >
              Ouvrir YouTube
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                void chrome.tabs.create({ url: "https://www.netflix.com/" });
              }}
            >
              Ouvrir Netflix
            </Btn>
            <Btn variant="ghost" onClick={props.onFinished}>
              Voir les réglages
            </Btn>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page maxWidth={560}>
      <Header />
      <WizardStepper current={step} />

      {error && <div style={s.errorBox}>{error}</div>}

      {step === 1 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>1 · Dictionnaire</h2>
          <p style={s.muted}>
            SubJap a besoin d'un dictionnaire japonais → anglais pour afficher les définitions au
            clic (~22 000 mots courants).
          </p>
          {dict?.installed ? (
            <p style={{ color: C.green }}>
              ✓ Dictionnaire installé : {dict.count.toLocaleString()} entrées
            </p>
          ) : (
            <>
              <Btn onClick={() => void installDictionary()} disabled={downloading}>
                {downloading ? "Téléchargement…" : "Installer le dictionnaire (~22k mots)"}
              </Btn>
              <p style={s.mutedSmall}>
                Environ 1,4 Mo à télécharger. Cette étape peut prendre quelques secondes.
              </p>
            </>
          )}
          <div style={s.btnRow}>
            {dict?.installed ? (
              <Btn
                onClick={() => {
                  void completeDictionaryStep().then(() => advanceTo(1));
                }}
              >
                Continuer →
              </Btn>
            ) : (
              <Btn
                variant="ghost"
                onClick={() => {
                  void advanceTo(1);
                }}
              >
                Passer pour l'instant
              </Btn>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>2 · Anki</h2>
          <p style={s.muted}>
            Optionnel — AnkiConnect (port 8765) permet d'envoyer vos cartes de vocabulaire vers
            Anki. Détecté automatiquement si Anki est ouvert.
          </p>
          {anki === null ? (
            <p style={s.muted}>Vérification…</p>
          ) : anki.connected ? (
            <>
              <p style={{ color: C.green }}>
                ✓ AnkiConnect détecté — {anki.deckNames.length}{" "}
                {anki.deckNames.length > 1 ? "decks" : "deck"}
              </p>
              <p style={s.mutedSmall}>
                SubJap va créer dans Anki le deck 日本語::Vocabulaire et son type de note.
              </p>
            </>
          ) : (
            <p style={{ color: C.amber }}>
              AnkiConnect introuvable. Ouvrez Anki (avec le plugin AnkiConnect), puis vérifiez à
              nouveau, ou passez cette étape.
            </p>
          )}
          <div style={s.btnRow}>
            {anki?.connected ? (
              <Btn onClick={() => void checkAnki()}>Continuer →</Btn>
            ) : (
              <Btn onClick={() => void checkAnki()} disabled={checkingAnki}>
                {checkingAnki ? "Vérification…" : "Vérifier la connexion"}
              </Btn>
            )}
            <Btn
              variant="ghost"
              onClick={() => {
                void skipAnkiStep().then(() => advanceTo(2));
              }}
            >
              Passer
            </Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>3 · Affichage par défaut</h2>
          <p style={s.muted}>Ces réglages sont modifiables à tout moment.</p>
          <div style={s.row}>
            <div style={s.rowLabel}>
              <span>Taille des sous-titres</span>
              <span style={s.rowHint}>suit la taille du lecteur</span>
            </div>
            <div style={s.rowControl}>
              <div style={s.inputGroup}>
                <input
                  type="range"
                  min={SUBTITLE_SCALE_MIN}
                  max={SUBTITLE_SCALE_MAX}
                  step={10}
                  value={options.subtitleScale}
                  style={s.range}
                  onChange={(e) =>
                    setOptions({ ...options, subtitleScale: Number(e.target.value) })
                  }
                />
                <span style={s.inputSuffix}>{options.subtitleScale} %</span>
              </div>
            </div>
          </div>
          <SubtitlePreview scale={options.subtitleScale} showFurigana={options.showFurigana} />
          <div style={s.row}>
            <div style={s.rowLabel}>
              <span>Furigana</span>
              <span style={s.rowHint}>lecture en kana au-dessus des kanji</span>
            </div>
            <div style={s.rowControl}>
              <Toggle
                checked={options.showFurigana}
                onChange={(v) => setOptions({ ...options, showFurigana: v })}
              />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.rowLabel}>
              <span>Phrases connues</span>
              <span style={s.rowHint}>
                tous les mots connus ou ignorés · survol ou X : japonais d'abord, puis traduction
              </span>
            </div>
            <div style={s.rowControl}>
              <select
                value={options.knownSentenceSubtitles}
                style={s.select}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    knownSentenceSubtitles:
                      e.target.value === "hide-translation" || e.target.value === "hide-all"
                        ? e.target.value
                        : "show",
                  })
                }
              >
                <option value="show">Tout afficher</option>
                <option value="hide-translation">Masquer la traduction</option>
                <option value="hide-all">Masquer japonais et traduction (écoute)</option>
              </select>
            </div>
          </div>
          <div style={s.btnRow}>
            <Btn onClick={() => void saveDisplayOptions()}>Continuer →</Btn>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>4 · Mots déjà connus</h2>
          <p style={s.muted}>
            Facultatif — Vous connaissez déjà du japonais ? Indiquez les mots fréquents que vous
            connaissez : SubJap ne grisera que les vrais inconnus. Vous pourrez y revenir à tout
            moment dans les réglages, section « Mots déjà connus ».
          </p>
          <KnownWordsTriage onFinish={() => void finish()} />
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Settings panel (onboarding complete)
// ---------------------------------------------------------------------------

/** Word to type before "Tout effacer" runs: Enter alone must never erase. */
const RESET_CONFIRMATION_WORD = "effacer";

function isResetConfirmed(typed: string | null): boolean {
  return typed?.trim().toLowerCase() === RESET_CONFIRMATION_WORD;
}

function SettingsPanel(props: { onStartOnboarding: () => void }): JSX.Element {
  const [dict, setDict] = useState<DictStatus | null>(null);
  const [anki, setAnki] = useState<AnkiStatus | null>(null);
  const [options, setOptions] = useState<OverlayOptions | null>(null);
  const [pack, setPack] = useState<JmdictPack>(JMDICT_PACKS[0]);
  const [downloading, setDownloading] = useState(false);
  const [checkingAnki, setCheckingAnki] = useState(false);
  const [settingUpAnki, setSettingUpAnki] = useState(false);
  const [syncingAnki, setSyncingAnki] = useState(false);
  const [ankiSyncNote, setAnkiSyncNote] = useState<string | null>(null);
  const [ankiNote, setAnkiNote] = useState<{ deckName: string; modelName: string } | null>(null);
  const [aiPrompt, setAiPrompt] = useState<string | null>(null);
  const [savingAiPrompt, setSavingAiPrompt] = useState(false);
  const [resetting, setResetting] = useState(false);
  /** Typed confirmation of "Tout effacer"; null while the button is not armed. */
  const [resetConfirmation, setResetConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** The triage list is long: unfolded on demand, or when opened from the popup. */
  const [triageOpen, setTriageOpen] = useState(() => location.hash === "#mots-connus");

  const refresh = useCallback(async () => {
    try {
      const [d, a, o, ai] = await Promise.all([
        sendMessage("dict:status", {}),
        sendMessage("anki:status", {}),
        getOptions(),
        getAiSettings(),
      ]);
      setDict(d);
      setAnki(a);
      setOptions(o);
      setAiPrompt(ai.enrichmentPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const saveAiPrompt = useCallback(async () => {
    if (!aiPrompt?.trim()) {
      setError("Le prompt ne peut pas être vide.");
      return;
    }
    setSavingAiPrompt(true);
    setError(null);
    try {
      const next = await saveAiSettings({ enrichmentPrompt: aiPrompt });
      setAiPrompt(next.enrichmentPrompt);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAiPrompt(false);
    }
  }, [aiPrompt]);

  const resetAiPrompt = useCallback(async () => {
    setSavingAiPrompt(true);
    setError(null);
    try {
      const next = await saveAiSettings({
        enrichmentPrompt: DEFAULT_ENRICHMENT_PROMPT,
      });
      setAiPrompt(next.enrichmentPrompt);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAiPrompt(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Save a partial options update and refresh the local state. */
  const updateOptions = useCallback(async (partial: Partial<OverlayOptions>) => {
    try {
      const next = await saveOptions(partial);
      setOptions(next);
      setSavedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const installDictionary = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const result = await sendMessage("dict:download", { url: pack.url });
      if (!result || typeof result.count !== "number") {
        throw new Error("Réponse invalide du service worker");
      }
      setDict({ count: result.count, installed: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [pack.url]);

  const checkAnki = useCallback(async () => {
    setCheckingAnki(true);
    setError(null);
    try {
      const status = await sendMessage("anki:status", {});
      setAnki(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingAnki(false);
    }
  }, []);

  const setupAnki = useCallback(async () => {
    setSettingUpAnki(true);
    setError(null);
    try {
      // Creates the vocabulary subdecks, presets and two-card model (idempotent).
      const result = await sendMessage("anki:setup", {});
      const status = await sendMessage("anki:status", {});
      setAnki(status);
      setAnkiNote(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingUpAnki(false);
    }
  }, []);

  const syncAnki = useCallback(async () => {
    setSyncingAnki(true);
    setError(null);
    try {
      const result = await sendMessage("anki:syncKnown", {});
      setAnkiSyncNote(
        `${result.imported} états Anki lus · ${result.changed} modifiés · ${result.removed} retirés`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingAnki(false);
    }
  }, []);

  const resetData = useCallback(async () => {
    setResetting(true);
    setError(null);
    try {
      await sendMessage("data:reset", {});
      setResetConfirmation(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }, [refresh]);

  return (
    <Page>
      <Header />
      {error && <div style={s.errorBox}>{error}</div>}
      {savedAt && <div style={s.noticeBox}>Réglages enregistrés ✓</div>}

      <Section title="Dictionnaire">
        <Row label="Statut">
          {dict === null ? (
            <span style={s.muted}>…</span>
          ) : dict.installed ? (
            <span style={{ color: C.green }}>Installé — {dict.count.toLocaleString()} entrées</span>
          ) : (
            <span style={{ color: C.amber }}>Non installé</span>
          )}
        </Row>
        <Row label="Pack">
          <select
            value={pack.id}
            style={s.select}
            onChange={(e) => {
              const found = JMDICT_PACKS.find((p) => p.id === e.target.value);
              if (found) setPack(found);
            }}
          >
            {JMDICT_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Description">
          <span style={s.mutedSmall}>{pack.description}</span>
        </Row>
        <Row label="Action">
          <div style={s.btnRow}>
            <Btn onClick={() => void installDictionary()} disabled={downloading}>
              {downloading
                ? "Téléchargement…"
                : dict?.installed
                  ? `Réinstaller (${pack.id === "full" ? "pack complet" : "pack courant"})`
                  : "Installer le dictionnaire"}
            </Btn>
          </div>
        </Row>
      </Section>

      <Section title="Anki">
        <Row label="AnkiConnect">
          {anki === null ? (
            <span style={s.muted}>…</span>
          ) : anki.connected ? (
            <span style={{ color: C.green }}>
              Connecté — {anki.deckNames.length} {anki.deckNames.length > 1 ? "decks" : "deck"}
            </span>
          ) : (
            <span style={{ color: C.amber }}>Déconnecté (port 8765)</span>
          )}
        </Row>
        <Row label="Vérification">
          <Btn variant="ghost" onClick={() => void checkAnki()} disabled={checkingAnki}>
            {checkingAnki ? "Vérification…" : "Vérifier la connexion"}
          </Btn>
        </Row>
        <Row
          label="Decks de vocabulaire"
          hint="crée Compréhension et Production sous 日本語::Vocabulaire, puis met à jour le modèle Migaku Memory"
        >
          <div style={s.btnRow}>
            <Btn onClick={() => void setupAnki()} disabled={settingUpAnki || !anki?.connected}>
              {settingUpAnki ? "Configuration…" : "Configurer les decks Anki"}
            </Btn>
          </div>
        </Row>
        {ankiNote && (
          <Row label="Prêt">
            <span style={{ color: C.green }}>
              Deck « {ankiNote.deckName} » + modèle « {ankiNote.modelName} »
            </span>
          </Row>
        )}
        <Row
          label="Statuts des mots"
          hint="synchronise KNOWN, IGNORED, UNKNOWN et LEARNING dans tous les decks"
        >
          <div style={s.btnRow}>
            <Btn
              variant="ghost"
              onClick={() => void syncAnki()}
              disabled={syncingAnki || !anki?.connected}
            >
              {syncingAnki ? "Synchronisation…" : "Synchroniser maintenant"}
            </Btn>
            {ankiSyncNote && <span style={{ color: C.green }}>{ankiSyncNote}</span>}
          </div>
        </Row>
      </Section>

      <Section title="Mots déjà connus" id="mots-connus">
        <p style={s.muted}>Indiquez les mots fréquents que vous connaissez déjà.</p>
        {triageOpen ? (
          <KnownWordsTriage />
        ) : (
          <Btn variant="ghost" onClick={() => setTriageOpen(true)}>
            Trier les mots fréquents →
          </Btn>
        )}
      </Section>

      <Section title="Affichage des sous-titres">
        {options && (
          <>
            <Row label="Taille des sous-titres" hint="suit la taille du lecteur">
              <div style={s.inputGroup}>
                <input
                  type="range"
                  min={SUBTITLE_SCALE_MIN}
                  max={SUBTITLE_SCALE_MAX}
                  step={10}
                  value={options.subtitleScale}
                  style={s.range}
                  onChange={(e) => void updateOptions({ subtitleScale: Number(e.target.value) })}
                />
                <span style={s.inputSuffix}>{options.subtitleScale} %</span>
              </div>
            </Row>
            <SubtitlePreview scale={options.subtitleScale} showFurigana={options.showFurigana} />
            <Row label="Furigana">
              <Toggle
                checked={options.showFurigana}
                onChange={(v) => void updateOptions({ showFurigana: v })}
              />
            </Row>
            <Row
              label="Pointiller les mots en cours"
              hint="carte Anki étudiée mais pas encore mûre (intervalle de moins de 21 jours)"
            >
              <Toggle
                checked={options.markYoungWords}
                onChange={(v) => void updateOptions({ markYoungWords: v })}
              />
            </Row>
            <Row
              label="Langues des sous-titres"
              hint="principal : japonais · l'autre traduction sert de repli · ou aucune traduction"
            >
              <select
                value={options.secondarySubtitleLanguage}
                style={s.select}
                onChange={(e) =>
                  void updateOptions({
                    secondarySubtitleLanguage:
                      e.target.value === "en" || e.target.value === "none"
                        ? e.target.value
                        : "fr",
                  })
                }
              >
                <option value="none">Secondaire : aucun</option>
                <option value="fr">Secondaire : français</option>
                <option value="en">Secondaire : anglais</option>
              </select>
            </Row>
            <Row
              label="Phrases connues"
              hint="tous les mots connus ou ignorés · survol ou X : japonais d'abord, puis traduction"
            >
              <select
                value={options.knownSentenceSubtitles}
                style={s.select}
                onChange={(e) =>
                  void updateOptions({
                    knownSentenceSubtitles:
                      e.target.value === "hide-translation" || e.target.value === "hide-all"
                        ? e.target.value
                        : "show",
                  })
                }
              >
                <option value="show">Tout afficher</option>
                <option value="hide-translation">Masquer la traduction</option>
                <option value="hide-all">Masquer japonais et traduction (écoute)</option>
              </select>
            </Row>
          </>
        )}
      </Section>

      <JimakuSettings />

      <Section title="Intelligence artificielle">
        <p style={s.muted}>
          Modifie les instructions utilisées pour enrichir les Notes. Les
          variables entre doubles accolades sont remplacées automatiquement.
        </p>
        {aiPrompt !== null && (
          <>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              spellCheck={false}
              aria-label="Prompt global d’enrichissement IA"
              style={s.promptInput}
            />
            <div style={s.btnRow}>
              <Btn onClick={() => void saveAiPrompt()} disabled={savingAiPrompt}>
                {savingAiPrompt ? "Enregistrement…" : "Enregistrer le prompt"}
              </Btn>
              <Btn
                variant="ghost"
                onClick={() => void resetAiPrompt()}
                disabled={savingAiPrompt}
              >
                Restaurer le défaut
              </Btn>
            </div>
            <p style={s.mutedSmall}>
              Variables disponibles : <code>{"{{targetWord}}"}</code>,{" "}
              <code>{"{{targetReading}}"}</code>, <code>{"{{sentence}}"}</code>,{" "}
              <code>{"{{definitions}}"}</code> et <code>{"{{kanjiCandidates}}"}</code>.
            </p>
          </>
        )}
      </Section>

      <Section title="Données">
        <Row label="Effacer" hint="états de mots, cartes, dictionnaire et réglages">
          <Btn
            variant="danger"
            onClick={() => setResetConfirmation("")}
            disabled={resetConfirmation !== null}
          >
            Tout effacer
          </Btn>
        </Row>
        {resetConfirmation !== null && (
          <div style={s.resetConfirm}>
            <p style={s.resetConfirmText}>
              Les décisions manuelles (Connu, Ignorer, mots déjà connus) et les cartes locales
              seront perdues définitivement. Anki n’est pas modifié : ses états reviendront à la
              prochaine synchronisation. Tapez « {RESET_CONFIRMATION_WORD} » pour confirmer.
            </p>
            <div style={s.btnRow}>
              <input
                autoFocus
                value={resetConfirmation}
                placeholder={RESET_CONFIRMATION_WORD}
                aria-label={`Tapez « ${RESET_CONFIRMATION_WORD} » pour confirmer`}
                autoComplete="off"
                spellCheck={false}
                style={s.input}
                onChange={(e) => setResetConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setResetConfirmation(null);
                  if (e.key === "Enter" && isResetConfirmed(resetConfirmation) && !resetting) {
                    void resetData();
                  }
                }}
              />
              <Btn
                variant="danger"
                onClick={() => void resetData()}
                disabled={!isResetConfirmed(resetConfirmation) || resetting}
              >
                {resetting ? "Effacement…" : "Effacer définitivement"}
              </Btn>
              <Btn variant="ghost" onClick={() => setResetConfirmation(null)} disabled={resetting}>
                Annuler
              </Btn>
            </div>
          </div>
        )}
        <Row label="Assistant" hint="relance les 4 étapes de configuration et les 5 slides de découverte">
          <Btn variant="ghost" onClick={props.onStartOnboarding}>
            Recommencer l'onboarding
          </Btn>
        </Row>
      </Section>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s: Record<string, React.CSSProperties> = {
  page: {
    margin: "0 auto",
    padding: "40px 24px 64px",
    maxWidth: 720,
    color: C.text,
    fontFamily: "var(--sj-font)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  brandLockup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  brandMark: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 36,
    borderRadius: 6,
    background: C.accent,
    color: C.bg,
    fontSize: 21,
    fontWeight: 700,
  },
  logo: {
    margin: 0,
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 600,
    color: C.text,
  },
  tagline: {
    margin: "4px 0 0",
    fontSize: 12,
    color: C.muted,
  },
  card: {
    backgroundColor: C.panel,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 12,
    padding: 24,
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: 18,
    fontWeight: 600,
  },
  section: {
    backgroundColor: C.panel,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 12,
    padding: "16px 20px",
    marginBottom: 20,
  },
  sectionTitle: {
    margin: "0 0 12px",
    fontSize: 15,
    fontWeight: 600,
    color: C.text,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    borderBottom: `1px solid ${C.panelBorder}`,
  },
  rowLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: 14,
  },
  rowHint: {
    fontSize: 12,
    color: C.muted,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  btnRow: {
    display: "flex",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },
  btn: {
    padding: "8px 14px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid transparent",
  },
  btnPrimary: {
    backgroundColor: C.accent,
    color: C.bg,
    borderColor: C.accent,
  },
  btnGhost: {
    backgroundColor: "transparent",
    color: C.text,
    borderColor: C.panelBorder,
  },
  btnDanger: {
    backgroundColor: "transparent",
    color: C.red,
    borderColor: C.red,
  },
  input: {
    backgroundColor: "#101216",
    color: C.text,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    minWidth: 200,
  },
  promptInput: {
    display: "block",
    width: "100%",
    minHeight: 360,
    boxSizing: "border-box",
    resize: "vertical",
    backgroundColor: "#101216",
    color: C.text,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  },
  select: {
    backgroundColor: "#101216",
    color: C.text,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    minWidth: 200,
  },
  inputGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  inputSuffix: {
    fontSize: 13,
    color: C.muted,
    minWidth: 44,
  },
  range: {
    width: 180,
    accentColor: C.accent,
  },
  preview: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    // Lets the subtitle use cqh units, like the overlay uses the player height.
    containerType: "size",
    margin: "8px 0 16px",
    overflow: "hidden",
    borderRadius: 8,
    border: `1px solid ${C.panelBorder}`,
    background:
      "radial-gradient(ellipse at 30% 25%, #4b5d73 0%, transparent 55%), linear-gradient(165deg, #2a3442 0%, #151a21 60%, #0b0d10 100%)",
  } as React.CSSProperties,
  previewSubtitles: {
    position: "absolute",
    inset: 0,
    // Same bottom inset share as the overlay above the player's control bar.
    paddingBottom: "13cqh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "center",
    fontFamily: "'IBM Plex Sans JP', 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
    textShadow:
      "0 0 0.08em #000, 0 0 0.2em rgba(0, 0, 0, 0.85), 0 0 0.2em rgba(0, 0, 0, 0.6), 0 0.04em 0.45em rgba(0, 0, 0, 0.65)",
  },
  previewJapanese: {
    fontWeight: 700,
    lineHeight: 1.2,
    textAlign: "center",
    padding: "0 0.24em 0.16em",
  },
  previewToken: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    verticalAlign: "bottom",
    marginTop: "0.24em",
    paddingInline: "0.02em",
    borderBottom: "max(2px, 0.08em) solid transparent",
    whiteSpace: "nowrap",
  },
  previewFurigana: {
    fontSize: "0.45em",
    lineHeight: 1,
    marginBottom: "0.08em",
    color: "#ffffff",
    fontWeight: 500,
  },
  previewTranslation: {
    marginTop: "0.16em",
    padding: "0.08em 0.3em 0.12em",
    fontSize: "0.72em",
    fontWeight: 400,
    lineHeight: 1.3,
    color: "#ffffff",
    textAlign: "center",
  },
  toggleWrap: {
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
  },
  toggle: {
    display: "none",
  },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    position: "relative",
    transition: "background-color 0.15s",
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    width: 18,
    height: 18,
    borderRadius: "50%",
    backgroundColor: C.text,
    transition: "transform 0.15s",
  },
  stepper: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 20,
  },
  stepGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  stepGroupLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  stepGroupDots: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  stepGroupSeparator: {
    alignSelf: "stretch",
    width: 1,
    backgroundColor: C.panelBorder,
  },
  calloutList: {
    listStyle: "none",
    margin: "16px 0 0",
    padding: 0,
    display: "grid",
    rowGap: 8,
  },
  calloutItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: 10,
    alignItems: "baseline",
  },
  callout: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: "50%",
    // Neutral, so callouts never read as the vermilion stepper or a state colour.
    backgroundColor: C.text,
    color: C.bg,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
  },
  mock: {
    display: "grid",
    rowGap: 8,
    marginTop: 14,
    padding: "12px 14px",
    backgroundColor: C.bg,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 10,
    fontSize: 12,
    color: C.text,
  },
  mockHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  mockTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginRight: 8,
  },
  mockSource: {
    color: C.muted,
    fontSize: 11,
  },
  mockSheet: {
    padding: "10px 12px",
    backgroundColor: C.panel,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 8,
  },
  mockRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  mockWord: {
    color: MOCK_TARGET,
    fontSize: 26,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  mockReading: {
    color: C.muted,
    fontSize: 14,
  },
  mockDefinitions: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${C.panelBorder}`,
  },
  mockSense: {
    padding: "2px 8px",
    border: `1px solid ${C.muted}`,
    borderRadius: 6,
    backgroundColor: C.panelRaised,
  },
  mockSenseOff: {
    borderColor: C.panelBorder,
    backgroundColor: "transparent",
    color: C.muted,
  },
  mockScene: {
    display: "grid",
    gridTemplateColumns: "110px minmax(0, 1fr)",
    columnGap: 12,
    alignItems: "start",
  },
  mockImage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    aspectRatio: "16 / 9",
    border: `1px dashed ${C.panelBorder}`,
    borderRadius: 6,
    color: C.muted,
    fontSize: 10,
    textAlign: "center",
  },
  mockSentence: {
    fontSize: 17,
    lineHeight: 1.5,
  },
  mockTranslation: {
    color: C.muted,
    fontSize: 12,
  },
  mockPlay: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: "50%",
    backgroundColor: C.text,
    color: C.panelRaised,
    fontSize: 8,
  },
  mockButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 6,
    backgroundColor: C.panelRaised,
    fontWeight: 600,
  },
  mockKbd: {
    padding: "0 4px",
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 3,
    color: C.muted,
    fontSize: 10,
    fontWeight: 500,
  },
  mockLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: 600,
  },
  mockFooter: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTop: `1px solid ${C.panelBorder}`,
  },
  mockFront: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "14px 12px",
  },
  mockCornerCallout: {
    position: "absolute",
    top: 8,
    right: 10,
  },
  minePlayer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    padding: "16px 14px 22px",
    borderRadius: 8,
    border: `1px solid ${C.panelBorder}`,
    background:
      "radial-gradient(ellipse at 30% 25%, #4b5d73 0%, transparent 55%), linear-gradient(165deg, #2a3442 0%, #151a21 60%, #0b0d10 100%)",
  },
  minePopover: {
    width: 240,
    padding: "10px 12px",
    backgroundColor: C.panel,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 10,
    fontSize: 12,
    color: C.text,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
  },
  minePopoverActions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${C.panelBorder}`,
  },
  minePopoverBtn: {
    padding: "4px 8px",
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 6,
    backgroundColor: C.panelRaised,
    color: C.muted,
    textAlign: "center",
  },
  mineSubtitle: {
    fontFamily: "'IBM Plex Sans JP', 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
    fontSize: 24,
    fontWeight: 700,
    color: "#ffffff",
    textShadow: "0 0 0.08em #000, 0 0 0.2em rgba(0, 0, 0, 0.85)",
  },
  mineTarget: {
    position: "relative",
    color: C.green,
    borderBottom: `2px solid ${C.green}`,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 3,
  },
  mineCursor: {
    position: "absolute",
    left: "55%",
    top: "60%",
    fontSize: 20,
    color: "#ffffff",
    fontWeight: 400,
  },
  mockSend: {
    padding: "6px 12px",
    backgroundColor: C.accent,
    borderColor: C.accent,
    color: C.bg,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 600,
    color: C.bg,
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: C.panelBorder,
  },
  muted: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 1.5,
  },
  triageHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
  },
  triageProgress: {
    color: C.muted,
    fontSize: 12,
  },
  triageList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 8,
  },
  triageRow: {
    display: "grid",
    gridTemplateColumns: "16px 7.5em 8em minmax(0, 1fr)",
    alignItems: "baseline",
    columnGap: 12,
    width: "100%",
    padding: "6px 12px",
    borderRadius: 6,
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  triageRowKnown: {
    color: C.text,
    backgroundColor: C.panelRaised,
    border: `1px solid ${C.panelBorder}`,
  },
  triageRowUnknown: {
    color: C.unknownGrey,
    backgroundColor: "transparent",
    border: "1px solid transparent",
  },
  triageWord: {
    fontSize: 17,
  },
  triageReading: {
    fontSize: 13,
    color: C.muted,
  },
  triageMeaning: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    color: C.muted,
  },
  triageBox: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    height: 16,
    alignSelf: "center",
    borderRadius: 4,
    border: `1.5px solid ${C.muted}`,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: C.bg,
  },
  triageBoxChecked: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  textLink: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: C.accent,
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
  },
  skipLink: {
    display: "block",
    marginTop: 12,
    color: C.muted,
  },
  link: {
    color: C.accent,
  },
  mutedSmall: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 1.4,
    marginTop: 8,
  },
  guideTitle: {
    margin: "20px 0 8px",
    fontSize: 14,
    fontWeight: 600,
    color: C.text,
  },
  legend: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    alignItems: "center",
    columnGap: 12,
    rowGap: 6,
  },
  legendWord: {
    justifySelf: "start",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.3,
    borderBottom: "2px solid transparent",
  },
  legendText: {
    color: C.muted,
    fontSize: 13,
  },
  lifecycle: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    alignItems: "start",
    columnGap: 14,
    rowGap: 14,
    margin: "16px 0",
  },
  lifecycleTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 2,
  },
  warningBox: {
    backgroundColor: "rgba(241,180,109,0.10)",
    border: `1px solid ${C.amber}`,
    color: C.amber,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    marginTop: 12,
  },
  kbd: {
    justifySelf: "start",
    minWidth: 22,
    padding: "1px 6px",
    textAlign: "center",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    color: C.text,
    backgroundColor: C.panelRaised,
    border: `1px solid ${C.panelBorder}`,
    borderRadius: 4,
  },
  errorBox: {
    backgroundColor: "rgba(255,132,144,0.10)",
    border: `1px solid ${C.red}`,
    color: C.red,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 16,
  },
  resetConfirm: {
    marginTop: 8,
    padding: "12px 14px",
    borderRadius: 8,
    border: `1px solid ${C.red}`,
    backgroundColor: "rgba(255,132,144,0.08)",
  },
  resetConfirmText: {
    margin: "0 0 10px",
    fontSize: 13,
    lineHeight: 1.5,
    color: C.text,
  },
  noticeBox: {
    backgroundColor: "rgba(120,214,163,0.10)",
    border: `1px solid ${C.green}`,
    color: C.green,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 16,
  },
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
