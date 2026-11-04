import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseUsageUpdate, type Usage } from "../shared/events";

const URL = "https://api.anthropic.com/api/oauth/usage";

/** One window of `GET /api/oauth/usage`: `utilization` 0..100, `resets_at` ISO 8601. */
const window = (w: unknown) => {
  const o = w as { utilization?: unknown; resets_at?: unknown } | null | undefined;
  const at = typeof o?.resets_at === "string" ? Math.floor(Date.parse(o.resets_at) / 1000) : NaN;
  if (typeof o?.utilization !== "number" || !Number.isFinite(o.utilization) || !(at > 0)) return undefined;
  return { usedPercentage: Math.min(100, Math.max(0, o.utilization)), resetsAt: at };
};

/** Maps the usage endpoint's response to a `Usage` message, or null when it carries no usable window. */
export function parseOauthUsage(raw: unknown): Usage | null {
  const r = raw as { five_hour?: unknown; seven_day?: unknown } | null;
  return parseUsageUpdate({ fiveHour: window(r?.five_hour), sevenDay: window(r?.seven_day) });
}

const SERVICE = "Claude Code-credentials";
const FILE = join(homedir(), ".claude", ".credentials.json");
/** Claude Code's public OAuth client and token endpoint (as in its own refresh). */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const run = promisify(execFile);

interface Store {
  json: string;
  write(json: string): Promise<void>;
}

/** Claude Code's stored login: macOS Keychain, else `~/.claude/.credentials.json`. */
async function readStore(): Promise<Store | undefined> {
  try {
    if (process.platform !== "darwin") return { json: await readFile(FILE, "utf8"), write: (j) => writeFile(FILE, j, { mode: 0o600 }) };
    const json = (await run("security", ["find-generic-password", "-s", SERVICE, "-w"])).stdout.trim();
    const acct = (await run("security", ["find-generic-password", "-s", SERVICE])).stdout.match(/"acct"<blob>="([^"]*)"/)?.[1];
    if (!acct) return undefined;
    return {
      json,
      // Through stdin and hex (-X) so the secret never shows in the process list or needs quoting.
      write: async (j) => {
        const child = execFile("security", ["-i"]);
        const done = new Promise<void>((ok, ko) => child.on("close", (c) => (c === 0 ? ok() : ko(new Error(`security exited ${c}`)))));
        child.stdin!.end(`add-generic-password -U -s "${SERVICE}" -a "${acct.replace(/"/g, "")}" -X ${Buffer.from(j).toString("hex")}\n`);
        await done;
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * A valid access token from Claude Code's login. When it has expired (the desktop app keeps its own login, so nothing
 * refreshes the CLI one), it is refreshed and written back in place, as Claude Code would: refresh tokens rotate, so
 * keeping the old one would log the CLI out.
 */
async function accessToken(): Promise<string | "missing" | "expired"> {
  const store = await readStore();
  let creds: Record<string, unknown>;
  try {
    creds = JSON.parse(store!.json);
  } catch {
    return "missing";
  }
  const o = creds.claudeAiOauth as { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown; scopes?: unknown } | undefined;
  if (typeof o?.accessToken !== "string") return "missing";
  // A minute of margin so the token does not expire mid-request.
  if (typeof o.expiresAt !== "number" || o.expiresAt > Date.now() + 60_000) return o.accessToken;
  if (typeof o.refreshToken !== "string") return "expired";
  try {
    const scope = Array.isArray(o.scopes) ? o.scopes.join(" ") : undefined;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: o.refreshToken, client_id: CLIENT_ID, ...(scope ? { scope } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    const t = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (!res.ok || typeof t.access_token !== "string" || typeof t.expires_in !== "number") return "expired";
    const next = { ...o, accessToken: t.access_token, refreshToken: typeof t.refresh_token === "string" ? t.refresh_token : o.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
    await store!.write(JSON.stringify({ ...creds, claudeAiOauth: next }));
    console.log("[agent-office] usage poll: refreshed Claude Code login");
    return t.access_token;
  } catch (e) {
    console.log(`[agent-office] usage poll: login refresh failed: ${(e as Error).message}`);
    return "expired";
  }
}

/** Polls the usage endpoint every `everyMs` and hands each valid result to `onUsage`. Returns a stop function. */
export function startUsagePoller(onUsage: (u: Usage) => void, everyMs: number): () => void {
  let warned = "";
  const tick = async () => {
    const token = await accessToken();
    if (token === "missing" || token === "expired") {
      if (warned !== token) console.log(`[agent-office] usage poll: Claude Code login ${token === "missing" ? "not found" : "expired and could not be refreshed (run claude /login)"}, will retry`);
      warned = token;
      return;
    }
    try {
      const res = await fetch(URL, {
        headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
        signal: AbortSignal.timeout(10_000),
      });
      const u = res.ok ? parseOauthUsage(await res.json()) : null;
      if (u) onUsage(u);
      else console.log(`[agent-office] usage poll: ${res.ok ? "no usable window" : `HTTP ${res.status}`}`);
    } catch (e) {
      console.log(`[agent-office] usage poll failed: ${(e as Error).message}`);
    }
  };
  void tick();
  const t = setInterval(tick, everyMs).unref();
  return () => clearInterval(t);
}
