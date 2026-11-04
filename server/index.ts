import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { parseEvent, parseGitEvent, parseUsageUpdate, type AgentEvent, type Usage } from "../shared/events";
import { play, randomScenario, scriptedScenario } from "../shared/scenario";
import { HookAdapter } from "./hook-adapter";
import { AgentTracker } from "./tracker";
import { checkUpdate, readVersion, type UpdateInfo } from "../scripts/update.mjs";

const PORT = Number(process.env.PORT ?? 4317);
const PROD = process.env.NODE_ENV === "production";
/** Built-in demo so `pnpm dev` is lively out of the box; it stops at the first real event. Disable with DEMO=0. */
const DEMO = process.env.DEMO !== "0";
const ROOT = join(import.meta.dirname, "..");
/** Daily look at the latest GitHub release; only offers, never applies. Disable with UPDATE_CHECK=0. */
const UPDATE_CHECK = process.env.UPDATE_CHECK !== "0";

const tracker = new AgentTracker();
const adapter = new HookAdapter();
const clients = new Set<WebSocket>();

function broadcastRaw(msg: AgentEvent | Usage): void {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
}

function broadcast(e: AgentEvent): void {
  tracker.apply(e);
  broadcastRaw(e);
}

// ── Demo ─────────────────────────────────────────────────────────────────────
let stopDemo: (() => void) | null = null;
if (DEMO) {
  const now = Math.floor(Date.now() / 1000);
  const demoUsage: Usage = { type: "usage", fiveHour: { usedPercentage: 62, resetsAt: now + 2 * 3600 }, sevenDay: { usedPercentage: 34, resetsAt: now + 3 * 86400 } };
  tracker.usage = demoUsage;
  let n = 0;
  const stopA = play(() => scriptedScenario(`demo-${n++}`), broadcast, { loop: false });
  let stopB: (() => void) | undefined;
  const t = setTimeout(() => (stopB = play(randomScenario(Math.random, ["claude", "claude", "robot"]), (e) => broadcast({ ...e, agentId: `demo:${e.agentId}`, ...("parentId" in e && e.parentId ? { parentId: `demo:${e.parentId}` } : {}) } as AgentEvent))), 72_000);
  stopDemo = () => {
    stopA();
    stopB?.();
    clearTimeout(t);
    if (tracker.usage === demoUsage) {
      tracker.usage = { type: "usage" };
      broadcastRaw(tracker.usage);
    }
    for (const id of tracker.ids()) if (id.startsWith("demo")) broadcast({ type: "agent_despawn", agentId: id });
    console.log("[agent-office] real events received → demo stopped");
  };
}
function external(): void {
  if (stopDemo) {
    stopDemo();
    stopDemo = null;
  }
}

// ── Update check ─────────────────────────────────────────────────────────────
let update: UpdateInfo = { current: readVersion(ROOT), latest: null, available: false, url: null };
async function refreshUpdate(): Promise<void> {
  const next = await checkUpdate(update.current);
  if (next.available && next.latest !== update.latest) console.log(`[agent-office] update available: v${next.current} → v${next.latest} (node scripts/update.mjs apply)`);
  // A failed check keeps the last known result instead of hiding a pending update.
  if (next.latest) update = next;
}
if (UPDATE_CHECK) {
  void refreshUpdate();
  setInterval(() => void refreshUpdate(), 24 * 3600_000).unref();
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      body += c;
      if (body.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "POST" && (url.pathname === "/hook" || url.pathname === "/events")) {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return true;
    }
    let events: AgentEvent[];
    if (url.pathname === "/hook") events = adapter.handle(body);
    else {
      const list = Array.isArray(body) ? body : [body];
      const parsed = list.map(parseEvent);
      if (parsed.some((e) => !e)) {
        json(res, 400, { error: "invalid AgentEvent" });
        return true;
      }
      events = parsed as AgentEvent[];
    }
    if (events.length) external();
    events.forEach(broadcast);
    json(res, 202, { accepted: events.length, events });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/git") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return true;
    }
    const git = parseGitEvent(body);
    if (!git) {
      json(res, 400, { error: "invalid git event" });
      return true;
    }
    const events = adapter.git(git.repo, git.direction);
    if (events.length) external();
    events.forEach(broadcast);
    json(res, 202, { accepted: events.length, events });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/usage") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return true;
    }
    const usage = parseUsageUpdate(body);
    if (!usage) {
      json(res, 400, { error: "invalid usage" });
      return true;
    }
    tracker.usage = usage; // deliberately not external(): usage alone must not stop the demo
    broadcastRaw(usage);
    json(res, 202, { accepted: true });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, clients: clients.size, agents: tracker.ids().length, demo: !!stopDemo, update });
    return true;
  }
  return false;
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const dist = join(ROOT, "dist");
  let path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/") path = "/index.html";
  if (path === "/gallery") path = "/gallery.html";
  const file = normalize(join(dist, path));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

let vite: import("vite").ViteDevServer | null = null;

const server = createServer((req, res) => {
  void api(req, res).then((handled) => {
    if (handled) return;
    if (!vite) return serveStatic(req, res);
    if (req.url === "/gallery" || req.url?.startsWith("/gallery?")) req.url = req.url.replace("/gallery", "/gallery.html");
    vite.middlewares(req, res);
  });
});

// Vite's HMR socket shares this HTTP server (otherwise the client tries a separate port and errors).
if (!PROD) vite = await (await import("vite")).createServer({ server: { middlewareMode: true, hmr: { server } }, appType: "mpa", root: ROOT });

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://x").pathname !== "/events") return; // let Vite HMR handle its own upgrades
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify(tracker.snapshot()));
    ws.on("close", () => clients.delete(ws));
  });
});

server.listen(PORT, () => {
  console.log(`Agent Office → http://localhost:${PORT}   galerie: /gallery   mock sans serveur: /?mock=1`);
  console.log(`  WebSocket ws://localhost:${PORT}/events · POST /hook (payload hook Claude Code) · POST /events (AgentEvent)${DEMO ? " · démo active (DEMO=0 pour couper)" : ""}`);
});
