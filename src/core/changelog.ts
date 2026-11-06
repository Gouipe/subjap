// ---------------------------------------------------------------------------
// SubJap — Release notes from CHANGELOG.md
// ---------------------------------------------------------------------------
//
// The CHANGELOG.md compiled into the extension is compared with:
// - the one on GitHub, to announce an update and what it brings;
// - the one last acknowledged in the popup, to show what the installed
//   update brought.
// A line is identified by its text, so a line present in the newer file and
// absent from the older one is a novelty.

import bundledChangelog from "../../CHANGELOG.md?raw";

export const REMOTE_CHANGELOG_URL =
  "https://raw.githubusercontent.com/Gouipe/subjap/master/CHANGELOG.md";
const REMOTE_CACHE_KEY = "subjap_changelog_remote";
const SEEN_KEY = "subjap_changelog_seen";
const REMOTE_MAX_AGE_MS = 60 * 60 * 1000;

/** Display order; a category unknown to this build follows them. */
const CATEGORY_ORDER = ["Fonctionnalités", "Corrections", "Refonte"];

export interface ChangelogGroup {
  category: string;
  items: string[];
}

interface ChangelogItem {
  category: string;
  text: string;
}

export function parseChangelog(markdown: string): ChangelogItem[] {
  const items: ChangelogItem[] = [];
  let category = "";
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      category = "";
    } else if (line.startsWith("### ")) {
      category = line.slice(4).trim();
    } else if (category && /^[-*]\s+/.test(line)) {
      items.push({ category, text: line.replace(/^[-*]\s+/, "").trim() });
    }
  }
  return items;
}

/** Lines of `newer` absent from `older`, grouped by category. */
export function changelogAdditions(newer: string, older: string): ChangelogGroup[] {
  const known = new Set(parseChangelog(older).map((item) => item.text));
  const groups = new Map<string, string[]>();
  for (const item of parseChangelog(newer)) {
    if (known.has(item.text)) continue;
    known.add(item.text);
    const items = groups.get(item.category) ?? [];
    items.push(item.text);
    groups.set(item.category, items);
  }
  const rank = (category: string): number => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => rank(a.category) - rank(b.category));
}

export function countChangelogItems(groups: ChangelogGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

interface RemoteCache {
  fetchedAt: number;
  text: string;
}

/** GitHub's CHANGELOG.md, fetched at most once an hour; null when unreachable. */
async function remoteChangelog(): Promise<string | null> {
  const stored = await chrome.storage.local.get(REMOTE_CACHE_KEY);
  const cached = stored[REMOTE_CACHE_KEY] as RemoteCache | undefined;
  if (cached && typeof cached.text === "string" && Date.now() - cached.fetchedAt < REMOTE_MAX_AGE_MS) {
    return cached.text;
  }
  try {
    const response = await fetch(REMOTE_CHANGELOG_URL, { cache: "no-store" });
    if (!response.ok) return cached?.text ?? null;
    const text = await response.text();
    await chrome.storage.local.set({ [REMOTE_CACHE_KEY]: { fetchedAt: Date.now(), text } });
    return text;
  } catch {
    return cached?.text ?? null;
  }
}

/** What an update would bring; empty when up to date or offline. */
export async function availableUpdateNotes(): Promise<ChangelogGroup[]> {
  const remote = await remoteChangelog();
  return remote === null ? [] : changelogAdditions(remote, bundledChangelog);
}

/**
 * What the installed update brought and the popup has not shown yet. The
 * first run only records the current notes: the onboarding presents SubJap.
 */
export async function unseenReleaseNotes(): Promise<ChangelogGroup[]> {
  const stored = await chrome.storage.local.get(SEEN_KEY);
  const seen: unknown = stored[SEEN_KEY];
  if (typeof seen !== "string") {
    await acknowledgeReleaseNotes();
    return [];
  }
  if (seen === bundledChangelog) return [];
  const groups = changelogAdditions(bundledChangelog, seen);
  if (groups.length === 0) await acknowledgeReleaseNotes();
  return groups;
}

export async function acknowledgeReleaseNotes(): Promise<void> {
  await chrome.storage.local.set({ [SEEN_KEY]: bundledChangelog });
}
