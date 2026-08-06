// ---------------------------------------------------------------------------
// SubJap — browser speechSynthesis TTS (offline-only)
// ---------------------------------------------------------------------------

const JA_VOICE_PATTERNS = [/japan/i, /ja[-_]jp/i, /nihon/i, /日本語/i];

/**
 * Speak `text` using the browser's built-in speechSynthesis.
 * Selects a Japanese voice when available, falls back to the default.
 * Returns a promise that resolves when the utterance completes.
 */
export function speak(text: string, lang = "ja-JP"): Promise<void> {
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;

    if (!synth) {
      reject(new Error("speechSynthesis not available"));
      return;
    }

    // Cancel any ongoing speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    // Try to select a Japanese voice
    const voices = synth.getVoices();
    if (voices.length > 0) {
      const jaVoice = voices.find((v) =>
        JA_VOICE_PATTERNS.some((p) => p.test(v.lang) || p.test(v.name)),
      );
      if (jaVoice) {
        utterance.voice = jaVoice;
      }
    }

    utterance.onend = () => resolve();
    utterance.onerror = (e) => {
      // "canceled" is expected when we cancel ourselves — don't reject
      if (e.error === "canceled" || e.error === "interrupted") {
        resolve();
      } else {
        reject(new Error(`speechSynthesis error: ${e.error}`));
      }
    };

    synth.speak(utterance);
  });
}

/**
 * Check whether speech synthesis is available.
 */
export function isTtsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
