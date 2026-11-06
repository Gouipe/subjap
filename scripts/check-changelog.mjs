// Claude Code PreToolUse hook: refuses a `git commit` that changes the
// extension (src/) while CHANGELOG.md is left untouched, unless the command
// carries the « [sans changelog] » marker. Exit code 2 blocks the command
// and hands the message on stderr back to Claude.
import { execFileSync } from "node:child_process";

const MARKER = "[sans changelog]";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const command = String(payload?.tool_input?.command ?? "");
if (!/\bgit\b[^\n]*\bcommit\b/.test(command) || command.includes(MARKER)) process.exit(0);

let status;
try {
  status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: payload.cwd || process.cwd(),
    encoding: "utf8",
  });
} catch {
  process.exit(0);
}

const paths = status
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""));
const touchesExtension = paths.some((path) => path.startsWith("src/"));
const touchesChangelog = paths.includes("CHANGELOG.md");

if (touchesExtension && !touchesChangelog) {
  process.stderr.write(
    "Commit refusé : src/ change mais CHANGELOG.md n'est pas modifié.\n" +
      "Si le changement est visible par l'utilisatrice, ajouter une ligne courte en français " +
      "sous la date du jour (## AAAA-MM-JJ), dans « ### Fonctionnalités », « ### Corrections » " +
      "ou « ### Refonte », sans reformuler les lignes existantes.\n" +
      `Sinon (refactor, lint, tests, doc), ajouter « ${MARKER} » au message de commit.\n`,
  );
  process.exit(2);
}
