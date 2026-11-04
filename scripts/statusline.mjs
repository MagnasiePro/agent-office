// Status line for Claude Code that feeds rate-limit usage to Agent Office, wrapping any existing status line.
//   node scripts/statusline.mjs install [port]   (idempotent, writes a timestamped backup first)
//   node scripts/statusline.mjs uninstall        (restores the previous status line exactly)
//   node scripts/statusline.mjs status
//   node scripts/statusline.mjs run <port> <prev>   (what Claude Code calls; <prev> = base64url previous status line or "-")
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = process.env.CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");
const MARK = "# agent-office";
const [cmd = "status", arg1, arg2 = "-"] = process.argv.slice(2);

const decode = (prev) => (prev === "-" ? undefined : JSON.parse(Buffer.from(prev, "base64url").toString("utf8")));
const encode = (prev) => (prev ? Buffer.from(JSON.stringify(prev)).toString("base64url") : "-");

async function run(port, prev) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks);
  let input = {};
  try { input = JSON.parse(raw.toString("utf8")); } catch {}

  // Claude Code may report more than 100 % in overage; drop windows without a usable number.
  const win = (w) => (Number.isFinite(w?.used_percentage) ? { usedPercentage: Math.min(100, Math.max(0, w.used_percentage)), resetsAt: w.resets_at } : undefined);
  const body = { fiveHour: win(input.rate_limits?.five_hour), sevenDay: win(input.rate_limits?.seven_day) };
  const post = body.fiveHour || body.sevenDay
    ? fetch(`http://localhost:${port}/usage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(500),
      }).catch(() => {})
    : Promise.resolve();

  const previous = (() => { try { return decode(prev); } catch { return undefined; } })();
  const line = previous?.command
    ? new Promise((resolve) => {
        const child = spawn("sh", ["-c", previous.command], { stdio: ["pipe", "pipe", "ignore"] });
        const out = [];
        child.stdout.on("data", (d) => out.push(d));
        child.on("error", () => resolve(""));
        child.on("close", () => resolve(Buffer.concat(out).toString("utf8")));
        child.stdin.on("error", () => {});
        child.stdin.end(raw);
      })
    : Promise.resolve(`[${input.model?.display_name ?? "Claude"}] ${basename(input.workspace?.current_dir ?? "")}\n`);

  const [text] = await Promise.all([line, post]);
  process.stdout.write(text);
}

if (cmd === "run") {
  await run(arg1, arg2).catch(() => {});
  process.exit(0);
}

const settings = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const ours = (s) => typeof s?.command === "string" && s.command.includes(MARK);
const storedPrev = (s) => {
  const m = s.command.match(/ run \d+ (\S+) # agent-office$/);
  if (!m) throw new Error("unreadable");
  return decode(m[1]);
};

function save() {
  const backup = `${FILE}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (existsSync(FILE)) copyFileSync(FILE, backup);
  writeFileSync(FILE, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`saved ${FILE} (backup: ${backup})`);
}

if (cmd === "install" && !/^\d+$/.test(arg1 ?? "4317")) {
  console.error("usage: node scripts/statusline.mjs install [port]");
  process.exit(1);
} else if (cmd === "install") {
  const port = arg1 ?? "4317";
  let previous;
  try { previous = ours(settings.statusLine) ? storedPrev(settings.statusLine) : settings.statusLine; } catch {
    console.error("cannot read the previous status line stored in the Agent Office command; run uninstall first or fix it by hand");
    process.exit(1);
  }
  const script = fileURLToPath(import.meta.url);
  settings.statusLine = { ...previous, type: "command", command: `node "${script}" run ${port} ${encode(previous)} ${MARK}` };
  save();
} else if (cmd === "uninstall") {
  if (!ours(settings.statusLine)) {
    console.log("Agent Office status line not installed (current status line left untouched)");
  } else {
    let previous;
    try { previous = storedPrev(settings.statusLine); } catch {
      console.log("cannot read the previous status line stored in the Agent Office command; nothing changed (restore it by hand from the .bak file)");
      process.exit(0);
    }
    if (previous) settings.statusLine = previous;
    else delete settings.statusLine;
    save();
  }
} else if (ours(settings.statusLine)) {
  let wraps = false;
  try { wraps = !!storedPrev(settings.statusLine); } catch {}
  console.log(`Agent Office status line on (${wraps ? "wraps a previous command" : "no previous status line"})`);
} else {
  console.log("Agent Office status line not installed");
}
