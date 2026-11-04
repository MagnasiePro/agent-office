import type { AnimName, Direction } from "../characters/types";
import type { Tile } from "./pathfinding";
import { animDuration, type SpriteSet } from "./sprite";

/**
 * Agent life cycle:
 *   spawning → idle ⇄ walking → working ⇄ waiting → done → (returning) → idle … → despawning → gone
 */
export type AgentState = "spawning" | "idle" | "walking" | "working" | "waiting" | "done" | "returning" | "despawning" | "gone";

/** What the agent should do once it arrives somewhere. */
export type Arrival = () => void;

export function directionOf(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "SE" : "NW";
  return dy >= 0 ? "SW" : "NE";
}

/** Front-facing version of a direction (used to look at the viewer when waiting/celebrating). */
export function towardViewer(dir: Direction): Direction {
  return dir === "NE" ? "SE" : dir === "NW" ? "SW" : dir;
}

/** One character on screen: position, motion along a path, current animation. Character-agnostic. */
export class Agent {
  /** Continuous grid position of the feet; tile (tx, ty) centre is (tx + .5, ty + .5). */
  x: number;
  y: number;
  dir: Direction = "SE";
  private _state: AgentState = "spawning";
  /** Seconds spent in the current state. */
  stateTime = 0;
  /** Seconds since the agent last received work (reset by the simulation on tool/waiting/done). */
  restTime = 0;
  /** Station type the agent is working at; null when not working. */
  station: string | null = null;
  /** True while a finished session waits for its next prompt. */
  awaitingPrompt = false;
  /** What a waiting agent needs from the user: an approval (red beacon) or an answer (blue beacon). */
  waitNeed: "permission" | "input" = "permission";
  anim: AnimName = "spawn";
  animTime = 0;
  /** Seconds left before the current timed state ends (spawn, done, idle pause…). */
  timer = 0;
  path: Tile[] = [];
  private onArrive: Arrival | null = null;
  /** Walking speed in tiles per second. */
  speed: number;

  constructor(
    readonly id: string,
    readonly kind: string,
    public sprites: SpriteSet,
    tile: Tile,
    readonly parentId?: string,
    public label?: string,
  ) {
    this.x = tile.x + 0.5;
    this.y = tile.y + 0.5;
    this.speed = sprites.variant.size === "mini" ? 2.6 : 2.1;
    this.timer = animDuration(sprites.anims.spawn.spec);
  }

  get state(): AgentState {
    return this._state;
  }

  set state(s: AgentState) {
    if (s !== this._state) {
      this._state = s;
      this.stateTime = 0;
    }
  }

  get mini(): boolean {
    return this.sprites.variant.size === "mini";
  }

  tile(): Tile {
    return { x: Math.floor(this.x), y: Math.floor(this.y) };
  }

  setAnim(a: AnimName): void {
    if (a !== this.anim) {
      this.anim = a;
      this.animTime = 0;
    }
  }

  /** Plays a non-looping animation from the start and returns its duration. */
  play(a: AnimName): number {
    this.anim = a;
    this.animTime = 0;
    return animDuration(this.sprites.anims[a].spec);
  }

  walk(path: Tile[], onArrive: Arrival): void {
    this.onArrive = onArrive;
    if (path.length === 0) {
      this.path = [];
      this.arrive();
      return;
    }
    this.path = path;
    this.state = this.state === "returning" ? "returning" : "walking";
    this.setAnim("walk");
  }

  /** Stops at the next tile centre instead of continuing the path. */
  stopAtNextTile(onArrive: Arrival): void {
    const t = this.tile();
    const atCentre = Math.abs(this.x - (t.x + 0.5)) < 0.01 && Math.abs(this.y - (t.y + 0.5)) < 0.01;
    const next = this.path[0];
    this.path = atCentre || !next ? [] : [next];
    this.onArrive = onArrive;
    if (this.path.length === 0) this.arrive();
  }

  isMoving(): boolean {
    return this.path.length > 0;
  }

  private arrive(): void {
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  update(dt: number): void {
    this.animTime += dt;
    this.stateTime += dt;
    this.restTime += dt;
    if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
    let budget = this.speed * dt;
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const tx = next.x + 0.5;
      const ty = next.y + 0.5;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) this.dir = directionOf(dx, dy);
      if (dist <= budget) {
        this.x = tx;
        this.y = ty;
        budget -= dist;
        this.path.shift();
        if (this.path.length === 0) this.arrive();
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }
  }
}
