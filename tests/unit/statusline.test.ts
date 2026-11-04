import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/statusline.mjs");
let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "statusline-")), "settings.json");
});
const run = (args: string[], input = "") =>
  execFileSync("node", [script, ...args], { env: { ...process.env, CLAUDE_SETTINGS: file }, input, encoding: "utf8" });
const read = () => JSON.parse(readFileSync(file, "utf8"));

describe("statusline script", () => {
  it("installs a neutral status line when none exists, and uninstall removes it", () => {
    writeFileSync(file, "{}");
    run(["install"]);
    expect(read().statusLine.command).toContain("run 4317 -");
    expect(read().statusLine.command).toContain("# agent-office");
    run(["uninstall"]);
    expect(read().statusLine).toBeUndefined();
  });

  it("wraps an existing status line and restores it byte-identical", () => {
    const original = { type: "command", command: "echo mine", padding: 2, refreshInterval: 10 };
    writeFileSync(file, JSON.stringify({ statusLine: original }));
    run(["install"]);
    run(["install"]);
    expect(read().statusLine.padding).toBe(2);
    run(["uninstall"]);
    expect(read().statusLine).toEqual(original);
  });

  it("leaves a status line it does not own untouched on uninstall", () => {
    writeFileSync(file, "{}");
    run(["install"]);
    writeFileSync(file, JSON.stringify({ statusLine: { type: "command", command: "echo other" } }));
    run(["uninstall"]);
    expect(read().statusLine.command).toBe("echo other");
  });

  it("run prints the previous command's output", () => {
    const prev = Buffer.from(JSON.stringify({ type: "command", command: "cat >/dev/null; echo wrapped" })).toString("base64url");
    expect(run(["run", "1", prev], "{}")).toBe("wrapped\n");
  });

  it("run prints a neutral line and exits fast when the server is down", () => {
    const input = JSON.stringify({
      model: { display_name: "Opus" },
      workspace: { current_dir: "/a/b/proj" },
      rate_limits: { five_hour: { used_percentage: 5, resets_at: 1893456000 } },
    });
    const t = Date.now();
    expect(run(["run", "1", "-"], input)).toBe("[Opus] proj\n");
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
