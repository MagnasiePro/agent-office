import type { ScenePalette } from "../art/palette";
import { bayer } from "../engine/bitmap";
import type { Hex } from "../engine/color";
import type { IsoPainter } from "../engine/isoPaint";
import { Mask, paintShape } from "../engine/shape";

/**
 * Procedural furniture. Each piece is drawn in local world units (1 tile = 16)
 * with (0, 0, 0) at the north corner of its footprint.
 */
export interface FurnitureDef {
  id: string;
  name: string;
  /** Footprint in tiles (blocks pathfinding). */
  footprint: { w: number; d: number };
  frames: number;
  fps: number;
  /** Adds the 1px ink outer outline (off for flat floor items). */
  outline: boolean;
  draw(p: IsoPainter, pal: ScenePalette, frame: number): void;
}

const wood = (pal: ScenePalette) => ({ top: pal.wood3, left: pal.wood2, right: pal.wood1, edge: pal.cream });
const dark = (pal: ScenePalette) => ({ top: pal.wall1, left: pal.wall0, right: pal.ink, edge: pal.wall2 });

/** Leafy blob painted in screen space above a world point. */
function leaves(p: IsoPainter, pal: ScenePalette, x: number, y: number, z: number, rx: number, ry: number, seed: number): void {
  const [cx, cy] = p.proj(x, y, z);
  const m = new Mask(p.bmp.w, p.bmp.h);
  m.ellipse(cx, cy, rx, ry);
  m.ellipse(cx - rx * 0.6, cy + ry * 0.3, rx * 0.55, ry * 0.6);
  m.ellipse(cx + rx * 0.6, cy + ry * 0.25, rx * 0.55, ry * 0.6);
  m.ellipse(cx + (seed % 2 ? 1 : -1), cy - ry * 0.8, rx * 0.45, ry * 0.55);
  paintShape(p.bmp, m, { outline: pal.leaf0, shade: pal.leaf0, base: pal.leaf1, light: pal.leaf1 });
  // A few darker leaf veins for texture.
  for (let i = 0; i < 6; i++) {
    const vx = Math.round(cx + Math.sin(seed * 7 + i * 2.1) * rx * 0.6);
    const vy = Math.round(cy + Math.cos(seed * 3 + i * 1.7) * ry * 0.5);
    if (m.has(vx, vy) && m.has(vx, vy + 1)) p.bmp.set(vx, vy, pal.leaf0);
  }
}

function monitor(p: IsoPainter, pal: ScenePalette, cx: number, frame: number, slot: number): void {
  p.box(cx - 1, 5, 15, 2, 2, 3, dark(pal)); // stand
  p.box(cx - 7, 3, 18, 14, 3, 11, { top: pal.wall1, left: pal.ink, right: pal.ink, edge: pal.wall2 });
  // Screen on the +y face with scrolling "code" lines.
  p.planeY(6.01, cx - 6, cx + 6, 19.5, 28, (x, z) => {
    const lx = Math.floor(x - (cx - 6));
    const lz = Math.floor(28 - z);
    const row = (lz + frame + slot * 3) % 9;
    if (lz % 2 === 1) return pal.mint0;
    const len = [9, 5, 7, 3, 10, 6, 8, 4, 2][row] ?? 5;
    const indent = row % 3 === 1 ? 2 : 0;
    if (lx >= 1 + indent && lx < 1 + indent + len) return row === 4 ? pal.cream : pal.mint1;
    return pal.mint0;
  });
  // Keyboard.
  p.box(cx - 6, 9, 15, 10, 4, 1, { top: pal.cream, left: pal.wall2, right: pal.wall1 });
}

export const DESK: FurnitureDef = {
  id: "desk",
  name: "Bureau double + écrans",
  footprint: { w: 2, d: 1 },
  frames: 9,
  fps: 2,
  outline: true,
  draw(p, pal, f) {
    const legs = { top: pal.wood1, left: pal.wood1, right: pal.wood0 };
    for (const [lx, ly] of [
      [1, 2],
      [29, 2],
      [1, 12],
      [29, 12],
    ] as const)
      p.box(lx, ly, 0, 2, 2, 12, legs);
    p.box(3, 3, 6, 26, 9, 1, legs); // lower shelf
    p.box(0, 1, 12, 32, 14, 3, wood(pal));
    monitor(p, pal, 8, f, 0);
    monitor(p, pal, 24, f, 1);
    // Mug with a coral band.
    p.box(14, 9, 15, 3, 3, 4, { top: pal.ink, left: pal.cream, right: pal.wall2 });
    p.dot(15, 12, 17, pal.coral1);
  },
};

const BOOK_COLORS: (keyof ScenePalette)[] = ["red", "sky1", "leaf1", "butter", "coral1", "mint0", "cream", "blush", "sky0", "wall2"];

export const BOOKSHELF: FurnitureDef = {
  id: "bookshelf",
  name: "Bibliothèque",
  footprint: { w: 2, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    p.box(1, 1, 0, 30, 11, 46, wood(pal));
    // Recessed shelves with books on the +y face.
    p.planeY(12.01, 3, 29, 2, 44, (x, z) => {
      const shelf = Math.floor((z - 2) / 10.5);
      const zIn = (z - 2) - shelf * 10.5;
      if (zIn < 1.5) return pal.wood3; // board
      const bx = Math.floor(x - 3);
      const book = Math.floor((bx + shelf * 5) / 3);
      const hash = (book * 7 + shelf * 13) % 10;
      const height = 5 + (hash % 4);
      if (shelf === 2 && book % 5 === 3) return zIn < 3 ? pal.leaf0 : null; // a gap with a tiny plant
      if (zIn > 1.5 + height) return pal.wood0;
      if ((bx + shelf * 5) % 3 === 2) return pal.ink; // spine separation
      const c = pal[BOOK_COLORS[hash] ?? "red"];
      return zIn > height - 0.5 ? pal.cream : c; // label band on top
    });
    leaves(p, pal, 9, 6, 49, 4, 3, 3);
  },
};

export const SERVER_RACK: FurnitureDef = {
  id: "server",
  name: "Terminal / serveurs",
  footprint: { w: 1, d: 2 },
  frames: 8,
  fps: 4,
  outline: true,
  draw(p, pal, f) {
    for (const [i, y0] of [
      [0, 2],
      [1, 18],
    ] as const) {
      p.box(1, y0, 0, 12, 13, 40 - i * 6, dark(pal));
      const h = 40 - i * 6;
      p.planeX(13.01, y0 + 1, y0 + 12, 2, h - 2, (y, z) => {
        const ly = Math.floor(y - y0);
        const lz = Math.floor(z);
        if (lz % 6 === 0) return pal.wall1; // unit separators
        if (lz % 6 === 3 && ly >= 2 && ly < 4) {
          const on = (ly * 5 + lz * 3 + f * (i + 2)) % 7 < 4;
          return on ? (lz % 12 === 3 ? pal.mint1 : pal.butter) : pal.mint0;
        }
        if (lz % 6 === 3 && ly === 9) return (f + lz + i) % 5 === 0 ? pal.red : pal.wall0;
        if (lz % 6 !== 0 && ly >= 6 && ly <= 10 && lz % 2 === 0) return pal.ink; // vents
        return null;
      });
    }
    // Little terminal screen on top of the short rack.
    p.box(3, 21, 34, 8, 8, 1, dark(pal));
    p.box(4, 22, 35, 2, 6, 7, { top: pal.wall1, left: pal.ink, right: pal.ink });
    p.planeX(6.01, 22.5, 27.5, 36, 41, (y, z) => {
      const lz = Math.floor(41 - z);
      if (lz === 1 && Math.floor(y) === 23) return pal.mint1;
      if (lz === 3 && Math.floor(y) === 23 + (f % 2) * 0) return f % 2 ? pal.mint1 : pal.mint0;
      return pal.mint0;
    });
  },
};

export const WHITEBOARD: FurnitureDef = {
  id: "whiteboard",
  name: "Tableau blanc",
  footprint: { w: 1, d: 2 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    const leg = { top: pal.wall2, left: pal.wall2, right: pal.wall1 };
    p.box(4, 3, 0, 2, 2, 14, leg);
    p.box(4, 27, 0, 2, 2, 14, leg);
    p.box(1, 4, 0, 8, 2, 1, leg);
    p.box(1, 26, 0, 8, 2, 1, leg);
    p.box(3, 1, 14, 3, 30, 28, { top: pal.wall2, left: pal.wall1, right: pal.cream, edge: pal.white });
    p.box(6, 3, 15, 2, 26, 1, { top: pal.wall2, left: pal.wall1, right: pal.wall1 }); // marker tray
    p.planeX(6.01, 2, 30, 16, 41, (y, z) => {
      const ly = y - 2;
      const lz = z - 16;
      if (ly < 1 || ly > 27 || lz < 1 || lz > 24) return pal.wall2; // frame
      // Sticky notes on the left edge (higher ly is further left); the usage pies are drawn live over the rest.
      if (ly >= 24 && ly < 28 && lz > 15 && lz < 21) return pal.butter;
      if (ly >= 24 && ly < 28 && lz > 7 && lz < 13) return pal.blush;
      return null;
    });
  },
};

export const MAILBOX: FurnitureDef = {
  id: "mailbox",
  name: "Boîte aux lettres",
  footprint: { w: 1, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal, f) {
    p.box(6, 6, 0, 3, 3, 12, { top: pal.wood2, left: pal.wood1, right: pal.wood0 });
    p.box(2, 3, 12, 11, 9, 8, { top: pal.red, left: pal.red, right: pal.coral0, edge: pal.blush });
    p.planeX(13.01, 5, 10, 15, 17, () => pal.ink); // slot
    // The scene always draws frame 0 (flag down); the mail overlay redraws the whole box with frame 1 (flag up)
    // while it holds mail. The lowered flag lies flat on the side so the raised version fully covers it.
    if (f === 1) {
      p.box(4, 12, 18, 1, 1, 8, { top: pal.wood1, left: pal.wood1, right: pal.wood0 });
      p.box(4, 12, 23, 1, 5, 3, { top: pal.butter, left: pal.butter, right: pal.coral1 });
    } else {
      p.box(4, 12, 15, 6, 1, 1, { top: pal.butter, left: pal.butter, right: pal.coral1 });
    }
  },
};

export const COUCH: FurnitureDef = {
  id: "couch",
  name: "Canapé",
  footprint: { w: 1, d: 2 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    const fabric = { top: pal.sky1, left: pal.sky1, right: pal.sky0, edge: pal.sky2 };
    p.box(2, 2, 0, 12, 28, 3, { top: pal.wood1, left: pal.wood1, right: pal.wood0 });
    p.box(9, 2, 3, 5, 28, 15, fabric); // backrest (against +x side)
    p.box(2, 4, 3, 7, 24, 6, fabric); // seat
    p.box(3, 5, 9, 6, 11, 2, { top: pal.sky2, left: pal.sky1, right: pal.sky0 }); // cushions
    p.box(3, 17, 9, 6, 10, 2, { top: pal.sky2, left: pal.sky1, right: pal.sky0 });
    p.box(2, 1, 3, 12, 4, 10, fabric); // arms
    p.box(2, 27, 3, 12, 4, 10, fabric);
    p.box(6, 21, 11, 4, 4, 3, { top: pal.butter, left: pal.butter, right: pal.coral1 }); // throw pillow
  },
};

export const COFFEE_BAR: FurnitureDef = {
  id: "coffee",
  name: "Machine à café",
  footprint: { w: 1, d: 1 },
  frames: 6,
  fps: 4,
  outline: true,
  draw(p, pal, f) {
    p.box(1, 1, 0, 14, 14, 15, wood(pal));
    p.planeY(15.01, 3, 13, 3, 12, (x) => (Math.floor(x) === 8 ? pal.wood1 : null)); // doors
    // Retro espresso machine: cream body, coral band, dark group head.
    p.box(3, 3, 15, 8, 8, 12, { top: pal.ink, left: pal.cream, right: pal.wall2, edge: pal.white });
    p.planeY(11.01, 3, 11, 22, 24, () => pal.coral1);
    p.box(4, 9, 20, 5, 3, 2, { top: pal.wall2, left: pal.ink, right: pal.ink }); // spout
    p.box(5, 11, 15, 3, 3, 3, { top: pal.ink, left: pal.cream, right: pal.wall2 }); // cup
    p.dot(5, 8, 25, pal.red);
    p.dot(5, 6, 25, pal.mint1);
    // Steam wisps rising from the cup (animated).
    for (let i = 0; i < 3; i++) {
      const z = 19 + ((f * 2 + i * 4) % 12);
      const wob = Math.round(Math.sin((z + i) * 0.8));
      const [sx, sy] = p.proj(6, 12, z);
      if (bayer(i, z) < 0.8 - (z - 19) / 14) p.bmp.set(Math.floor(sx) + wob, Math.floor(sy), pal.cream);
    }
    p.box(11, 5, 15, 3, 3, 4, { top: pal.ink, left: pal.coral1, right: pal.coral0 }); // spare mug
  },
};

export const FLOOR_LAMP: FurnitureDef = {
  id: "lamp",
  name: "Lampe",
  footprint: { w: 1, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    p.box(4, 4, 0, 8, 8, 1, dark(pal));
    p.box(7, 7, 1, 2, 2, 34, { top: pal.wall2, left: pal.wall2, right: pal.wall0 });
    p.box(3, 3, 32, 10, 10, 10, { top: pal.white, left: pal.cream, right: pal.butter, edge: pal.white });
  },
};

function pot(p: IsoPainter, pal: ScenePalette, x: number, y: number, s: number, h: number): void {
  p.box(x, y, 0, s, s, h, { top: pal.wood0, left: pal.mint0, right: pal.ink, edge: pal.mint1 });
}

export const PLANT_BIG: FurnitureDef = {
  id: "plant-big",
  name: "Grande plante",
  footprint: { w: 1, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    pot(p, pal, 3, 3, 10, 9);
    leaves(p, pal, 8, 8, 24, 9, 8, 1);
    leaves(p, pal, 8, 8, 36, 6, 5, 2);
  },
};

export const PLANT_SMALL: FurnitureDef = {
  id: "plant-small",
  name: "Petite plante",
  footprint: { w: 1, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    pot(p, pal, 5, 5, 6, 6);
    leaves(p, pal, 8, 8, 14, 5, 4, 5);
  },
};

export const CAFE_TABLE: FurnitureDef = {
  id: "cafe-table",
  name: "Table de café",
  footprint: { w: 1, d: 1 },
  frames: 1,
  fps: 1,
  outline: true,
  draw(p, pal) {
    p.box(5, 5, 0, 6, 6, 1, dark(pal));
    p.box(7, 7, 1, 2, 2, 10, { top: pal.wall2, left: pal.wall2, right: pal.wall0 });
    // Octagonal-looking top: a plus of two boxes.
    p.box(2, 4, 11, 12, 8, 2, wood(pal));
    p.box(4, 2, 11, 8, 12, 2, wood(pal));
    p.box(5, 6, 13, 3, 3, 3, { top: pal.ink, left: pal.cream, right: pal.wall2 }); // mug
    p.box(9, 8, 13, 2, 2, 2, { top: pal.ink, left: pal.coral1, right: pal.coral0 }); // cup
    p.box(8, 4, 13, 4, 3, 1, { top: pal.blush, left: pal.coral1, right: pal.coral0 }); // cake slice
  },
};

/** Low wall segment between rooms, one tile long, drawn along +x ("y" partitions) or +y ("x" partitions). */
export function partitionSegment(axis: "x" | "y"): FurnitureDef {
  return {
    id: `partition-${axis}`,
    name: "Cloison",
    footprint: { w: 1, d: 1 },
    frames: 1,
    fps: 1,
    outline: true,
    draw(p, pal) {
      const c = { top: pal.wall2, left: pal.wall1, right: pal.wall0, edge: pal.cream };
      if (axis === "y") p.box(0, -1, 0, 16, 2, 15, c);
      else p.box(-1, 0, 0, 2, 16, 15, c);
    },
  };
}

/** Door post marking an opening in a partition. */
export function doorPost(): FurnitureDef {
  return {
    id: "door-post",
    name: "Montant de porte",
    footprint: { w: 1, d: 1 },
    frames: 1,
    fps: 1,
    outline: true,
    draw(p, pal) {
      p.box(-1, -1, 0, 2, 2, 22, { top: pal.cream, left: pal.wood2, right: pal.wood1, edge: pal.cream });
    },
  };
}

export const ALL_FURNITURE: FurnitureDef[] = [DESK, BOOKSHELF, SERVER_RACK, WHITEBOARD, MAILBOX, COUCH, COFFEE_BAR, CAFE_TABLE, FLOOR_LAMP, PLANT_BIG, PLANT_SMALL];

export type { Hex };
