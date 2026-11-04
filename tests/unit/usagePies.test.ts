import { describe, expect, it } from "vitest";
import { pieFraction } from "../../src/scene/usagePies";

describe("pieFraction", () => {
  it("is null without a window", () => expect(pieFraction(undefined, 0)).toBeNull());
  it("is the used share while the window is live", () => expect(pieFraction({ usedPercentage: 62, resetsAt: 2000 }, 1000)).toBe(0.62));
  it("is null once the window has reset", () => expect(pieFraction({ usedPercentage: 62, resetsAt: 1000 }, 1000)).toBeNull());
  it("is 1 at full usage", () => expect(pieFraction({ usedPercentage: 100, resetsAt: 2000 }, 1000)).toBe(1));
});
