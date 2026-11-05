import { describe, expect, it } from "vitest";
import { parseOauthUsage } from "../../server/usage-poller";

describe("parseOauthUsage", () => {
  it("maps utilization and ISO reset times to a usage message", () => {
    expect(
      parseOauthUsage({
        five_hour: { utilization: 62.5, resets_at: "2026-11-04T18:00:00.000Z" },
        seven_day: { utilization: 130, resets_at: "2026-11-08T00:00:00+00:00" },
        seven_day_opus: null,
      }),
    ).toEqual({
      type: "usage",
      fiveHour: { usedPercentage: 62.5, resetsAt: Date.parse("2026-11-04T18:00:00Z") / 1000 },
      sevenDay: { usedPercentage: 100, resetsAt: Date.parse("2026-11-08T00:00:00Z") / 1000 },
    });
  });

  it("drops windows without a number or a reset time, and rejects a response with none left", () => {
    expect(parseOauthUsage({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 20, resets_at: "2026-11-08T00:00:00Z" } })?.fiveHour).toBeUndefined();
    expect(parseOauthUsage({ five_hour: { utilization: null, resets_at: "2026-11-08T00:00:00Z" } })).toBeNull();
    expect(parseOauthUsage({ error: "unauthorized" })).toBeNull();
    expect(parseOauthUsage(null)).toBeNull();
  });
});
