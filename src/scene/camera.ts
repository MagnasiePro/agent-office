import type { Vec2 } from "../engine/iso";

/**
 * Viewport over the world bitmap. Centres the world when it (nearly) fits; otherwise glides slowly
 * towards a focus point (where agents are busy). Offsets are rounded when used, so pixels stay crisp.
 */
export class Camera {
  x = 0;
  y = 0;
  private placed = false;

  constructor(
    readonly worldW: number,
    readonly worldH: number,
    /** Painted rows of the world, centred instead of the whole box when the view is a bit short. */
    readonly rows: { top: number; bottom: number } = { top: 0, bottom: worldH },
  ) {}

  private axis(world: number, view: number, focus: number, lo = 0, hi = world): number {
    if (world <= view) return Math.round((world - view) / 2);
    // A small overflow (the "one step closer" zoom of viewportFor) stays still, centred on what is painted:
    // following walkers there only made the whole scene drift a few pixels up and down.
    if (world - view <= world * 0.2) return Math.round(Math.min(world - view, Math.max(0, (lo + hi - view) / 2)));
    return Math.min(world - view, Math.max(0, focus - view / 2));
  }

  update(dt: number, viewW: number, viewH: number, focus: Vec2 | null): void {
    const f = focus ?? { x: this.worldW / 2, y: this.worldH / 2 };
    const tx = this.axis(this.worldW, viewW, f.x);
    const ty = this.axis(this.worldH, viewH, f.y, this.rows.top, this.rows.bottom);
    if (!this.placed) {
      this.x = tx;
      this.y = ty;
      this.placed = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 0.6);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }
}

/** Integer scale and internal viewport for a window: as large as possible while keeping ≥ 2× pixels on big screens. */
export function viewportFor(
  worldW: number,
  worldH: number,
  winW: number,
  winH: number,
  dpr: number,
  minW: number,
  minH: number,
): { scale: number; w: number; h: number; cssW: number; cssH: number } {
  const devW = Math.round(winW * dpr);
  const devH = Math.round(winH * dpr);
  const fit = Math.max(1, Math.floor(Math.min(devW / worldW, devH / worldH)));
  // One step closer when ~90 % of the world stays visible: bigger characters, the camera pans the rest.
  const closer = devW / (fit + 1) >= worldW * 0.9 && devH / (fit + 1) >= worldH * 0.85 ? fit + 1 : fit;
  const minScale = devW >= minW * 2 && devH >= minH * 2 ? 2 : 1;
  const scale = Math.max(closer, minScale);
  const w = Math.ceil(devW / scale);
  const h = Math.ceil(devH / scale);
  return { scale, w, h, cssW: (w * scale) / dpr, cssH: (h * scale) / dpr };
}
