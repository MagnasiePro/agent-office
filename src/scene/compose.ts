import type { ScenePalette } from "../art/palette";
import type { AnimName, Direction } from "../characters/types";
import { bayer, Bitmap } from "../engine/bitmap";
import { toCanvas } from "../engine/canvas";
import { depthSort, gridToScreen, type DepthBox } from "../engine/iso";
import { frameAt, type SpriteSet } from "../engine/sprite";
import { doorPost, partitionSegment, type FurnitureDef } from "../world/furniture";
import type { WorldLayout } from "../world/layout";
import { furnitureSprite, renderStaticLayer, worldFrame } from "../world/roomRender";

/** Anything with a footprint that must be depth-sorted with the furniture. */
export interface Actor {
  /** Continuous grid position of the feet. */
  x: number;
  y: number;
  sprites: SpriteSet;
  anim: AnimName;
  dir: Direction;
  /** Seconds since the current animation started. */
  elapsed: number;
  /** Extra pixels above the floor (none for now, reserved for hops). */
  z?: number;
}

type Drawable = { box: DepthBox; draw: (ctx: CanvasRenderingContext2D) => void };

const shadowCache = new Map<string, HTMLCanvasElement>();
function shadow(rx: number, ry: number, color: string): HTMLCanvasElement {
  const key = `${rx}|${ry}|${color}`;
  let c = shadowCache.get(key);
  if (!c) {
    const b = new Bitmap(rx * 2 + 1, ry * 2 + 1);
    for (let y = 0; y <= ry * 2; y++) {
      for (let x = 0; x <= rx * 2; x++) {
        const dx = (x - rx) / (rx + 0.5);
        const dy = (y - ry) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1 && bayer(x, y) < 0.6) b.set(x, y, color);
      }
    }
    c = toCanvas(b);
    shadowCache.set(key, c);
  }
  return c;
}

interface Fixture {
  def: FurnitureDef;
  /** Grid point where the sprite's local origin goes. */
  x: number;
  y: number;
  box: DepthBox;
  /** Phase offset for animated furniture. */
  phase: number;
}

/** Furniture placements plus partition segments and door posts, all depth-sorted with the agents. */
export function fixtures(layout: WorldLayout): Fixture[] {
  const out: Fixture[] = layout.furniture.map((pl) => ({
    def: pl.def,
    x: pl.x,
    y: pl.y,
    box: { x0: pl.x, x1: pl.x + pl.def.footprint.w, y0: pl.y, y1: pl.y + pl.def.footprint.d },
    phase: pl.x * 3 + pl.y,
  }));
  const post = doorPost();
  for (const p of layout.partitions) {
    const seg = partitionSegment(p.axis);
    const at = (i: number) => (p.axis === "y" ? { x: i, y: p.at } : { x: p.at, y: i });
    // The depth box sits entirely on the back side of the line, so anything standing on the
    // line's front side (furniture against the partition, agents) is strictly in front of it.
    const thin = (i: number, len: number): DepthBox =>
      p.axis === "y" ? { x0: i, x1: i + len, y0: p.at - 0.1, y1: p.at } : { x0: p.at - 0.1, x1: p.at, y0: i, y1: i + len };
    for (let i = p.from; i < p.to; i++) {
      if (p.doors.some(([s, e]) => i >= s && i < e)) continue;
      out.push({ def: seg, ...at(i), box: thin(i, 1), phase: 0 });
    }
    for (const [s, e] of p.doors) {
      for (const i of [s, e]) out.push({ def: post, ...at(i), box: thin(i - 0.05, 0.1), phase: 0 });
    }
  }
  return out;
}

/**
 * Renders the world in world-bitmap coordinates (the caller applies the camera transform):
 * cached static layer, then furniture, partitions and actors in painter's order.
 */
export class WorldView {
  readonly origin;
  readonly width: number;
  readonly height: number;
  private staticLayer: HTMLCanvasElement;
  private fixtures: Fixture[];

  constructor(
    readonly layout: WorldLayout,
    readonly pal: ScenePalette,
  ) {
    const frame = worldFrame(layout);
    this.origin = frame.origin;
    this.width = frame.w;
    this.height = frame.h;
    this.staticLayer = toCanvas(renderStaticLayer(layout, pal));
    this.fixtures = fixtures(layout);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    time: number,
    actors: readonly Actor[],
    overlay?: (ctx: CanvasRenderingContext2D) => void,
    underlay?: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    ctx.drawImage(this.staticLayer, 0, 0);
    const items: Drawable[] = [];
    for (const f of this.fixtures) {
      const spr = furnitureSprite(f.def, this.pal, Math.floor(time * f.def.fps + f.phase));
      const at = gridToScreen(f.x, f.y, this.origin);
      const canvas = toCanvas(spr.bmp);
      items.push({ box: f.box, draw: (c) => c.drawImage(canvas, Math.round(at.x - spr.origin.x), Math.round(at.y - spr.origin.y)) });
    }
    // Shadows go under everything that stands on the floor.
    for (const a of actors) {
      const s = gridToScreen(a.x, a.y, this.origin);
      const { rx, ry } = a.sprites.size.shadow;
      ctx.drawImage(shadow(rx, ry, this.pal.ink), Math.round(s.x - rx), Math.round(s.y - ry));
    }
    underlay?.(ctx);
    for (const a of actors) {
      const anim = a.sprites.anims[a.anim];
      const frame = anim.frames[a.dir][frameAt(anim.spec, a.elapsed)]!;
      const canvas = toCanvas(frame);
      const s = gridToScreen(a.x, a.y, this.origin);
      const { anchor } = a.sprites.size;
      const r = 0.3;
      items.push({
        box: { x0: a.x - r, x1: a.x + r, y0: a.y - r, y1: a.y + r },
        draw: (c) => c.drawImage(canvas, Math.round(s.x - anchor.x), Math.round(s.y - anchor.y - (a.z ?? 0))),
      });
    }
    for (const it of depthSort(items)) it.draw(ctx);
    overlay?.(ctx);
  }
}
