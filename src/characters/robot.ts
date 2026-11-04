import type { Bitmap } from "../engine/bitmap";
import { drawSleepZ, drawSparkle } from "../engine/emotes";
import { Mask, paintShape } from "../engine/shape";
import { poseFor, STANDARD_ANIMATIONS } from "./pose";
import type { CharacterDefinition, DrawContext, SizeSpec } from "./types";

/**
 * "Bolt" — placeholder second character (little blue robot) proving that a new agent type
 * is one self-contained file + one `registry.register()` call, with zero engine changes.
 */

const PALETTE = {
  outline: "#22356b",
  shade: "#3f63ad",
  base: "#5b8fd9",
  light: "#8fb8ee",
  spec: "#cfe4fb",
  steel0: "#3b3f52",
  steel1: "#6d7290",
  steel2: "#a3a8bf",
  steel3: "#cfd2df",
  visor: "#1b1f2e",
  eye: "#6fe3ff",
  bulbOn: "#ff6b6b",
  bulbOff: "#7a3340",
  screen: "#6fd0b8",
};
const FIXED = ["steel0", "steel1", "steel2", "steel3", "visor", "eye", "bulbOn", "bulbOff", "screen"];

const SIZES: Record<"full" | "mini", SizeSpec> = {
  full: { frame: { w: 32, h: 44 }, anchor: { x: 16, y: 42 }, shadow: { rx: 8, ry: 3 }, head: { x: 0, y: -22 } },
  mini: { frame: { w: 22, h: 30 }, anchor: { x: 11, y: 28 }, shadow: { rx: 5, ry: 2 }, head: { x: 0, y: -14 } },
};

const DIM = {
  full: { headW: 16, headH: 12, visorW: 12, visorH: 5, eye: 2, bodyW: 10, bodyH: 6, legH: 3, antenna: 4 },
  mini: { headW: 10, headH: 8, visorW: 8, visorH: 3, eye: 1, bodyW: 6, bodyH: 4, legH: 2, antenna: 2 },
};

function draw(bmp: Bitmap, ctx: DrawContext): void {
  const D = DIM[ctx.size];
  const S = SIZES[ctx.size];
  const full = ctx.size === "full";
  const pose = poseFor(ctx.anim, ctx.frame);
  const p = ctx.pal;
  const cx = S.anchor.x;
  const feetY = S.anchor.y - pose.jump;
  const steel = { outline: p.steel0!, shade: p.steel1!, base: p.steel2!, light: p.steel3! };

  // Legs + body + stick arms.
  const bodyTop = feetY - D.legH - D.bodyH + 1 + pose.bob;
  const bx = cx - D.bodyW / 2;
  const legs = new Mask(bmp.w, bmp.h);
  legs.rect(bx + 1, bodyTop + D.bodyH, 2, feetY - (pose.lift[0] ?? 0) - bodyTop - D.bodyH + 1);
  legs.rect(bx + D.bodyW - 3, bodyTop + D.bodyH, 2, feetY - (pose.lift[1] ?? 0) - bodyTop - D.bodyH + 1);
  paintShape(bmp, legs, steel);
  const body = new Mask(bmp.w, bmp.h).roundRect(bx, bodyTop, D.bodyW, D.bodyH, 1);
  paintShape(bmp, body, steel);
  const armLen = full ? 4 : 3;
  bmp.rect(bx - 1, bodyTop + pose.armL, 1, armLen, p.steel0!);
  bmp.rect(bx + D.bodyW, bodyTop + pose.armR, 1, armLen, p.steel0!);
  if (ctx.view === "front") bmp.set(cx, bodyTop + Math.floor(D.bodyH / 2), pose.glow ? p.screen! : p.bulbOn!);

  // Head.
  const headTop = bodyTop - D.headH + 1;
  const hx = cx - D.headW / 2;
  paintShape(bmp, new Mask(bmp.w, bmp.h).roundRect(hx, headTop, D.headW, D.headH, full ? 2 : 1), {
    outline: p.outline!,
    shade: p.shade!,
    base: p.base!,
    light: p.light!,
  });
  bmp.set(hx + 2, headTop + 1, p.spec!);

  // Antenna with blinking bulb.
  const ax = cx + 1 + pose.wobble;
  for (let i = 1; i <= D.antenna; i++) bmp.set(cx + 1, headTop - i, p.steel1!);
  const lit = ctx.anim === "waiting" || ctx.anim === "waiting_input" || ctx.anim === "done" || ctx.frame % 4 < 2;
  bmp.rect(ax - (full ? 1 : 0), headTop - D.antenna - (full ? 2 : 1), full ? 2 : 1, full ? 2 : 1, lit ? p.bulbOn! : p.bulbOff!);

  if (ctx.view === "front") {
    const vx = cx - D.visorW / 2 + 1;
    const vy = headTop + (full ? 3 : 2);
    bmp.rect(vx, vy, D.visorW, D.visorH, p.visor!);
    const ey = vy + (full ? 1 : 1);
    const exs = full ? [vx + 3, vx + 8] : [vx + 2, vx + 5];
    for (const ex of exs) {
      if (pose.eyes === "blink") bmp.rect(ex, ey + D.eye - 1, D.eye, 1, p.eye!);
      else if (pose.eyes === "happy") {
        bmp.rect(ex, ey, D.eye, 1, p.eye!);
        if (full) {
          bmp.set(ex - 1, ey + 1, p.eye!);
          bmp.set(ex + D.eye, ey + 1, p.eye!);
        }
      } else if (pose.eyes === "focus") bmp.rect(ex, ey + (full ? 1 : 0), D.eye, 1, p.eye!);
      else bmp.rect(ex, ey - (pose.eyes === "up" && full ? 1 : 0), D.eye, full ? 3 : 1, p.eye!);
    }
    if (pose.prop === "book") {
      // Bolt reads from a tablet.
      bmp.rect(cx - 3, bodyTop + 1, 6, full ? 4 : 2, p.steel0!);
      bmp.rect(cx - 2, bodyTop + 2, 4, full ? 2 : 1, pose.page ? p.eye! : p.screen!);
    }
  } else {
    // Back panel with two bolts.
    bmp.rect(cx - 1, headTop + 2, 2, D.headH - 4, p.shade!);
    bmp.set(cx - 3, headTop + 3, p.steel2!);
    bmp.set(cx + 2, headTop + 3, p.steel2!);
  }
  ctx.accessory(bmp, cx - 3 + pose.wobble, headTop - 1);

  if (pose.zzz !== null) drawSleepZ(bmp, cx + (full ? 5 : 3), headTop, pose.zzz, ctx.size);
  for (const [dx, dy, big] of pose.sparkles) {
    const k = full ? 1 : 0.6;
    drawSparkle(bmp, Math.round(cx + dx * k), Math.round(headTop + dy * k), big && full);
  }
}

export const ROBOT: CharacterDefinition = {
  id: "robot",
  name: "Bolt (robot factice)",
  description: "Petit robot bleu — 2ᵉ personnage de démonstration de l'extensibilité.",
  palette: PALETTE,
  fixedColors: FIXED,
  sizes: SIZES,
  animations: STANDARD_ANIMATIONS,
  draw,
  idlePreferences: { cafe: 3, terminal: 2 },
};
