import type { AnimName, AnimSpec } from "./types";

/**
 * Character-agnostic motion curves. Character files turn a Pose into pixels,
 * so every character shares the same timing and "feel".
 */
export type EyeState = "open" | "blink" | "focus" | "up" | "happy";

export interface Pose {
  /** Body offset: +1 = squashed down, -1 = stretched up. */
  bob: number;
  /** Whole-sprite lift off the floor (done jump). */
  jump: number;
  /** Per-leg lift, back-left to front-right. */
  lift: readonly [number, number, number, number];
  /** Arm vertical offset (negative = raised). */
  armL: number;
  armR: number;
  eyes: EyeState;
  prop: "none" | "book";
  /** Book page turning. */
  page: boolean;
  /** Typing glow / screen reflection. */
  glow: boolean;
  /** "!" bubble vertical offset, or null when hidden. */
  bubble: number | null;
  /** Which bubble `bubble` draws: red "!" (permission) or blue "?" (waiting for the next prompt). */
  bubbleKind: "alert" | "ask";
  /** Sleep "z" drift phase (0..2), or null. */
  zzz: number | null;
  /** Sparkles relative to head top: [dx, dy, big]. */
  sparkles: readonly (readonly [number, number, boolean])[];
  /** Small horizontal wobble for antennas/accessories. */
  wobble: number;
}

const REST: Pose = {
  bob: 0,
  jump: 0,
  lift: [0, 0, 0, 0],
  armL: 0,
  armR: 0,
  eyes: "open",
  prop: "none",
  page: false,
  glow: false,
  bubble: null,
  bubbleKind: "alert",
  zzz: null,
  sparkles: [],
  wobble: 0,
};

/** Default animation timings — characters may reuse them as-is. */
export const STANDARD_ANIMATIONS: Record<Exclude<AnimName, "spawn" | "despawn">, AnimSpec> = {
  idle: { frames: 8, fps: 4, loop: true },
  walk: { frames: 4, fps: 8, loop: true },
  work_type: { frames: 4, fps: 8, loop: true },
  work_read: { frames: 4, fps: 3, loop: true },
  work_terminal: { frames: 4, fps: 12, loop: true },
  waiting: { frames: 4, fps: 4, loop: true },
  waiting_input: { frames: 4, fps: 2, loop: true },
  sleep: { frames: 6, fps: 2, loop: true },
  done: { frames: 8, fps: 10, loop: false },
};

export function poseFor(anim: AnimName, f: number): Pose {
  switch (anim) {
    case "idle":
      return { ...REST, bob: [0, 0, 1, 1, 0, 0, 1, 1][f] ?? 0, eyes: f === 5 ? "blink" : "open" };
    case "walk":
      return {
        ...REST,
        bob: f % 2 === 1 ? -1 : 0,
        lift: f === 0 ? [1, 0, 1, 0] : f === 2 ? [0, 1, 0, 1] : [0, 0, 0, 0],
        armL: f === 0 ? -1 : 0,
        armR: f === 2 ? -1 : 0,
        wobble: f === 1 ? -1 : f === 3 ? 1 : 0,
      };
    case "work_type":
    case "work_terminal":
      return {
        ...REST,
        armL: f % 2 === 0 ? -1 : 0,
        armR: f % 2 === 1 ? -1 : 0,
        eyes: "focus",
        glow: anim === "work_terminal" ? f % 2 === 0 : f === 0,
        bob: anim === "work_terminal" && f === 3 ? 1 : 0,
      };
    case "work_read":
      return { ...REST, bob: f === 2 ? 1 : 0, prop: "book", page: f === 3, armL: 1, armR: 1, eyes: f === 1 ? "blink" : "focus" };
    case "waiting":
      // The scene overlay draws the beacon and its bubble (Ambient.drawBeacons).
      return { ...REST, bob: f < 2 ? 0 : 1, eyes: "up", armR: f % 2 === 0 ? -3 : -2 };
    case "waiting_input":
      return { ...REST, bob: f === 1 || f === 2 ? 1 : 0, eyes: f === 3 ? "blink" : "up" };
    case "sleep":
      return { ...REST, bob: f < 3 ? 1 : 0, eyes: "blink", zzz: Math.floor(f / 2) };
    case "done": {
      const jump = [0, 2, 4, 5, 5, 4, 2, 0][f] ?? 0;
      const sparkles: [number, number, boolean][] =
        f >= 2 && f <= 6
          ? [
              [-8, -2 + (f % 2), f % 2 === 0],
              [8, -5 - (f % 2), f % 2 === 1],
              [1, -9, f === 4],
            ]
          : [];
      return { ...REST, jump, armL: -2, armR: -2, eyes: "happy", sparkles };
    }
    default:
      return REST;
  }
}
