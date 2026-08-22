import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("the production page-world bridge runs as a classic script", async ({
  page,
}) => {
  const bundle = await readFile(
    resolve(process.cwd(), "dist/netflix-bridge.js"),
    "utf8",
  );
  await page.goto("/tests/fixture/index.html");

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addScriptTag({ content: bundle });

  await expect(page.locator("html")).toHaveAttribute(
    "data-subjap-netflix-bridge",
    "ready",
  );
  await expect
    .poll(() => pageErrors)
    .toEqual([]);

  await expect(
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          document.addEventListener(
            "subjap:netflix-seek-result",
            (event) => {
              resolve((event as CustomEvent).detail.ok === false);
            },
            { once: true },
          );
          document.dispatchEvent(
            new CustomEvent("subjap:netflix-seek", {
              detail: {
                source: "subjap",
                requestId: "bundle-check",
                timeMs: 1000,
                resume: false,
              },
            }),
          );
        }),
    ),
  ).resolves.toBe(true);
});
