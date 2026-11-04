// Offers Agent Office updates from GitHub releases (tags vX.Y.Z). Never updates on its own.
//   node scripts/update.mjs check          print the current version and the latest release
//   node scripts/update.mjs apply [--yes]  fast-forward this checkout to the latest release, after confirmation
// Also imported by the server for its background check (see docs/configuration.md#updates).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export const RELEASES_URL = "https://api.github.com/repos/MagnasiePro/agent-office/releases/latest";
export const ROOT = join(import.meta.dirname, "..");

/** @typedef {{ current: string, latest: string | null, available: boolean, url: string | null }} UpdateInfo */

/** @param {string} v */
const parts = (v) => (/^\d+\.\d+\.\d+$/.test(v.replace(/^v/, "")) ? v.replace(/^v/, "").split(".").map(Number) : null);

/** <0 when a is older than b. Anything that isn't plain X.Y.Z (pre-releases, junk) never counts as newer. */
export function compareVersions(/** @type {string} */ a, /** @type {string} */ b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return /** @type {number} */ (pa[i]) - /** @type {number} */ (pb[i]);
  return 0;
}

/** @param {unknown} body @returns {{ latest: string, url: string } | null} */
export function parseRelease(body) {
  const b = /** @type {{ tag_name?: unknown, html_url?: unknown } | null} */ (body);
  // Only vX.Y.Z: apply merges the tag `v<latest>`, so anything else would be offered but impossible to apply.
  if (typeof b?.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(b.tag_name) || typeof b.html_url !== "string") return null;
  return { latest: b.tag_name.replace(/^v/, ""), url: b.html_url };
}

/** Latest published release, or null when offline, rate-limited or anything else goes wrong. */
export async function fetchLatest(fetchFn = fetch) {
  try {
    const res = await fetchFn(RELEASES_URL, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000) });
    return res.ok ? parseRelease(await res.json()) : null;
  } catch {
    return null;
  }
}

/** @param {string} current @returns {Promise<UpdateInfo>} */
export async function checkUpdate(current, fetchFn = fetch) {
  const rel = await fetchLatest(fetchFn);
  return { current, latest: rel?.latest ?? null, available: !!rel && compareVersions(current, rel.latest) < 0, url: rel?.url ?? null };
}

/** @param {string} root @returns {string} */
export const readVersion = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

/** @typedef {(args: string[]) => { code: number, out: string }} Git */

/** Why `apply` must not touch this checkout, or null when it can fast-forward to `tag`. @param {Git} git @param {string} tag */
export function preflight(git, tag) {
  if (git(["rev-parse", "--is-inside-work-tree"]).code !== 0) return "This folder is not a git checkout: download the release instead.";
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== "main") return `Updates apply to the main branch only (you are on ${branch === "HEAD" ? "a detached HEAD" : branch}). Run git switch main first.`;
  if (git(["status", "--porcelain"]).out) return "You have uncommitted changes. Commit or discard them first; the update never touches your work.";
  if (git(["merge-base", "--is-ancestor", tag, "HEAD"]).code === 0) return `Already up to date (${tag} is in this checkout).`;
  if (git(["merge-base", "--is-ancestor", "HEAD", tag]).code !== 0) return `Your main branch has diverged from ${tag} (local commits?), so it cannot fast-forward. Update by hand.`;
  return null;
}

/** WorkingDirectory of the LaunchAgent plist, or null. @param {string} plist */
export function agentRoot(plist) {
  return /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1] ?? null;
}

/** Same folder once symlinks are resolved (launchagent.sh records the logical `pwd`). @param {string} a @param {string} b */
export function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Whether the native screen saver sources changed between two commits. @param {Git} git @param {string} from @param {string} tag */
export const saverChanged = (git, from, tag) => git(["diff", "--name-only", from, tag, "--", "saver/"]).out !== "";

/** @type {Git} */
const git = (args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
};
/** Runs a step in the foreground; false when it fails. @param {string} cmd @param {string[]} args */
const step = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status === 0;
};

/** @param {UpdateInfo} info @param {boolean} yes */
async function apply(info, yes) {
  if (!info.available || !info.latest) return console.log(info.latest ? `Up to date (v${info.current}).` : "Could not find a release on GitHub.");
  const tag = `v${info.latest}`;
  if (git(["rev-parse", "--is-inside-work-tree"]).code !== 0) {
    console.error(`This folder is not a git checkout: download the release instead: ${info.url}`);
    process.exit(1);
  }
  if (!step("git", ["fetch", "--tags", "origin"])) process.exit(1);
  const refusal = preflight(git, tag);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const from = git(["rev-parse", "HEAD"]).out;
  const undo = `git reset --hard ${from} && pnpm install --frozen-lockfile && pnpm build`;
  console.log(`\nUpdate v${info.current} → ${tag} (${info.url})\n  git merge --ff-only ${tag}\n  pnpm install --frozen-lockfile\n  pnpm build\nTo undo afterwards: ${undo}\n`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Apply ${tag}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return console.log("Nothing changed.");
  }
  for (const [cmd, ...args] of [["git", "merge", "--ff-only", tag], ["pnpm", "install", "--frozen-lockfile"], ["pnpm", "build"]]) {
    if (!step(/** @type {string} */ (cmd), args)) {
      console.error(`\nUpdate stopped. To go back: ${undo}`);
      process.exit(1);
    }
  }
  console.log(`\nUpdated to ${tag}. To undo: ${undo}`);
  if (saverChanged(git, from, tag)) console.log("The screen saver changed in this release: rebuild it with saver/legacy/build.sh");
  const plist = join(homedir(), "Library", "LaunchAgents", "com.agent-office.server.plist");
  const root = existsSync(plist) ? agentRoot(readFileSync(plist, "utf8")) : null;
  if (root && samePath(root, ROOT)) step(join(ROOT, "scripts", "launchagent.sh"), ["restart"]);
  else if (root) console.log(`The background server runs from another checkout (${root}); it was not restarted.`);
  else console.log("Restart your server to use the new version.");
}

async function main() {
  const [cmd = "check", ...flags] = process.argv.slice(2);
  if (cmd !== "check" && cmd !== "apply") {
    console.error("usage: node scripts/update.mjs check|apply [--yes]");
    process.exit(1);
  }
  const info = await checkUpdate(readVersion(ROOT));
  if (cmd === "apply") return apply(info, flags.includes("--yes"));
  console.log(`current: v${info.current}`);
  if (!info.latest) console.log("latest:  unknown (could not reach GitHub, or no release yet)");
  else console.log(`latest:  v${info.latest}${info.available ? ` → update available: ${info.url} (node scripts/update.mjs apply)` : " (up to date)"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
