import { expect, test } from "@playwright/test";
import { SCENE_WARM } from "../../src/art/palette";
import { gridToScreen } from "../../src/engine/iso";
import { blurryBlocks, colors, decode, ready, SIZES, type Office } from "./helpers";

const OUT = "docs/screenshots/qa";

for (const size of SIZES) {
  test.describe(`@${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr });

    test("empty office: integer scale, crisp pixels, scene palette only", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/?ws=ws://localhost:1/none&freeze=0");
      await ready(page);
      await page.waitForTimeout(500);
      const vp = await page.evaluate(() => (window as unknown as { __agentOffice: Office }).__agentOffice.viewport());
      expect(Number.isInteger(vp.scale)).toBe(true);
      expect(vp.scale).toBeGreaterThanOrEqual(2);
      const rendering = await page.locator("canvas").evaluate((c) => getComputedStyle(c).imageRendering);
      expect(rendering).toBe("pixelated");
      const shot = await page.screenshot({ path: `${OUT}/empty-${size.name}.png` });
      const png = decode(shot);
      expect(png.width).toBe(size.width * size.dpr);
      expect(blurryBlocks(png, vp.scale)).toBe(0);
      const allowed = new Set(Object.values(SCENE_WARM));
      const stray = [...colors(png)].filter((c) => !allowed.has(c));
      expect(stray, "colours outside the 24-colour scene palette").toEqual([]);
      expect(errors).toEqual([]);
    });

    test("scripted scene: agents, sub-agents, crisp", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/?mock=1&speed=2");
      await ready(page);
      await page.waitForFunction(() => (window as unknown as { __agentOffice: Office }).__agentOffice.office.agents.size >= 4, null, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      const vp = await page.evaluate(() => (window as unknown as { __agentOffice: Office }).__agentOffice.viewport());
      const png = decode(await page.screenshot({ path: `${OUT}/scene-${size.name}.png` }));
      expect(blurryBlocks(png, vp.scale)).toBe(0);
      expect(errors).toEqual([]);
    });

    test("gallery renders", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/gallery");
      await page.waitForFunction(() => (window as unknown as { __galleryReady?: boolean }).__galleryReady === true);
      await page.waitForTimeout(800);
      expect(await page.locator("canvas").count()).toBeGreaterThan(150);
      if (size.name === "1920x1080") await page.screenshot({ path: `${OUT}/gallery-${size.name}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  });
}

test.describe("waiting beacons", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("waiting agents get a beacon", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?ws=ws://localhost:1/none");
    await ready(page);
    const apply = (e: unknown) => page.evaluate((ev) => (window as unknown as { __agentOffice: Office }).__agentOffice.apply(ev), e);
    await apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    await apply({ type: "agent_spawn", agentId: "b", kind: "claude" });
    await page.waitForTimeout(3000);
    await apply({ type: "agent_waiting", agentId: "a", reason: "" });
    await apply({ type: "agent_tool", agentId: "b", tool: "Read", summary: "" });
    await apply({ type: "agent_waiting", agentId: "b", reason: "", need: "input" });
    await page.waitForTimeout(1000);
    const where = () =>
      page.evaluate(() => {
        const o = (window as unknown as { __agentOffice: Office }).__agentOffice;
        const pos = (id: string) => {
          const a = o.office.agents.get(id) as unknown as { x: number; y: number; state: string };
          return { x: a.x, y: a.y, state: a.state };
        };
        return { a: pos("a"), b: pos("b"), origin: o.view.origin, cam: { x: Math.round(o.camera.x), y: Math.round(o.camera.y) }, scale: o.viewport().scale };
      });
    const w = await where();
    const png = decode(await page.screenshot());
    expect(await where()).toEqual(w);
    expect(w.a.state).toBe("waiting");
    expect(w.b.state).toBe("waiting");
    // Beam and ring only: the box stops below the head, where the old sprite bubble sat.
    const countAbove = (p: { x: number; y: number }, color: string) => {
      const s = gridToScreen(p.x, p.y, w.origin);
      let n = 0;
      for (let y = Math.round(s.y) - 24; y <= Math.round(s.y) + 6; y++) {
        for (let x = Math.round(s.x) - 12; x <= Math.round(s.x) + 12; x++) {
          const px = (x - w.cam.x) * w.scale;
          const py = (y - w.cam.y) * w.scale;
          if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
          const o = (py * png.width + px) * 4;
          const hex = `#${[png.data[o]!, png.data[o + 1]!, png.data[o + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          if (hex === color) n++;
        }
      }
      return n;
    };
    expect(countAbove(w.a, SCENE_WARM.red), "red beacon above a").toBeGreaterThan(8);
    expect(countAbove(w.b, SCENE_WARM.sky1), "blue beacon above b").toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });
});

test.describe("depth sorting stability", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("frozen frames with 30 agents are pixel-identical (no sort flicker)", async ({ page }) => {
    await page.goto("/?mock=stress&n=30&freeze=12");
    await ready(page);
    await page.waitForTimeout(13_000);
    const a = await page.screenshot();
    await page.waitForTimeout(400);
    const b = await page.screenshot();
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
