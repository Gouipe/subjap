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

test("the page-world bridge forwards an official timed-text URL", async ({
  page,
}) => {
  const bundle = await readFile(
    resolve(process.cwd(), "dist/netflix-bridge.js"),
    "utf8",
  );
  await page.goto("/tests/fixture/index.html");
  await page.addScriptTag({ content: bundle });

  const payload = await page.evaluate(async () => {
    // Simulate Netflix sending playback metadata before the isolated content
    // script has finished subscribing to page messages.
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

    const received = new Promise<Record<string, unknown>>((resolve) => {
      window.addEventListener(
        "message",
        (event) => {
          if (
            event.source === window &&
            event.data?.source === "subjap" &&
            event.data?.type === "subjap:netflix-timed-text-url"
          ) {
            resolve(event.data.payload as Record<string, unknown>);
          }
        },
        { once: true },
      );
    });

    window.postMessage(
      { source: "subjap", type: "subjap:netflix-timed-text-request" },
      window.location.origin,
    );
    return received;
  });

  expect(payload).toMatchObject({
    language: "fr-FR",
    url: "https://cdn.example/timedtext/fr.vtt",
  });
});

test("the page-world bridge inspects JSON metadata returned by fetch", async ({
  page,
}) => {
  const bundle = await readFile(
    resolve(process.cwd(), "dist/netflix-bridge.js"),
    "utf8",
  );
  await page.goto("/tests/fixture/index.html");
  await page.evaluate(() => {
    window.fetch = async () =>
      new Response(
        JSON.stringify({
          timedtexttracks: [
            {
              bcp47: "en",
              ttDownloadables: {
                webvtt: "https://cdn.example/timedtext/en.vtt",
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
  });
  await page.addScriptTag({ content: bundle });

  const payload = await page.evaluate(async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      window.addEventListener(
        "message",
        (event) => {
          if (
            event.source === window &&
            event.data?.source === "subjap" &&
            event.data?.type === "subjap:netflix-timed-text-url"
          ) {
            resolve(event.data.payload as Record<string, unknown>);
          }
        },
        { once: true },
      );
    });
    await fetch("https://cdn.example/metadata");
    return received;
  });

  expect(payload).toEqual({
    language: "en",
    url: "https://cdn.example/timedtext/en.vtt",
  });
});
