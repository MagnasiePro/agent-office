import type { Direction } from "../characters/types";
import {
  BOOKSHELF,
  CAFE_TABLE,
  COFFEE_BAR,
  COUCH,
  DESK,
  FLOOR_LAMP,
  MAILBOX,
  PLANT_BIG,
  PLANT_SMALL,
  SERVER_RACK,
  WHITEBOARD,
  type FurnitureDef,
} from "./furniture";

/** Station types an agent can go to. Tools are mapped to these in shared/tool-stations.json. */
export type StationType = "desk" | "library" | "terminal" | "whiteboard" | "window" | "coffee" | "cafe" | "mailbox";

export interface Placement {
  def: FurnitureDef;
  x: number;
  y: number;
}

export interface Slot {
  /** Tile the agent stands on. */
  x: number;
  y: number;
  /** Facing while working there. */
  dir: Direction;
}

export interface Station {
  id: string;
  type: StationType;
  room: string;
  slots: Slot[];
}

export type FloorStyle = "planks" | "tiles" | "checker";

/** Axis-aligned room on the shared grid (tiles). */
export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floor: FloorStyle;
  /** Optional rug, in tiles (fractional allowed). */
  rug?: { x0: number; y0: number; x1: number; y1: number };
}

/** A span on a back wall: NE wall is the line y = 0 (span along x), NW wall the line x = 0 (span along y). */
export interface WallSpan {
  wall: "NE" | "NW";
  from: number;
  to: number;
}

/**
 * Low wall between two rooms on the grid line `axis = at`, from `from` to `to` tiles,
 * with door openings [start, end) where agents can walk through.
 * axis "y": the line y = at, running along x. axis "x": the line x = at, running along y.
 */
export interface Partition {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  doors: [number, number][];
}

export interface WorldLayout {
  /** Grid bounds in tiles; tiles outside every room are void. */
  w: number;
  d: number;
  rooms: Room[];
  partitions: Partition[];
  windows: WallSpan[];
  posters: WallSpan[];
  fairyLights: WallSpan[];
  lamps: { x: number; y: number }[];
  furniture: Placement[];
  stations: Station[];
  /** Where idle agents hang out (cafeteria centre). */
  lounge: { x: number; y: number };
  /** Where new session agents appear. */
  spawn: { x: number; y: number };
}

// ── Builder helpers ──────────────────────────────────────────────────────────

const furniture: Placement[] = [];
const stations: Station[] = [];
const put = (def: FurnitureDef, x: number, y: number) => furniture.push({ def, x, y });
const station = (id: string, type: StationType, room: string, slots: Slot[]) => stations.push({ id, type, room, slots });

/** A double desk, with its two seats one tile in front (+y), facing NE. */
function desk(id: string, room: string, x: number, y: number): void {
  put(DESK, x, y);
  station(id, "desk", room, [
    { x, y: y + 1, dir: "NE" },
    { x: x + 1, y: y + 1, dir: "NE" },
  ]);
}

/*
 * The office: an L-shaped floor.
 *   open space (0..13 × 0..8) │ lab (14..23 × 0..8)
 *   cafeteria  (0..9 × 9..16)
 * Back walls run along y = 0 and x = 0; front edges are open, diorama style.
 */

// Open space: two rows of desks, a window between the back-row desks.
put(PLANT_BIG, 0, 0);
desk("desk-a1", "open", 1, 0);
desk("desk-a2", "open", 3, 0);
put(PLANT_SMALL, 7, 0);
desk("desk-a3", "open", 8, 0);
desk("desk-a4", "open", 10, 0);
desk("desk-a5", "open", 12, 0);
desk("desk-b1", "open", 2, 4);
desk("desk-b2", "open", 4, 4);
desk("desk-b3", "open", 6, 4);
desk("desk-b4", "open", 8, 4);
desk("desk-b5", "open", 10, 4);
put(FLOOR_LAMP, 0, 4);
put(MAILBOX, 0, 7);
put(PLANT_SMALL, 13, 5);
station("window-open", "window", "open", [
  { x: 5, y: 1, dir: "NE" },
  { x: 6, y: 1, dir: "NE" },
]);
station("mailbox", "mailbox", "open", [{ x: 1, y: 7, dir: "NW" }]);

// Lab: research & tooling.
put(WHITEBOARD, 14, 2);
put(SERVER_RACK, 14, 5);
put(BOOKSHELF, 16, 0);
put(BOOKSHELF, 18, 0);
put(PLANT_BIG, 23, 0);
put(FLOOR_LAMP, 23, 5);
put(PLANT_SMALL, 23, 8);
station("whiteboard", "whiteboard", "lab", [
  { x: 15, y: 2, dir: "NW" },
  { x: 15, y: 3, dir: "NW" },
  { x: 16, y: 3, dir: "NW" },
]);
station("terminal", "terminal", "lab", [
  { x: 15, y: 5, dir: "NW" },
  { x: 15, y: 6, dir: "NW" },
  { x: 16, y: 6, dir: "NW" },
]);
station("library", "library", "lab", [
  { x: 16, y: 1, dir: "NE" },
  { x: 17, y: 1, dir: "NE" },
  { x: 18, y: 1, dir: "NE" },
  { x: 19, y: 1, dir: "NE" },
]);
station("window-lab", "window", "lab", [
  { x: 20, y: 1, dir: "NE" },
  { x: 21, y: 1, dir: "NE" },
]);

// Cafeteria: coffee, tables, couch — where idle agents go.
put(COFFEE_BAR, 1, 9);
put(COFFEE_BAR, 2, 9);
put(CAFE_TABLE, 3, 13);
put(CAFE_TABLE, 6, 12);
put(COUCH, 9, 13);
put(FLOOR_LAMP, 9, 10);
put(PLANT_BIG, 0, 16);
station("cafe", "cafe", "cafe", [
  { x: 1, y: 10, dir: "NE" },
  { x: 2, y: 10, dir: "NE" },
  { x: 2, y: 13, dir: "SE" },
  { x: 4, y: 13, dir: "NW" },
  { x: 3, y: 14, dir: "NE" },
  { x: 5, y: 12, dir: "SE" },
  { x: 7, y: 12, dir: "NW" },
  { x: 6, y: 13, dir: "NE" },
  { x: 8, y: 13, dir: "SW" },
  { x: 8, y: 14, dir: "SW" },
]);

export const OFFICE: WorldLayout = {
  w: 24,
  d: 17,
  rooms: [
    { id: "open", name: "Open space", x: 0, y: 0, w: 14, d: 9, floor: "planks" },
    { id: "lab", name: "Labo", x: 14, y: 0, w: 10, d: 9, floor: "tiles", rug: { x0: 17.3, y0: 3.3, x1: 21.7, y1: 6.7 } },
    { id: "cafe", name: "Cafétéria", x: 0, y: 9, w: 10, d: 8, floor: "checker" },
  ],
  partitions: [
    { axis: "x", at: 14, from: 0, to: 9, doors: [[7, 9]] },
    { axis: "y", at: 9, from: 0, to: 10, doors: [[4, 6]] },
  ],
  windows: [
    { wall: "NE", from: 5, to: 7 },
    { wall: "NE", from: 20, to: 22 },
    { wall: "NW", from: 12, to: 14 },
  ],
  posters: [{ wall: "NW", from: 1.5, to: 3 }],
  fairyLights: [
    { wall: "NE", from: 0, to: 14 },
    { wall: "NW", from: 9, to: 17 },
  ],
  lamps: [
    { x: 0, y: 4 },
    { x: 23, y: 5 },
    { x: 9, y: 10 },
  ],
  furniture,
  stations,
  lounge: { x: 5, y: 14 },
  spawn: { x: 6, y: 7 },
};

export function isFloor(layout: WorldLayout, x: number, y: number): boolean {
  return layout.rooms.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.d);
}

export function roomAt(layout: WorldLayout, x: number, y: number): Room | undefined {
  return layout.rooms.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.d);
}

/** Blocked tiles (furniture footprints). */
export function obstacles(layout: WorldLayout): Set<string> {
  const s = new Set<string>();
  for (const { def, x, y } of layout.furniture) {
    for (let i = 0; i < def.footprint.w; i++) for (let j = 0; j < def.footprint.d; j++) s.add(`${x + i},${y + j}`);
  }
  return s;
}

/** True when a partition (outside its doors) separates two orthogonally adjacent tiles. */
export function wallBetween(layout: WorldLayout, ax: number, ay: number, bx: number, by: number): boolean {
  for (const p of layout.partitions) {
    if (p.axis === "x" && ay === by && Math.min(ax, bx) === p.at - 1 && Math.max(ax, bx) === p.at) {
      if (ay >= p.from && ay < p.to && !p.doors.some(([s, e]) => ay >= s && ay < e)) return true;
    }
    if (p.axis === "y" && ax === bx && Math.min(ay, by) === p.at - 1 && Math.max(ay, by) === p.at) {
      if (ax >= p.from && ax < p.to && !p.doors.some(([s, e]) => ax >= s && ax < e)) return true;
    }
  }
  return false;
}
