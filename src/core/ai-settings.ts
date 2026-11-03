// ---------------------------------------------------------------------------
// SubJap — AI settings shared storage module
// ---------------------------------------------------------------------------

export const AI_SETTINGS_STORAGE_KEY = "subjap_ai_settings";
export const MAX_ENRICHMENT_PROMPT_LENGTH = 20_000;

/** Shown when Gemini times out: the service is at fault, not the user's setup. */
export const AI_UNAVAILABLE_MESSAGE =
  "Gemini ne répond pas pour le moment (service lent ou indisponible). Réessaie dans quelques minutes.";

export const DEFAULT_ENRICHMENT_PROMPT = `Crée une note pédagogique très concise pour un apprenant francophone de japonais.

Mot cible : {{targetWord}}
Lecture : {{targetReading}}
Phrase rencontrée : {{sentence}}
Définitions sélectionnées : {{definitions}}

Candidats disponibles pour les exemples de kanji :
{{kanjiCandidates}}

Règles impératives :
- Propose au maximum deux synonymes, seulement s'ils sont très importants et réellement substituables dans un sens proche du contexte. Sinon retourne un tableau vide.
- Pour chaque synonyme, explique en une seule phrase française la différence d'usage avec {{targetWord}}.
- Donne pour chaque kanji du mot cible une définition française en un seul mot.
- Les exemples de kanji doivent provenir exactement des candidats fournis.
- Privilégie les candidats dont familiarity vaut known, learning ou anki. N'utilise un candidat frequent que si aucun candidat familier ne convient.
- Ne retiens un exemple que si le kanji y possède la même lecture que dans le mot cible. En cas de doute, ne le retiens pas.
- Maximum deux exemples par kanji. Il est parfaitement valide de n'en donner aucun.
- Si le mot contient plusieurs kanjis, la phrase d'association doit citer chacun d'eux dans l'ordre, rappeler brièvement leur sens et expliquer comment leurs sens se combinent pour produire celui du mot cible. Par exemple : « 全 (« totalité ») + 国 (« pays ») désignent l'ensemble du pays, donc 全国. » Ne donne pas seulement la définition ou la lecture d'un kanji isolé.
- Présente cette association comme une aide mnémotechnique, jamais comme une étymologie certaine. Si l'association serait trompeuse, retourne une chaîne vide.
- N'ajoute aucune justification, avertissement ou texte hors du JSON.`;

export interface AiSettings {
  enrichmentPrompt: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enrichmentPrompt: DEFAULT_ENRICHMENT_PROMPT,
};

function sanitizeAiSettings(
  raw: Partial<AiSettings> | undefined | null,
): Partial<AiSettings> {
  if (!raw || typeof raw !== "object") return {};
  if (
    typeof raw.enrichmentPrompt !== "string" ||
    raw.enrichmentPrompt.trim().length === 0
  ) {
    return {};
  }
  return {
    enrichmentPrompt: raw.enrichmentPrompt.slice(0, MAX_ENRICHMENT_PROMPT_LENGTH),
  };
}

export async function getAiSettings(): Promise<AiSettings> {
  const stored = await chrome.storage.local.get(AI_SETTINGS_STORAGE_KEY);
  const raw = stored[AI_SETTINGS_STORAGE_KEY] as
    | Partial<AiSettings>
    | undefined;
  return { ...DEFAULT_AI_SETTINGS, ...sanitizeAiSettings(raw) };
}

export async function saveAiSettings(
  partial: Partial<AiSettings>,
): Promise<AiSettings> {
  const current = await getAiSettings();
  const next = { ...current, ...sanitizeAiSettings(partial) };
  await chrome.storage.local.set({ [AI_SETTINGS_STORAGE_KEY]: next });
  return next;
}
