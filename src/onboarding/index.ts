// ---------------------------------------------------------------------------
// SubJap — Onboarding flow controller
// ---------------------------------------------------------------------------
//
// Orchestrates the 3-step onboarding process:
//   1. Dictionary pack download
//   2. AnkiConnect detection + deck/model setup
//   3. Default options
//
// The actual UI pages are built separately (options page, popup).
// This module provides the logic layer: check completion status,
// guide through steps, and persist progress via chrome.storage.local.

import { checkAnkiConnect } from "@/mining/anki";
import { sendMessage } from "@/core/messaging";
import { DEFAULT_OPTIONS, saveOptions } from "@/core/options";
import { DICTIONARY_REVISION_STORAGE_KEY } from "@/dictionary/revision";
import type { OverlayOptions } from "@/core/types";

const STORAGE_KEY = "subjap_onboarding";
const DICT_STORAGE_KEY = "subjap_dictionary_loaded";

export interface OnboardingState {
  completed: boolean;
  currentStep: number;
  dictionaryDownloaded: boolean;
  ankiConfigured: boolean;
  optionsConfigured: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Read the current onboarding state from storage. */
export async function getOnboardingState(): Promise<OnboardingState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    return stored[STORAGE_KEY] as OnboardingState;
  }
  return {
    completed: false,
    currentStep: 0,
    dictionaryDownloaded: false,
    ankiConfigured: false,
    optionsConfigured: false,
  };
}

/** Persist the onboarding state to storage. */
export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** Check whether the user has completed onboarding. */
export async function isOnboardingComplete(): Promise<boolean> {
  const state = await getOnboardingState();
  return state.completed;
}

// ── Step handlers ─────────────────────────────────────────────────────────

/** Step 1: Mark the dictionary as downloaded. */
export async function completeDictionaryStep(): Promise<void> {
  const state = await getOnboardingState();
  state.dictionaryDownloaded = true;
  state.currentStep = Math.max(state.currentStep, 1);
  await saveOnboardingState(state);
}

/** Step 2: Check AnkiConnect availability and mark as configured. */
export async function completeAnkiStep(): Promise<boolean> {
  const { connected, deckNames } = await checkAnkiConnect();
  if (!connected || deckNames.length === 0) {
    return false;
  }
  await sendMessage("anki:setup", {});

  const state = await getOnboardingState();
  state.ankiConfigured = true;
  state.currentStep = Math.max(state.currentStep, 2);
  await saveOnboardingState(state);
  return true;
}

/** Step 2 (fallback): continue onboarding without AnkiConnect. */
export async function skipAnkiStep(): Promise<void> {
  const state = await getOnboardingState();
  state.ankiConfigured = false;
  state.currentStep = Math.max(state.currentStep, 2);
  await saveOnboardingState(state);
}

/** Step 3: Save default options and mark onboarding as complete. */
export async function completeOptionsStep(
  options: Partial<OverlayOptions> = {},
): Promise<void> {
  const merged: OverlayOptions = { ...DEFAULT_OPTIONS, ...options };
  await saveOptions(merged);

  const state = await getOnboardingState();
  state.optionsConfigured = true;
  state.completed = true;
  state.currentStep = 3;
  await saveOnboardingState(state);
}

/** Reset onboarding (e.g., for testing or "start over" button). */
export async function resetOnboarding(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
  await chrome.storage.local.remove("subjap_options");
  await chrome.storage.local.remove(DICT_STORAGE_KEY);
  await chrome.storage.local.remove(DICTIONARY_REVISION_STORAGE_KEY);
}

/** Check whether the dictionary data has been loaded into IndexedDB. */
export async function isDictionaryLoaded(): Promise<boolean> {
  const stored = await chrome.storage.local.get(DICT_STORAGE_KEY);
  return stored[DICT_STORAGE_KEY] === true;
}

/** Mark the dictionary as loaded into IndexedDB. */
export async function markDictionaryLoaded(): Promise<void> {
  const stored = await chrome.storage.local.get(DICTIONARY_REVISION_STORAGE_KEY);
  const previousRevision = stored[DICTIONARY_REVISION_STORAGE_KEY] as number | undefined;
  const revision = (typeof previousRevision === "number" ? previousRevision : 0) + 1;
  await chrome.storage.local.set({
    [DICT_STORAGE_KEY]: true,
    [DICTIONARY_REVISION_STORAGE_KEY]: revision,
  });
}
