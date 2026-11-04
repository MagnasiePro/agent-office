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
    const where = () =>
      page.evaluate(() => {
        const o = (window as unknown as { __agentOffice: Office }).__agentOffice;
        const pos = (id: string) => {
          const a = o.office.agents.get(id) as unknown as { x: number; y: number; state: string };
          return { x: a.x, y: a.y, state: a.state };
        };
        return { a: pos("a"), b: pos("b"), origin: o.view.origin, cam: { x: Math.round(o.camera.x), y: Math.round(o.camera.y) }, scale: o.viewport().scale };
      });
    type Where = Awaited<ReturnType<typeof where>>;
    // Beam and ring only: the box (24×30 world px) stops below the head, where the old sprite bubble sat.
    const countAbove = (png: ReturnType<typeof decode>, w: Where, p: { x: number; y: number }, color: string) => {
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
    await apply({ type: "agent_tool", agentId: "b", tool: "Read", summary: "" });
    await page.waitForTimeout(300);
    await apply({ type: "agent_waiting", agentId: "b", reason: "", need: "input" });
    // Right away, while b may still be walking to its stop tile: blue already, never a red flash.
    const w0 = await where();
    const png0 = decode(await page.screenshot());
    expect(w0.b.state).toBe("waiting");
    expect(countAbove(png0, w0, w0.b, SCENE_WARM.red), "no red while b settles").toBe(0);
    await apply({ type: "agent_waiting", agentId: "a", reason: "" });
    await page.waitForTimeout(1000);
    const w = await where();
    const png = decode(await page.screenshot());
    expect(await where()).toEqual(w);
    expect(w.a.state).toBe("waiting");
    expect(w.b.state).toBe("waiting");
    expect(countAbove(png, w, w.a, SCENE_WARM.red), "red beacon above a").toBeGreaterThan(8);
    expect(countAbove(png, w, w.b, SCENE_WARM.sky2), "blue beacon above b").toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });
});

test.describe("station activity", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("working agents light up their station", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?ws=ws://localhost:1/none");
    await ready(page);
    const apply = (e: unknown) => page.evaluate((ev) => (window as unknown as { __agentOffice: Office }).__agentOffice.apply(ev), e);
    await apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    await page.waitForTimeout(2000);
    await apply({ type: "agent_tool", agentId: "a", tool: "Bash", summary: "" });
    await page.waitForFunction(() => (window as unknown as { __agentOffice: Office }).__agentOffice.office.agents.get("a")?.state === "working", null, { timeout: 20_000 });
    await page.waitForTimeout(3000); // let the camera settle
    const where = () =>
      page.evaluate(() => {
        const o = (window as unknown as { __agentOffice: Office }).__agentOffice;
        const a = o.office.agents.get("a") as unknown as { x: number; y: number; state: string };
        return { a: { x: a.x, y: a.y, state: a.state }, origin: o.view.origin, cam: { x: Math.round(o.camera.x), y: Math.round(o.camera.y) }, scale: o.viewport().scale };
      });
    const w = await where();
    const png0 = decode(await page.screenshot());
    await page.waitForTimeout(150);
    const png1 = decode(await page.screenshot());
    expect(await where()).toEqual(w);
    expect(w.a.state).toBe("working");
    type Png = ReturnType<typeof decode>;
    // Visits each canvas pixel of a world-space box (x0..x1, y0..y1 in screen px before scale).
    const each = (png: Png, x0: number, y0: number, x1: number, y1: number, f: (o: number) => void) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const px = (x - w.cam.x) * w.scale;
          const py = (y - w.cam.y) * w.scale;
          if (px >= 0 && py >= 0 && px < png.width && py < png.height) f((py * png.width + px) * 4);
        }
      }
    };
    const changed = (a: Png, b: Png, x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      each(a, x0, y0, x1, y1, (o) => (n += a.data[o] !== b.data[o] || a.data[o + 1] !== b.data[o + 1] || a.data[o + 2] !== b.data[o + 2] ? 1 : 0));
      return n;
    };
    const white = (png: Png, x0: number, y0: number, x1: number, y1: number) => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(SCENE_WARM.white.slice(i, i + 2), 16));
      let n = 0;
      each(png, x0, y0, x1, y1, (o) => (n += png.data[o] === r && png.data[o + 1] === g && png.data[o + 2] === bl ? 1 : 0));
      return n;
    };
    // The racks stand at x = 14. The "above" box sits just above the rack top, right of the desk monitors behind it
    // (they scroll on their own) and left of where a waiting agent's beam would rise, so only the station effect
    // changes it. The "face" box covers the rack's front face, where only the effect's progress bar is white.
    const rack = gridToScreen(14.5, Math.floor(w.a.y) + 0.5, w.origin);
    const rx = Math.round(rack.x);
    const ry = Math.round(rack.y);
    const above = [rx - 4, ry - 72, rx + 5, ry - 48] as const;
    const face = [rx - 4, ry - 30, rx + 3, ry + 4] as const;
    expect(changed(png0, png1, ...above), "activity above the rack").toBeGreaterThan(0);
    expect(white(png0, ...face) + white(png1, ...face), "progress bar on the rack face").toBeGreaterThan(0);
    const floor = gridToScreen(20.5, 7.5, w.origin);
    expect(changed(png0, png1, Math.round(floor.x) - 20, Math.round(floor.y) - 20, Math.round(floor.x) + 20, Math.round(floor.y) + 20), "empty floor stays still").toBe(0);
    // Same agent, same slot, but blocked on the user: the station goes quiet.
    await apply({ type: "agent_waiting", agentId: "a", reason: "" });
    await page.waitForTimeout(300);
    const png2 = decode(await page.screenshot());
    await page.waitForTimeout(150);
    const png3 = decode(await page.screenshot());
    const w2 = await where();
    expect(w2.a.state).toBe("waiting");
    expect({ ...w2, a: { x: w2.a.x, y: w2.a.y } }).toEqual({ ...w, a: { x: w.a.x, y: w.a.y } });
    expect(changed(png2, png3, ...above), "no activity above the rack while waiting").toBe(0);
    expect(white(png2, ...face) + white(png3, ...face), "no progress bar while waiting").toBe(0);
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
