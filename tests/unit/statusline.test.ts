import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

  it("rejects a non-numeric port without writing", () => {
    writeFileSync(file, "{}");
    expect(() => execFileSync("node", [script, "install", "--help"], { env: { ...process.env, CLAUDE_SETTINGS: file }, stdio: "pipe" })).toThrow(/usage: node scripts\/statusline.mjs install \[port\]/);
    expect(readFileSync(file, "utf8")).toBe("{}");
  });

  it("refuses to uninstall when the stored previous status line cannot be parsed", () => {
    const mangled = { type: "command", command: 'node "x.mjs" run --help eyJ4 # agent-office' };
    writeFileSync(file, JSON.stringify({ statusLine: mangled }));
    expect(run(["uninstall"])).toContain("cannot");
    expect(read().statusLine).toEqual(mangled);
  });

  it("clamps usage above 100 and skips non-numeric windows", async () => {
    const bodies: unknown[] = [];
    const server = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { bodies.push(JSON.parse(b)); res.end(); });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const input = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 130, resets_at: 1 }, seven_day: { used_percentage: "x", resets_at: 2 } } });
    await new Promise<void>((res, rej) => {
      const c = spawn("node", [script, "run", String(port), "-"], { env: { ...process.env, CLAUDE_SETTINGS: file }, stdio: ["pipe", "ignore", "ignore"] });
      c.on("close", () => res());
      c.on("error", rej);
      c.stdin.end(input);
    });
    server.close();
    expect(bodies).toEqual([{ fiveHour: { usedPercentage: 100, resetsAt: 1 } }]);
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
