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
export const MIGAKU_TEMPLATE_MARKER_V10 = 'data-subjap-template-version="10"';
export const MIGAKU_TEMPLATE_MARKER_V11 = 'data-subjap-template-version="11"';
export const MIGAKU_TEMPLATE_MARKER_V12 = 'data-subjap-template-version="12"';
export const MIGAKU_TEMPLATE_MARKER_V13 = 'data-subjap-template-version="13"';
export const MIGAKU_TEMPLATE_MARKER = 'data-subjap-template-version="14"';
export const MIGAKU_COMPREHENSION_TEMPLATE_NAME = "Compréhension";
export const MIGAKU_PRODUCTION_TEMPLATE_NAME = "Production";

export const ANKI_VOCABULARY_PARENT_DECK = "日本語::Vocabulaire";
export const ANKI_COMPREHENSION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Compréhension`;
export const ANKI_PRODUCTION_DECK = `${ANKI_VOCABULARY_PARENT_DECK}::Production`;
/** Marks a note whose production card the extension must create outside reviews. */
export const ANKI_PRODUCTION_REQUEST_TAG = "subjap::production-demandee";

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

/* Recent Anki versions render replay buttons as an inline SVG disc. */
.card .audio .replay-button svg {
  width: 50px;
  height: 50px;
}

.card .audio .replay-button svg circle {
  fill: var(--surface-raised);
  stroke: var(--border);
  stroke-width: 1.5px;
}

.card .audio .replay-button svg path {
  fill: var(--text);
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

/* Centered so the audio and translation controls share one inline row. */
.back-card {
  max-width: 800px;
  text-align: center;
}

.back-word {
  margin: 0 0 8px;
  color: var(--accent-strong);
  font-size: 44px;
  font-weight: 600;
  line-height: 1.25;
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
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  margin: 6px 4px 18px;
  vertical-align: middle;
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
  cursor: pointer;
}

.audio-label {
  color: var(--muted);
  font-size: 12px;
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

.card .audio-control .replay-button {
  display: inline-flex;
  margin: 0;
}

.card .audio-control .replay-button svg {
  width: 20px;
  height: 20px;
}

.card .audio-control .replay-button svg circle {
  fill: var(--muted);
  stroke: none;
}

.card .audio-control .replay-button svg path {
  fill: var(--surface-raised);
}

.audio-control:hover {
  border-color: var(--accent);
}

.audio-control:hover .audio-label,
.translation-reveal > summary:hover {
  color: var(--text);
}

.card .audio-control:hover .replay-button svg circle {
  fill: var(--text);
}

.audio-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.audio-shortcut,
.translation-shortcut {
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  line-height: 1;
}

.back-divider {
  height: 1px;
  margin: 0 0 22px;
  background: var(--border);
}

.definition-panel {
  max-width: 760px;
  margin: 0 auto 18px;
  text-align: left;
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
  text-align: left;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
}

/* Closed, it sits beside the audio controls; open, the translation takes a full row. */
.translation-reveal {
  display: inline-block;
  margin: 6px 4px 18px;
  vertical-align: middle;
  text-align: center;
}

.translation-reveal[open] {
  display: block;
  margin: 0 0 18px;
}

.translation-reveal > summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  min-height: 36px;
  box-sizing: border-box;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  transition: border-color 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.translation-reveal > summary::-webkit-details-marker {
  display: none;
}

.translation-reveal > summary:hover {
  border-color: var(--accent);
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
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.notes-term {
  color: var(--text);
  font-weight: 600;
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
    margin-bottom: 6px;
    font-size: 44px;
    line-height: 1.2;
  }

  .back-sentence {
    padding: 4px 10px 2px;
    font-size: 24px;
    line-height: 1.5;
  }

  .back-audio-row {
    gap: 7px;
    min-height: 36px;
    margin: 5px 4px 14px;
  }

  .audio-control {
    min-height: 34px;
    padding: 4px 9px 4px 8px;
  }

  .audio-label {
    font-size: 12px;
  }

  .translation-reveal {
    margin: 5px 4px 14px;
  }

  .translation-reveal[open] {
    margin: 0 0 14px;
  }

  .translation-reveal > summary {
    min-height: 34px;
    padding: 4px 9px;
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

}

/* Back layout: one centered column read top to bottom, whatever the window width:
   study (word sheet) → scene (image, sentence, controls) → notes. */
.back-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  max-width: 760px;
  text-align: left;
}

.back-layout .study-column {
  min-width: 0;
}

/* The scene is a panel like the word sheet: image flush on top, then its caption and controls. */
.back-layout .scene-column {
  min-width: 0;
  overflow: hidden;
  padding-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  text-align: center;
}

/* The word heads the sheet with its word-level action beside it; the definitions span below. */
.word-sheet {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "word action"
    "definitions definitions";
  column-gap: 16px;
  align-items: start;
  padding: 18px 22px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.back-layout .back-word {
  grid-area: word;
  margin: 0;
  text-align: left;
}

/* The reading sits grouped under the word instead of furigana spread over it. */
.back-word ruby {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
}

.back-word rt {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.08em;
  line-height: 1.3;
}

/* One sense per block: the kept sense leads, further senses stay secondary. */
.definitions .sense + .sense,
.production-definitions .sense + .sense {
  margin-top: 4px;
  color: var(--muted);
  font-size: 15px;
  font-weight: 400;
}

.word-sheet .definitions {
  grid-area: definitions;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--text);
  font-size: 19px;
  font-weight: 500;
  line-height: 1.5;
}

.back-layout .back-image {
  max-width: none;
  margin: 0;
  background: var(--bg);
}

/* High enough for a 16:9 picture to fill the column width in usual review windows. */
.back-layout .back-image img {
  max-height: min(460px, 60vh);
  border-radius: 0;
}

.back-layout .back-sentence {
  padding: 16px 20px 0;
  font-size: 28px;
}

.scene-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 12px 20px 0;
}

/* Audio controls join the translation button as direct flex items. */
.scene-controls .back-audio-row {
  display: contents;
}

.scene-controls .translation-reveal,
.scene-controls .translation-reveal[open] {
  margin: 0;
}

.scene-controls .translation-reveal[open] {
  flex-basis: 100%;
}

/* Revealed in place of its button, the translation needs no label of its own. */
.scene-column .translation-content {
  margin-top: 4px;
  padding: 12px 8px 0;
}

.scene-column .translation-content .section-label {
  display: none;
}

/* Blurred in place under the sentence: its line is reserved, so revealing it moves nothing. */
.translation-veil {
  display: block;
  max-width: 70ch;
  margin: 4px auto 0;
  padding: 2px 12px;
  border-radius: 6px;
  color: var(--text);
  font-size: 18px;
  line-height: 1.5;
  text-align: center;
  cursor: pointer;
}

/* The W hint hangs to the right of the line, outside its width, so the text stays centered. */
.translation-line {
  position: relative;
  display: inline-block;
}

.translation-line .translation-shortcut {
  position: absolute;
  top: 50%;
  left: 100%;
  margin-left: 10px;
  transform: translateY(-50%);
}

.translation-veil .translation-text {
  filter: blur(7px);
  user-select: none;
  transition: filter 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.translation-veil:hover .translation-shortcut {
  color: var(--text);
}

.translation-veil:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.translation-veil.is-revealed {
  cursor: auto;
}

.translation-veil.is-revealed .translation-text {
  filter: none;
  user-select: text;
}

@media (prefers-reduced-motion: reduce) {
  .translation-veil .translation-text {
    transition: none;
  }
}

/* Replays beside the word and at the end of the sentence: icon and shortcut, no label. */
.audio-control.audio-inline {
  gap: 6px;
  min-height: 0;
  margin-left: 12px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  line-height: 1;
  vertical-align: middle;
}

.audio-control.audio-inline .audio-label {
  display: none;
}

/* Anki's own replay disc, restyled: a quiet raised circle with a slim triangle. */
.card .audio-control.audio-inline .replay-button svg,
.audio-control.audio-inline img.replay-button {
  width: 30px;
  height: 30px;
  padding: 0;
}

.card .audio-control.audio-inline .replay-button svg circle {
  fill: var(--surface-raised);
  stroke: var(--border);
  stroke-width: 2;
  transition: fill 160ms cubic-bezier(0.22, 1, 0.36, 1), stroke 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.card .audio-control.audio-inline .replay-button svg path {
  fill: var(--text);
  transform: scale(0.55);
  transform-box: view-box;
  transform-origin: 32px 32px;
}

.card .audio-control.audio-inline:hover .replay-button svg circle {
  fill: var(--accent);
  stroke: var(--accent);
}

/* Shortcut reminders beside the replays and the blurred translation: a plain letter, no key cap. */
.audio-control.audio-inline .audio-shortcut,
.translation-line .translation-shortcut {
  padding: 0;
  border: 0;
  color: var(--muted);
  font-weight: 600;
}

.audio-control.audio-inline:hover .audio-shortcut {
  color: var(--text);
}

@media (prefers-reduced-motion: reduce) {
  .card .audio-control.audio-inline .replay-button svg circle {
    transition: none;
  }
}

/* Activating production is a decision about the word: a discreet action beside it, top right. */
.word-sheet .production-activation {
  grid-area: action;
  align-items: flex-end;
  max-width: 260px;
  margin: 8px 0 0;
  padding: 0;
  text-align: right;
}

.word-sheet .production-activation-button {
  padding: 5px 10px;
  background: transparent;
  color: var(--muted);
  font-weight: 500;
}

/* Same hover as the scene controls: accent border, brighter text. */
.word-sheet .production-activation-button:hover,
.word-sheet .production-activation-button:focus-visible {
  color: var(--text);
}

.word-sheet .production-activation-button[data-state="success"] {
  color: var(--priority-green, #78d6a3);
}

/* The explanation stays in the button tooltip and for screen readers. */
.word-sheet .production-activation-hint {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.back-layout .back-notes {
  min-width: 0;
  max-width: none;
  margin: 0;
  background: var(--surface);
}

/* The column already bounds the reading measure: notes use the full panel width. */
.back-layout .notes {
  max-width: none;
}

.kanji-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  margin: 2px 0 12px;
}

.kanji-tiles:last-child {
  margin-bottom: 0;
}

.kanji-tile {
  padding: 10px 12px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
}

.kanji-tile-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.kanji-tile-char {
  color: var(--text);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.2;
}

.kanji-tile-meaning {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.kanji-tile-examples {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
`;

export const MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT = `
{{^Production}}
<div class="production-activation">
  <span class="production-activation-tags" hidden>{{Tags}}</span>
  <button class="production-activation-button" id="subjap-activate-production" type="button"
    aria-describedby="subjap-production-hint" title="À réserver aux mots utiles à l’oral">
    Activer la production orale
  </button>
  <div class="production-activation-hint" id="subjap-production-hint">Crée une carte sœur de production orale.</div>
  <div class="production-activation-status" id="subjap-production-status" role="status" aria-live="polite"></div>
</div>
<script>
(() => {
  const button = document.getElementById("subjap-activate-production");
  const status = document.getElementById("subjap-production-status");
  if (!button || !status) return;
  const block = button.closest(".production-activation");
  const tags = block && block.querySelector(".production-activation-tags");

  const showActivated = () => {
    const done = document.createElement("div");
    done.className = "production-activation-status";
    done.textContent = "Production orale activée";
    block.replaceChildren(done);
  };

  // The sister card is created by the extension outside reviews: until then the tag marks the request.
  if (tags && tags.textContent.trim().split(" ").includes("${ANKI_PRODUCTION_REQUEST_TAG}")) {
    showActivated();
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

      // Only tag the note: creating, moving or suspending a card now would make Anki
      // rebuild its queue and possibly replace the card under review with another one.
      await invoke("addTags", { notes: [currentInfo.note], tags: "${ANKI_PRODUCTION_REQUEST_TAG}" });
      showActivated();
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

// Keep the managed script ID stable so existing templates receive both shortcuts.
export const MIGAKU_AUDIO_CONTROLS_FRAGMENT = `
<script id="subjap-anki-audio-controls">
(() => {
  const audioShortcuts = [
    { selector: ".audio-word", key: "Z", label: "Rejouer le mot" },
    { selector: ".audio-phrase", key: "Q", label: "Rejouer la phrase" },
  ];
  const controls = document.querySelectorAll(".audio-control");
  controls.forEach((control) => {
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    const shortcut = audioShortcuts.find(({ selector }) => control.matches(selector));
    if (shortcut) {
      control.setAttribute("aria-label", shortcut.label);
      control.setAttribute("aria-keyshortcuts", shortcut.key);
      control.setAttribute("title", shortcut.label + " (" + shortcut.key + ")");
      if (!control.querySelector(".audio-shortcut")) {
        const hint = document.createElement("kbd");
        hint.className = "audio-shortcut";
        hint.textContent = shortcut.key;
        hint.setAttribute("aria-hidden", "true");
        control.appendChild(hint);
      }
    }
  });

  // The translation sits blurred right under the sentence, its space already taken, so revealing it
  // moves nothing. Built from the template's details block, which stays the fallback without script.
  const translationReveal = document.querySelector(".back-card details.translation-reveal");
  const translationContent = translationReveal?.querySelector(".translation-content");
  if (translationReveal && translationContent && !document.querySelector(".back-card .translation-veil")) {
    translationContent.querySelector(".section-label")?.remove();
    const text = document.createElement("span");
    text.className = "translation-text";
    text.setAttribute("aria-hidden", "true");
    text.append(...translationContent.childNodes);
    const hint = document.createElement("kbd");
    hint.className = "translation-shortcut";
    hint.textContent = "W";
    hint.setAttribute("aria-hidden", "true");
    const veil = document.createElement("div");
    veil.className = "translation-veil";
    veil.setAttribute("role", "button");
    veil.setAttribute("tabindex", "0");
    veil.setAttribute("aria-label", "Afficher la traduction");
    veil.setAttribute("aria-keyshortcuts", "W");
    veil.setAttribute("title", "Afficher la traduction (W)");
    // The hint hangs outside the line so the text stays centered once it goes away.
    const line = document.createElement("span");
    line.className = "translation-line";
    line.append(text, hint);
    veil.appendChild(line);
    const sentence = document.querySelector(".back-card .back-sentence");
    if (sentence) sentence.after(veil);
    else translationReveal.before(veil);
    translationReveal.remove();
  }

  // Each replay sits beside what it plays: the word's after the word, the sentence's at its end.
  // The controls row then disappears once nothing is left in it.
  [
    [".back-card .audio-control.audio-word", ".back-card .back-word"],
    [".back-card .audio-control.audio-phrase", ".back-card .back-sentence"],
  ].forEach(([controlSelector, hostSelector]) => {
    const control = document.querySelector(controlSelector);
    const host = document.querySelector(hostSelector);
    if (!control || !host || host.contains(control)) return;
    control.classList.add("audio-inline");
    host.appendChild(control);
  });
  document.querySelectorAll(".back-card .back-audio-row").forEach((row) => {
    if (!row.querySelector(".audio-control")) row.remove();
  });
  document.querySelectorAll(".back-card .scene-controls").forEach((row) => {
    if (row.children.length === 0) row.remove();
  });

  // Notes are plain text lines: kanji headings and their examples become tiles; the remaining
  // lines stay as text with emphasized enrichment labels. Unrecognized lines are kept as they are.
  document.querySelectorAll(".back-card .notes").forEach((notes) => {
    if (notes.dataset.subjapFormatted) return;
    notes.dataset.subjapFormatted = "1";

    const isBlock = (node) => node.nodeType === Node.ELEMENT_NODE && /^(?:DIV|P)$/u.test(node.nodeName);
    const lines = [];
    let current = [];
    Array.from(notes.childNodes).forEach((node) => {
      if (node.nodeName === "BR") {
        lines.push(current);
        current = [];
      } else if (isBlock(node)) {
        if (current.length > 0) lines.push(current);
        lines.push([node]);
        current = [];
      } else {
        current.push(node);
      }
    });
    lines.push(current);
    const lineText = (line) => line.map((node) => node.textContent).join("").trim();

    const tiles = [];
    const rest = [];
    let tile = null;
    lines.forEach((line) => {
      const text = lineText(line);
      const heading = /^(\\p{Script=Han}{1,2}) — (.+)$/u.exec(text);
      if (heading) {
        tile = { character: heading[1], meaning: heading[2], examples: [] };
        tiles.push(tile);
        return;
      }
      if (tile && text.startsWith("・")) {
        tile.examples.push(text.slice(1).trim());
        return;
      }
      tile = null;
      rest.push(line);
    });
    if (tiles.length === 0 && !rest.some((line) => /^(?:Synonyme|Nuance|Association) :/u.test(lineText(line)))) return;

    // Drop the blank lines left around extracted tiles.
    const textLines = [];
    rest.forEach((line) => {
      const blank = lineText(line) === "";
      if (blank && (textLines.length === 0 || textLines[textLines.length - 1] === null)) return;
      textLines.push(blank ? null : line);
    });
    while (textLines.length > 0 && textLines[textLines.length - 1] === null) textLines.pop();

    notes.replaceChildren();
    if (tiles.length > 0) {
      const grid = document.createElement("div");
      grid.className = "kanji-tiles";
      tiles.forEach((item) => {
        const element = document.createElement("div");
        element.className = "kanji-tile";
        const head = document.createElement("div");
        head.className = "kanji-tile-head";
        const character = document.createElement("span");
        character.className = "kanji-tile-char";
        character.textContent = item.character;
        const meaning = document.createElement("span");
        meaning.className = "kanji-tile-meaning";
        meaning.textContent = item.meaning;
        head.append(character, meaning);
        element.appendChild(head);
        if (item.examples.length > 0) {
          const list = document.createElement("ul");
          list.className = "kanji-tile-examples";
          item.examples.forEach((example) => {
            const entry = document.createElement("li");
            entry.textContent = example;
            list.appendChild(entry);
          });
          element.appendChild(list);
        }
        grid.appendChild(element);
      });
      notes.appendChild(grid);
    }
    if (textLines.length === 0) return;

    const text = document.createElement("div");
    text.className = "notes-text";
    textLines.forEach((line, index) => {
      if (line) {
        const [first, ...others] = line;
        const label = first && first.nodeType === Node.TEXT_NODE
          ? /^(\\s*)((?:Synonyme|Nuance|Association) :)/u.exec(first.data)
          : null;
        if (label) {
          const remainder = first.splitText(label[0].length);
          const term = document.createElement("span");
          term.className = "notes-term";
          term.textContent = label[2];
          first.data = label[1];
          text.append(first, term, remainder, ...others);
        } else {
          text.append(...line);
        }
      }
      const last = line && line[line.length - 1];
      if (index < textLines.length - 1 && !(last && isBlock(last))) {
        text.appendChild(document.createElement("br"));
      }
    });
    notes.appendChild(text);
  });

  // The production block follows the card in the template: move it into the word sheet,
  // whose grid shows it beside the word.
  // Deferred because Anki runs the card's scripts in document order while this one executes;
  // moving the block (and its script) earlier now would make Anki skip that script.
  setTimeout(() => {
    const activation = document.querySelector(".production-activation");
    const sheet = document.querySelector(".back-layout .word-sheet");
    if (activation && sheet && !sheet.contains(activation)) sheet.appendChild(activation);
  }, 0);

  // Anki reuses the document between cards: replace, rather than accumulate, listeners.
  if (window.__subjapAudioControlsCleanup) window.__subjapAudioControlsCleanup();

  const activate = (control) => {
    const replay = control.querySelector("a.replay-button, button.replay-button, img.replay-button");
    const clickable = replay?.closest("a, button") ?? replay;
    if (!(clickable instanceof HTMLElement)) return false;
    clickable.click();
    return true;
  };

  // Once revealed, the translation stays visible for the rest of the card.
  const revealTranslation = (veil) => {
    if (veil.classList.contains("is-revealed")) return;
    veil.classList.add("is-revealed");
    ["role", "tabindex", "aria-label", "aria-keyshortcuts", "title"].forEach((name) => veil.removeAttribute(name));
    veil.querySelector(".translation-text")?.removeAttribute("aria-hidden");
    veil.querySelector(".translation-shortcut")?.remove();
  };

  const onClick = (event) => {
    if (!(event.target instanceof Element)) return;
    const veil = event.target.closest(".back-card .translation-veil");
    if (veil) {
      revealTranslation(veil);
      return;
    }
    const control = event.target.closest(".audio-control");
    if (!control || event.target.closest("a.replay-button, button.replay-button, img.replay-button")) return;
    activate(control);
  };
  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
    if (!event.shiftKey && event.key.toLowerCase() === "w") {
      const veil = document.querySelector(".back-card .translation-veil");
      const translation = document.querySelector(".back-card details.translation-reveal");
      if (veil) revealTranslation(veil);
      else if (translation instanceof HTMLDetailsElement) translation.open = true;
      if (veil || translation) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const audioKeys = { q: ".audio-phrase", z: ".audio-word" };
    const audioSelector = event.shiftKey ? undefined : audioKeys[event.key.toLowerCase()];
    if (audioSelector) {
      const control = document.querySelector(".back-card .audio-control" + audioSelector);
      if (control && activate(control)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target instanceof Element && event.target.matches(".translation-veil:not(.is-revealed)")) {
      event.preventDefault();
      event.stopPropagation();
      revealTranslation(event.target);
      return;
    }
    const control = event.target instanceof Element && event.target.matches(".audio-control") ? event.target : null;
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    activate(control);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.__subjapAudioControlsCleanup = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
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

/** Single-column back body used up to template version 13, recognized to upgrade it in place. */
export const MIGAKU_LEGACY_BACK_BODY = `
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
`;

export const MIGAKU_BACK_BODY = `<div class="card-shell back-card back-layout" ${MIGAKU_TEMPLATE_MARKER}>
  <section class="study-column">
    <div class="word-sheet">
      <div class="back-word">{{Mot}}</div>
      {{#Définitions}}<div class="definitions">{{Définitions}}</div>{{/Définitions}}
    </div>
  </section>

  <section class="scene-column">
    {{#Image}}<div class="back-image">{{Image}}</div>{{/Image}}
    {{#Phrase}}<div class="back-sentence">{{Phrase}}</div>{{/Phrase}}
    <div class="scene-controls">
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
    </div>
  </section>

  {{#Notes}}
  <section class="back-notes">
    <div class="section-label">Notes</div>
    <div class="notes">{{Notes}}</div>
  </section>
  {{/Notes}}
</div>`;

const MIGAKU_SHARED_BACK_TEMPLATE = `
${MIGAKU_BACK_BODY}
${MIGAKU_REVIEW_SHORTCUTS_FRAGMENT}
${MIGAKU_AUDIO_CONTROLS_FRAGMENT}
`;

export const MIGAKU_BACK_TEMPLATE = `
${MIGAKU_SHARED_BACK_TEMPLATE}
${MIGAKU_PRODUCTION_ACTIVATION_FRAGMENT}
`;

export const MIGAKU_PRODUCTION_FRONT_TEMPLATE = `
{{#Production}}
<div class="production-card production-front" ${MIGAKU_TEMPLATE_MARKER}>
  <div class="production-prompt">Retrouve le mot japonais et prononce-le à voix haute</div>
  {{#Définitions}}<div class="production-definitions">{{Définitions}}</div>{{/Définitions}}
</div>
{{/Production}}
`;

export const MIGAKU_PRODUCTION_BACK_TEMPLATE = MIGAKU_SHARED_BACK_TEMPLATE;
