import { PNG } from "pngjs";
import type { Page } from "@playwright/test";

export interface Office {
  office: { agents: Map<string, { state: string }>; speeches(): unknown[] };
  stats: { fps: number; frames: number; frameMs: number };
  apply(e: unknown): void;
  viewport(): { scale: number; w: number; h: number; cssW: number; cssH: number };
  view: { origin: { x: number; y: number } };
  camera: { x: number; y: number };
}

export const SIZES = [
  { name: "1280x720", width: 1280, height: 720, dpr: 1 },
  { name: "1920x1080", width: 1920, height: 1080, dpr: 1 },
  { name: "2560x1440", width: 2560, height: 1440, dpr: 1 },
  // MacBook Pro 14" native panel: 3024×1964 physical pixels = 1512×982 CSS at 2×.
  { name: "3024x1964", width: 1512, height: 982, dpr: 2 },
] as const;

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __agentOffice?: unknown }).__agentOffice);
}

export function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

/**
 * Checks that the screenshot is made of uniform scale×scale blocks aligned on the canvas grid
 * (no interpolation / half-pixel blur). Returns the number of non-uniform blocks among the samples.
 */
export function blurryBlocks(png: PNG, scale: number, samples = 4000): number {
  let bad = 0;
  const bw = Math.floor(png.width / scale);
  const bh = Math.floor(png.height / scale);
  for (let i = 0; i < samples; i++) {
    const bx = Math.floor(((i * 7919) % 9973) / 9973 * bw);
    const by = Math.floor(((i * 104729) % 99991) / 99991 * bh);
    const at = (x: number, y: number) => {
      const o = (y * png.width + x) * 4;
      return (png.data[o]! << 16) | (png.data[o + 1]! << 8) | png.data[o + 2]!;
    };
    const ref = at(bx * scale, by * scale);
    outer: for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        if (at(bx * scale + x, by * scale + y) !== ref) {
          bad++;
          break outer;
        }
      }
    }
  }
  return bad;
}

export function colors(png: PNG): Set<string> {
  const out = new Set<string>();
  for (let o = 0; o < png.data.length; o += 4) {
    out.add(`#${[png.data[o]!, png.data[o + 1]!, png.data[o + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
  }
  return out;
}
