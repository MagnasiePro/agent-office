// Renders the Agent Office app icon: Clawd at night, with a padlock.
// Same pixel engine and palette as the scene, drawn on a 64×64 grid then scaled up (nearest neighbour).
//   tsx scripts/app-icon.ts <out.png> [size=1024]
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { SCENE_WARM as P } from "../src/art/palette";
import { CLAUDE } from "../src/characters/claude";
import { Bitmap } from "../src/engine/bitmap";
import type { Hex } from "../src/engine/color";
import { buildSpriteSet } from "../src/engine/sprite";

const [out = "icon.png", sizeArg = "1024"] = process.argv.slice(2);
const N = 64;
const icon = new Bitmap(N, N);

// Rounded tile (macOS icon grid: ~80% of the canvas), stepped corners.
const M = 6;
const R = 9;
const inTile = (x: number, y: number): boolean => {
  if (x < M || y < M || x >= N - M || y >= N - M) return false;
  const cx = Math.min(Math.max(x + 0.5, M + R), N - M - R);
  const cy = Math.min(Math.max(y + 0.5, M + R), N - M - R);
  return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= R * R;
};
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    if (!inTile(x, y)) continue;
    // Night sky: haze at the top fading to the background, ordered dither on the seam.
    const t = (y - M) / (N - 2 * M);
    const haze = t < 0.38 || (t < 0.5 && (x + y) % 2 === 0);
    icon.set(x, y, haze ? P.night1 : P.night0);
  }
}
for (const [x, y, c] of [[14, 13, P.butter], [45, 11, P.white], [51, 20, P.cream], [20, 22, P.cream], [38, 17, P.butter], [11, 30, P.white]] as [number, number, Hex][]) {
  icon.set(x, y, c);
}

// Soft ground shadow, then Clawd (idle, facing the viewer).
const fx = 27;
const fy = 42;
for (let y = -3; y <= 3; y++) for (let x = -12; x <= 12; x++) {
  if ((x / 12) ** 2 + (y / 3) ** 2 <= 1) icon.set(fx + x, fy + y, (x / 12) ** 2 + (y / 3) ** 2 <= 0.45 ? P.ink : (x + y) % 2 === 0 ? P.ink : P.night0);
}
const clawd = buildSpriteSet(CLAUDE, { size: "full", hue: 0, accessory: "none" });
const frame = clawd.anims.idle.frames.SE[0]!;
for (let y = 0; y < frame.h; y++) {
  for (let x = 0; x < frame.w; x++) {
    if (frame.opaque(x, y)) icon.setRaw(fx - clawd.size.anchor.x + x, fy - clawd.size.anchor.y + y, frame.get(x, y));
  }
}

// Padlock, bottom right: hand-placed shackle rows, outlined, over a butter body.
const lx = 41;
const ly = 26;
const SHACKLE = [
  "..XXXXXX..",
  ".XXXXXXXX.",
  "XXX....XXX",
  "XX......XX",
  "XX......XX",
  "XX......XX",
  "XX......XX",
];
const on = (x: number, y: number): boolean => SHACKLE[y]?.[x] === "X";
for (let y = -1; y <= SHACKLE.length; y++) for (let x = -1; x <= 10; x++) {
  if (on(x, y)) icon.set(lx + x, ly + y, x < 2 || y === 0 ? P.white : P.cream);
  else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) icon.set(lx + x, ly + y, P.ink);
}
const bx = lx - 2;
const by = ly + 6;
for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) {
  const edge = x === 0 || x === 13 || y === 0 || y === 11;
  icon.set(bx + x, by + y, edge ? P.ink : y >= 9 ? P.wood3 : x === 1 || y === 1 ? P.cream : P.butter);
}
icon.rect(bx + 6, by + 4, 2, 2, P.ink);
icon.rect(bx + 6, by + 6, 2, 1, P.ink);
icon.set(bx + 6, by + 7, P.ink);
icon.set(bx + 7, by + 7, P.ink);

const size = Number(sizeArg);
const png = new PNG({ width: size, height: size });
const rgba = new Uint8Array(icon.data.buffer);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const s = (Math.floor((y * N) / size) * N + Math.floor((x * N) / size)) * 4;
    png.data.set(rgba.subarray(s, s + 4), (y * size + x) * 4);
  }
}
writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out} (${size}×${size})`);
