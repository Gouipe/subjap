// Native messaging host « com.subjap.updater », launched by Chrome or Edge
// through the launcher written by register-native-host.ps1. It answers
// { type: "ping" } with { type: "pong" }, and { type: "update" } by running
// scripts/update.ps1, relaying its progress markers:
//   ::subjap-step <pull|deps|build>  ->  { type: "step", step }
//   ::subjap-error <message>         ->  { type: "error", message }
//   exit code 0                      ->  { type: "done" }
// Messages are framed by Chrome's protocol: a 32-bit length, then UTF-8 JSON.
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let running = false;

function send(message) {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([length, json]));
}

function runUpdate() {
  if (running) return;
  running = true;
  let errorMessage = "";
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "scripts", "update.ps1")],
    { cwd: repo, env: { ...process.env, SUBJAP_PROGRESS: "1" }, windowsHide: true },
  );
  createInterface({ input: child.stdout }).on("line", (line) => {
    const step = /^::subjap-step (pull|deps|build)\s*$/.exec(line);
    if (step) send({ type: "step", step: step[1] });
    const error = /^::subjap-error (.+)$/.exec(line);
    if (error) errorMessage = error[1].trim();
  });
  child.stderr.resume();
  child.on("error", (err) => {
    running = false;
    send({ type: "error", message: `Impossible de lancer la mise à jour : ${err.message}` });
  });
  child.on("close", (code) => {
    running = false;
    if (code === 0) send({ type: "done" });
    else send({ type: "error", message: errorMessage || `La mise à jour a échoué (code ${code}).` });
  });
}

function handle(message) {
  if (message?.type === "ping") send({ type: "pong" });
  else if (message?.type === "update") runUpdate();
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const body = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // Not JSON: ignored.
    }
  }
});
// Chrome closed the port: leave once no update is running.
process.stdin.on("end", () => {
  if (!running) process.exit(0);
});
