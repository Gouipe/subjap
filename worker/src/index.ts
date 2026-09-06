const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_SCHEMA_LENGTH = 20_000;
const GEMINI_TIMEOUT_MS = 15_000;

interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS?: string;
}

interface EnrichmentRequest {
  prompt: string;
  responseSchema: Record<string, unknown>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function allowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin");
  if (!origin) return "";
  const allowed = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes("*") || allowed.includes(origin) ? origin : "";
}

function headers(request: Request, env: Env): Headers {
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    result.set("Access-Control-Allow-Origin", origin);
    result.set("Access-Control-Allow-Headers", "Content-Type");
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return result;
}

function json(request: Request, env: Env, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(request, env) });
}

function isRequest(value: unknown): value is EnrichmentRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.prompt === "string" &&
    request.prompt.length > 0 &&
    request.prompt.length <= MAX_PROMPT_LENGTH &&
    typeof request.responseSchema === "object" &&
    request.responseSchema !== null &&
    JSON.stringify(request.responseSchema).length <= MAX_SCHEMA_LENGTH
  );
}

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    // These constraints belong to the browser-side validation contract but
    // are not accepted by GenerateContent's responseSchema subset.
    if (key === "additionalProperties" || key === "maxLength") continue;
    result[key] = toGeminiSchema(child);
  }
  return result;
}

async function generate(
  request: EnrichmentRequest,
  env: Env,
): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(request.responseSchema),
          maxOutputTokens: 900,
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Gemini HTTP ${response.status}.`);
    }
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Gemini n’a renvoyé aucun texte.");
    return { text, model: GEMINI_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json(request, env, {});
    if (request.method !== "POST") {
      return json(request, env, { error: "Méthode non autorisée." }, 405);
    }
    if (!env.GEMINI_API_KEY) {
      return json(request, env, { error: "GEMINI_API_KEY est absent du Worker." }, 500);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(request, env, { error: "Corps JSON invalide." }, 400);
    }
    if (!isRequest(payload)) {
      return json(request, env, { error: "Requête d’enrichissement invalide." }, 400);
    }

    try {
      return json(request, env, await generate(payload, env));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return json(request, env, { error: "Gemini a dépassé 15 secondes." }, 504);
      }
      console.error("Gemini enrichment failed", error);
      return json(
        request,
        env,
        { error: error instanceof Error ? error.message : "Erreur Gemini." },
        502,
      );
    }
  },
};
