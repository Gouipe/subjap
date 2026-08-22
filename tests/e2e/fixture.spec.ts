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

  test("ouvre la popover au survol et modifie l’état connu", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const firstToken = page.locator(".subjap-token").first();

    await firstToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("日本語");

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(page.getByTestId("status")).toContainText("日本語");
    await expect(page.locator(".subjap-token").first()).not.toHaveClass(
      /subjap-known/,
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
});
