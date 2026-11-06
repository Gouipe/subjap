// ---------------------------------------------------------------------------
// SubJap — State of an update launched from the popup
// ---------------------------------------------------------------------------
//
// The service worker drives the local updater (scripts/native-host.mjs) and
// records its progress here, so the popup can close and reopen meanwhile.

export const NATIVE_UPDATER_HOST = "com.subjap.updater";
export const UPDATE_STATE_KEY = "subjap_update_state";

export type UpdateStep = "pull" | "deps" | "build";

export type UpdateState =
  | { status: "running"; step: UpdateStep; startedAt: number }
  | { status: "error"; message: string };

export const UPDATE_STEP_LABELS: Record<UpdateStep, string> = {
  pull: "Récupération des nouveautés…",
  deps: "Installation des dépendances…",
  build: "Compilation…",
};

/** A run silent for this long is treated as interrupted. */
const RUNNING_STALE_MS = 15 * 60 * 1000;

export function readUpdateState(value: unknown): UpdateState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Partial<Record<string, unknown>>;
  if (state.status === "error" && typeof state.message === "string") {
    return { status: "error", message: state.message };
  }
  if (
    state.status === "running" &&
    (state.step === "pull" || state.step === "deps" || state.step === "build") &&
    typeof state.startedAt === "number" &&
    Date.now() - state.startedAt < RUNNING_STALE_MS
  ) {
    return { status: "running", step: state.step, startedAt: state.startedAt };
  }
  return null;
}
