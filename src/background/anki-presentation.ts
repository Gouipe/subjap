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
export const MIGAKU_TEMPLATE_MARKER = 'data-subjap-template-version="5"';
export const MIGAKU_COMPREHENSION_TEMPLATE_NAME = "Compréhension";
export const MIGAKU_PRODUCTION_TEMPLATE_NAME = "Production";

export const ANKI_VOCABULARY_PARENT_DECK = "日本語::Vocabulaire";
export const ANKI_COMPREHENSION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Compréhension`;
export const ANKI_PRODUCTION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Production`;

export const MIGAKU_CSS = `
.card {
  --bg: #0e1016;
  --surface: #171a23;
  --surface-raised: #202532;
  --border: rgba(255, 255, 255, 0.10);
  --text: #f5f7fb;
  --muted: #a9b1c2;
  --accent: #c084fc;
  --accent-strong: #e0b5ff;
  --audio: #57d3d0;
  margin: 0;
  padding: 34px;
  min-width: 760px;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, "Avenir Next", "Hiragino Kaku Gothic ProN", "Meiryo", Arial, sans-serif;
  font-size: 18px;
  line-height: 1.55;
  text-align: left;
}

.card-shell {
  width: min(1120px, calc(100vw - 68px));
  margin: 0 auto;
}

.front-card {
  min-height: 560px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 26px;
  background:
    radial-gradient(circle at 50% 15%, rgba(192, 132, 252, 0.18), transparent 38%),
    linear-gradient(145deg, #171a23 0%, #0e1016 70%);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
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
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.word {
  color: var(--text);
  font-size: 76px;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.reading {
  color: var(--muted);
  font-size: 22px;
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
  border: 1px solid rgba(87, 211, 208, 0.55);
  border-radius: 999px;
  background: rgba(87, 211, 208, 0.13);
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
  border-radius: 18px;
  background: var(--surface);
}

.answer-header .word {
  font-size: 42px;
}

.answer-header .reading {
  margin-left: auto;
  font-size: 18px;
}

.answer-header .audio {
  margin: 0;
}

.back-card {
  max-width: 920px;
}

.back-word {
  margin: 0 0 8px;
  color: var(--accent-strong);
  font-size: 38px;
  font-weight: 750;
  line-height: 1.35;
  text-align: center;
}

.back-sentence {
  padding: 12px 16px 4px;
  color: #ffffff;
  font-size: 29px;
  line-height: 1.65;
  text-align: center;
}

.back-audio-row {
  display: flex;
  justify-content: center;
  gap: 12px;
  min-height: 42px;
  margin: 6px 0 24px;
}

.back-audio-row .audio {
  margin: 0;
}

.back-audio-row .audio-word,
.back-audio-row .audio-phrase {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  min-height: 42px;
  padding: 0;
  box-sizing: border-box;
}

.back-audio-row .audio-word {
  order: 1;
  border: 1px solid rgba(192, 132, 252, 0.55);
  background: rgba(192, 132, 252, 0.18);
  color: #e0b5ff;
  border-radius: 999px;
}

.back-audio-row .audio-phrase {
  order: 2;
  border: 1px solid rgba(87, 211, 208, 0.55);
  background: rgba(87, 211, 208, 0.15);
  color: #8ce9e5;
  border-radius: 14px;
}

.back-audio-row .audio-word img.replay-button,
.back-audio-row .audio-phrase img.replay-button {
  width: 28px;
  height: 28px;
  padding: 4px;
  border: 0;
  background: transparent;
  box-sizing: content-box;
}

.back-divider {
  height: 1px;
  margin: 0 0 22px;
  background: var(--border);
}

.definition-panel {
  margin-bottom: 22px;
  padding: 20px 22px 22px;
  border: 1px solid rgba(192, 132, 252, 0.32);
  border-left: 5px solid var(--accent);
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(192, 132, 252, 0.16), rgba(32, 37, 50, 0.82));
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
}

.definition-panel .definitions {
  color: #ffffff;
  font-size: 26px;
  font-weight: 650;
  line-height: 1.7;
}

.definition-panel .section-label {
  color: var(--accent-strong);
}

.back-image {
  margin: 0 auto 22px;
  max-width: 760px;
}

.back-image img {
  display: block;
  width: 100%;
  max-height: 560px;
  object-fit: contain;
  border-radius: 16px;
}

.back-notes {
  margin-bottom: 16px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface-raised);
}

.translation-reveal {
  margin: 2px 0 22px;
  text-align: center;
}

.translation-reveal > summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 220px;
  padding: 12px 22px;
  border: 1px solid rgba(192, 132, 252, 0.45);
  border-radius: 999px;
  background: linear-gradient(135deg, #54308d, #352064);
  color: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  box-shadow: 0 10px 24px rgba(35, 16, 67, 0.35);
}

.translation-reveal > summary::-webkit-details-marker {
  display: none;
}

.translation-reveal > summary:hover {
  background: linear-gradient(135deg, #6840a8, #43297c);
}

.translation-content {
  margin-top: 16px;
  padding: 0 8px;
  color: var(--muted);
  font-size: 18px;
  line-height: 1.6;
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
  border-radius: 18px;
  background: #050609;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.34);
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
  border-radius: 18px;
  background: var(--surface);
}

.sentence-panel {
  border-left: 4px solid var(--accent);
}

.section-label {
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.sentence {
  color: #ffffff;
  font-size: 29px;
  line-height: 1.65;
}

.translation {
  color: #e4e8f0;
  font-size: 20px;
  line-height: 1.6;
}

.definitions {
  color: #d5dbea;
  line-height: 1.7;
}

.notes {
  color: var(--muted);
  font-size: 15px;
  line-height: 1.65;
}

.target {
  color: var(--accent-strong);
  font-weight: 750;
}

.production-activation {
  margin: 8px auto 0;
  padding: 0;
  text-align: center;
}

.production-activation-button {
  padding: 6px 11px;
  border: 1px solid rgba(169, 177, 194, 0.28);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  opacity: 0.68;
  transition: border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}

.production-activation-button:hover,
.production-activation-button:focus-visible {
  border-color: rgba(87, 211, 208, 0.58);
  color: #baf5f2;
  opacity: 1;
}

.production-activation-button:disabled {
  cursor: default;
  opacity: 0.65;
}

.production-activation-status {
  display: none;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
}

.production-activation-status:not(:empty) {
  display: block;
}

.production-card {
  max-width: 920px;
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
  border-radius: 24px;
  background: linear-gradient(145deg, #171a23 0%, #0e1016 72%);
  text-align: center;
}

.production-prompt {
  color: var(--accent-strong);
  font-size: 15px;
  font-weight: 750;
  letter-spacing: 0.05em;
}

.production-sentence {
  color: #ffffff;
  font-size: 34px;
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
  font-size: 34px;
  letter-spacing: 0;
}

.production-hint {
  margin: 0;
}

.production-hint > summary {
  display: inline-flex;
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.production-hint > summary::-webkit-details-marker {
  display: none;
}

.production-hint[open] > summary {
  display: none;
}

.production-hint-content {
  color: #e4e8f0;
  font-size: 18px;
  line-height: 1.6;
}

.production-hint-warning,
.production-repeat {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.production-repeat {
  margin: 4px 0 16px;
  color: #baf5f2;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

.production-grading {
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

/* Compact desktop review: keep the familiar vertical stack inside the study window. */
@media (min-width: 901px) {
  .back-card {
    margin-top: -16px;
    margin-bottom: -18px;
  }

  .back-word {
    margin-bottom: 2px;
    font-size: 32px;
    line-height: 1.15;
  }

  .back-sentence {
    padding: 4px 10px 0;
    font-size: 22px;
    line-height: 1.35;
  }

  .back-audio-row {
    gap: 8px;
    min-height: 34px;
    margin: 4px 0 10px;
  }

  .back-audio-row .audio-word,
  .back-audio-row .audio-phrase {
    width: 34px;
    height: 34px;
    min-height: 34px;
  }

  .back-audio-row .audio-word img.replay-button,
  .back-audio-row .audio-phrase img.replay-button {
    width: 22px;
    height: 22px;
    padding: 3px;
  }

  .translation-reveal {
    margin: 0 0 10px;
  }

  .translation-reveal > summary {
    min-width: 0;
    padding: 7px 16px;
    font-size: 10px;
  }

  .translation-content {
    margin-top: 8px;
    padding: 0 6px;
    font-size: 15px;
    line-height: 1.35;
  }

  .back-divider {
    margin-bottom: 10px;
  }

  .definition-panel {
    margin-bottom: 12px;
    padding: 10px 14px 12px;
    border-radius: 12px;
  }

  .definition-panel .definitions {
    font-size: 20px;
    line-height: 1.35;
  }

  .definition-panel .section-label,
  .back-notes .section-label {
    margin-bottom: 4px;
    font-size: 10px;
  }

  .back-image {
    margin-bottom: 12px;
  }

  .back-image img {
    height: min(300px, 30vh);
    max-height: min(300px, 30vh);
    border-radius: 12px;
  }

  .back-notes {
    margin-bottom: 6px;
    padding: 10px 14px;
    border-radius: 12px;
  }

  .notes {
    font-size: 13px;
    line-height: 1.35;
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
    font-size: 27px;
  }
}
`;

export const MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT = `
{{^Production}}
<div class="production-activation">
  <button class="production-activation-button" id="subjap-activate-production" type="button"
    title="Première révision dans deux jours · à réserver aux mots utiles à l’oral">
    ＋ Production orale
  </button>
  <div class="production-activation-status" id="subjap-production-status"></div>
</div>
<script>
(() => {
  const button = document.getElementById("subjap-activate-production");
  const status = document.getElementById("subjap-production-status");
  if (!button || !status) return;

  const target = document.querySelector(".back-sentence .target");
  if (!target) {
    button.disabled = true;
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
      status.textContent = "";
      await invoke("guiShowAnswer").catch(() => {});
    } catch (error) {
      button.disabled = false;
      status.textContent = "Échec : " + (error && error.message ? error.message : String(error));
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

export const MIGAKU_FRONT_TEMPLATE = `
<div class="card-shell front-card" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="focus">
    <div class="word">{{Mot}}</div>
    {{#Lecture}}<div class="reading">{{Lecture}}</div>{{/Lecture}}
    {{#AudioMot}}<div class="audio audio-word">{{AudioMot}}</div>{{/AudioMot}}
  </div>
</div>
`;

export const MIGAKU_BACK_TEMPLATE = `
<div class="card-shell back-card" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="back-word">{{Mot}}</div>
  {{#Phrase}}<div class="back-sentence">{{Phrase}}</div>{{/Phrase}}
  <div class="back-audio-row">
    {{#AudioMot}}<div class="audio audio-word">{{AudioMot}}</div>{{/AudioMot}}
    {{#AudioPhrase}}<div class="audio audio-phrase">{{AudioPhrase}}</div>{{/AudioPhrase}}
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
${MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT}
`;

export const MIGAKU_PRODUCTION_FRONT_TEMPLATE = `
{{#Production}}
<div class="production-card production-front" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="production-prompt">Prononce le mot manquant à voix haute</div>
  {{#Phrase}}<div class="production-sentence">{{Phrase}}</div>{{/Phrase}}
  {{#Traduction}}
  <details class="production-hint">
    <summary>Voir la traduction</summary>
    <div class="production-hint-content">{{Traduction}}</div>
    <div class="production-hint-warning">Traduction utilisée : Difficile au maximum</div>
  </details>
  {{/Traduction}}
</div>
{{/Production}}
`;

export const MIGAKU_PRODUCTION_BACK_TEMPLATE = `
<div class="production-card back-card" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="back-word">{{Mot}}</div>
  {{#Lecture}}<div class="reading" style="text-align:center">{{Lecture}}</div>{{/Lecture}}
  {{#Phrase}}<div class="back-sentence">{{Phrase}}</div>{{/Phrase}}
  <div class="back-audio-row">
    {{#AudioMot}}<div class="audio audio-word">{{AudioMot}}</div>{{/AudioMot}}
    {{#AudioPhrase}}<div class="audio audio-phrase">{{AudioPhrase}}</div>{{/AudioPhrase}}
  </div>
  <div class="production-repeat">Écoute, puis répète toute la phrase à voix haute.</div>

  {{#Traduction}}
  <div class="translation-content">
    <div class="section-label">Traduction</div>
    {{Traduction}}
  </div>
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

  <div class="production-grading">
    À revoir : absent, faux ou mauvaise lecture · Difficile : flexion, hésitation ou traduction utilisée ·
    Bon : forme exacte en quelques secondes · Facile : immédiat et phrase complète fluide
  </div>
</div>
`;
