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
] as const;

export const MIGAKU_TEMPLATE_MARKER = 'data-subjap-template-version="2"';

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
}
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
`;
