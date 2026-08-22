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

test("the page-world bridge forwards an official timed-text track", async ({
  page,
}) => {
  const bundle = await readFile(
    resolve(process.cwd(), "dist/netflix-bridge.js"),
    "utf8",
  );
  await page.goto("/tests/fixture/index.html");
  await page.addScriptTag({ content: bundle });

  const payload = await page.evaluate(async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      window.addEventListener(
        "message",
        (event) => {
          if (
            event.source === window &&
            event.data?.source === "subjap" &&
            event.data?.type === "subjap:netflix-timed-text"
          ) {
            resolve(event.data.payload as Record<string, unknown>);
          }
        },
        { once: true },
      );
    });

    window.fetch = async () =>
      new Response(
        "WEBVTT\\n\\n00:00:01.000 --> 00:00:02.000\\nBonjour",
        { headers: { "content-type": "text/vtt" } },
      );
    JSON.parse(
      JSON.stringify({
        timedtexttracks: [
          {
            bcp47: "fr-FR",
            ttDownloadables: {
              webvtt: "https://cdn.example/timedtext/fr.vtt",
            },
          },
        ],
      }),
    );
    return received;
  });

  expect(payload).toMatchObject({
    language: "fr-FR",
    url: "https://cdn.example/timedtext/fr.vtt",
    body: expect.stringContaining("Bonjour"),
  });
});
