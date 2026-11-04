import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

// The server listens on import, so it runs as a child process on a free port (production mode: no Vite, no demo).
let child: ChildProcess;
let base: string;

const freePort = () =>
  new Promise<number>((r) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => r(port));
    });
  });
const post = (path: string, body: string) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });

beforeAll(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  child = spawn(resolve("node_modules/.bin/tsx"), ["server/index.ts"], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", DEMO: "0" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}, 15_000);

afterAll(() => {
  child?.kill();
});

describe("POST /git", () => {
  it("rejects non-JSON and junk with 400", async () => {
    const bad = await post("/git", "{nope");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid JSON" });
    for (const body of [{}, { repo: "/x", direction: "merge" }, { repo: "", direction: "push" }]) {
      const r = await post("/git", JSON.stringify(body));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid git event" });
    }
  });

  it("routes a push to the matching session and broadcasts agent_mail", async () => {
    await post("/hook", JSON.stringify({ hook_event_name: "SessionStart", session_id: "srv-test", cwd: "/w/app" }));
    const ws = new WebSocket(`${base.replace("http", "ws")}/events`);
    const got: unknown[] = [];
    ws.on("message", (d) => got.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    const r = await post("/git", JSON.stringify({ repo: "/w/app", direction: "push" }));
    expect(r.status).toBe(202);
    const mail = { type: "agent_mail", agentId: "srv-test", direction: "push" };
    expect(await r.json()).toEqual({ accepted: 1, events: [mail] });
    for (let i = 0; i < 50 && !got.some((m) => JSON.stringify(m) === JSON.stringify(mail)); i++) await new Promise((r) => setTimeout(r, 20));
    expect(got).toContainEqual(mail);
    ws.close();
  });

  it("accepts a push nobody is working on with nothing to broadcast", async () => {
    const r = await post("/git", JSON.stringify({ repo: "/nowhere", direction: "pull" }));
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ accepted: 0, events: [] });
  });
});
