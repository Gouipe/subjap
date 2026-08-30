import { expect, test } from "@playwright/test";

const fixturePort = process.env.SUBJAP_FIXTURE_PORT ?? "4173";

test.describe("SubJap UX fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: `http://127.0.0.1:${fixturePort}`,
    });
    await page.goto("/tests/fixture/index.html");
  });

  test("copie avec C la phrase japonaise affichée sur une seule ligne", async ({ page }) => {
    const pageBody = page.locator("body");
    const feedback = page.locator("#subjap-copy-feedback");

    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "待ってください。");
    await pageBody.press("c");
    await expect(feedback).toHaveText("Copié");
    await expect(feedback).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("待ってください。");

    await page.getByTestId("bilingual-cue").click();
    await expect(page.locator(".subjap-translation-line")).toHaveText("J’étudie le japonais.");
    await pageBody.press("c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("日本語を勉強します。");

    await page.getByTestId("rolling-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-cue",
      "生徒が起こした騒動については\n不問ということにいたしましょう",
    );
    await pageBody.press("c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("生徒が起こした騒動については 不問ということにいたしましょう");
    await expect(feedback).toBeHidden({ timeout: 2_000 });
  });

  test("ignore C dans un champ et lorsqu'aucune phrase n'est affichée", async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText("inchangé"));
    await page.getByLabel("Afficher le furigana").focus();
    await page.keyboard.press("c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("inchangé");

    await page.getByTestId("clear-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "");
    await page.locator("body").press("c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("inchangé");
    await expect(page.locator("#subjap-copy-feedback")).toHaveCount(0);
  });

  test("affiche les cues au-dessus des contrôles et masque les natifs", async ({ page }) => {
    await page.getByTestId("next-cue").click();

    const overlay = page.locator("#subjap-overlay-container");
    const nativeSubtitles = page.getByTestId("native-subtitles");
    const controls = page.locator(".player-controls");

    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".subjap-token")).toHaveCount(6);
    await expect(overlay.locator(".subjap-token--punctuation")).toHaveCount(1);
    await expect(overlay.locator(".subjap-furigana").first()).toHaveText("にほんご");
    await expect(nativeSubtitles).toBeHidden();
    await expect(overlay.locator(".subjap-token").first()).toHaveClass(/subjap-known/);

    const cueLine = overlay.locator(".subjap-cue-line");
    await expect(cueLine).toHaveCSS("align-items", "flex-end");
    await expect(cueLine).toHaveCSS("background-color", "rgba(0, 0, 0, 0.62)");
    const gapRatio = await cueLine.evaluate((element) => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.columnGap) / Number.parseFloat(style.fontSize);
    });
    expect(gapRatio).toBeCloseTo(0.16, 2);

    const overlayBox = await overlay.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(await overlay.evaluate((el) => getComputedStyle(el).zIndex)).toBe("2147483646");
    expect(overlayBox!.y + overlayBox!.height).toBeGreaterThan(controlsBox!.y);
  });

  test("masque la traduction quand toutes les lignes sont connues", async ({ page }) => {
    await page.getByLabel("Masquer FR/EN si la phrase est connue").check();
    await page.getByTestId("bilingual-known-cue").click();

    await expect(page.locator(".subjap-cue-line")).toBeVisible();
    await expect(page.locator(".subjap-translation-line")).toHaveCount(0);

    await page.getByLabel("Masquer FR/EN si la phrase est connue").uncheck();
    await expect(page.locator(".subjap-translation-line")).toHaveText("J’étudie le japonais.");
  });

  test("conserve la traduction dès qu’un mot reste inconnu", async ({ page }) => {
    await page.getByLabel("Masquer FR/EN si la phrase est connue").check();
    await page.getByTestId("bilingual-cue").click();

    await expect(page.locator(".subjap-translation-line")).toHaveText("J’étudie le japonais.");
  });

  test("ignore le furigana ruby natif sans dupliquer le mot", async ({ page }) => {
    await page.goto("/tests/fixture/index.html?scenario=ruby-native-annotation");

    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-cue",
      "親父もおふくろも超喜んじゃって",
    );
    const overlay = page.locator("#subjap-overlay-container");
    await expect(overlay.locator('[data-surface="親父"]')).toHaveCount(1);
    await expect(overlay.locator('[data-surface="おやじ"]')).toHaveCount(0);
    await expect(overlay.locator('[data-surface="親父"] .subjap-furigana')).toHaveText("おやじ");
  });

  test("n’affiche le furigana que pour les tokens kanji ou katakana", async ({ page }) => {
    await page.getByTestId("furigana-rule-cue").click();

    await expect(page.locator('[data-surface="言っ"] .subjap-furigana')).toHaveText("いっ");
    await expect(page.locator('[data-surface="てんだ"] .subjap-furigana')).toHaveCount(0);
  });

  test("fait primer KNOWN sur UNKNOWN entre formes lexicales UniDic", async ({ page }) => {
    await page.goto("/tests/fixture/index.html?scenario=lexical-alias");
    await expect(page.getByTestId("status")).toHaveAttribute(
      "data-scenario",
      "unidic-lexical-alias",
      { timeout: 10_000 },
    );

    const token = page.locator("#subjap-overlay-container .subjap-token").first();
    await expect(token).toHaveText("いろんな");
    await expect(token).toHaveAttribute("data-lemma", "色んな");
    await expect(token).toHaveClass(/subjap-known/);
    await expect(token).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  test("grise toute expression entre parenthèses et la rend non interactive", async ({ page }) => {
    await page.getByTestId("parenthetical-cue").click();

    const parenthetical = page.locator("#subjap-overlay-container .subjap-token--parenthetical");
    await expect(parenthetical).toHaveCount(3);
    await expect(parenthetical.first()).toHaveCSS("color", "rgb(100, 116, 139)");
    await expect(parenthetical.nth(1).locator(".subjap-furigana")).toHaveCSS(
      "color",
      "rgb(100, 116, 139)",
    );
    await expect(parenthetical.first()).toHaveCSS("opacity", "0.7");
    await expect(parenthetical.first()).toHaveCSS("pointer-events", "none");
    await expect(parenthetical.first()).toHaveCSS("cursor", "default");

    await parenthetical.first().dispatchEvent("mouseover");
    await parenthetical.first().dispatchEvent("click");
    await page.waitForTimeout(450);
    await expect(page.locator("#subjap-popover")).not.toHaveClass(/subjap-popover--visible/);

    await expect(page.locator("#subjap-overlay-container .subjap-token").nth(3)).not.toHaveClass(
      /subjap-token--parenthetical/,
    );
  });

  test("affiche la traduction française Netflix sous le japonais", async ({ page }) => {
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

  test("décode les quotes HTML dans la traduction française", async ({ page }) => {
    await page.getByTestId("encoded-translation-cue").click();

    await expect(page.locator(".subjap-translation-line")).toHaveText(
      '"Good luck," or something like that.',
    );
  });

  test("distingue connu, carte Anki, apprentissage et les couleurs de fréquence", async ({
    page,
  }) => {
    await page.getByTestId("next-cue").click();
    const tokens = page.locator("#subjap-overlay-container .subjap-token");

    // N = 1: an existing Anki card and LEARNING are violet; low-priority
    // unknown is orange and KNOWN is white.
    await expect(tokens.nth(0)).toHaveClass(/subjap-known/);
    await expect(tokens.nth(0)).not.toHaveClass(/subjap-unknown--/);
    await expect(tokens.nth(1)).toHaveClass(/subjap-unknown--near/);
    await expect(tokens.nth(2)).toHaveClass(/subjap-learning/);
    await expect(tokens.nth(3)).toHaveClass(/subjap-learning/);
    await expect(tokens.nth(4)).toHaveClass(/subjap-unknown/);
    await expect(tokens.nth(4)).not.toHaveClass(/subjap-unknown--/);
    await expect(tokens.nth(4)).toHaveCSS("color", "rgb(251, 146, 60)");
    await expect(tokens.nth(3)).toHaveCSS("color", "rgb(192, 132, 252)");
    await expect(tokens.locator(".subjap-token--mine-candidate")).toHaveCount(0);
  });

  test("encadre en bleu le seul mot vert ou bleu sans mot orange", async ({ page }) => {
    await page.getByTestId("candidate-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).not.toHaveClass(/subjap-token--mine-candidate/);
    await expect(tokens.nth(1)).toHaveClass(/subjap-unknown--near/);
    await expect(tokens.nth(1)).toHaveClass(/subjap-token--mine-candidate/);
    await expect(tokens.nth(1)).toHaveClass(/subjap-token--mine-candidate--near/);
    await expect(tokens.nth(1)).toHaveCSS("outline-width", "2px");
    await expect(tokens.nth(1)).toHaveCSS("outline-color", "rgb(96, 165, 250)");
  });

  test("encadre en vert un mot vert entouré de mots blancs", async ({ page }) => {
    await page.getByTestId("green-white-cue").click();

    const candidate = page.locator('[data-surface="発表"]');
    await expect(candidate).toHaveClass(/subjap-unknown--relevant/);
    await expect(candidate).toHaveClass(/subjap-token--mine-candidate/);
    await expect(candidate).toHaveClass(/subjap-token--mine-candidate--relevant/);
    await expect(candidate).toHaveCSS("outline-width", "2px");
    await expect(candidate).toHaveCSS("outline-color", "rgb(34, 197, 94)");
    await expect(page.locator('[data-surface="日本語"]')).not.toHaveClass(
      /subjap-token--mine-candidate/,
    );
  });

  test("ignore un espace invisible dans la détection du candidat", async ({ page }) => {
    await page.getByTestId("whitespace-candidate-cue").click();

    await expect(page.locator('[data-surface="発表"]')).toHaveClass(/subjap-token--mine-candidate/);
    await expect(page.locator('[data-surface=" "]')).toHaveClass(/subjap-token--punctuation/);
  });

  test("ouvre la popover au survol et modifie l’état connu", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const firstToken = page.locator(".subjap-token").first();

    await firstToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("日本語");
    await expect(page.locator(".subjap-popover__defs")).toHaveText("Japanese language");

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(page.getByTestId("status")).toContainText("日本語");
    await expect(page.locator(".subjap-token").first()).not.toHaveClass(/subjap-known/);
  });

  test("permet de sélectionner les informations de la popover sans ses boutons", async ({
    page,
  }) => {
    await page.getByTestId("long-definition-cue").click();
    await page.getByTestId("video-stage").scrollIntoViewIfNeeded();
    await page.locator(".subjap-token").first().click();

    const popover = page.locator("#subjap-popover");
    const header = popover.locator(".subjap-popover__header");
    const definitions = popover.locator(".subjap-popover__defs");
    const button = popover.locator(".subjap-btn").first();

    await expect(popover).toBeVisible();
    await expect(header).toHaveCSS("user-select", "text");
    await expect(definitions).toHaveCSS("user-select", "text");
    await expect(button).toHaveCSS("user-select", "none");

    await header.selectText();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("為る");

    await definitions.selectText();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("to carry out");
  });

  test("garde une longue définition défilable dans une taille fixe", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await page.getByTestId("long-definition-cue").click();
    await page.getByTestId("video-stage").scrollIntoViewIfNeeded();

    const token = page.locator(".subjap-token").first();
    await token.click();

    const popover = page.locator("#subjap-popover");
    const header = page.locator(".subjap-popover__header");
    const content = page.locator(".subjap-popover__content");
    const actions = page.locator(".subjap-popover__actions");
    await expect(popover).toBeVisible();
    await expect(header).toContainText("する");
    await expect(actions).toBeVisible();
    await expect(popover).toHaveCSS("width", "306px");
    await expect(popover).toHaveCSS("height", "422px");

    const layout = await popover.evaluate((element) => {
      const popoverRect = element.getBoundingClientRect();
      const headerRect = element
        .querySelector<HTMLElement>(".subjap-popover__header")!
        .getBoundingClientRect();
      const contentElement = element.querySelector<HTMLElement>(".subjap-popover__content")!;
      const actionsRect = element
        .querySelector<HTMLElement>(".subjap-popover__actions")!
        .getBoundingClientRect();
      const subtitleTop = Math.min(
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            "#subjap-overlay-container > .subjap-cue-line, #subjap-overlay-container > .subjap-translation-line",
          ),
          (subtitle) => subtitle.getBoundingClientRect().top,
        ),
      );
      return {
        popoverTop: popoverRect.top,
        popoverBottom: popoverRect.bottom,
        subtitleTop,
        viewportHeight: window.innerHeight,
        headerTop: headerRect.top,
        actionsBottom: actionsRect.bottom,
        contentClientHeight: contentElement.clientHeight,
        contentScrollHeight: contentElement.scrollHeight,
      };
    });

    expect(layout.popoverTop).toBeGreaterThanOrEqual(7);
    expect(layout.popoverBottom).toBeLessThanOrEqual(layout.viewportHeight - 7);
    expect(layout.headerTop).toBeGreaterThanOrEqual(layout.popoverTop);
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.popoverBottom);
    expect(layout.contentScrollHeight).toBeGreaterThan(layout.contentClientHeight);

    const headerBeforeScroll = await header.boundingBox();
    const actionsBeforeScroll = await actions.boundingBox();
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const headerAfterScroll = await header.boundingBox();
    const actionsAfterScroll = await actions.boundingBox();
    expect(headerAfterScroll!.y).toBeCloseTo(headerBeforeScroll!.y, 1);
    expect(actionsAfterScroll!.y).toBeCloseTo(actionsBeforeScroll!.y, 1);

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(page.getByTestId("status")).toContainText("為る");
  });

  test("affiche un message quand la définition est introuvable", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    await page.locator(".subjap-token").nth(1).hover();

    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__defs")).toHaveText("Definition not found");
  });

  test("expose ヤバくない comme un adjectif unique lié à やばい", async ({ page }) => {
    await page.getByTestId("mixed-adjective-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(1);
    await expect(tokens.first()).toHaveAttribute("data-surface", "ヤバくない");
    await expect(tokens.first()).toHaveAttribute("data-lemma", "やばい");
    await expect(tokens.first()).toHaveAttribute("data-reading", "やばくない");
    await expect(tokens.first()).toHaveAttribute("data-pos", /形容詞/);

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.first().hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("やばい");
    await expect(page.locator(".subjap-popover__reading")).toHaveText("やばい");
    await expect(page.locator(".subjap-popover__dictionary")).toHaveCount(0);
    await expect(page.locator(".subjap-popover__pos")).toContainText("Adj (i)");
    await expect(page.locator(".subjap-popover__defs")).toHaveText(
      "dangerous; risky; awful; amazing",
    );

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(page.getByTestId("status")).toContainText("やばい");
    await expect(tokens.first()).toHaveClass(/subjap-known/);
  });

  test("affiche le rang de fréquence pour toutes les couleurs", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    const frequency = page.locator(".subjap-popover__freq");

    // The fixture provides deterministic ranks for each token. Known/Anki/
    // UNKNOWN colours do not hide the frequency rank.
    await tokens.nth(0).hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(frequency).toHaveText("Frequency rank: #1");
    const infoOrder = await page.locator(".subjap-popover__freq").evaluate((frequency) => {
      const header = frequency.closest(".subjap-popover__header");
      const content = frequency.closest(".subjap-popover__content");
      return Boolean(header && !content);
    });
    expect(infoOrder).toBe(true);
    await expect(page.locator(".subjap-popover__reading")).toHaveCSS("font-size", "17px");
    await expect(frequency).toHaveCSS("font-size", "13px");

    await tokens.nth(2).hover();
    await expect(frequency).toHaveText("Frequency rank: #1");

    await tokens.nth(1).hover();
    await expect(frequency).toHaveText("Frequency rank: #2");

    await tokens.nth(3).hover();
    await expect(frequency).toHaveText("Frequency rank: #3");

    await tokens.nth(4).hover();
    await expect(frequency).toHaveText("Frequency rank: #500");
  });

  test("avertit dans la popover quand des cartes existent déjà dans Anki", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const existingCardNotice = page.locator(".subjap-popover__anki");

    await page.locator(".subjap-token").nth(2).hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(existingCardNotice).toHaveText("Déjà dans Anki · 2 cartes");

    await page.locator(".subjap-token").nth(1).hover();
    await expect(existingCardNotice).toHaveText("");
  });

  test("capture automatiquement le screenshot à l’ouverture du mining", async ({ page }) => {
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
    const definitions = page.getByTestId("mining-definitions");
    await expect(definitions).toHaveCSS("height", "59.5px");
    await expect(definitions).toHaveValue("fixture definition");
    await definitions.fill("classroom, my personal definition");
    await expect(definitions).toHaveValue("classroom, my personal definition");
    await definitions.press("Enter");
    const notes = page.getByTestId("mining-notes");
    await expect(notes).toHaveCSS("min-height", "260px");
    await expect(notes).toHaveValue("");
    await notes.fill("classroom\nmy personal note");
    await expect(notes).toHaveValue("classroom\nmy personal note");
    await notes.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator("#subjap-mining-modal")).toBeVisible();
    await page.locator(".subjap-modal-backdrop").dispatchEvent("click");
    await expect(page.locator("#subjap-mining-modal")).toBeVisible();
    await expect(page.locator(".subjap-screenshot-info")).toHaveText("✓ Screenshot captured");
    await page.locator(".subjap-modal-close").click();
    await expect(page.locator("#subjap-mining-modal")).toBeHidden();
  });

  test("masque instantanément la popover avant le démarrage du mining", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    await page.locator(".subjap-token").first().click();
    await expect(page.locator("#subjap-popover")).toBeVisible();

    await page.locator(".subjap-btn--mine").click();

    await expect(page.locator("#subjap-popover")).toBeHidden();
    await expect(page.getByTestId("status")).toHaveAttribute("data-mine-popover-hidden", "true");
  });

  test("envoie automatiquement la traduction française avec la carte minée", async ({ page }) => {
    await page.evaluate(() => {
      const messages: Array<Record<string, unknown>> = [];
      Object.defineProperty(window, "__subjapFixtureMessages", {
        configurable: true,
        value: messages,
      });
      (window as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (message: Record<string, unknown>) => {
            messages.push(message);
            switch (message.type) {
              case "tts:generate":
                return { dataUrl: "data:audio/wav;base64:fixture" };
              case "mine:create":
                return { id: "fixture-card" };
              case "anki:setup":
                return { deckName: "SubJap", modelName: "Migaku Memory" };
              case "anki:addNote":
                return { noteId: 42, modelName: "Migaku Memory", deckName: "SubJap" };
              default:
                return undefined;
            }
          },
        },
      };
    });

    await page.getByTestId("bilingual-cue").click();
    await expect(page.locator(".subjap-translation-line")).toHaveText("J’étudie le japonais.");
    await page.getByTestId("mine-cue").click();
    await page.getByTestId("mining-notes").fill("context from my study session");
    await page.locator(".subjap-modal-btn-send").click();
    await expect(page.locator("#subjap-mining-modal")).toBeHidden();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const messages = (
            window as unknown as {
              __subjapFixtureMessages?: Array<Record<string, unknown>>;
            }
          ).__subjapFixtureMessages;
          const ankiMessage = messages?.find((message) => message.type === "anki:addNote");
          const fields = ankiMessage?.fields as Record<string, unknown> | undefined;
          return { translation: fields?.Traduction, notes: fields?.Notes };
        }),
      )
      .toEqual({
        translation: "J’étudie le japonais.",
        notes: "context from my study session",
      });
  });

  test("met à jour la couleur quand un mot inconnu devient connu", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    const unknownToken = page.locator(".subjap-token").nth(2);

    await unknownToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-btn--toggle-known")).toHaveText("Mark Known");

    await page.locator(".subjap-btn--toggle-known").click();
    await expect(unknownToken).toHaveClass(/subjap-known/);
  });

  test("ignore un mot en blanc sans l’ajouter aux mots connus", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    // 勉強 has an existing Anki card in the fixture; IGNORED must override
    // that presence and turn the token white instead of leaving it purple.
    const ignoredToken = page.locator(".subjap-token").nth(2);

    await expect(ignoredToken).toHaveClass(/subjap-learning/);

    await ignoredToken.hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-btn--toggle-ignored")).toHaveText("Ignore");

    await page.locator(".subjap-btn--toggle-ignored").click();
    await expect(ignoredToken).toHaveClass(/subjap-known/);
    await expect(ignoredToken).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("status")).toHaveAttribute("data-known-count", "1");
    await expect(page.locator(".subjap-btn--toggle-ignored")).toHaveText("Unignore");

    await page.locator(".subjap-btn--toggle-ignored").click();
    await expect(ignoredToken).toHaveClass(/subjap-learning/);
    await expect(ignoredToken).toHaveCSS("color", "rgb(192, 132, 252)");
    await expect(page.getByTestId("status")).toHaveAttribute("data-known-count", "1");
  });

  test("regroupe une construction grammaticale en une seule unité", async ({ page }) => {
    await page.getByTestId("grouped-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(1);
    await expect(tokens.first()).toHaveText("じゃなくって");

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.first().hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("じゃなくって");
  });

  test("rend les unités plurielles et leurs annotations avec UniDic réel", async ({ page }) => {
    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await page.getByTestId("unidic-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-scenario", "unidic-plurals", {
      timeout: 10_000,
    });

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens.first()).toHaveAttribute("data-surface", "こいつら");
    await expect(tokens.first()).toHaveAttribute("data-lemma", "此奴");
    await expect(tokens.filter({ hasText: "生徒たち" })).toHaveCount(1);
    await expect(tokens.filter({ hasText: "ら" })).toHaveCount(1);

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.first().hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("こいつ");
    await expect(page.locator(".subjap-popover__reading")).toHaveText("こいつら");
    await expect(page.locator(".subjap-popover__dictionary")).toHaveCount(0);
    await expect(page.locator(".subjap-popover__grammar")).toHaveText("ら — suffixe pluriel");
    await expect(page.locator(".subjap-popover .subjap-token")).toHaveCount(0);
  });

  test("garde les variantes UniDic séparées quand elles ne sont pas des pluriels", async ({
    page,
  }) => {
    await page.getByTestId("unidic-variants-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-scenario", "unidic-variants", {
      timeout: 10_000,
    });

    const surfaces = await page
      .locator("#subjap-overlay-container .subjap-token")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-surface")));
    expect(surfaces).toContain("どいつら");
    expect(surfaces).toContain("らしい");
    expect(surfaces).toContain("彼ら");
    expect(surfaces).toContain("生徒達");
    await expect(page.locator(".subjap-popover__grammar")).toHaveCount(1);
  });

  test("regroupe la forme explicative なんです sans absorber le nom", async ({ page }) => {
    await page.getByTestId("explanatory-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toHaveAttribute("data-surface", "孫");
    await expect(tokens.nth(1)).toHaveAttribute("data-surface", "なんです");

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.nth(1).hover();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("なんです");
  });

  test("regroupe une forme polie autour du lemme verbal", async ({ page }) => {
    await page.getByTestId("polite-verb-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toHaveAttribute("data-surface", "感動");
    await expect(tokens.nth(1)).toHaveAttribute("data-surface", "しました");
    await expect(tokens.nth(1)).toHaveAttribute("data-lemma", "する");
    await expect(tokens.nth(1)).toHaveAttribute("data-pos", /動詞/);

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.nth(1).click();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("する");
    await expect(page.locator(".subjap-popover__defs")).toHaveText("to do");
  });

  test("regroupe passif et passé autour du verbe lexical", async ({ page }) => {
    await page.getByTestId("passive-verb-cue").click();

    const tokens = page.locator("#subjap-overlay-container .subjap-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toHaveAttribute("data-surface", "取材");
    await expect(tokens.nth(1)).toHaveAttribute("data-surface", "された");
    await expect(tokens.nth(1)).toHaveAttribute("data-lemma", "する");
    await expect(tokens.nth(1)).toHaveAttribute("data-pos", /動詞/);

    await page.getByTestId("video-stage").evaluate((stage) => {
      stage.scrollIntoView({ block: "start" });
    });
    await tokens.nth(1).click();
    await expect(page.locator("#subjap-popover")).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".subjap-popover__surface")).toHaveText("する");
    await expect(page.locator(".subjap-popover__defs")).toHaveText("to do");
  });

  test("réagit à l’effacement, aux options live et au remplacement SPA", async ({ page }) => {
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
    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "日本語を勉強します。");
    await page.getByTestId("grouped-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "じゃなくって");

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

  test("préserve l'état pause ou lecture avec q, s et d", async ({ page }) => {
    await page.getByTestId("next-cue").click();
    await page.getByTestId("grouped-cue").click();

    const video = page.locator("#video");
    const pageBody = page.locator("body");
    await expect(video).toHaveJSProperty("paused", true);

    for (const key of ["q", "s", "d"]) {
      await video.evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 11;
      });
      await pageBody.press(key);
      await expect(video).toHaveJSProperty("paused", true);
    }

    await video.evaluate((element) => (element as HTMLVideoElement).play());
    await expect(video).toHaveJSProperty("paused", false);

    for (const key of ["q", "s", "d"]) {
      await video.evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 11;
      });
      await pageBody.press(key);
      await expect(video).toHaveJSProperty("paused", false);
    }
  });

  test("Q revient au dernier sous-titre depuis un blanc", async ({ page }) => {
    const video = page.locator("#video");
    const pageBody = page.locator("body");

    await page.getByTestId("next-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "日本語を勉強します。");

    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 17;
    });
    await page.getByTestId("clear-cue").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-cue", "");

    await pageBody.press("q");
    await expect(video).toHaveJSProperty("currentTime", 12);
  });

  test("Q ignore une reconstruction Netflix de la même phrase", async ({ page }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");
    const pageBody = page.locator("body");

    await page.getByTestId("seek-rebuild-cue").click();
    await expect(status).toHaveAttribute("data-cue", "教育シンポジウムです");

    await pageBody.press("q");
    await expect(video).toHaveJSProperty("currentTime", 59.4);

    // The next Q must reach the genuinely preceding subtitle, not a second
    // whitespace-only DOM build of the cue at 59 seconds.
    await pageBody.press("q");
    await expect(video).toHaveJSProperty("currentTime", 50);
  });

  test("Q garde le vrai début d'une phrase réaffichée à la fin d'un seek", async ({ page }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("seek-overlap-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "seek-overlap-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    await page.locator("body").press("q");
    await expect(video).toHaveJSProperty("currentTime", 105);
  });

  test("Q utilise le timestamp de la piste Netflix après une observation DOM tardive", async ({
    page,
  }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("authoritative-timing-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "authoritative-timing-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    await page.locator("body").press("q");
    await expect(video).toHaveJSProperty("currentTime", 105);
  });

  test("Q utilise la phrase précédente de la piste Netflix après un rechargement", async ({
    page,
  }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("official-history-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "official-history-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    await page.locator("body").press("q");
    await expect(video).toHaveJSProperty("currentTime", 105);
  });

  test("Q ignore le doublon de la cue courante entre DOM et piste officielle", async ({ page }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("stale-dom-track-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "stale-dom-track-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    await page.locator("body").press("q");
    await expect(video).toHaveJSProperty("currentTime", 105);
  });

  test("S reprend la cue courante avec le timestamp officiel", async ({ page }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("stale-dom-track-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "stale-dom-track-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    await page.locator("body").press("s");
    await expect(video).toHaveJSProperty("currentTime", 110.778);
  });

  test("conserve les cibles de Q et S quand ils sont pressés au même instant", async ({ page }) => {
    const video = page.locator("#video");
    const status = page.getByTestId("status");

    await page.getByTestId("official-history-cue").click();
    await expect(status).toHaveAttribute("data-scenario", "official-history-complete");
    await expect(status).toHaveAttribute("data-cue", "困るんですよ生徒に示しがつかないから");

    // Dispatch both keys before the first queued seek can update the media
    // clock. Each action must retain the timestamp that existed at keydown.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    await expect(video).toHaveJSProperty("currentTime", 110.778);
  });

  test("rejoue sans dérive un sous-titre Netflix dépourvu de timestamps", async ({ page }) => {
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

  test("garde navigation et mining alignés sur la phrase réellement rendue", async ({ page }) => {
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
    await expect(status).toHaveAttribute("data-cue", "日本語を\n勉強します。");
    await page.getByTestId("mine-cue").click();
    await expect(page.locator("#subjap-mining-modal .subjap-sentence")).toContainText(
      "日本語を勉強します。",
    );
  });

  test("permet de sélectionner la phrase et le target word dans la modale de mining", async ({
    page,
  }) => {
    // Some host pages disable text selection globally. The modal must keep
    // these learner-facing values copyable when it is mounted in that context.
    await page.locator("body").evaluate((body) => {
      body.style.userSelect = "none";
    });
    await page.getByTestId("next-cue").click();
    await page.getByTestId("mine-cue").click();

    const modal = page.locator("#subjap-mining-modal");
    const sentence = modal.locator(".subjap-sentence");
    const targetWord = page.getByTestId("mining-target-word");

    await expect(modal).toBeVisible();
    await expect(sentence).toHaveCSS("user-select", "text");
    await expect(targetWord).toHaveCSS("user-select", "text");
    await expect(sentence.locator(".subjap-target")).toHaveText("日本語");

    await sentence.selectText();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("日本語を勉強します。");

    await targetWord.selectText();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe("日本語");
  });

  test("garde toute une phrase quand Netflix fait défiler ses deux lignes", async ({ page }) => {
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
