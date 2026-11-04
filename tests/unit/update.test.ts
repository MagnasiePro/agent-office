import { describe, expect, it } from "vitest";
import { checkUpdate, compareVersions, fetchLatest, parseRelease } from "../../scripts/update.mjs";

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
