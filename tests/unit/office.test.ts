import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/events";
import { createRegistry } from "../../src/characters";
import { Office } from "../../src/scene/office";
import { OFFICE, wallBetween } from "../../src/world/layout";

function seeded(seed = 7) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

let office: Office;
const run = (seconds: number, step = 1 / 30) => {
  for (let t = 0; t < seconds; t += step) office.update(step);
};
const apply = (...es: AgentEvent[]) => es.forEach((e) => office.apply(e));
const agent = (id: string) => office.agents.get(id)!;
const slotOf = (type: string) => OFFICE.stations.filter((s) => s.type === type).flatMap((s) => s.slots);

beforeEach(() => {
  office = new Office(OFFICE, createRegistry(), { rng: seeded() });
});

describe("agent state machine", () => {
  it("spawns, then idles", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    expect(agent("a").state).toBe("spawning");
    expect(agent("a").anim).toBe("spawn");
    run(1);
    expect(["idle", "walking"]).toContain(agent("a").state);
  });

  it("walks to the mapped station and plays the matching animation", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" }, { type: "agent_tool", agentId: "a", tool: "Read" });
    run(1);
    expect(agent("a").state).toBe("walking");
    run(15);
    const a = agent("a");
    expect(a.state).toBe("working");
    expect(a.anim).toBe("work_read");
    expect(slotOf("library")).toContainEqual({ x: Math.floor(a.x), y: Math.floor(a.y), dir: a.dir });
  });

  it("sends a session's edits to its own desk", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" }, { type: "agent_spawn", agentId: "b", kind: "claude" });
    apply({ type: "agent_tool", agentId: "a", tool: "Edit" }, { type: "agent_tool", agentId: "b", tool: "Edit" });
    run(15);
    const [a, b] = [agent("a"), agent("b")];
    expect(a.anim).toBe("work_type");
    expect(b.anim).toBe("work_type");
    expect(`${Math.floor(a.x)},${Math.floor(a.y)}`).not.toBe(`${Math.floor(b.x)},${Math.floor(b.y)}`);
    // Going elsewhere and back lands on the same seat.
    const seat = `${a.x},${a.y}`;
    apply({ type: "agent_tool", agentId: "a", tool: "Bash" });
    run(15);
    expect(agent("a").anim).toBe("work_terminal");
    apply({ type: "agent_tool", agentId: "a", tool: "Write" });
    run(15);
    expect(`${agent("a").x},${agent("a").y}`).toBe(seat);
  });

  it("waits with a bubble, then resumes", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    run(1);
    apply({ type: "agent_waiting", agentId: "a", reason: "permission" });
    run(2);
    expect(agent("a").state).toBe("waiting");
    expect(agent("a").anim).toBe("waiting");
    expect(["SE", "SW"]).toContain(agent("a").dir);
    apply({ type: "agent_tool", agentId: "a", tool: "Bash" });
    run(15);
    expect(agent("a").state).toBe("working");
  });

  it("shows an input wait for a real question and resumes on the next tool", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    run(1);
    apply({ type: "agent_waiting", agentId: "a", need: "input" });
    run(2);
    expect(agent("a").state).toBe("waiting");
    expect(agent("a").anim).toBe("waiting_input");
    apply({ type: "agent_tool", agentId: "a", tool: "Bash" });
    run(15);
    expect(agent("a").state).toBe("working");
  });

  it("falls asleep after a long rest", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    run(120);
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      run(0.5);
      seen.add(agent("a").anim);
    }
    expect(seen.has("sleep")).toBe(true);
  });

  it("celebrates done once, even when done arrives twice", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    run(1);
    apply({ type: "agent_done", agentId: "a" });
    run(0.3);
    expect(agent("a").state).toBe("done");
    expect(agent("a").anim).toBe("done");
    run(2);
    expect(agent("a").state).not.toBe("done");
    apply({ type: "agent_done", agentId: "a" });
    run(0.1);
    expect(agent("a").state).not.toBe("done");
  });

  it("despawns with a poof and is removed", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    run(1);
    apply({ type: "agent_despawn", agentId: "a" });
    run(0.2);
    expect(agent("a").state).toBe("despawning");
    run(2);
    expect(office.agents.has("a")).toBe(false);
    apply({ type: "agent_despawn", agentId: "a" }, { type: "agent_done", agentId: "a" });
    expect(office.agents.size).toBe(0);
  });

  it("creates an unknown agent on a tool event and falls back to the default character for unknown kinds", () => {
    apply({ type: "agent_tool", agentId: "ghost", tool: "Grep" });
    expect(agent("ghost")).toBeDefined();
    apply({ type: "agent_spawn", agentId: "g", kind: "gemini" });
    expect(agent("g").sprites.def.id).toBe("claude");
    run(15);
    expect(agent("ghost").anim).toBe("work_read");
  });

  it("queues events received while spawning", () => {
    apply({ type: "agent_spawn", agentId: "a", kind: "claude" }, { type: "agent_tool", agentId: "a", tool: "Bash" }, { type: "agent_waiting", agentId: "a" });
    expect(agent("a").state).toBe("spawning");
    run(15);
    expect(agent("a").state).toBe("waiting");
  });
});

describe("sub-agents", () => {
  beforeEach(() => {
    apply({ type: "agent_spawn", agentId: "p", kind: "claude" });
    run(1);
  });

  it("appear mini next to their parent, get a briefing bubble, and are linked", () => {
    apply({ type: "agent_spawn", agentId: "c", parentId: "p", kind: "claude" });
    const c = agent("c");
    expect(c.mini).toBe(true);
    expect(c.sprites.variant.hue).not.toBe(0);
    expect(Math.abs(c.x - agent("p").x) + Math.abs(c.y - agent("p").y)).toBeLessThanOrEqual(3);
    run(1);
    expect(office.links().map(([a, b]) => [a.id, b.id])).toEqual([["p", "c"]]);
    expect(office.speeches().map((s) => s.agentId)).toContain("p");
  });

  it("go back to their parent, report, then disappear", () => {
    apply({ type: "agent_spawn", agentId: "c", parentId: "p", kind: "claude" });
    run(1);
    apply({ type: "agent_tool", agentId: "c", tool: "WebSearch" });
    run(20);
    expect(agent("c").state).toBe("working");
    apply({ type: "agent_done", agentId: "c" }, { type: "agent_despawn", agentId: "c" });
    let reported = false;
    for (let i = 0; i < 30 * 30 && office.agents.has("c"); i++) {
      office.update(1 / 30);
      if (office.speeches().some((s) => s.agentId === "c")) reported = true;
    }
    expect(reported).toBe(true);
    expect(office.agents.has("c")).toBe(false);
  });

  it("disappear with their parent", () => {
    apply({ type: "agent_spawn", agentId: "c", parentId: "p", kind: "claude" });
    run(1);
    apply({ type: "agent_despawn", agentId: "p" });
    run(3);
    expect(office.agents.size).toBe(0);
  });

  it("handle 30 simultaneous sub-agents without overlapping work spots", () => {
    for (let i = 0; i < 30; i++) apply({ type: "agent_spawn", agentId: `c${i}`, parentId: "p", kind: i % 3 ? "claude" : "robot" });
    run(1);
    const tools = ["Read", "Edit", "Bash", "WebFetch", "Task"];
    for (let i = 0; i < 30; i++) apply({ type: "agent_tool", agentId: `c${i}`, tool: tools[i % tools.length]! });
    run(40);
    const spots = [...office.agents.values()].filter((a) => a.state === "working").map((a) => `${a.x},${a.y}`);
    expect(spots.length).toBe(30);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

describe("idle behaviour", () => {
  it("idle agents drift to the cafeteria and chat", () => {
    for (const id of ["a", "b", "c"]) apply({ type: "agent_spawn", agentId: id, kind: "claude" }, { type: "agent_done", agentId: id });
    let chats = 0;
    for (let i = 0; i < 30 * 90; i++) {
      office.update(1 / 30);
      if (i % 30 === 0 && office.speeches().length) chats++;
    }
    const inCafe = [...office.agents.values()].filter((a) => a.y >= 9 && a.x < 10).length;
    expect(inCafe).toBeGreaterThanOrEqual(2);
    expect(chats).toBeGreaterThan(0);
  });

  it("never steps through a partition", () => {
    for (let i = 0; i < 5; i++) apply({ type: "agent_spawn", agentId: `a${i}`, kind: "claude" });
    const last = new Map<string, { x: number; y: number }>();
    const tools = ["Read", "Edit", "Bash", "WebFetch", "Task", "Grep"];
    for (let i = 0; i < 30 * 120; i++) {
      if (i % 90 === 0) apply({ type: "agent_tool", agentId: `a${(i / 90) % 5}`, tool: tools[(i / 90) % tools.length]! });
      office.update(1 / 30);
      for (const a of office.agents.values()) {
        const t = a.tile();
        const p = last.get(a.id);
        if (p && (p.x !== t.x || p.y !== t.y)) expect(wallBetween(OFFICE, p.x, p.y, t.x, t.y), `${a.id} ${p.x},${p.y}→${t.x},${t.y}`).toBe(false);
        last.set(a.id, t);
      }
    }
  });
});

describe("snapshot reconciliation", () => {
  it("removes agents the server no longer knows and restores the others", () => {
    apply({ type: "agent_spawn", agentId: "old", kind: "claude" });
    run(1);
    office.applySnapshot({
      type: "snapshot",
      agents: [{ spawn: { type: "agent_spawn", agentId: "new", kind: "claude" }, last: { type: "agent_tool", agentId: "new", tool: "Bash" } }],
    });
    run(20);
    expect(office.agents.has("old")).toBe(false);
    expect(agent("new").anim).toBe("work_terminal");
  });
});

describe("agent status visibility", () => {
  const spawn = (id: string) => apply({ type: "agent_spawn", agentId: id, kind: "claude" });
  const tileOf = (id: string) => ({ x: Math.floor(agent(id).x), y: Math.floor(agent(id).y) });

  it("a parent waiting on a sub-agent takes a coffee at the bar", () => {
    spawn("p");
    run(1);
    apply({ type: "agent_tool", agentId: "p", tool: "Task" });
    run(20);
    expect(agent("p").state).toBe("working");
    expect(agent("p").station).toBe("coffee");
    expect(slotOf("coffee")).toContainEqual(expect.objectContaining(tileOf("p")));
  });

  it("idle agents never take the coffee-bar slots", () => {
    for (let i = 0; i < 6; i++) spawn(`a${i}`);
    for (let t = 0; t < 120; t += 0.5) {
      run(0.5);
      for (const a of office.agents.values())
        expect(slotOf("coffee")).not.toContainEqual(expect.objectContaining({ x: Math.floor(a.x), y: Math.floor(a.y) }));
    }
  });

  it("a finished session awaiting its next prompt keeps its coffee break, with no beacon", () => {
    spawn("a");
    run(1);
    apply({ type: "agent_tool", agentId: "a", tool: "Edit" });
    run(15);
    apply({ type: "agent_done", agentId: "a" });
    run(5);
    apply({ type: "agent_waiting", agentId: "a", need: "next_prompt" });
    run(2);
    expect(agent("a").state).not.toBe("waiting");
    expect(agent("a").awaitingPrompt).toBe(true);
    apply({ type: "agent_tool", agentId: "a", tool: "Read" });
    run(1);
    expect(agent("a").awaitingPrompt).toBe(false);
  });

  it("the idle_prompt event does not wake a finished agent that fell asleep", () => {
    spawn("a");
    run(1);
    apply({ type: "agent_tool", agentId: "a", tool: "Edit" });
    run(15);
    apply({ type: "agent_done", agentId: "a" });
    run(120);
    expect(agent("a").anim).toBe("sleep");
    const rest = agent("a").restTime;
    apply({ type: "agent_waiting", agentId: "a", need: "next_prompt" });
    run(1);
    expect(agent("a").anim).toBe("sleep");
    expect(agent("a").restTime).toBeGreaterThanOrEqual(rest);
  });

  it("a real question on an idle agent still gets the beacon", () => {
    spawn("a");
    run(3);
    apply({ type: "agent_waiting", agentId: "a", need: "input" });
    run(2);
    expect(agent("a").state).toBe("waiting");
    expect(agent("a").anim).toBe("waiting_input");
    expect(agent("a").awaitingPrompt).toBe(false);
  });

  it("station is set while working and cleared when leaving", () => {
    spawn("a");
    run(1);
    apply({ type: "agent_tool", agentId: "a", tool: "Bash" });
    run(15);
    expect(agent("a").station).toBe("terminal");
    apply({ type: "agent_waiting", agentId: "a" });
    run(2);
    expect(agent("a").station).toBeNull();
  });
});
