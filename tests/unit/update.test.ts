import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRoot, checkUpdate, compareVersions, fetchLatest, parseRelease, preflight, samePath, saverChanged } from "../../scripts/update.mjs";

const fakeOk = (tag: string) => (async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: "https://x" }) })) as unknown as typeof fetch;
const fakeStatus = (status: number) => (async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch;
const fakeThrow = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

describe("compareVersions", () => {
  it("orders numerically, ignoring a leading v", () => {
    expect(compareVersions("0.1.0", "v0.3.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });
  it("never reports a malformed or pre-release tag as newer", () => {
    expect(compareVersions("0.1.0", "v0.3.0-beta")).toBe(0);
    expect(compareVersions("0.1.0", "garbage")).toBe(0);
  });
});

describe("parseRelease", () => {
  it("reads tag and url", () => {
    expect(parseRelease({ tag_name: "v0.3.0", html_url: "https://x" })).toEqual({ latest: "0.3.0", url: "https://x" });
  });
  it("returns null on unexpected bodies", () => {
    expect(parseRelease({})).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
  it("only accepts vX.Y.Z tags, the ones apply can merge", () => {
    expect(parseRelease({ tag_name: "0.3.0", html_url: "https://x" })).toBeNull();
  });
});

describe("fetchLatest", () => {
  it("returns null on rate limit or network failure", async () => {
    expect(await fetchLatest(fakeStatus(403))).toBeNull();
    expect(await fetchLatest(fakeThrow)).toBeNull();
  });
});

describe("checkUpdate", () => {
  it("flags a newer release", async () => {
    expect(await checkUpdate("0.1.0", fakeOk("v0.3.0"))).toEqual({ current: "0.1.0", latest: "0.3.0", available: true, url: "https://x" });
  });
  it("is quiet when up to date", async () => {
    expect((await checkUpdate("0.3.0", fakeOk("v0.3.0"))).available).toBe(false);
  });
  it("is quiet when GitHub is unreachable", async () => {
    expect(await checkUpdate("0.1.0", fakeThrow)).toEqual({ current: "0.1.0", latest: null, available: false, url: null });
  });
});

/** Fake git: answers by joined args; unknown commands succeed with empty output. */
const fakeGit = (answers: Record<string, { code?: number; out?: string }>) => (args: string[]) => ({ code: 0, out: "", ...answers[args.join(" ")] });
const clean = {
  "rev-parse --is-inside-work-tree": { out: "true" },
  "rev-parse --abbrev-ref HEAD": { out: "main" },
  "status --porcelain": { out: "" },
  "merge-base --is-ancestor v0.3.0 HEAD": { code: 1 },
  "merge-base --is-ancestor HEAD v0.3.0": { code: 0 },
};

describe("preflight", () => {
  it("lets a clean main that can fast-forward through", () => {
    expect(preflight(fakeGit(clean), "v0.3.0")).toBeNull();
  });
  it("refuses outside a git checkout", () => {
    expect(preflight(fakeGit({ ...clean, "rev-parse --is-inside-work-tree": { code: 128 } }), "v0.3.0")).toMatch(/not a git checkout/);
  });
  it("refuses a feature branch or a detached HEAD", () => {
    expect(preflight(fakeGit({ ...clean, "rev-parse --abbrev-ref HEAD": { out: "feat/x" } }), "v0.3.0")).toMatch(/main/);
    expect(preflight(fakeGit({ ...clean, "rev-parse --abbrev-ref HEAD": { out: "HEAD" } }), "v0.3.0")).toMatch(/main/);
  });
  it("refuses uncommitted changes", () => {
    expect(preflight(fakeGit({ ...clean, "status --porcelain": { out: " M src/main.ts" } }), "v0.3.0")).toMatch(/uncommitted/);
  });
  it("says when the release is already in", () => {
    expect(preflight(fakeGit({ ...clean, "merge-base --is-ancestor v0.3.0 HEAD": { code: 0 } }), "v0.3.0")).toMatch(/up to date/);
  });
  it("refuses a branch that diverged from the release", () => {
    expect(preflight(fakeGit({ ...clean, "merge-base --is-ancestor HEAD v0.3.0": { code: 1 } }), "v0.3.0")).toMatch(/diverged/);
  });
});

describe("agentRoot", () => {
  it("reads the LaunchAgent working directory", () => {
    expect(agentRoot("<dict><key>Label</key><string>x</string><key>WorkingDirectory</key><string>/a/b</string></dict>")).toBe("/a/b");
    expect(agentRoot("<dict></dict>")).toBeNull();
  });
});

describe("saverChanged", () => {
  it("is true only when the release touches saver/", () => {
    expect(saverChanged(fakeGit({ "diff --name-only abc v0.3.0 -- saver/": { out: "saver/lock/x.swift" } }), "abc", "v0.3.0")).toBe(true);
    expect(saverChanged(fakeGit({}), "abc", "v0.3.0")).toBe(false);
  });
});

describe("samePath", () => {
  it("sees a folder and a symlink to it as the same checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-"));
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(samePath(join(dir, "link"), join(dir, "real"))).toBe(true);
    expect(samePath(join(dir, "real"), dir)).toBe(false);
    expect(samePath(join(dir, "missing"), dir)).toBe(false);
  });
});
