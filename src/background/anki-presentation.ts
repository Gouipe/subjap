// ---------------------------------------------------------------------------
// SubJap — shared desktop presentation for Migaku-compatible Anki notes
// ---------------------------------------------------------------------------

export const MIGAKU_FIELDS = [
  "Mot",
  "Lecture",
  "Phrase",
  "Traduction",
  "Définitions",
  "Notes",
  "Image",
  "AudioMot",
  "AudioPhrase",
  "Production",
] as const;

export const MIGAKU_TEMPLATE_MARKER_V2 = 'data-subjap-template-version="2"';
export const MIGAKU_TEMPLATE_MARKER_V3 = 'data-subjap-template-version="3"';
export const MIGAKU_TEMPLATE_MARKER_V4 = 'data-subjap-template-version="4"';
export const MIGAKU_TEMPLATE_MARKER_V5 = 'data-subjap-template-version="5"';
export const MIGAKU_TEMPLATE_MARKER_V6 = 'data-subjap-template-version="6"';
export const MIGAKU_TEMPLATE_MARKER_V7 = 'data-subjap-template-version="7"';
export const MIGAKU_TEMPLATE_MARKER_V8 = 'data-subjap-template-version="8"';
export const MIGAKU_TEMPLATE_MARKER_V9 = 'data-subjap-template-version="9"';
export const MIGAKU_TEMPLATE_MARKER = 'data-subjap-template-version="10"';
export const MIGAKU_COMPREHENSION_TEMPLATE_NAME = "Compréhension";
export const MIGAKU_PRODUCTION_TEMPLATE_NAME = "Production";

export const ANKI_VOCABULARY_PARENT_DECK = "日本語::Vocabulaire";
export const ANKI_COMPREHENSION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Compréhension`;
export const ANKI_PRODUCTION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Production`;

export const MIGAKU_CSS = `
.card {
  --bg: #0c0d10;
  --surface: #14161b;
  --surface-raised: #1b1e24;
  --border: #343842;
  --text: #f4f1ea;
  --muted: #b2b6bf;
  --accent: #ff624d;
  --accent-strong: #ff7966;
  --audio: #b2b6bf;
  margin: 0;
  padding: 28px;
  min-width: 760px;
  background: var(--bg);
  color: var(--text);
  font-family: "IBM Plex Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif;
  font-size: 17px;
  line-height: 1.55;
  text-align: left;
}

.card-shell {
  width: min(840px, calc(100vw - 56px));
  margin: 0 auto;
}

.front-card {
  max-width: 720px;
  min-height: 560px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-align: center;
}

.focus {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.eyebrow {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.word {
  color: var(--text);
  font-size: 64px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.reading {
  color: var(--muted);
  font-size: 17px;
  letter-spacing: 0.08em;
}

ruby rt {
  color: var(--accent-strong);
  font-size: 0.38em;
  font-weight: 500;
}

.audio {
  min-height: 42px;
  margin-top: 8px;
}

.audio img.replay-button {
  width: 34px;
  height: 34px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-raised);
  box-sizing: content-box;
}

.answer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding: 18px 22px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.answer-header .word {
  font-size: 32px;
}

.answer-header .reading {
  margin-left: auto;
  font-size: 17px;
}

.answer-header .audio {
  margin: 0;
}

.back-card {
  max-width: 800px;
}

.back-word {
  margin: 0 0 8px;
  color: var(--accent-strong);
  font-size: 32px;
  font-weight: 600;
  line-height: 1.35;
  text-align: center;
}

.back-sentence {
  max-width: 70ch;
  margin: 0 auto;
  padding: 12px 16px 4px;
  color: var(--text);
  font-size: 24px;
  line-height: 1.65;
  text-align: center;
}

.back-audio-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  margin: 6px 0 18px;
}

.audio-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 5px 10px 5px 9px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--surface-raised);
  border-radius: 6px;
  color: var(--text);
}

.audio-control.audio-word .audio-label {
  color: var(--accent-strong);
}

.audio-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.audio-control .audio {
  display: inline-flex;
  align-items: center;
  min-height: 0;
  margin: 0;
}

.audio-control img.replay-button {
  width: 20px;
  height: 20px;
  padding: 2px;
  border: 0;
  background: transparent;
  box-sizing: content-box;
}

.audio-control:hover {
  border-color: var(--accent);
}

.back-divider {
  height: 1px;
  margin: 0 0 22px;
  background: var(--border);
}

.definition-panel {
  max-width: 760px;
  margin: 0 auto 18px;
  padding: 16px 20px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.definition-panel .definitions {
  color: var(--text);
  font-size: 19px;
  font-weight: 500;
  line-height: 1.55;
}

.definition-panel .section-label {
  color: var(--accent-strong);
}

.back-image {
  margin: 0 auto 18px;
  max-width: 760px;
}

.back-image img {
  display: block;
  width: 100%;
  max-height: 380px;
  object-fit: contain;
  border-radius: 8px;
}

.back-notes {
  max-width: 760px;
  margin: 0 auto 12px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
}

.translation-reveal {
  margin: 2px 0 18px;
  text-align: center;
}

.translation-reveal > summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--accent-strong);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: background 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.translation-reveal > summary::-webkit-details-marker {
  display: none;
}

.translation-reveal > summary:hover {
  border-color: var(--accent);
  background: var(--surface-raised);
}

.translation-content {
  max-width: 70ch;
  margin: 10px auto 0;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
  text-align: center;
}

.translation-reveal[open] > summary {
  display: none;
}

.back-notes {
  color: var(--text);
}

.study-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(360px, 0.88fr);
  align-items: start;
  gap: 24px;
}

.media-column,
.content-column {
  min-width: 0;
}

.media-frame {
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}

.media-frame img {
  display: block;
  width: 100%;
  max-height: 520px;
  object-fit: contain;
  border-radius: 10px;
}

.media-column > .audio {
  padding: 14px 4px 0;
  text-align: center;
}

.sentence-panel,
.info-panel {
  margin-bottom: 16px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.sentence-panel {
  border-color: var(--border);
}

.section-label {
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.sentence {
  color: var(--text);
  font-size: 24px;
  line-height: 1.65;
}

.translation {
  color: var(--text);
  font-size: 17px;
  line-height: 1.6;
}

.definitions {
  color: var(--text);
  line-height: 1.7;
}

.notes {
  max-width: 70ch;
  margin: 0 auto;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.target {
  color: var(--accent-strong);
  font-weight: 600;
}

.production-activation {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 760px;
  margin: 16px auto 0;
  padding: 0 12px;
  text-align: center;
}

.production-activation-button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: border-color 160ms cubic-bezier(0.22, 1, 0.36, 1), color 160ms cubic-bezier(0.22, 1, 0.36, 1), background 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.production-activation-button:hover,
.production-activation-button:focus-visible {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--surface);
}

.production-activation-button:disabled {
  cursor: default;
  color: var(--muted);
}

.production-activation-button[data-state="success"] {
  border-color: var(--priority-green, #78d6a3);
  color: var(--priority-green, #78d6a3);
}

.production-activation-hint {
  margin-top: 7px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.production-activation-status {
  display: none;
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.production-activation-status:not(:empty) {
  display: block;
}

.production-activation-status[data-state="error"] {
  color: #ff8490;
}

.production-card {
  max-width: 800px;
  margin: 0 auto;
}

.production-front {
  min-height: 520px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-align: center;
}

.production-prompt {
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.production-sentence {
  color: var(--text);
  font-size: 32px;
  line-height: 1.75;
}

.production-sentence .target {
  display: inline-flex;
  width: 5rem;
  overflow: hidden;
  align-items: baseline;
  justify-content: center;
  color: transparent;
  font-size: 0;
  vertical-align: baseline;
  white-space: nowrap;
}

.production-sentence .target > * {
  display: none;
}

.production-sentence .target::after {
  content: "＿＿＿";
  color: var(--accent-strong);
  font-size: 32px;
  letter-spacing: 0;
}

.production-definitions {
  color: var(--text);
  font-size: 17px;
  line-height: 1.6;
}

.translation-reveal > summary:focus-visible,
.production-activation-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.translation-reveal > summary:active {
  transform: translateY(1px);
}

@media (prefers-reduced-motion: reduce) {
  .translation-reveal > summary,
  .production-activation-button {
    transition: none;
  }
}

/* Compact desktop review: keep the familiar vertical stack inside the study window. */
@media (min-width: 901px) {
  .back-card {
    margin-top: -8px;
    margin-bottom: -10px;
  }

  .back-word {
    margin-bottom: 4px;
    font-size: 30px;
    line-height: 1.2;
  }

  .back-sentence {
    padding: 4px 10px 2px;
    font-size: 23px;
    line-height: 1.4;
  }

  .back-audio-row {
    gap: 7px;
    min-height: 36px;
    margin: 5px 0 14px;
  }

  .audio-control {
    min-height: 34px;
    padding: 4px 9px 4px 8px;
  }

  .audio-label {
    font-size: 11px;
  }

  .translation-reveal {
    margin: 0 0 14px;
  }

  .translation-reveal > summary {
    padding: 7px 13px;
    font-size: 12px;
  }

  .translation-content {
    margin-top: 8px;
    padding: 10px 14px;
    font-size: 15px;
    line-height: 1.5;
  }

  .back-divider {
    margin-bottom: 14px;
  }

  .definition-panel {
    margin-bottom: 16px;
    padding: 14px 18px 16px;
    border-radius: 10px;
  }

  .definition-panel .definitions {
    font-size: 18px;
    line-height: 1.5;
  }

  .definition-panel .section-label,
  .back-notes .section-label {
    margin-bottom: 6px;
    font-size: 11px;
  }

  .back-image {
    margin-bottom: 16px;
  }

  .back-image img {
    height: auto;
    max-height: min(360px, 36vh);
    border-radius: 8px;
  }

  .back-notes {
    margin-bottom: 10px;
    padding: 13px 17px;
    border-radius: 10px;
  }

  .notes {
    font-size: 14px;
    line-height: 1.5;
  }

  .production-activation {
    margin-top: 14px;
  }
}

@media (max-width: 900px) {
  .card {
    min-width: 0;
    padding: 20px;
  }

  .card-shell {
    width: 100%;
  }

  .study-grid {
    grid-template-columns: 1fr;
  }

  .production-front {
    min-height: 440px;
    padding: 22px;
  }

  .production-sentence,
  .production-sentence .target::after {
    font-size: 24px;
  }
}
`;

export const MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT = `
{{^Production}}
<div class="production-activation">
  <button class="production-activation-button" id="subjap-activate-production" type="button"
    aria-describedby="subjap-production-hint" title="Première révision dans deux jours · à réserver aux mots utiles à l’oral">
    Activer la production orale
  </button>
  <div class="production-activation-hint" id="subjap-production-hint">Crée une carte sœur disponible dans deux jours.</div>
  <div class="production-activation-status" id="subjap-production-status" role="status" aria-live="polite"></div>
</div>
<script>
(() => {
  const button = document.getElementById("subjap-activate-production");
  const status = document.getElementById("subjap-production-status");
  if (!button || !status) return;

  const target = document.querySelector(".back-sentence .target");
  if (!target) {
    button.disabled = true;
    status.dataset.state = "error";
    status.textContent = "Activation impossible : mot cible introuvable dans la phrase.";
    return;
  }

  const invoke = async (action, params) => {
    const response = await fetch("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params: params || {} }),
    });
    if (!response.ok) throw new Error("AnkiConnect HTTP " + response.status);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    return payload.result;
  };

  const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.dataset.state = "";
    status.textContent = "Activation en cours…";
    try {
      const permission = await invoke("requestPermission");
      if (permission && permission.permission === "denied") {
        throw new Error("autorisation AnkiConnect refusée");
      }

      const current = await invoke("guiCurrentCard");
      if (!current || !current.cardId) throw new Error("carte courante introuvable");
      const cards = await invoke("cardsInfo", { cards: [current.cardId] });
      const currentInfo = cards && cards[0];
      if (!currentInfo || !currentInfo.note) throw new Error("note courante introuvable");

      const releaseAt = String(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await invoke("updateNoteFields", {
        note: { id: currentInfo.note, fields: { Production: releaseAt } },
      });

      let productionCards = [];
      for (let attempt = 0; attempt < 10 && productionCards.length === 0; attempt += 1) {
        productionCards = await invoke("findCards", {
          query: "nid:" + currentInfo.note + " card:Production",
        });
        if (productionCards.length === 0) await wait(100);
      }
      if (productionCards.length === 0) throw new Error("carte de production non générée");

      await invoke("changeDeck", {
        cards: productionCards,
        deck: "${ANKI_PRODUCTION_DECK}",
      });
      await invoke("suspend", { cards: productionCards });

      button.textContent = "Production activée";
      button.dataset.state = "success";
      status.textContent = "";
      await invoke("guiShowAnswer").catch(() => {});
    } catch (error) {
      button.disabled = false;
      status.dataset.state = "error";
      status.textContent = "Activation impossible. Vérifie qu’Anki est ouvert, puis réessaie.";
    }
  });
})();
</script>
{{/Production}}
{{#Production}}
<div class="production-activation">
  <div class="production-activation-status">Production orale activée</div>
</div>
{{/Production}}
`;

export const MIGAKU_REVIEW_SHORTCUTS_FRAGMENT = `
<script id="subjap-anki-review-shortcuts">
(() => {
  if (window.__subjapReviewShortcutsInstalled) return;
  window.__subjapReviewShortcutsInstalled = true;

  const commands = {
    "&": "ease1",
    "é": "ease2",
    '"': "ease3",
    "'": "ease4",
  };

  const isEditable = (target) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  };

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
    const command = commands[event.key];
    if (!command) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof window.pycmd === "function") {
      window.pycmd(command);
      return;
    }

    const button = document.querySelector('[onclick*="' + command + '"]');
    if (button instanceof HTMLElement) button.click();
  }, true);
})();
</script>
`;

export const MIGAKU_FRONT_TEMPLATE = `
<div class="card-shell front-card" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="focus">
    <div class="word">{{Mot}}</div>
    {{#Lecture}}<div class="reading">{{Lecture}}</div>{{/Lecture}}
    {{#AudioMot}}<div class="audio audio-word">{{AudioMot}}</div>{{/AudioMot}}
  </div>
</div>
`;

const MIGAKU_SHARED_BACK_TEMPLATE = `
<div class="card-shell back-card" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="back-word">{{Mot}}</div>
  {{#Phrase}}<div class="back-sentence">{{Phrase}}</div>{{/Phrase}}
  <div class="back-audio-row" aria-label="Écoute">
    {{#AudioMot}}<div class="audio-control audio-word"><span class="audio-label">Mot</span><div class="audio">{{AudioMot}}</div></div>{{/AudioMot}}
    {{#AudioPhrase}}<div class="audio-control audio-phrase"><span class="audio-label">Phrase</span><div class="audio">{{AudioPhrase}}</div></div>{{/AudioPhrase}}
  </div>

  {{#Traduction}}
  <details class="translation-reveal">
    <summary>Voir la traduction</summary>
    <div class="translation-content">
      <div class="section-label">Traduction</div>
      {{Traduction}}
    </div>
  </details>
  {{/Traduction}}

  <div class="back-divider"></div>

  {{#Définitions}}
  <div class="definition-panel">
    <div class="section-label">Définition</div>
    <div class="definitions">{{Définitions}}</div>
  </div>
  {{/Définitions}}

  {{#Image}}<div class="back-image">{{Image}}</div>{{/Image}}

  {{#Notes}}
  <div class="back-notes">
    <div class="section-label">Notes</div>
    <div class="notes">{{Notes}}</div>
  </div>
  {{/Notes}}
</div>
${MIGAKU_REVIEW_SHORTCUTS_FRAGMENT}
`;

export const MIGAKU_BACK_TEMPLATE = `
${MIGAKU_SHARED_BACK_TEMPLATE}
${MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT}
`;

export const MIGAKU_PRODUCTION_FRONT_TEMPLATE = `
{{#Production}}
<div class="production-card production-front" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="production-prompt">Prononce le mot manquant à voix haute</div>
  {{#Phrase}}<div class="production-sentence">{{Phrase}}</div>{{/Phrase}}
  {{#Définitions}}<div class="production-definitions">{{Définitions}}</div>{{/Définitions}}
</div>
{{/Production}}
`;

export const MIGAKU_PRODUCTION_BACK_TEMPLATE = MIGAKU_SHARED_BACK_TEMPLATE;
