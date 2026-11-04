import type { Bitmap } from "../engine/bitmap";
import { drawSleepZ, drawSparkle } from "../engine/emotes";
import { Mask, paintMatrix, paintShape } from "../engine/shape";
import { poseFor, STANDARD_ANIMATIONS, type Pose } from "./pose";
import type { CharacterDefinition, DrawContext, SizeSpec } from "./types";

/**
 * "Claude" mascot "Clawd" — warm coral blocky body on four little legs, tall dot eyes
 * (terminal-mascot lineage). Chosen in the design review over the chibi variant.
 */

const PALETTE = {
  outline: "#8c3a2a",
  shade: "#bd5f42",
  base: "#d97757",
  light: "#eb9673",
  spec: "#f8c9a8",
  eye: "#2b1e2e",
  blush: "#f28b8b",
  cover: "#3e5a8c",
  coverDark: "#24305a",
  paper: "#f3e3c3",
  glow: "#6fd0b8",
};
const FIXED = ["eye", "blush", "cover", "coverDark", "paper", "glow"];

const SIZES: Record<"full" | "mini", SizeSpec> = {
  full: { frame: { w: 32, h: 44 }, anchor: { x: 16, y: 42 }, shadow: { rx: 9, ry: 3 }, head: { x: 0, y: -18 } },
  mini: { frame: { w: 22, h: 30 }, anchor: { x: 11, y: 28 }, shadow: { rx: 5, ry: 2 }, head: { x: 0, y: -12 } },
};

const ramp = (p: Record<string, string>) => ({ outline: p.outline!, shade: p.shade!, base: p.base!, light: p.light! });

function drawBook(bmp: Bitmap, p: Record<string, string>, cx: number, y: number, mini: boolean, page: boolean): void {
  const rows = mini ? ["kkkkk", "kbcbk", "kkkkk"] : [page ? "..pp...." : "........", ".kkkkkk.", "kbbbbbbk", "kbbppbbk", "kbbbbbbk", ".kkkkkk."];
  paintMatrix(bmp, rows, { k: p.coverDark!, b: p.cover!, p: p.paper! }, cx - Math.floor(rows[0]!.length / 2), y - (mini ? 0 : 1));
}

function drawEyes(bmp: Bitmap, p: Record<string, string>, xs: readonly number[], y: number, h: number, w: number, pose: Pose): void {
  for (const x of xs) {
    switch (pose.eyes) {
      case "blink":
        bmp.rect(x, y + h - 1, w, 1, p.eye!);
        break;
      case "happy":
        bmp.set(x - 1, y + 1, p.eye!);
        bmp.rect(x, y, w, 1, p.eye!);
        bmp.set(x + w, y + 1, p.eye!);
        break;
      case "focus":
        bmp.rect(x, y + 1, w, Math.max(1, h - 1), p.eye!);
        break;
      case "up":
        bmp.rect(x, y - 1, w, h, p.eye!);
        break;
      default:
        bmp.rect(x, y, w, h, p.eye!);
    }
  }
}

function drawEmotes(bmp: Bitmap, pose: Pose, headX: number, headTop: number, ctx: DrawContext): void {
  const bx = headX + (ctx.size === "full" ? 6 : 4);
  if (pose.zzz !== null) drawSleepZ(bmp, bx - 2, headTop, pose.zzz, ctx.size);
  for (const [dx, dy, big] of pose.sparkles) {
    const k = ctx.size === "full" ? 1 : 0.6;
    drawSparkle(bmp, Math.round(headX + dx * k), Math.round(headTop + dy * k), big && ctx.size === "full");
  }
}

const CLAWD = {
  full: { bw: 16, bh: 12, legH: 4, legW: 2, legXs: [1, 5, 9, 13], armW: 2, armH: 4, armY: 5, eyeXs: [-4, 3], eyeY: 3, eyeH: 3, eyeW: 2, blush: true },
  mini: { bw: 10, bh: 8, legH: 3, legW: 1, legXs: [1, 3, 6, 8], armW: 1, armH: 3, armY: 3, eyeXs: [-2, 2], eyeY: 2, eyeH: 2, eyeW: 1, blush: true },
};

function drawClawd(bmp: Bitmap, ctx: DrawContext): void {
  const S = SIZES[ctx.size];
  const P = CLAWD[ctx.size];
  const pose = poseFor(ctx.anim, ctx.frame);
  const p = ctx.pal;
  const cx = S.anchor.x;
  const feetY = S.anchor.y - pose.jump;
  const top = feetY - P.legH - P.bh + 1 + pose.bob;
  const bx = cx - Math.floor(P.bw / 2);
  const bottom = top + P.bh - 1;

  const m = new Mask(bmp.w, bmp.h);
  m.roundRect(bx, top, P.bw, P.bh, 1);
  m.rect(bx - P.armW, top + P.armY + pose.armL, P.armW, P.armH);
  m.rect(bx + P.bw, top + P.armY + pose.armR, P.armW, P.armH);
  P.legXs.forEach((lx, i) => {
    const end = feetY - (pose.lift[i] ?? 0);
    for (let y = bottom + 1; y <= end; y++) m.rect(bx + lx, y, P.legW, 1);
  });
  paintShape(bmp, m, ramp(p));
  bmp.set(bx + 2, top + 1, p.spec!);

  if (ctx.view === "front") {
    const ey = top + P.eyeY;
    const xs = P.eyeXs.map((dx) => cx + dx);
    drawEyes(bmp, p, xs, ey, P.eyeH, P.eyeW, pose);
    if (P.blush && pose.eyes !== "focus") {
      const bw = P.eyeW;
      bmp.rect(xs[0]! - bw, ey + P.eyeH + 1, bw, 1, p.blush!);
      bmp.rect(xs[1]! + P.eyeW, ey + P.eyeH + 1, bw, 1, p.blush!);
    }
    if (pose.eyes === "happy") bmp.rect(cx, ey + P.eyeH + 1, ctx.size === "full" ? 2 : 1, 1, p.outline!);
    if (pose.glow) bmp.rect(cx - 2, bottom - 1, 4, 1, p.glow!);
    if (pose.prop === "book") drawBook(bmp, p, cx, top + P.armY + 1, ctx.size === "mini", pose.page);
  }
  ctx.accessory(bmp, cx + 2 + pose.wobble, top - 1);
  drawEmotes(bmp, pose, cx, top, ctx);
}

export const CLAUDE: CharacterDefinition = {
  id: "claude",
  name: "Claude « Clawd »",
  description: "Mascotte corail, corps carré sur quatre petites pattes.",
  palette: PALETTE,
  fixedColors: FIXED,
  sizes: SIZES,
  animations: STANDARD_ANIMATIONS,
  draw: drawClawd,
  idlePreferences: { cafe: 5, window: 1 },
};
