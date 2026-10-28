import type { ScenePalette } from "../art/palette";
import { Bitmap, bayer } from "../engine/bitmap";
import type { Hex } from "../engine/color";
import { gridToScreen, UNIT, type Vec2 } from "../engine/iso";
import { IsoPainter, renderCropped } from "../engine/isoPaint";
import type { FurnitureDef } from "./furniture";
import { isFloor, roomAt, type WallSpan, type WorldLayout } from "./layout";

/** Minimum internal render resolution; the viewport grows with the screen at an integer scale. */
export const VIEW_W = 480;
export const VIEW_H = 270;
export const WALL_H = 58;
const SLAB = 6;
const MARGIN = 8;

/** Pixel size of the whole world bitmap and the position of grid point (0, 0) inside it. */
export function worldFrame(layout: WorldLayout): { w: number; h: number; origin: Vec2 } {
  const left = layout.d * (UNIT) + MARGIN;
  const top = WALL_H + MARGIN;
  return {
    w: (layout.w + layout.d) * UNIT + MARGIN * 2,
    h: top + ((layout.w + layout.d) * UNIT) / 2 + SLAB + MARGIN,
    origin: { x: left, y: top },
  };
}

/** Vertical extent actually painted (back wall top to the lowest floor slab): the world box also spans the empty bottom of an L-shaped plan. */
export function worldContentRows(layout: WorldLayout): { top: number; bottom: number } {
  const { origin } = worldFrame(layout);
  let bottom = 0;
  for (const r of layout.rooms) bottom = Math.max(bottom, gridToScreen(r.x + r.w, r.y + r.d, origin).y + SLAB);
  return { top: origin.y - WALL_H, bottom };
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Night sky behind the diorama, sized to the viewport. */
export function renderBackground(w: number, h: number, pal: ScenePalette): Bitmap {
  const bmp = new Bitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w * 0.55);
      const dy = (y - h / 2) / (h * 0.6);
      const glow = 1 - Math.sqrt(dx * dx + dy * dy);
      bmp.set(x, y, bayer(x, y) < glow * 0.55 ? pal.night1 : pal.night0);
    }
  }
  for (let i = 0; i < (w * h) / 1800; i++) bmp.set(Math.floor(hash(i) * w), Math.floor(hash(i + 99) * h), i % 9 === 0 ? pal.cream : pal.wall0);
  return bmp;
}

/** Lighter / darker steps used for dithered lighting, staying inside the palette. */
function lighten(pal: ScenePalette, c: Hex): Hex {
  if (c === pal.wood1) return pal.wood2;
  if (c === pal.wood2) return pal.wood3;
  if (c === pal.sky0) return pal.sky1;
  if (c === pal.sky1) return pal.sky2;
  if (c === pal.wall1) return pal.wall2;
  return c;
}
function darken(pal: ScenePalette, c: Hex): Hex {
  if (c === pal.cream) return pal.wall2;
  if (c === pal.wood3) return pal.wood2;
  if (c === pal.wood2) return pal.wood1;
  if (c === pal.wood1) return pal.wood0;
  if (c === pal.sky2) return pal.sky1;
  if (c === pal.sky1) return pal.sky0;
  if (c === pal.wall2) return pal.wall1;
  if (c === pal.wall1) return pal.wall0;
  return c;
}

function baseFloor(layout: WorldLayout, pal: ScenePalette, x: number, y: number): Hex | null {
  const room = roomAt(layout, Math.floor(x / UNIT), Math.floor(y / UNIT));
  if (!room) return null;
  const lx = x - room.x * UNIT;
  const ly = y - room.y * UNIT;
  let c: Hex;
  switch (room.floor) {
    case "planks": {
      // Planks along x, 4 units wide, staggered end joints.
      const row = Math.floor(y / 4);
      const offset = Math.floor(hash(row + 7) * 48);
      c = pal.wood2;
      if (y - row * 4 < 0.9 || (x + offset) % 48 < 1) c = pal.wood1;
      else if (hash(row * 31 + Math.floor((x + offset) / 48)) > 0.82) c = pal.wood3;
      break;
    }
    case "tiles": {
      // Soft lab tiles with grout lines.
      const gx = lx % 8;
      const gy = ly % 8;
      c = gx < 0.8 || gy < 0.8 ? pal.wall1 : hash(Math.floor(lx / 8) * 13 + Math.floor(ly / 8) * 7) > 0.94 ? pal.sky2 : pal.wall2;
      break;
    }
    case "checker": {
      const k = (Math.floor(lx / 8) + Math.floor(ly / 8)) % 2;
      c = k === 0 ? pal.wood3 : pal.wood2;
      break;
    }
  }
  if (room.rug) {
    const rx0 = room.rug.x0 * UNIT;
    const rx1 = room.rug.x1 * UNIT;
    const ry0 = room.rug.y0 * UNIT;
    const ry1 = room.rug.y1 * UNIT;
    if (x > rx0 && x < rx1 && y > ry0 && y < ry1) {
      const e = Math.min(x - rx0, rx1 - x, y - ry0, ry1 - y);
      if (e < 2) c = pal.sky0;
      else if (e < 4.5) c = Math.floor((x + y) / 3) % 2 === 0 ? pal.cream : pal.sky1;
      else {
        const diamond = Math.abs(x - (rx0 + rx1) / 2) + Math.abs(y - (ry0 + ry1) / 2);
        c = diamond < 10 ? (diamond < 5 ? pal.butter : pal.coral1) : Math.floor(diamond / 4) % 3 === 0 ? pal.sky0 : pal.sky1;
      }
    }
  }
  return c;
}

function floorColor(layout: WorldLayout, pal: ScenePalette, x: number, y: number, px: number, py: number): Hex | null {
  let c = baseFloor(layout, pal, x, y);
  if (!c) return null;
  const dither = bayer(px, py);

  // Contact shadows: light comes from the top-left, shadows fall to +x / +y.
  for (const { def, x: fx, y: fy } of layout.furniture) {
    const x0 = fx * UNIT + 1;
    const y0 = fy * UNIT + 1;
    const x1 = (fx + def.footprint.w) * UNIT + 3;
    const y1 = (fy + def.footprint.d) * UNIT + 3;
    if (x > x0 && x < x1 && y > y0 && y < y1 && (Math.min(x1 - x, y1 - y) > 2 || dither < 0.5)) c = darken(pal, c);
  }
  // Under the back walls and in front of partitions.
  if ((y < 5 && dither < (5 - y) / 5) || (x < 5 && dither < (5 - x) / 5)) c = darken(pal, c);
  for (const p of layout.partitions) {
    const along = p.axis === "y" ? x / UNIT : y / UNIT;
    const off = (p.axis === "y" ? y : x) - p.at * UNIT;
    const inDoor = p.doors.some(([s, e]) => along >= s && along < e);
    if (!inDoor && along >= p.from && along < p.to && off > 0 && off < 4 && dither < (4 - off) / 4) c = darken(pal, c);
  }
  // Warm lamp pools.
  for (const l of layout.lamps) {
    const d = Math.hypot(x - (l.x * UNIT + 10), y - (l.y * UNIT + 8)) / 46;
    if (d < 1 && dither < (1 - d) * 0.9) c = lighten(pal, c);
  }
  // Moonlight patches below windows (light slants into the room).
  for (const w of layout.windows) {
    const a0 = w.from * UNIT + 2;
    const a1 = w.to * UNIT - 2;
    const depth = w.wall === "NE" ? y : x;
    const along = w.wall === "NE" ? x : y;
    const shift = depth * 0.35;
    if (depth > 2 && depth < 44 && along > a0 + shift && along < a1 + shift && dither < 0.5 - depth / 100) c = lighten(pal, c);
  }
  return c;
}

function windowPixel(pal: ScenePalette, along: number, z: number, span: WallSpan): Hex | null {
  const a0 = span.from * UNIT;
  const a1 = span.to * UNIT;
  if (along > a0 + 2 && along < a1 - 2 && z > 18 && z < 48) {
    const fx = along - a0 - 2;
    const fz = z - 18;
    const fw = a1 - a0 - 4;
    if (fx < 2 || fx > fw - 2 || fz < 2 || fz > 28) return pal.cream;
    if (Math.abs(fx - fw / 2) < 1 || Math.abs(fz - 15) < 0.8) return pal.wall2; // mullions
    const mx = fx - 8 - (span.from % 3) * 4;
    const mz = fz - 22;
    if (mx * mx + mz * mz < 14 && (mx - 1.5) ** 2 + (mz + 1) ** 2 > 9) return pal.butter;
    if (hash(Math.floor(fx) * 17 + Math.floor(fz) * 3 + span.from * 101) > 0.94) return pal.cream;
    return fz < 9 ? pal.sky1 : pal.sky0;
  }
  if (along > a0 && along < a1 && z > 16 && z < 19) return pal.cream; // sill
  return null;
}

function posterPixel(pal: ScenePalette, along: number, z: number, span: WallSpan): Hex | null {
  const a0 = span.from * UNIT;
  if (along <= a0 || along >= a0 + 20 || z <= 26 || z >= 48) return null;
  const ly = along - a0;
  const lz = z - 26;
  if (ly < 1.5 || ly > 18.5 || lz < 1.5 || lz > 20.5) return pal.wood1;
  const r = Math.hypot(ly - 10, lz - 11);
  const ray = Math.abs(Math.cos(Math.atan2(lz - 11, ly - 10) * 4)) ** 6;
  return r < 1.5 || (r < 7 && ray > 0.45) ? pal.coral1 : pal.cream;
}

/** Fairy light wire height at a position along a span; bulbs every 12 units. */
export function fairySag(along: number): number {
  return 50 - Math.abs(Math.sin((along / 40) * Math.PI)) * 5;
}

function fairyPixel(pal: ScenePalette, along: number, z: number, span: WallSpan): Hex | null {
  if (along < span.from * UNIT || along > span.to * UNIT) return null;
  const sag = fairySag(along);
  if (Math.abs(z - sag) < 0.6) return pal.ink;
  const bulb = Math.floor(along) % 12;
  if ((bulb === 5 || bulb === 6) && z < sag && z > sag - 3) return [pal.butter, pal.blush, pal.mint1][Math.floor(along / 12) % 3] ?? pal.butter;
  if ((bulb === 4 || bulb === 7) && z < sag - 0.5 && z > sag - 2.5 && bayer(Math.floor(along), Math.floor(z)) < 0.5) return pal.wall2;
  return null;
}

function wallPixel(layout: WorldLayout, pal: ScenePalette, wall: "NE" | "NW", along: number, z: number, base: Hex, dot: Hex, board: Hex): Hex {
  if (z < 3) return board; // baseboard
  if (z > WALL_H - 2) return wall === "NE" ? pal.wall2 : pal.wall1; // crown trim
  const spans = (list: WallSpan[]) => list.filter((s) => s.wall === wall);
  for (const s of spans(layout.windows)) {
    const c = windowPixel(pal, along, z, s);
    if (c) return c;
  }
  for (const s of spans(layout.posters)) {
    const c = posterPixel(pal, along, z, s);
    if (c) return c;
  }
  for (const s of spans(layout.fairyLights)) {
    const c = fairyPixel(pal, along, z, s);
    if (c) return c;
  }
  // Wallpaper: tiny dots in a half-drop grid.
  const col = Math.floor(along / 8);
  if (Math.floor(along) % 8 === 4 && (Math.floor(z) + (col % 2) * 4) % 8 === 4) return dot;
  return base;
}

/** Floors, slab edges, back walls and wall decorations: everything that never moves and needs no depth sorting. */
export function renderStaticLayer(layout: WorldLayout, pal: ScenePalette): Bitmap {
  const frame = worldFrame(layout);
  const bmp = new Bitmap(frame.w, frame.h);
  const p = new IsoPainter(bmp, frame.origin);
  const W = layout.w * UNIT;
  const D = layout.d * UNIT;

  // Floor slab front faces wherever a floor tile has void in front of it.
  for (let ty = 0; ty < layout.d; ty++) {
    for (let tx = 0; tx < layout.w; tx++) {
      if (!isFloor(layout, tx, ty)) continue;
      if (!isFloor(layout, tx, ty + 1))
        p.planeY((ty + 1) * UNIT, tx * UNIT, (tx + 1) * UNIT, -SLAB, 0, (x, z) => (z > -1.5 ? pal.wood1 : Math.floor(x) % 16 === 0 ? pal.ink : pal.wood0));
      if (!isFloor(layout, tx + 1, ty)) p.planeX((tx + 1) * UNIT, ty * UNIT, (ty + 1) * UNIT, -SLAB, 0, (_y, z) => (z > -1.5 ? pal.wood0 : pal.ink));
    }
  }
  p.quadZ(0, 0, W, 0, D, (px, py) => {
    const sx = px + 0.5 - p.origin.x;
    const sy = py + 0.5 - p.origin.y;
    return floorColor(layout, pal, sy + sx / 2, sy - sx / 2, px, py);
  });

  // Back walls: NE along y = 0 (lit) and NW along x = 0 (in shade), only where there is floor.
  const neLen = Array.from({ length: layout.w }, (_, x) => isFloor(layout, x, 0)).lastIndexOf(true) + 1;
  const nwLen = Array.from({ length: layout.d }, (_, y) => isFloor(layout, 0, y)).lastIndexOf(true) + 1;
  const wallTop = { top: pal.wall2, left: pal.wall1, right: pal.wall0, edge: pal.cream };
  p.box(-4, -4, 0, neLen * UNIT + 4, 4, WALL_H, wallTop);
  p.box(-4, 0, 0, 4, nwLen * UNIT, WALL_H, wallTop);
  p.planeY(0.01, 0, neLen * UNIT, 0, WALL_H, (x, z) => wallPixel(layout, pal, "NE", x, z, pal.wall1, pal.wall2, pal.wall0));
  p.planeX(0.01, 0, nwLen * UNIT, 0, WALL_H, (y, z) => wallPixel(layout, pal, "NW", y, z, pal.wall0, pal.wall1, pal.ink));
  return bmp;
}

export interface FurnitureSprite {
  bmp: Bitmap;
  /** Position of the footprint's north corner inside bmp. */
  origin: Vec2;
}

const furnitureCache = new Map<string, FurnitureSprite>();

export function furnitureSprite(def: FurnitureDef, pal: ScenePalette, frame: number): FurnitureSprite {
  const key = `${def.id}|${pal.night0}|${frame % def.frames}`;
  let s = furnitureCache.get(key);
  if (!s) {
    s = renderCropped((p) => def.draw(p, pal, frame % def.frames), def.outline ? pal.ink : undefined);
    furnitureCache.set(key, s);
  }
  return s;
}
