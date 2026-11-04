// Adds / removes the Agent Office git hooks in the global git config (config-based hooks, git >= 2.54).
// They run in addition to each repo's own hooks; every other git setting is kept.
//   node scripts/git-hooks.mjs install [port]   (idempotent)
//   node scripts/git-hooks.mjs uninstall        (removes exactly the hook.agent-office-push / -refs sections)
//   node scripts/git-hooks.mjs status
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [cmd = "status", port = "4317"] = process.argv.slice(2);
const script = fileURLToPath(new URL("git-hook.sh", import.meta.url));
/** Section name → [git event, our kind argument]. */
const HOOKS = { "agent-office-push": ["pre-push", "pre-push"], "agent-office-refs": ["reference-transaction", "refs"] };

// LC_ALL=C: the "no such section" match below must not depend on the user's locale.
const git = (args, cwd) => execFileSync("git", args, { cwd, env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const shq = (s) => `'${s.replaceAll("'", "'\\''")}'`;

function remove() {
  for (const name of Object.keys(HOOKS)) {
    try { git(["config", "--global", "--remove-section", `hook.${name}`]); } catch (e) {
      if (!/no such section/i.test(String(e.stderr))) throw e;
    }
  }
}

function listed() {
  const dir = mkdtempSync(join(tmpdir(), "agent-office-git-"));
  try {
    git(["init", "-q", dir]);
    return git(["hook", "list", "pre-push"], dir).includes("agent-office-push");
  } catch { return false; } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (cmd === "install" && !/^\d+$/.test(port)) {
  console.error("usage: node scripts/git-hooks.mjs install [port]");
  process.exit(1);
} else if (cmd === "install") {
  remove();
  for (const [name, [event, kind]] of Object.entries(HOOKS)) {
    git(["config", "--global", "--add", `hook.${name}.event`, event]);
    // Git appends its own args as "$@"; a moved or deleted checkout must not abort every commit and push.
    git(["config", "--global", "--add", `hook.${name}.command`, `f=${shq(script)}; [ ! -f "$f" ] || sh "$f" ${port} ${kind}`]);
  }
  if (!listed()) {
    remove();
    console.error(`git >= 2.54 is required for config-based hooks (found ${git(["--version"]).trim()})`);
    process.exit(1);
  }
  console.log(`Agent Office git hooks installed (port ${port})`);
} else if (cmd === "uninstall") {
  remove();
  console.log("Agent Office git hooks removed");
} else {
  let command = "";
  try { command = git(["config", "--global", "--get", "hook.agent-office-push.command"]); } catch {}
  const p = command.match(/ (\d+) pre-push/)?.[1];
  console.log(p ? `Agent Office git hooks on (port ${p})` : "Agent Office git hooks not installed");
}
