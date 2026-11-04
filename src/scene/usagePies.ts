import type { Usage, UsageWindow } from "../../shared/events";
import type { ScenePalette } from "../art/palette";
import { UNIT, worldToScreen, type Vec2 } from "../engine/iso";
import type { WorldLayout } from "../world/layout";

/** Used share of a rate-limit window in [0, 1], or null when unknown or already reset. */
export function pieFraction(w: UsageWindow | undefined, nowSec: number): number | null {
  if (!w || w.resetsAt <= nowSec) return null;
  return Math.min(1, Math.max(0, w.usedPercentage / 100));
}

/** 3×5 marker handwriting, rows top to bottom. */
const GLYPHS: Record<string, string[]> = {
  "5": ["###", "#..", "###", "..#", "###"],
  "7": ["###", "..#", "..#", ".#.", ".#."],
  h: ["#..", "#..", "###", "#.#", "#.#"],
  d: ["..#", "..#", "###", "#.#", "###"],
};

const R = 5;

/**
 * The 5h and 7d usage pies, marker-drawn on the whiteboard surface (the +x face at local x 6,
 * board-local (ly, lz) from (2, 16)). Higher ly is further left on screen, so 5h sits at ly 17.
 */
export function drawUsagePies(ctx: CanvasRenderingContext2D, usage: Usage | null, layout: WorldLayout, origin: Vec2, pal: ScenePalette, nowSec: number): void {
  const pl = layout.furniture.find((p) => p.def.id === "whiteboard");
  if (!pl) return;
  // Screen position of board-local (0, 0); along the board, +1 ly is 1 px left and half a px down.
  const b = worldToScreen(pl.x * UNIT + 6, pl.y * UNIT + 2, 16);
  const bx = origin.x + b.x;
  const by = origin.y + b.y;
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  const pies: [number, string, UsageWindow | undefined, string][] = [
    [17, "5h", usage?.fiveHour, pal.coral1],
    [7, "7d", usage?.sevenDay, pal.sky1],
  ];
  for (const [cy, label, w, colour] of pies) {
    const f = pieFraction(w, nowSec);
    const fill = f !== null && f >= 0.9 ? pal.red : colour;
    // Walk screen pixels and map each centre back onto the board (like IsoPainter.planeX), so the
    // ink outline is a clean screen-space ring around the sheared disc.
    const local = (x: number, y: number) => {
      const ly = bx - (x + 0.5);
      return { dy: ly - cy, dz: by + ly / 2 - (y + 0.5) - 14 };
    };
    const inside = (x: number, y: number) => {
      const { dy, dz } = local(x, y);
      return dy * dy + dz * dz <= R * R;
    };
    const x0 = Math.floor(bx - cy - R) - 1;
    const y0 = Math.floor(by + (cy - R) / 2 - 14 - R) - 1;
    for (let x = x0; x <= x0 + 2 * R + 2; x++) {
      for (let y = y0; y <= y0 + 3 * R + 3; y++) {
        if (!inside(x, y)) continue;
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) px(x, y, pal.ink);
        else if (f !== null) {
          // Clockwise from 12 o'clock as seen on screen, where screen-right is -ly.
          const { dy, dz } = local(x, y);
          if ((Math.atan2(-dy, dz) + 2 * Math.PI) % (2 * Math.PI) < f * 2 * Math.PI) px(x, y, fill);
        }
      }
    }
    // Each glyph stays upright and steps down the board's slope as a whole, like real handwriting.
    [...label].forEach((ch, i) => {
      const ly = cy + 3 - i * 4;
      const gx = Math.floor(bx - ly - 0.5);
      const gy = Math.floor(by + (ly + 0.5) / 2 - 8.5);
      GLYPHS[ch]!.forEach((row, r) => {
        for (let c = 0; c < 3; c++) if (row[c] === "#") px(gx + c, gy + r, pal.ink);
      });
    });
  }
}
