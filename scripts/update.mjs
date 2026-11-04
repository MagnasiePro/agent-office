// Offers Agent Office updates from GitHub releases (tags vX.Y.Z). Never updates on its own.
//   node scripts/update.mjs check   print the current version and the latest release
// Also imported by the server for its background check (see docs/configuration.md#updates).
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  if (typeof b?.tag_name !== "string" || typeof b.html_url !== "string") return null;
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

async function main() {
  const [cmd = "check"] = process.argv.slice(2);
  if (cmd !== "check") {
    console.error("usage: node scripts/update.mjs check");
    process.exit(1);
  }
  const info = await checkUpdate(readVersion(ROOT));
  console.log(`current: v${info.current}`);
  if (!info.latest) console.log("latest:  unknown (could not reach GitHub, or no release yet)");
  else console.log(`latest:  v${info.latest}${info.available ? ` → update available: ${info.url}` : " (up to date)"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
