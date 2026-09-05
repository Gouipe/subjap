# Plan — stabilize Q / S / D subtitle navigation on Netflix

Date: 2026-09-04
Status: analysis done, implementation not started.
Audience: the agent implementing the fix. Read `AGENTS.md` first (no tests are
created or run; work in a worktree; merge into `master`; run `npm.cmd run build`;
commit).

## 1. Symptom

The three navigation keys installed by `installPlaybackShortcuts()` in
`src/content/shortcuts.ts`:

| Key | Action     | Intended target                                   |
| --- | ---------- | ------------------------------------------------- |
| Q   | `previous` | start of the subtitle before the one on screen    |
| S   | `current`  | start of the subtitle on screen                   |
| D   | `next`     | start of the subtitle after the one on screen     |

About one press in ten does not land where expected: it lands a few hundred
milliseconds off the real start, replays the same cue instead of moving, or
does nothing. Rewinding ten seconds with Netflix's own controls, letting the
video play, then pressing the same key at the same instant works. The failure is
therefore **state-dependent**, not a property of the media position.

## 2. How navigation works today

Two independent sources of cue timing feed `CueNavigator`:

1. **DOM-observed cues** (`NetflixAdapter.emitCues`, `src/adapters/netflix.ts`).
   Netflix's `.player-timedtext` lines carry no `data-start`/`data-end` in
   practice. A cue is created when the text appears, with
   `start = observationTime - 0.15` (`FALLBACK_CUE_PREROLL_SECONDS`),
   `end = start`, `endConfirmed = false`. The end is filled in when the text
   disappears. These cues reach the navigator through
   `cueNavigator.observe(japaneseCues)` in `src/content/index.ts`.
2. **The official TTML track** captured by the page bridge and fetched by the
   service worker (`storeTimedText`). It has exact start/end for every cue and
   reaches the navigator through `cueNavigator.remember(adapter.getNavigationCues())`.

`CueNavigator` merges both into one `observedCues` map and decides equality
with `isEquivalentCue()`: same language, **identical compact text**, and starts
within 1 s or overlapping ranges. `getSeekTime()` then:

- reuses a stored `seekAnchor` as the base cue when the previous press had the
  same action, or when the media clock is within 0.5 s of the anchor's start;
- otherwise finds the base cue by time containment, first in `currentCues`
  (the displayed set), then in **all** observed cues, then falls back to
  `currentCues[0]`;
- picks previous/next by sorting every observed cue by start.

The adapter also keeps `pendingSeekTarget` after every programmatic seek and
suppresses every emission until an emission's clock is within 0.5 s of the
target.

## 3. Root causes (ranked by likely impact)

### RC1 — Two timelines merged by text equality produce near-duplicate cues

`isEquivalentCue()` requires identical text after `normalizeCueText` and
whitespace removal. Real Netflix data breaks this in several ways:

- **Furigana.** `parseTTML()` (`src/subtitles/parse.ts`) strips tags with
  `.replace(/<[^>]+>/g, "")`, so an IMSC ruby span
  `<span tts:ruby="base">漢字</span><span tts:ruby="text">かんじ</span>` becomes
  `漢字かんじ`. The DOM reader `textWithoutRubyAnnotations()` removes `<rt>` and
  yields `漢字`. Every cue with furigana therefore exists twice in the
  navigator: the official cue with the exact start, and a provisional DOM cue
  with `start ≈ official − 0.15 ± jitter`.
- **Two speakers on screen at once.** Netflix renders two `<p>` cues with
  overlapping times as two lines; the DOM cue text is `A\nB`, the official cues
  are `A` and `B`. Three entries for one moment.
- **Several bodies for the same language.** `storeTimedText()` merges every
  body it receives for `ja` (each track exposes several `ttDownloadables`
  formats; a `Japanese [CC]` track may also be fetched) using the key
  `start:end:text`. Format differences (ruby markup, tick precision, sound
  descriptions) produce duplicates with the same or near-identical timing.
- The same mismatch makes `getMatchingTrackCue()` fail in the adapter, so the
  displayed cue keeps provisional timing and `endConfirmed: false`.

Consequence: with base cue N (official) and its provisional twin N′ at
`N.start − 0.15`, Q returns N′ (same subtitle, 150 ms earlier) and D returns a
twin that starts a few hundred milliseconds later. This is exactly "does not
go to the beginning" and "does nothing".

### RC2 — The provisional start depends on which code path observed the cue

When the seek lands, `emitCues()` is usually triggered by `timeupdate`, so
`observationTime = video.currentTime` (up to 250 ms after the landing) rather
than the DOM transition time captured by `scheduleEmit()`. The rebuilt
provisional cue can start before **or** after the official start depending on
the path. The same instant therefore yields a different neighbour ordering
after a SubJap seek than after natural playback. This is why rewinding with
Netflix's controls and replaying "fixes" it.

### RC3 — `seekAnchor` is reused without a lifetime

`canReuseAnchor` is true whenever `seekAnchorAction === action`. The anchor is
only cleared by `applySeekAnchor()` when a **non-empty, non-matching**
`observe()` arrives, by `cancelPendingSeek()`, or by `reset()`. Any situation
where `observe()` stops being called (RC6, listening mode deferral, a swallowed
emission) leaves the anchor stale, and the next press of the same key navigates
from a cue the user left long ago.

### RC4 — Base cue chosen by time containment instead of what is displayed

`findCurrentCue()` searches `currentCues` by `start <= t < end`, then **all**
observed cues, then `currentCues[0]`. Provisional cues have `end === start`, so
they never match containment. Near a cue boundary, Netflix's DOM lags the
official timeline by 0–300 ms: the overlay still shows N while the official
N+1 already contains the clock, so the second search returns N+1. S then
jumps to the next line, Q replays N instead of N−1.

### RC5 — S and D do nothing in gaps; D is a no-op without the official track

`getSeekTime()` returns `null` for `current` and `next` when no base cue is
found, which is the case in every silence between two cues. Without the
official track, `next` with an unconfirmed end falls back to
`Math.max(current.end, currentTime) + 0.05` = `currentTime + 0.05`, a
micro-seek that only flickers the overlay.

### RC6 — Seek landing is detected only by clock proximity

`pendingSeekTarget` is cleared only when an emission's clock is within 0.5 s of
the target. If Netflix drops or coalesces a seek (rapid presses), or the first
post-seek emission is outside the window, every live emission is suppressed
until the clock happens to pass near the old target. The overlay freezes and,
per RC3, the anchor goes stale. There is no `seeked` listener and no timeout.

### RC7 — Minor

- `installPlaybackShortcuts` calls `preventDefault()` but not
  `stopImmediatePropagation()`, unlike the Space handler. Netflix binds `S` to
  "Skip intro" when that button is visible.
- There is no diagnostic output, so bug reports cannot be specific.

## 4. Target design

Guiding rule: **one timeline, identity by time, base cue = what is displayed,
explicit and short-lived pending state.**

### 4.1 `CueNavigator` (rewrite of the internals, same public surface)

State:

```ts
official: SubtitleCue[]      // sorted, from remember(); authoritative when non-empty
domCues: SubtitleCue[]       // sorted, provisional cues that overlap no official cue
displayed: SubtitleCue[]     // last observe() payload, i.e. what the overlay shows
pending: { cue: SubtitleCue; issuedAtMs: number } | null
```

Identity: two cues are the same occurrence when they overlap in time or their
starts are within `MATCH_TOLERANCE_SECONDS = 1` **regardless of text**. For a
provisional cue (`endConfirmed === false`) use the point `start + 0.15` as its
extent. Text equality is only kept for DOM↔DOM canonicalization so a rebuilt
provisional cue keeps the start of its first observation (existing tests
"keeps the original start when Netflix rebuilds the current cue" and "treats
whitespace-only Netflix rebuilds as the same cue" describe this).

`timeline()` = `official` plus every `domCues` entry that overlaps no official
cue, sorted by start. Prev/next are **index moves** on this array.

`remember(cues)`: keep the same-array identity short-circuit; store sorted;
drop `domCues` entries now covered by an official cue; if `pending.cue` maps to
an official cue, replace it.

`observe(cues)`: set `displayed`; for each cue, if an official cue matches it
do nothing (the official cue represents it), else canonicalize against
`domCues` (same compact text + time match → reuse existing object) and store.
If a displayed cue matches `pending.cue`, clear `pending` (the seek has landed
and the overlay reflects it). Never clear `pending` on an empty payload.

`getSeekTime(action, pressedAt)`:

1. **Base cue resolution**, in order:
   1. `pending` exists and `performance.now() − issuedAtMs < PENDING_TTL_MS`
      (1500) → base = `pending.cue`. This is what makes rapid Q Q Q and
      D-then-Q behave as chained moves from the requested destination.
   2. `displayed` non-empty → base = the timeline entry matching
      `displayed[0]` (the official cue when one overlaps, else the DOM cue).
      Exception: if `base.end` is confirmed and
      `pressedAt > base.end + STALE_DISPLAY_SECONDS` (0.75), treat as a gap
      (the DOM is stale).
   3. Otherwise **gap** rules below.
2. **Actions with a base cue** (index `i` in `timeline()`):
   - `current` → `base.start`.
   - `previous` → `timeline[i − 1]?.start ?? null`.
   - `next` → `timeline[i + 1]?.start`; if none and `base.endConfirmed !== false`
     and `base.end > base.start` → `Math.max(base.end, pressedAt) + 0.05`
     (keeps the existing "falls through to the current cue end" behaviour);
     otherwise `null` (no more micro-seeks).
3. **Gap rules** (nothing displayed):
   - `previous` and `current` → start of the last timeline cue with
     `start <= pressedAt` (replay what was just heard). This keeps the tested
     Q-in-gap behaviour and gives S a useful meaning.
   - `next` → start of the first timeline cue with `start > pressedAt`.
4. Set `pending = { cue: target, issuedAtMs: performance.now() }` whenever a
   target cue is returned; `cancelPendingSeek()` clears it.

Remove `seekAnchorAction`, `applySeekAnchor`, `isNearCue`,
`observedKeysByComparison` and the text-keyed maps. Keep `comparisonText()` for
DOM↔DOM canonicalization only.

Add one `console.debug` per press:
`[SubJap] nav <action> at=<pressedAt> base=<start|"gap"> src=<official|dom|pending> target=<seconds> official=<n> dom=<n>`.
This is the tool for the next bug report.

### 4.2 `NetflixAdapter`

- **Landing detection.** Attach a `seeked` listener next to the `timeupdate`
  one (`attachTimeUpdateListener`). On `seeked` with `pendingSeekTarget !== null`
  and `|currentTime − target| <= 1`, run the landing branch immediately
  (clear target, reset `activeDomCue`, emit the official destination cue or fall
  through to the DOM). Also arm a `SEEK_LANDING_TIMEOUT_MS = 2500` timer in
  `seekTo()` after the transport resolves; when it fires with the same target
  still pending, clear it and `scheduleEmit()` so live emissions resume. Keep
  the existing clock-proximity path as a fallback. Verify in Chrome that
  Netflix's `player.seek()` fires `seeked` on the `<video>`; if it does not,
  the timeout alone still bounds the failure.
- **One effective body per language.** Replace the `start:end:text` merge in
  `storeTimedText()` with `timedTextBodies: Map<language, Map<url, SubtitleCue[]>>`
  and rebuild the effective list by walking bodies in arrival order, adding a
  cue only when no already-accepted cue overlaps it by more than half of the
  shorter duration. Overlaps inside a single body are kept (two speakers).
  Rebuild `japaneseCuesByText` from the effective list as today.
- **Landing without an official destination cue** (optional, cosmetic): when
  falling through to the DOM after landing, use the seek target as the
  observation time instead of `video.currentTime`, so the rebuilt provisional
  cue does not drift by up to 250 ms.

### 4.3 TTML parser

In `parseTTML()`, before the generic tag strip, remove ruby annotation and
delimiter spans:

```ts
.replace(/<(?:[\w-]+:)?span\b[^>]*\btts:ruby\s*=\s*["'](?:text|delimiter)["'][^>]*>[\s\S]*?<\/(?:[\w-]+:)?span>/gi, "")
.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
```

This makes official text equal to DOM text for furigana cues, which also
repairs `getMatchingTrackCue()` (exact timing and `endConfirmed: true` for the
overlay and mining). Confirm the attribute name on a real Netflix IMSC body;
`tts:ruby` is the TTML2/IMSC 1.1 name.

### 4.4 Content script

- Call `rememberNavigationCues()` at the top of `enqueueCues()`, before the
  signature dedupe, so a track arriving without a cue change still seeds the
  navigator. The same-array short-circuit keeps it cheap.
- No other change: `observe()` and `remember()` keep their call sites.

### 4.5 Shortcuts

- Add `event.stopImmediatePropagation()` after `preventDefault()` in
  `installPlaybackShortcuts`, mirroring `installPausePlayShortcut`.

## 5. Implementation steps

Work in a worktree. Each step is independently buildable.

1. **TTML ruby** — `src/subtitles/parse.ts`, `parseTTML()`. Smallest change,
   largest effect on RC1.
2. **Body merge by overlap** — `src/adapters/netflix.ts`, `storeTimedText()`.
   Keep `getNavigationCues()` returning a stable array instance per rebuild.
3. **Landing detection** — `src/adapters/netflix.ts`: `seeked` listener,
   landing timeout in `seekTo()`, shared `landSeek(observationTime)` helper used
   by `emitCues()`, the `seeked` handler and the timeout. Detach in `destroy()`
   and when the video element changes.
4. **`CueNavigator` rewrite** — `src/content/shortcuts.ts`, per §4.1. Public
   methods unchanged: `observe`, `remember`, `reset`, `getSeekTime`,
   `cancelPendingSeek`. Add the debug line.
5. **`enqueueCues` seeding** and **`stopImmediatePropagation`** —
   `src/content/index.ts`, `src/content/shortcuts.ts`.
6. `npm.cmd run build`, load the extension, run the manual scenarios in §6.
7. Update `docs/architecture.md` (French): add a short "Navigation Q / S / D"
   paragraph in the overlay/interactions section describing the contract
   (displayed cue is the base, gap behaviour, single timeline preferring the
   official track). Do not document internals that this plan already holds.
8. Merge into `master`, `npm.cmd run build`, commit.

Existing unit tests in `src/content/shortcuts.test.ts` encode parts of the old
contract (for example the anchor reuse in "serializes rapid q presses"). They
are not run and not part of `npm run build`. Adjust assertions only where the
new contract differs (chained presses still advance from the last requested
cue, so most tests keep passing by construction); do not add new tests.

## 6. Manual verification (Chrome, one Netflix episode with Japanese subtitles)

Keep DevTools open, filter the console on `SubJap nav`. Each line shows which
base cue was chosen and from which source, so a failure is explainable.

1. **Furigana cue.** Find a cue with ruby (or any cue whose debug line shows
   `dom=` growing while `official=` is non-zero). Press Q from the following
   cue: it must land on the official start of the ruby cue. Press Q again: the
   cue before it. Before the fix, the first Q lands 150 ms early on the same
   cue.
2. **Tail of a cue.** Press S in the last 200 ms of a displayed cue. It must
   replay that cue, not start the next one.
3. **Gap, D.** In a silence between two cues press D: jumps to the next cue
   start. Before the fix, nothing happens.
4. **Gap, S / Q.** In the same silence press S, then Q: both replay the
   previous cue.
5. **Chained Q.** Press Q three times within a second: lands three cues back;
   overlay shows that cue; no intermediate cue flashes for long.
6. **D then Q** within 300 ms: returns to the cue you started from.
7. **Stale anchor.** Press D once, watch 30 s, press D again: moves to the cue
   after the one displayed, not relative to the earlier destination.
8. **Paused.** Pause, press Q: lands on the previous cue, overlay updates,
   playback stays paused. Press S: replays the displayed cue, stays paused.
9. **Netflix seek then key.** Use the Netflix ← key (10 s back), let it play
   to the same instant as scenario 2, press S: identical result.
10. **Rapid conflicting seeks.** Press Q, D, Q as fast as possible: the overlay
    must never freeze; live cues keep updating within 2.5 s at most (landing
    timeout).
11. **No official track.** If an episode shows `official=0` in the debug line,
    Q and S still work from DOM history and D either moves to a seen cue or
    does nothing; the overlay does not flicker on D.

## 7. Risks and boundaries

- Time-based identity assumes the fetched official `ja` track has the same
  timing as the displayed track. Netflix `Japanese` and `Japanese [CC]` differ
  by text, not by timing, so overlap matching holds; the body-merge rule in
  §4.2 additionally prevents both from being interleaved.
- `seeked` behaviour of Netflix's player is to be confirmed in the browser; the
  timeout makes the design safe either way.
- Listening mode (`src/content/listening-mode.ts`) defers cue emissions while
  active, so `displayed` can be stale during an exercise. Out of scope; the
  pending TTL and the stale-display guard limit the effect.
- The generic HTML5 adapter is unaffected: it has no official track, so the
  navigator runs on DOM/textTrack cues only.
- Do not touch the mining replay (`beginCueReplay`, `NetflixCueReplaySession`)
  or the `AudioPhrase` capture path; they use the same `seekTo` but have their
  own isolation and were stabilised separately.

## 8. Files touched

| File | Change |
| --- | --- |
| `src/subtitles/parse.ts` | Drop ruby annotation spans in `parseTTML()` |
| `src/adapters/netflix.ts` | Overlap-based body merge; `seeked` landing; landing timeout |
| `src/content/shortcuts.ts` | `CueNavigator` single timeline, pending TTL, gap rules, debug line, `stopImmediatePropagation` |
| `src/content/index.ts` | Seed navigation in `enqueueCues()` |
| `docs/architecture.md` | Q / S / D contract paragraph |
