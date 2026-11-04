import type { ScenePalette } from "../art/palette";
import { bayer, Bitmap } from "../engine/bitmap";
import { gridToScreen, worldToScreen, UNIT, type Vec2 } from "../engine/iso";
import type { Agent } from "../engine/agent";
import { toCanvas } from "../engine/canvas";
import { drawAlertBubble, drawAskBubble, speechBubble } from "../engine/emotes";
import { frameAt } from "../engine/sprite";
import type { SizeClass } from "../characters/types";
import type { Speech } from "./office";
import type { WorldLayout } from "../world/layout";
import { fairySag } from "../world/roomRender";

function hash(n: number): number {
  const s = Math.sin(n * 91.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Cheap living details drawn over the scene: twinkling stars, fairy lights, dust in the moonlight. */
export class Ambient {
  private bulbs: Vec2[] = [];

  constructor(
    private layout: WorldLayout,
    private origin: Vec2,
    private pal: ScenePalette,
  ) {
    for (const span of layout.fairyLights) {
      for (let a = Math.ceil((span.from * UNIT - 5.5) / 12) * 12 + 5.5; a < span.to * UNIT; a += 12) {
        const z = fairySag(a) - 1.5;
        const s = span.wall === "NE" ? worldToScreen(a, 0, z) : worldToScreen(0, a, z);
        this.bulbs.push({ x: Math.floor(origin.x + s.x), y: Math.floor(origin.y + s.y) });
      }
    }
  }

  /** Twinkling stars in screen space (drawn before the camera transform). */
  drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const n = Math.max(10, Math.floor((w * h) / 9000));
    for (let i = 0; i < n; i++) {
      const x = Math.floor(hash(i) * w);
      const y = Math.floor(hash(i + 50) * h);
      const k = Math.sin(t * (0.6 + hash(i) * 0.8) + i * 2.3);
      if (k <= 0.55) continue;
      ctx.fillStyle = this.pal.cream;
      ctx.fillRect(x, y, 1, 1);
      if (k > 0.93) {
        ctx.fillStyle = this.pal.wall2;
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.fillStyle = this.pal.cream;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /** World-space details (drawn with the camera transform). */
  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const px = (x: number, y: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    };
    this.bulbs.forEach((b, i) => {
      if (Math.sin(t * 1.7 + i * 1.9) > 0.8) px(b.x, b.y, this.pal.white);
    });
    // Dust motes drifting down through each moonbeam.
    this.layout.windows.forEach((w, wi) => {
      const a0 = w.from * UNIT + 4;
      const a1 = w.to * UNIT - 4;
      for (let i = 0; i < 8; i++) {
        const seed = i + wi * 31;
        const depth = 3 + hash(seed + 7) * 36;
        const z = 40 - ((t * (1.5 + hash(seed) * 1.5) + hash(seed + 3) * 40) % 40);
        const along = a0 + hash(seed + 11) * (a1 - a0) + depth * 0.35 * (1 - z / 40) + Math.sin(t * 0.7 + i) * 1.5;
        const s = w.wall === "NE" ? worldToScreen(along, depth, z) : worldToScreen(depth, along, z);
        if (bayer(i, Math.floor(t * 4)) < 0.7) px(Math.floor(this.origin.x + s.x), Math.floor(this.origin.y + s.y), i % 3 ? this.pal.cream : this.pal.butter);
      }
    });
  }

  private bubbleCache = new Map<string, HTMLCanvasElement>();

  /** Speech bubbles with fake text above talking agents. */
  drawSpeech(ctx: CanvasRenderingContext2D, speeches: readonly Speech[], agents: ReadonlyMap<string, Agent>): void {
    for (const sp of speeches) {
      const a = agents.get(sp.agentId);
      if (!a) continue;
      const key = `${sp.seed}|${sp.question}`;
      let c = this.bubbleCache.get(key);
      if (!c) {
        c = toCanvas(speechBubble(sp.seed, sp.question));
        this.bubbleCache.set(key, c);
      }
      const s = gridToScreen(a.x, a.y, this.origin);
      const h = a.sprites.size.head;
      ctx.drawImage(c, Math.round(s.x + h.x + 3), Math.round(s.y + h.y - c.height - 1));
    }
  }

  /** Floating "z" above agents idle for a while — at a glance, sleepy = free, animated = busy. */
  drawSleepy(ctx: CanvasRenderingContext2D, agents: Iterable<Agent>, t: number): void {
    const Z = ["ccc", "..c", ".c.", "ccc"];
    for (const a of agents) {
      if (a.state !== "idle" || a.isMoving() || a.restTime < 12) continue;
      const s = gridToScreen(a.x, a.y, this.origin);
      const h = a.sprites.size.head;
      for (let k = 0; k < 2; k++) {
        const phase = (t * 0.5 + k * 0.5 + (a.id.length % 7) * 0.13) % 1;
        const x = Math.round(s.x + h.x + 5 + phase * 4 + k);
        const y = Math.round(s.y + h.y - 3 - phase * 10);
        if (phase > 0.85) continue;
        ctx.fillStyle = phase > 0.6 ? this.pal.wall2 : this.pal.cream;
        Z.forEach((row, j) => {
          for (let i = 0; i < row.length; i++) if (row[i] === "c") ctx.fillRect(x + i, y + j, 1, 1);
        });
      }
    }
  }

  /** Dotted thread between a parent agent and each of its sub-agents. */
  drawLinks(ctx: CanvasRenderingContext2D, pairs: readonly [Agent, Agent][], t: number): void {
    ctx.fillStyle = this.pal.butter;
    for (const [p, c] of pairs) {
      const a = gridToScreen(p.x, p.y, this.origin);
      const b = gridToScreen(c.x, c.y, this.origin);
      const ha = p.sprites.size.head;
      const hb = c.sprites.size.head;
      const x0 = a.x + ha.x;
      const y0 = a.y + ha.y;
      const x1 = b.x + hb.x;
      const y1 = b.y + hb.y;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.floor(len / 4);
      const phase = (t * 6) % 4;
      for (let i = 1; i < n; i++) {
        const k = (i * 4 + phase) / len;
        if (k >= 1) break;
        // Slight sag like a thread.
        const sag = Math.sin(k * Math.PI) * Math.min(10, len * 0.12);
        ctx.fillRect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k + sag), 1, 1);
      }
    }
  }

  /** Red "!" (permission) or blue "?" (a real question) for agents blocked on the user, else null. */
  private beacon(a: Agent): { main: string; glow: string; period: number; ask: boolean } | null {
    if (a.state !== "waiting") return null;
    const ask = a.waitNeed === "input";
    // sky2, not sky1: sky1 is the couch/rug colour and too dark to stand out.
    return ask ? { main: this.pal.sky2, glow: this.pal.sky1, period: 1.8, ask } : { main: this.pal.red, glow: this.pal.coral1, period: 1.0, ask };
  }

  /** 0..1..0 once per period. */
  private static pulse(t: number, period: number): number {
    return (1 - Math.cos(((t % period) / period) * Math.PI * 2)) / 2;
  }

  private ringCache = new Map<string, HTMLCanvasElement>();

  /** Underlay: pulsing dithered ring on the floor around each waiting agent's feet. */
  drawBeaconRings(ctx: CanvasRenderingContext2D, agents: Iterable<Agent>, t: number): void {
    for (const a of agents) {
      const b = this.beacon(a);
      if (!b) continue;
      const grow = Math.round(Ambient.pulse(t, b.period) * 3);
      const { rx: srx, ry: sry } = a.sprites.size.shadow;
      const rx = srx + 4 + grow;
      const ry = sry + 2 + Math.ceil(grow / 2);
      const key = `${rx}|${ry}|${grow}|${b.main}`;
      let c = this.ringCache.get(key);
      if (!c) {
        const bmp = new Bitmap(rx * 2 + 1, ry * 2 + 1);
        const inEllipse = (x: number, y: number, ex: number, ey: number) => ((x - rx) / (ex + 0.5)) ** 2 + ((y - ry) / (ey + 0.5)) ** 2 <= 1;
        // The ring thins out as it expands, like a ripple.
        const density = 1 - grow * 0.17;
        for (let y = 0; y <= ry * 2; y++) {
          for (let x = 0; x <= rx * 2; x++) {
            if (!inEllipse(x, y, rx, ry)) continue;
            if (!inEllipse(x, y, rx - 2, ry - 1)) {
              if (bayer(x, y) < density) bmp.set(x, y, b.main);
            } else if (bayer(x, y) < 0.25) bmp.set(x, y, b.glow);
          }
        }
        c = toCanvas(bmp);
        this.ringCache.set(key, c);
      }
      const s = gridToScreen(a.x, a.y, this.origin);
      ctx.drawImage(c, Math.round(s.x) - rx, Math.round(s.y) - ry);
    }
  }

  /** Beam canvases per agent frame (the beam skips the agent's own pixels so it reads as behind them). */
  private beamCache = new WeakMap<Bitmap, Map<string, HTMLCanvasElement>>();
  private bigBubbles = new Map<string, HTMLCanvasElement>();
  private askBubbles = new Map<SizeClass, HTMLCanvasElement>();

  /**
   * Overlay: light beam rising from each waiting agent with a big bobbing "!" or "?" above the head,
   * plus the small "?" over finished sessions that wait for their next prompt.
   */
  drawBeacons(ctx: CanvasRenderingContext2D, agents: Iterable<Agent>, t: number): void {
    const big: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const small: Agent[] = [];
    for (const a of agents) {
      const b = this.beacon(a);
      if (!b) {
        if (a.awaitingPrompt && a.state !== "despawning" && a.state !== "gone") small.push(a);
        continue;
      }
      const s = gridToScreen(a.x, a.y, this.origin);
      const sx = Math.round(s.x);
      const sy = Math.round(s.y);
      const h = a.sprites.size.head;
      const k = Ambient.pulse(t, b.period);
      const level = 3 + Math.round(k); // 3/4 or 4/4 of full density
      const anim = a.sprites.anims[a.anim];
      const frame = anim.frames[a.dir][frameAt(anim.spec, a.animTime)]!;
      const { anchor, shadow } = a.sprites.size;
      const hw = shadow.rx + 2;
      const H = a.mini ? 34 : 48;
      let byFrame = this.beamCache.get(frame);
      if (!byFrame) this.beamCache.set(frame, (byFrame = new Map()));
      const key = `${level}|${b.main}|${hw}|${H}`;
      let beam = byFrame.get(key);
      if (!beam) {
        const bmp = new Bitmap(hw * 2 + 1, H);
        const edgeW = a.mini ? 2 : 3;
        for (let y = 0; y < H; y++) {
          // Solid over the lower two thirds, dithering out over the top third.
          const fade = Math.min(1, (y + 1) / (H / 3)) * (level / 4);
          for (let x = 0; x <= hw * 2; x++) {
            // Beam pixel in frame coordinates: the beam's bottom-centre sits on the anchor.
            if (frame.opaque(x - hw + anchor.x, y - H + 1 + anchor.y)) continue;
            const d = bayer(x, y);
            const fromEdge = Math.min(x, hw * 2 - x);
            if (fromEdge < edgeW) {
              if (d >= fade) continue;
              // Blue gets a cream highlight on the inner edge column so it reads against dark floors.
              bmp.set(x, y, b.ask && fromEdge === edgeW - 1 && d < fade * 0.5 ? this.pal.cream : b.main);
            } else if (d < 0.6 * fade) bmp.set(x, y, d < 0.45 * fade ? b.main : b.glow);
          }
        }
        beam = toCanvas(bmp);
        byFrame.set(key, beam);
      }
      ctx.drawImage(beam, sx - hw, sy - H + 1);
      const bubble = this.bigBubble(b.ask, b.main);
      const bob = Math.round(k * 2);
      const x = sx + h.x - bubble.width;
      const y = sy + h.y - 28 - bob;
      ctx.drawImage(bubble, x, y, bubble.width * 2, bubble.height * 2);
      big.push({ x0: x, y0: y, x1: x + bubble.width * 2, y1: y + bubble.height * 2 });
    }
    for (const a of small) {
      const s = gridToScreen(a.x, a.y, this.origin);
      const h = a.sprites.size.head;
      const size = a.sprites.variant.size;
      let c = this.askBubbles.get(size);
      if (!c) {
        const bmp = new Bitmap(7, 11);
        drawAskBubble(bmp, 3, 10, size);
        c = toCanvas(bmp);
        this.askBubbles.set(size, c);
      }
      const x = Math.round(s.x) + h.x + 3;
      const y = Math.round(s.y) + h.y - 12; // tail just above the head, as the sprite used to draw it
      // A waiting agent's big bubble wins over a neighbour's small "?".
      if (big.some((r) => x < r.x1 && x + c.width > r.x0 && y < r.y1 && y + c.height > r.y0)) continue;
      ctx.drawImage(c, x, y);
    }
  }

  /** Full-size "!" or "?" bubble with a 1 px frame in the beacon colour, cached. */
  private bigBubble(ask: boolean, color: string): HTMLCanvasElement {
    const key = `${ask}|${color}`;
    let c = this.bigBubbles.get(key);
    if (!c) {
      const inner = new Bitmap(7, 11);
      (ask ? drawAskBubble : drawAlertBubble)(inner, 3, 10, "full");
      const bmp = new Bitmap(9, 13);
      bmp.blit(inner, 1, 1);
      for (let y = 0; y < 13; y++) {
        for (let x = 0; x < 9; x++) {
          if (!bmp.opaque(x, y) && (inner.opaque(x - 1, y - 1) || inner.opaque(x - 2, y - 1) || inner.opaque(x, y - 1) || inner.opaque(x - 1, y - 2) || inner.opaque(x - 1, y))) bmp.set(x, y, color);
        }
      }
      c = toCanvas(bmp);
      this.bigBubbles.set(key, c);
    }
    return c;
  }
}
