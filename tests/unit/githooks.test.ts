import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Every git call is async so the in-process server keeps receiving while git runs.
const exec = promisify(execFile);
const installer = resolve("scripts/git-hooks.mjs");

let tmp: string;
let env: NodeJS.ProcessEnv;
let server: Server;
let port: number;
let bodies: unknown[];
let a: string; // clone that pushes / fetches
let b: string; // second clone that moves the remote ahead

const git = (cwd: string, ...args: string[]) => exec("git", args, { cwd, env });
const hooks = (...args: string[]) => exec("node", [installer, ...args], { env });
const commit = (cwd: string, name: string) => {
  writeFileSync(join(cwd, name), name);
  return git(cwd, "add", name).then(() => git(cwd, "commit", "-qm", name));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitBodies(n: number, ms = 2000) {
  const end = Date.now() + ms;
  while (bodies.length < n && Date.now() < end) await sleep(25);
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "githooks-"));
  mkdirSync(join(tmp, "t"));
  env = {
    PATH: process.env.PATH,
    HOME: tmp,
    TMPDIR: join(tmp, "t"),
    GIT_CONFIG_GLOBAL: join(tmp, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL!, "");
  bodies = [];
  server = createServer((req, res) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/git") bodies.push(JSON.parse(s));
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;

  // Remote and clones are set up before the hooks are installed.
  await git(tmp, "init", "-q", "--bare", "-b", "main", "remote.git");
  await git(tmp, "clone", "-q", "remote.git", "a");
  a = join(tmp, "a");
  await commit(a, "first");
  await git(a, "push", "-q", "-u", "origin", "HEAD:main");
  await git(tmp, "clone", "-q", "remote.git", "b");
  b = join(tmp, "b");
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

const toplevel = async (cwd: string) => (await git(cwd, "rev-parse", "--show-toplevel")).stdout.trim();

describe("git hooks", () => {
  it("install is idempotent and uninstall removes exactly our sections", async () => {
    const original = '[user]\n\tname = x\n[hook "other"]\n\tevent = post-commit\n\tcommand = true\n';
    writeFileSync(env.GIT_CONFIG_GLOBAL!, original);
    await hooks("install", String(port));
    await hooks("install", String(port));
    const installed = readFileSync(env.GIT_CONFIG_GLOBAL!, "utf8");
    expect(installed.startsWith(original)).toBe(true);
    expect(installed.match(/\[hook "agent-office-push"\]/g)).toHaveLength(1);
    expect(installed.match(/\[hook "agent-office-refs"\]/g)).toHaveLength(1);
    expect((await hooks("status")).stdout).toContain(`port ${port}`);
    await hooks("uninstall");
    await hooks("uninstall");
    expect(readFileSync(env.GIT_CONFIG_GLOBAL!, "utf8")).toBe(original);
    expect((await hooks("status")).stdout).toContain("not installed");
  });

  it("rejects a non-numeric port without writing", async () => {
    await expect(hooks("install", "--help")).rejects.toThrow(/usage: node scripts\/git-hooks.mjs install \[port\]/);
    expect(readFileSync(env.GIT_CONFIG_GLOBAL!, "utf8")).toBe("");
  });

  it("a successful push sends push", async () => {
    await hooks("install", String(port));
    await commit(a, "second");
    await git(a, "push", "-q");
    await waitBodies(1);
    await sleep(300);
    expect(bodies).toEqual([{ repo: await toplevel(a), direction: "push" }]);
  });

  it("a rejected push sends nothing", async () => {
    await hooks("install", String(port));
    await commit(b, "ahead");
    await git(b, "push", "-q");
    await waitBodies(1);
    bodies.length = 0;
    await commit(a, "behind");
    await expect(git(a, "push", "-q")).rejects.toThrow();
    await sleep(1500);
    expect(bodies).toEqual([]);
    // The marker lives in the repo's git common dir, not in a shared temp dir.
    expect(existsSync(join(a, ".git/agent-office-push"))).toBe(true);
    expect(readdirSync(env.TMPDIR!)).toEqual([]);
  });

  it("pushing two branches at once sends one push", async () => {
    await hooks("install", String(port));
    await git(a, "branch", "x");
    await commit(a, "second");
    await git(a, "push", "-q", "origin", "main", "x");
    await waitBodies(1);
    await sleep(1000);
    expect(bodies).toEqual([{ repo: await toplevel(a), direction: "push" }]);
    expect(readdirSync(join(a, ".git")).filter((f) => f.startsWith("agent-office-push"))).toEqual([]);
  });

  it("a fetch after a rejected push sends pull, not push", async () => {
    await hooks("install", String(port));
    await commit(b, "ahead");
    await git(b, "push", "-q");
    await waitBodies(1);
    bodies.length = 0;
    await commit(a, "behind");
    await expect(git(a, "push", "-q")).rejects.toThrow();
    await git(a, "fetch", "-q");
    await waitBodies(1);
    await sleep(300);
    expect(bodies).toEqual([{ repo: await toplevel(a), direction: "pull" }]);
  });

  it("a repo pre-push that fails still aborts the push and sends nothing", async () => {
    await hooks("install", String(port));
    writeFileSync(join(a, ".git/hooks/pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const before = (await git(join(tmp, "remote.git"), "rev-parse", "main")).stdout;
    await commit(a, "blocked");
    await expect(git(a, "push", "-q")).rejects.toThrow();
    expect((await git(join(tmp, "remote.git"), "rev-parse", "main")).stdout).toBe(before);
    await sleep(1500);
    expect(bodies).toEqual([]);
  });

  it("a fetch that brings commits sends pull; an empty fetch sends nothing", async () => {
    await hooks("install", String(port));
    await commit(b, "news");
    await git(b, "push", "-q");
    await waitBodies(1);
    bodies.length = 0;
    await git(a, "fetch", "-q");
    await waitBodies(1);
    await sleep(300);
    expect(bodies).toEqual([{ repo: await toplevel(a), direction: "pull" }]);
    bodies.length = 0;
    await git(a, "fetch", "-q");
    await sleep(1500);
    expect(bodies).toEqual([]);
  });

  it("a plain commit and a checkout send nothing", async () => {
    await hooks("install", String(port));
    await commit(a, "local");
    await git(a, "checkout", "-q", "-b", "side");
    await git(a, "checkout", "-q", "main");
    await sleep(1500);
    expect(bodies).toEqual([]);
  });

  it("a moved or deleted checkout leaves git working and silent", async () => {
    // A checkout path with quote, dollar and backtick: the stored command must neither break nor expand it.
    const co = join(tmp, "co 'q\"$HOME`x`");
    mkdirSync(co);
    for (const f of ["git-hooks.mjs", "git-hook.sh"]) copyFileSync(resolve("scripts", f), join(co, f));
    await exec("node", [join(co, "git-hooks.mjs"), "install", String(port)], { env });
    await commit(a, "before");
    await git(a, "push", "-q");
    await waitBodies(1);
    expect(bodies).toEqual([{ repo: await toplevel(a), direction: "push" }]);
    rmSync(co, { recursive: true });
    await commit(b, "news");
    await git(b, "push", "-q", "origin", "HEAD:news");
    for (const step of [
      () => commit(a, "after"),
      () => git(a, "checkout", "-q", "-b", "side"),
      () => git(a, "fetch", "-q"),
      () => git(a, "push", "-q", "origin", "side"),
    ]) {
      expect((await step()).stderr).toBe("");
    }
  });

  it("ref updates that do not touch remotes cost no more than a no-op hook", async () => {
    // Spawning any hook costs tens of ms per phase on some machines; measure only what our script adds on top.
    const loop = async (prefix: string) => {
      const t0 = Date.now();
      for (let i = 0; i < 20; i++) await git(a, "update-ref", `refs/heads/${prefix}${i}`, "HEAD");
      return Date.now() - t0;
    };
    await git(a, "config", "--global", "hook.noop.event", "reference-transaction");
    await git(a, "config", "--global", "hook.noop.command", "sh /dev/null");
    const base = await loop("noop");
    await git(a, "config", "--global", "--remove-section", "hook.noop");
    await hooks("install", String(port));
    const hooked = await loop("hooked");
    expect(hooked).toBeLessThan(base + 500);
  }, 20000);

  it("git is not slowed down or broken when the server is down", async () => {
    const closed = await new Promise<number>((r) => {
      const s = createServer().listen(0, () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => r(p));
      });
    });
    await hooks("install", String(closed));
    const t0 = Date.now();
    await commit(a, "fast");
    expect(Date.now() - t0).toBeLessThan(1000);
    await git(a, "push", "-q");
    expect((await git(join(tmp, "remote.git"), "rev-parse", "main")).stdout).toBe((await git(a, "rev-parse", "HEAD")).stdout);
  });
});
