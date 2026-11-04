import { SCENE_WARM as P } from "../art/palette";
import { Bitmap } from "../engine/bitmap";
import type { Hex } from "../engine/color";
import { IsoPainter } from "../engine/isoPaint";

/** Where the truck's ground centre sits inside its sprite: blit at the lane point minus this. */
export const TRUCK_ANCHOR = { x: 32, y: 42 } as const;

const LEN = 38;
const WID = 18;
const CAB = 12;
const BODY = { top: P.coral1, left: P.red, right: P.coral0 };

const cache = new Map<string, Bitmap>();

/**
 * The mail van (approved preview v3), centred on the world point (0, 0, 0), driving along x.
 * "in": cab towards -x (arriving, up-left); "out": cab towards +x (leaving, windscreen to the viewer).
 * `frame` (0/1) turns the wheels. No envelope on the outside, by the owner's choice.
 */
export function truckSprite(facing: "in" | "out", frame: number): Bitmap {
  const key = `${facing}|${frame & 1}`;
  let bmp = cache.get(key);
  if (!bmp) {
    bmp = new Bitmap(64, 56);
    paint(new IsoPainter(bmp, TRUCK_ANCHOR), facing === "in", frame & 1);
    cache.set(key, bmp);
  }
  return bmp;
}

function paint(p: IsoPainter, arriving: boolean, spin: number): void {
  const S = (x: number, y: number, z: number) => p.proj(x, y, z).map(Math.round) as [number, number];
  const px = (x: number, y: number, c: Hex, w = 1, h = 1) => p.bmp.rect(x, y, w, h, c);
  const edge = (a: [number, number], b: [number, number]) => {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let i = 0; i <= n; i++) px(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n), P.ink);
  };
  // Box with an ink line on every visible edge.
  const obox = (x: number, y: number, z: number, w: number, d: number, h: number) => {
    p.box(x, y, z, w, d, h, BODY);
    const c = [S(x, y + d, z), S(x + w, y + d, z), S(x + w, y, z), S(x + w, y, z + h), S(x, y, z + h), S(x, y + d, z + h), S(x + w, y + d, z + h)] as const;
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [5, 6], [6, 3], [6, 1]] as const) edge(c[i], c[j]);
  };

  const x = -LEN / 2;
  const y = -WID / 2;
  const cargoX = arriving ? x + CAB : x;
  const cabX = arriving ? x : x + LEN - CAB;
  // Near-side wheels, partly hidden by the body drawn after them.
  for (const wx of [x + 7, x + LEN - 8]) {
    const [a, b] = S(wx, y + WID, 3);
    px(a - 3, b - 3, P.ink, 7, 7);
    px(a - 1, b - 1, P.wall1, 3, 3);
    px(a + (spin ? 1 : -1), b, P.cream);
  }
  // The block with the smaller x is further back: draw it first.
  const cab = () => obox(cabX, y + 1, 4, CAB, WID - 2, 15);
  const cargo = () => obox(cargoX, y, 4, LEN - CAB, WID, 22);
  if (arriving) {
    cab();
    cargo();
  } else {
    cargo();
    cab();
  }
  // Cab side window (slanted towards the front) and door line.
  const side = y + WID - 1;
  const w0 = arriving ? cabX + 2 : cabX + CAB - 10;
  p.poly3(
    [
      [w0, side, 11],
      [w0 + 8, side, 11],
      [arriving ? w0 + 8 : w0 + 6, side, 17],
      [arriving ? w0 + 2 : w0, side, 17],
    ],
    P.sky2,
  );
  const door = arriving ? w0 : w0 + 8;
  edge(S(door, side, 5), S(door, side, 17));
  const front = x + LEN;
  if (!arriving) {
    // Windscreen and two headlights on the front face.
    p.quadX(front, y + 3, y + WID - 3, 11, 17, P.sky2);
    for (const hy of [y + 3, y + WID - 3]) {
      const [a, b] = S(front, hy, 7);
      px(a - 1, b - 1, P.butter, 2, 2);
    }
  } else {
    // Rear doors and tail lights on the back face.
    edge(S(front, 0, 5), S(front, 0, 25));
    const [a, b] = S(front, y + 3, 7);
    px(a, b, P.red, 2, 1);
    const [c, d] = S(front, y + WID - 3, 7);
    px(c - 1, d, P.red, 2, 1);
  }
  // White stripe along the cargo side.
  for (let i = 1; i < LEN - CAB - 1; i++) {
    const [a, b] = S(cargoX + i, y + WID, 9);
    px(a, b - 1, P.white, 1, 2);
  }
}
