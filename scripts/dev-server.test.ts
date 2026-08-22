import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import { afterEach, expect, test } from "vitest";

const popupUrl = "http://127.0.0.1:4173/src/popup/index.html";
let devServer: ChildProcess | undefined;
let devOutput = "";

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });

    request.setTimeout(1_000, () => request.destroy(new Error("HTTP request timed out")));
    request.on("error", reject);
  });
}

async function stopProcessTree(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.pid === undefined) return;

  const killer = spawn("taskkill", ["/pid", String(process.pid), "/t", "/f"]);
  await once(killer, "exit");
}

afterEach(async () => {
  if (devServer) await stopProcessTree(devServer);
});

test("npm run dev serves the extension popup on port 4173", async () => {
  devServer = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd run dev"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  devServer.stdout?.on("data", (chunk) => (devOutput += chunk));
  devServer.stderr?.on("data", (chunk) => (devOutput += chunk));

  const deadline = Date.now() + 8_000;
  let status: number | undefined;

  while (Date.now() < deadline) {
    try {
      status = await getStatus(popupUrl);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  expect(status, devOutput).toBe(200);
}, 15_000);
