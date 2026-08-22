import { expect, test } from "@playwright/test";

test.describe("SubJap UX fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tests/fixture/index.html");
  });

  test("affiche les cues au-dessus des contrôles et masque les natifs", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();

    const overlay = page.locator("#subjap-overlay-container");
    const nativeSubtitles = page.getByTestId("native-subtitles");
    const controls = page.locator(".player-controls");

    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".subjap-token")).toHaveCount(6);
    await expect(overlay.locator(".subjap-token--punctuation")).toHaveCount(1);
    await expect(overlay.locator(".subjap-furigana").first()).toHaveText("にほんご");
    await expect(nativeSubtitles).toBeHidden();
    await expect(overlay.locator(".subjap-token").first()).toHaveClass(
      /subjap-known/,
    );

    const cueLine = overlay.locator(".subjap-cue-line");
    await expect(cueLine).toHaveCSS("align-items", "flex-end");
    const gapRatio = await cueLine.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        Number.parseFloat(style.columnGap) /
        Number.parseFloat(style.fontSize)
      );
    });
    expect(gapRatio).toBeCloseTo(0.16, 2);

    const overlayBox = await overlay.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(await overlay.evaluate((el) => getComputedStyle(el).zIndex)).toBe(
      "2147483646",
    );
    expect(overlayBox!.y + overlayBox!.height).toBeGreaterThan(
      controlsBox!.y,
    );
  });

  test("affiche la traduction française Netflix sous le japonais", async ({
    page,
  }) => {
    await page.getByTestId("bilingual-cue").click();

    const overlay = page.locator("#subjap-overlay-container");
    const translation = overlay.locator(".subjap-translation-line");

    await expect(overlay).toBeVisible();
    await expect(translation).toHaveText("J’étudie le japonais.");
    await expect(translation).toHaveAttribute("lang", "fr");
    await expect(translation).toHaveAttribute("data-language", "fr");
    await expect(overlay.locator(".subjap-token")).toHaveCount(6);
    await expect(page.getByTestId("native-subtitles")).toBeHidden();
  });

  test("distingue connu, pertinence, apprentissage, ignoré et inconnu orange", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    const tokens = page.locator("#subjap-overlay-container .subjap-token");

    // N = 1: green <= N, blue in the next 300, violet for LEARNING,
    // orange for a low-priority unknown, and white for KNOWN/IGNORED.
    await expect(tokens.nth(0)).toHaveClass(/subjap-known/);
    await expect(tokens.nth(0)).not.toHaveClass(/subjap-unknown--/);
    await expect(tokens.nth(2)).toHaveClass(/subjap-unknown--relevant/);
    await expect(tokens.nth(1)).toHaveClass(/subjap-unknown--near/);
    await expect(tokens.nth(3)).toHaveClass(/subjap-learning/);
    await expect(tokens.nth(4)).toHaveClass(/subjap-unknown/);
    await expect(tokens.nth(4)).not.toHaveClass(/subjap-unknown--/);
    await expect(tokens.nth(4)).toHaveCSS("color", "rgb(251, 146, 60)");
    await expect(tokens.nth(3)).toHaveCSS("color", "rgb(192, 132, 252)");
  });

  test("ouvre la popover au survol et modifie l’état connu", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const firstToken = page.locator(".subjap-token").first();

    await firstToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("日本語");
    await expect(page.locator(".subjap-popover__defs")).toHaveText(
      "Japanese language",
    );

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(page.getByTestId("status")).toContainText("日本語");
    await expect(page.locator(".subjap-token").first()).not.toHaveClass(
      /subjap-known/,
    );
  });

  test("affiche un message quand la définition est introuvable", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    await page.locator(".subjap-token").nth(1).hover();

    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__defs")).toHaveText(
      "Definition not found",
    );
  });

  test("affiche le rang de fréquence uniquement pour les mots verts et bleus", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    const frequency = page.locator(".subjap-popover__freq");

    // 勉強 is green (rank 1), を is blue (rank 2), while ます is orange.
    await tokens.nth(2).hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(frequency).toHaveText("Frequency rank: #1");

    await tokens.nth(1).hover();
    await expect(frequency).toHaveText("Frequency rank: #2");

    await tokens.nth(4).hover();
    await expect(frequency).toHaveText("");
  });

  test("capture automatiquement le screenshot à l’ouverture du mining", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    await expect(page.locator("#subjap-overlay-container")).toBeVisible();
    await page.evaluate(() => {
      const context = { drawImage: () => undefined };
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: () => context,
      });
      Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
        configurable: true,
        value: () => "data:image/jpeg;base64,fixture",
      });
    });

    await page.getByTestId("mine-cue").click();

    await expect(page.locator("#subjap-mining-modal")).toBeVisible();
    await expect(page.locator(".subjap-screenshot-info")).toHaveText(
      "✓ Screenshot captured",
    );
  });

  test("met à jour la couleur quand un mot inconnu devient connu", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    const unknownToken = page.locator(".subjap-token").nth(2);

    await unknownToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-btn--toggle-known")).toHaveText(
      "Mark Known",
    );

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(unknownToken).toHaveClass(/subjap-known/);
  });

  test("ignore un mot en blanc sans l’ajouter aux mots connus", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    const ignoredToken = page.locator(".subjap-token").nth(4);

    await ignoredToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-btn--toggle-ignored")).toHaveText(
      "Ignore",
    );

    await page.locator(".subjap-btn--toggle-ignored").click();
    await expect(ignoredToken).toHaveClass(/subjap-known/);
    await expect(ignoredToken).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-known-count",
      "1",
    );
    await expect(page.locator(".subjap-btn--toggle-ignored")).toHaveText(
      "Unignore",
    );

    await page.locator(".subjap-btn--toggle-ignored").click();
    await expect(ignoredToken).toHaveClass(/subjap-unknown/);
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-known-count",
      "1",
    );
  });

  test("regroupe une construction grammaticale en une seule unité", async ({
    page,
  }) => {
    await page.getByTestId("grouped-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(1);
    await expect(tokens.first()).toHaveText("じゃなくって");

    await tokens.first().hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("じゃなくって");
  });

  test("regroupe la forme explicative なんです sans absorber le nom", async ({
    page,
  }) => {
    await page.getByTestId("explanatory-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toHaveAttribute("data-surface", "孫");
    await expect(tokens.nth(1)).toHaveAttribute("data-surface", "なんです");

    await tokens.nth(1).hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("なんです");
  });

  test("réagit à l’effacement, aux options live et au remplacement SPA", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    await expect(page.locator("#subjap-overlay-container")).toBeVisible();

    await page.getByTestId("clear-cue").click();
    await expect(page.locator("#subjap-overlay-container")).toBeHidden();

    await page.getByTestId("next-cue").click();
    await page.getByTestId("swap-video").click();
    await expect(page.getByTestId("status")).toContainText("nouveau lecteur");

    await page.getByTestId("next-cue").click();
    await expect(page.locator("#subjap-overlay-container")).toBeVisible();

    await page.getByLabel("Afficher le furigana").uncheck();
    await expect(page.locator(".subjap-furigana").first()).toBeHidden();
  });

  test("navigue entre les sous-titres avec q, s et d", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-cue",
      "日本語を勉強します。",
    );
    await page.getByTestId("grouped-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-cue",
      "じゃなくって",
    );

    const video = page.locator("#video");
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 16;
    });
    const pageBody = page.locator("body");
    await pageBody.press("q");
    await expect(video).toHaveJSProperty("currentTime", 12);

    await pageBody.press("s");
    await expect(video).toHaveJSProperty("currentTime", 12);

    await pageBody.press("d");
    await expect(video).toHaveJSProperty("currentTime", 16);

    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 0;
    });
    await page.getByLabel("Afficher le furigana").focus();
    await page.keyboard.press("s");
    await expect(video).toHaveJSProperty("currentTime", 0);
  });

  test("rejoue sans dérive un sous-titre Netflix dépourvu de timestamps", async ({
    page,
  }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");
    const pageBody = page.locator("body");

    await expect(status).toHaveAttribute("data-cue", "待ってください。");
    await page.getByTestId("clear-cue").click();
    await expect(page.locator("#subjap-overlay-container")).toBeHidden();
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 20;
    });
    await page.getByTestId("untimed-cue").click();

    // Simulate playback continuing during the adapter's 60 ms debounce.
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 20.5;
    });
    await expect(status).toHaveAttribute("data-cue", "日本語を勉強します。");

    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 21;
    });
    await pageBody.press("s");
    await expect(video).toHaveJSProperty("currentTime", 19.85);

    // Netflix clears then rebuilds timed text after a seek. Repeated S must
    // retain the first anchor rather than adopting a new fallback timestamp.
    await page.getByTestId("clear-cue").click();
    await expect(status).toHaveAttribute("data-cue", "");
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 20.2;
    });
    await page.getByTestId("untimed-cue").click();
    await expect(status).toHaveAttribute("data-cue", "日本語を勉強します。");
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 21;
    });

    await pageBody.press("s");
    await pageBody.press("s");
    await pageBody.press("s");
    await expect(video).toHaveJSProperty("currentTime", 19.85);
  });

  test("garde navigation et mining alignés sur la phrase réellement rendue", async ({
    page,
  }) => {
    const status = page.getByTestId("status");
    const video = page.locator("#video");
    const pageBody = page.locator("body");

    await page.getByTestId("next-cue").click();
    await expect(status).toHaveAttribute("data-cue", "日本語を勉強します。");
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 21;
    });
    await page.getByTestId("delayed-cue").click();

    // The native cue has changed, but the learner still sees the old overlay.
    // S must replay that displayed phrase until the delayed render commits.
    await page.waitForTimeout(100);
    await expect(status).toHaveAttribute("data-cue", "日本語を勉強します。");
    await pageBody.press("s");
    await expect(video).toHaveJSProperty("currentTime", 12);

    await expect(status).toHaveAttribute("data-cue", "遅れて表示される字幕");
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 21;
    });
    await pageBody.press("s");
    await expect(video).toHaveJSProperty("currentTime", 20);

    await page.getByTestId("multiline-cue").click();
    await expect(status).toHaveAttribute(
      "data-cue",
      "日本語を\n勉強します。",
    );
    await page.getByTestId("mine-cue").click();
    await expect(page.locator("#subjap-mining-modal .subjap-sentence")).toContainText(
      "日本語を勉強します。",
    );
  });

  test("garde toute une phrase quand Netflix fait défiler ses deux lignes", async ({
    page,
  }) => {
    const status = page.getByTestId("status");

    await expect(status).toHaveAttribute("data-cue", "待ってください。");
    await page.getByTestId("rolling-cue").click();
    await expect(status).toHaveAttribute(
      "data-cue",
      "生徒が起こした騒動については\n不問ということにいたしましょう",
    );
    await expect(status).toHaveAttribute("data-cue-start", "39.85");
  });
});
