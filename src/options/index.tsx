// ---------------------------------------------------------------------------
// SubJap — Options page (React)
//
// Two modes:
//   • Onboarding wizard (3 steps) when the user hasn't completed setup yet —
//     the service worker opens this page on first install.
//   • Full settings panel once onboarding is complete: dictionary, Anki,
//     overlay display options and data management.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendMessage } from "@/core/messaging";
import { getOptions, saveOptions, DEFAULT_OPTIONS } from "@/core/options";
import { JMDICT_PACKS } from "@/dictionary/jmdict";
import type { JmdictPack } from "@/dictionary/jmdict";
import {
  getOnboardingState,
  saveOnboardingState,
  completeDictionaryStep,
  completeAnkiStep,
  skipAnkiStep,
  completeOptionsStep,
  resetOnboarding,
} from "@/onboarding";
import type { OnboardingState } from "@/onboarding";
import type { OverlayOptions } from "@/core/types";

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
  bg: "#1e1e2e",
  panel: "#181825",
  panelBorder: "#313244",
  text: "#cdd6f4",
  muted: "#94a3b8",
  accent: "#cba6f7",
  blue: "#3b82f6",
  green: "#5cb85c",
  red: "#d9534f",
  amber: "#f0ad4e",
};

function Section(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={s.section}>
      <h2 style={s.sectionTitle}>{props.title}</h2>
      {props.children}
    </section>
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
          backgroundColor: props.checked ? C.blue : "#45475a",
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
      <div>
        <h1 style={s.logo}>SubJap</h1>
        <p style={s.tagline}>Apprendre le japonais en regardant des anime</p>
      </div>
      {props.children}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Onboarding wizard (3 steps)
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
  const [finished, setFinished] = useState(false);

  const step = Math.min(state.currentStep + 1, 3);

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

  const finish = useCallback(async () => {
    setError(null);
    try {
      await completeOptionsStep(options);
      setFinished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [options]);

  if (finished) {
    return (
      <Page maxWidth={560}>
        <Header />
        <div style={s.card}>
          <h2 style={s.cardTitle}>Configuration terminée 🎉</h2>
          <p style={s.muted}>
            SubJap est prêt. Ouvrez une série avec des sous-titres japonais pour voir l'overlay
            interactif.
          </p>
          <div style={s.btnRow}>
            <Btn
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
      {/* Stepper */}
      <div style={s.stepper}>
        {[1, 2, 3].map((n) => (
          <React.Fragment key={n}>
            <div
              style={{
                ...s.stepDot,
                backgroundColor: step >= n ? C.blue : "#45475a",
              }}
            >
              {n}
            </div>
            {n < 3 && <div style={s.stepLine} />}
          </React.Fragment>
        ))}
      </div>

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
            <p style={{ color: C.green }}>
              ✓ AnkiConnect détecté — {anki.deckNames.length}{" "}
              {anki.deckNames.length > 1 ? "decks" : "deck"}
            </p>
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
              <span>Taille de police</span>
              <span style={s.rowHint}>px</span>
            </div>
            <div style={s.rowControl}>
              <input
                type="number"
                min={12}
                max={64}
                value={options.fontSize}
                style={s.input}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    fontSize: Number(e.target.value) || options.fontSize,
                  })
                }
              />
            </div>
          </div>
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
              <span>Surligner les mots pertinents</span>
              <span style={s.rowHint}>
                inconnus jusqu’à ton vocabulaire connu
              </span>
            </div>
            <div style={s.rowControl}>
              <Toggle
                checked={options.highlightKnown}
                onChange={(v) => setOptions({ ...options, highlightKnown: v })}
              />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.rowLabel}>
              <span>Couleur des mots pertinents</span>
            </div>
            <div style={s.rowControl}>
              <input
                type="color"
                value={options.knownColor}
                style={s.colorInput}
                onChange={(e) => setOptions({ ...options, knownColor: e.target.value })}
              />
            </div>
          </div>
          <div style={s.row}>
            <div style={s.rowLabel}>
              <span>Masquer les sous-titres natifs</span>
              <span style={s.rowHint}>l'overlay remplace la piste japonaise du lecteur</span>
            </div>
            <div style={s.rowControl}>
              <Toggle
                checked={options.hideNativeSubtitles}
                onChange={(v) => setOptions({ ...options, hideNativeSubtitles: v })}
              />
            </div>
          </div>
          <div style={s.btnRow}>
            <Btn onClick={() => void finish()}>Terminer ✓</Btn>
          </div>
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Settings panel (onboarding complete)
// ---------------------------------------------------------------------------

function SettingsPanel(props: { onStartOnboarding: () => void }): JSX.Element {
  const [dict, setDict] = useState<DictStatus | null>(null);
  const [anki, setAnki] = useState<AnkiStatus | null>(null);
  const [options, setOptions] = useState<OverlayOptions | null>(null);
  const [pack, setPack] = useState<JmdictPack>(JMDICT_PACKS[0]);
  const [downloading, setDownloading] = useState(false);
  const [checkingAnki, setCheckingAnki] = useState(false);
  const [settingUpAnki, setSettingUpAnki] = useState(false);
  const [ankiNote, setAnkiNote] = useState<{ deckName: string; modelName: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
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
      // Creates the dedicated "SubJap" deck + note model in Anki (idempotent).
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

  const resetData = useCallback(async () => {
    if (
      !window.confirm(
        "Tout effacer ? Cette action supprime les états de mots, cartes, dictionnaire et réglages (données locales uniquement).",
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await sendMessage("data:reset", {});
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
          label="Deck dédié"
          hint="crée le deck « SubJap » + le modèle compatible « Migaku Memory » dans Anki (sans effet si déjà présents)"
        >
          <div style={s.btnRow}>
            <Btn onClick={() => void setupAnki()} disabled={settingUpAnki || !anki?.connected}>
              {settingUpAnki ? "Création…" : "Créer le deck « SubJap »"}
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
      </Section>

      <Section title="Affichage des sous-titres">
        {options && (
          <>
            <Row label="Taille de police">
              <div style={s.inputGroup}>
                <input
                  type="range"
                  min={12}
                  max={64}
                  value={options.fontSize}
                  style={s.range}
                  onChange={(e) => void updateOptions({ fontSize: Number(e.target.value) })}
                />
                <span style={s.inputSuffix}>{options.fontSize} px</span>
              </div>
            </Row>
            <Row label="Police" hint="laisser vide pour la police par défaut">
              <input
                type="text"
                defaultValue={options.fontFamily}
                list="subjap-fonts"
                style={s.input}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== options.fontFamily) {
                    void updateOptions({ fontFamily: v });
                  }
                }}
              />
              <datalist id="subjap-fonts">
                <option value="'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', sans-serif" />
                <option value="'Noto Sans JP', sans-serif" />
                <option value="'Yu Gothic', sans-serif" />
                <option value="system-ui, sans-serif" />
              </datalist>
            </Row>
            <Row label="Furigana">
              <Toggle
                checked={options.showFurigana}
                onChange={(v) => void updateOptions({ showFurigana: v })}
              />
            </Row>
            <Row label="Surligner les mots pertinents">
              <Toggle
                checked={options.highlightKnown}
                onChange={(v) => void updateOptions({ highlightKnown: v })}
              />
            </Row>
            <Row label="Couleur des mots pertinents">
              <input
                type="color"
                value={options.knownColor}
                style={s.colorInput}
                onChange={(e) => void updateOptions({ knownColor: e.target.value })}
              />
            </Row>
            <Row
              label="Masquer les sous-titres natifs"
              hint="l'overlay remplace la piste japonaise du lecteur"
            >
              <Toggle
                checked={options.hideNativeSubtitles}
                onChange={(v) => void updateOptions({ hideNativeSubtitles: v })}
              />
            </Row>
          </>
        )}
      </Section>

      <Section title="Données">
        <Row label="Effacer" hint="états de mots, cartes, dictionnaire et réglages">
          <Btn variant="danger" onClick={() => void resetData()} disabled={resetting}>
            {resetting ? "Effacement…" : "Tout effacer"}
          </Btn>
        </Row>
        <Row label="Assistant" hint="relance la configuration en 3 étapes">
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
    padding: "32px 24px 64px",
    maxWidth: 720,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  logo: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.accent,
  },
  tagline: {
    margin: "4px 0 0",
    fontSize: 13,
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
    color: C.accent,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    borderBottom: "1px solid #23232f",
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
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid transparent",
  },
  btnPrimary: {
    backgroundColor: C.blue,
    color: "#fff",
    borderColor: C.blue,
  },
  btnGhost: {
    backgroundColor: "transparent",
    color: "#a5b4fc",
    borderColor: "#475569",
  },
  btnDanger: {
    backgroundColor: "transparent",
    color: C.red,
    borderColor: C.red,
  },
  input: {
    backgroundColor: "#11111b",
    color: C.text,
    border: "1px solid #45475a",
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    minWidth: 200,
  },
  select: {
    backgroundColor: "#11111b",
    color: C.text,
    border: "1px solid #45475a",
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
    accentColor: C.blue,
  },
  colorInput: {
    width: 40,
    height: 28,
    padding: 0,
    border: "1px solid #45475a",
    borderRadius: 6,
    backgroundColor: "#11111b",
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
    backgroundColor: "#fff",
    transition: "transform 0.15s",
  },
  stepper: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: "#45475a",
  },
  muted: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 1.5,
  },
  mutedSmall: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 1.4,
    marginTop: 8,
  },
  errorBox: {
    backgroundColor: "rgba(217,83,79,0.12)",
    border: "1px solid #d9534f",
    color: C.red,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 16,
  },
  noticeBox: {
    backgroundColor: "rgba(92,184,92,0.12)",
    border: "1px solid #5cb85c",
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
