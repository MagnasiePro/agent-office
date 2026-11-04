import { describe, expect, it } from "vitest";
import { parseEvent, parseGitEvent, parseServerMessage, parseUsage, parseUsageUpdate, SnapshotSchema, type Usage } from "../../shared/events";
import { randomScenario, scriptedScenario } from "../../shared/scenario";
import { animationForStation, mailForTool, stationForTool } from "../../shared/toolMapping";
import { HookAdapter, summarize } from "../../server/hook-adapter";
import { AgentTracker } from "../../server/tracker";

describe("event contract (zod)", () => {
  it("accepts every event type", () => {
    for (const e of [
      { type: "agent_spawn", agentId: "a", kind: "claude" },
      { type: "agent_spawn", agentId: "b", parentId: "a", kind: "codex", label: "Explore" },
      { type: "agent_tool", agentId: "a", tool: "Read", summary: "x.ts" },
      { type: "agent_waiting", agentId: "a" },
      { type: "agent_done", agentId: "a" },
      { type: "agent_despawn", agentId: "a" },
    ]) expect(parseEvent(e)).toEqual(e);
  });

  it("rejects malformed events", () => {
    for (const e of [null, 42, {}, { type: "agent_tool", agentId: "a" }, { type: "agent_spawn", agentId: "", kind: "claude" }, { type: "nope", agentId: "a" }, { type: "agent_done" }])
      expect(parseEvent(e)).toBeNull();
  });

  it("parses snapshots as server messages", () => {
    const s = { type: "snapshot", agents: [{ spawn: { type: "agent_spawn", agentId: "a", kind: "claude" }, last: { type: "agent_done", agentId: "a" } }] };
    expect(parseServerMessage(s)).toEqual(s);
  });

  it("parses usage messages and rejects out-of-range values", () => {
    expect(parseServerMessage({ type: "usage", fiveHour: { usedPercentage: 62, resetsAt: 1762300000 } })).toBeTruthy();
    expect(parseUsage({ type: "usage", fiveHour: { usedPercentage: 140, resetsAt: 1 } })).toBeNull();
    expect(parseUsage({ type: "usage", sevenDay: { usedPercentage: "5", resetsAt: 1 } })).toBeNull();
    expect(parseUsage({ type: "usage" })).toBeTruthy();
  });

  it("scenarios only produce valid events, in time order", () => {
    const scripted = scriptedScenario("m");
    for (const t of scripted) expect(parseEvent(t.event)).not.toBeNull();
    for (let i = 1; i < scripted.length; i++) expect(scripted[i]!.at).toBeGreaterThanOrEqual(scripted[i - 1]!.at);
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const it = randomScenario(rng);
    for (let i = 0; i < 300; i++) expect(parseEvent(it.next().value!.event)).not.toBeNull();
  });
});

describe("tool → station mapping", () => {
  it.each([
    ["Read", "library"],
    ["Grep", "library"],
    ["Glob", "library"],
    ["Edit", "desk"],
    ["Write", "desk"],
    ["Bash", "terminal"],
    ["Task", "coffee"],
    ["Agent", "coffee"],
    ["WebFetch", "library"],
    ["WebSearch", "library"],
    ["mcp__github__create_issue", "library"],
    ["ExitPlanMode", "desk"],
    ["SomethingNew", "desk"],
  ])("%s → %s", (tool, station) => expect(stationForTool(tool)).toBe(station));

  it("gives each station a work animation", () => {
    expect(animationForStation("library")).toBe("work_read");
    expect(animationForStation("terminal")).toBe("work_terminal");
    expect(animationForStation("coffee")).toBe("idle");
    expect(animationForStation("unknown")).toBe("work_type");
  });
});

describe("hook adapter", () => {
  it("maps a Claude Code session with a sub-agent", () => {
    const h = new HookAdapter();
    const s = "sess-1";
    expect(h.handle({ hook_event_name: "PreToolUse", session_id: s, cwd: "/w/proj", tool_name: "Read", tool_input: { file_path: "/w/proj/a.ts" } })).toEqual([
      { type: "agent_spawn", agentId: s, kind: "claude", label: "proj" },
      { type: "agent_tool", agentId: s, tool: "Read", summary: "a.ts" },
    ]);
    const task = h.handle({ hook_event_name: "PreToolUse", session_id: s, tool_name: "Task", tool_use_id: "tu1", tool_input: { subagent_type: "Explore" } });
    expect(task).toContainEqual({ type: "agent_spawn", agentId: `${s}/tu1`, parentId: s, kind: "claude", label: "Explore" });
    h.handle({ hook_event_name: "SubagentStart", session_id: s, agent_id: "a-1" });
    expect(h.handle({ hook_event_name: "PreToolUse", session_id: s, agent_id: "a-1", tool_name: "Grep", tool_input: { pattern: "x" } })).toEqual([
      { type: "agent_tool", agentId: `${s}/tu1`, tool: "Grep", summary: "x" },
    ]);
    expect(h.handle({ hook_event_name: "Notification", session_id: s, message: "Claude needs permission" })).toEqual([
      { type: "agent_waiting", agentId: s, reason: "Claude needs permission" },
    ]);
    expect(h.handle({ hook_event_name: "SubagentStop", session_id: s })).toEqual([
      { type: "agent_done", agentId: `${s}/tu1` },
      { type: "agent_despawn", agentId: `${s}/tu1` },
    ]);
    // The session was waiting (Notification): its next PostToolUse puts it back to work; the sub-agent is already closed.
    expect(h.handle({ hook_event_name: "PostToolUse", session_id: s, tool_name: "Task", tool_use_id: "tu1" })).toEqual([{ type: "agent_tool", agentId: s, tool: "Task", summary: undefined }]);
    expect(h.handle({ hook_event_name: "Stop", session_id: s })).toEqual([{ type: "agent_done", agentId: s }]);
    expect(h.handle({ hook_event_name: "SessionEnd", session_id: s })).toEqual([{ type: "agent_despawn", agentId: s }]);
  });

  it("binds sub-agents announced by Task to their SubagentStart agent_id, and resumes after a permission", () => {
    const h = new HookAdapter();
    const s = "sess-2";
    h.handle({ hook_event_name: "SessionStart", session_id: s });
    h.handle({ hook_event_name: "PreToolUse", session_id: s, tool_name: "Task", tool_use_id: "tu9", tool_input: { description: "x" } });
    expect(h.handle({ hook_event_name: "SubagentStart", session_id: s, agent_id: "ag1", agent_type: "Explore" })).toEqual([]);
    expect(h.handle({ hook_event_name: "PreToolUse", session_id: s, agent_id: "ag1", tool_name: "Read" })).toEqual([{ type: "agent_tool", agentId: `${s}/tu9`, tool: "Read", summary: undefined }]);
    expect(h.handle({ hook_event_name: "Notification", session_id: s, notification_type: "idle_prompt", message: "Claude is waiting for your input" })).toEqual([
      { type: "agent_waiting", agentId: s, reason: "Claude is waiting for your input", need: "next_prompt" },
    ]);
    expect(h.handle({ hook_event_name: "UserPromptSubmit", session_id: s })).toEqual([{ type: "agent_tool", agentId: s, tool: "UserPromptSubmit" }]);
    expect(h.handle({ hook_event_name: "PermissionRequest", session_id: s, tool_name: "Bash" })).toEqual([{ type: "agent_waiting", agentId: s, reason: undefined }]);
    expect(h.handle({ hook_event_name: "PostToolUse", session_id: s, tool_name: "Bash", tool_input: { command: "ls" } })).toEqual([{ type: "agent_tool", agentId: s, tool: "Bash", summary: "ls" }]);
    // A sub-agent started without a Task call still shows up.
    expect(h.handle({ hook_event_name: "SubagentStart", session_id: s, agent_id: "ag2", agent_type: "Plan" })).toEqual([{ type: "agent_spawn", agentId: `${s}/ag2`, parentId: s, kind: "claude", label: "Plan" }]);
    expect(h.handle({ hook_event_name: "SubagentStop", session_id: s, agent_id: "ag1" })).toEqual([
      { type: "agent_done", agentId: `${s}/tu9` },
      { type: "agent_despawn", agentId: `${s}/tu9` },
    ]);
    // PostToolUse of the Task after SubagentStop does not close anything twice.
    expect(h.handle({ hook_event_name: "PostToolUse", session_id: s, tool_name: "Task", tool_use_id: "tu9" })).toEqual([]);
  });

  it("maps idle_prompt to next_prompt", () => {
    expect(new HookAdapter().handle({ hook_event_name: "Notification", session_id: "s", notification_type: "idle_prompt" })).toContainEqual({ type: "agent_waiting", agentId: "s", need: "next_prompt" });
  });

  it("turns AskUserQuestion and ExitPlanMode into an input wait, resumed by PostToolUse", () => {
    const h = new HookAdapter();
    const pre = h.handle({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", session_id: "s" });
    expect(pre).toContainEqual({ type: "agent_waiting", agentId: "s", need: "input" });
    expect(pre.some((e) => e.type === "agent_tool")).toBe(false);
    expect(h.handle({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", session_id: "s" })).toContainEqual({ type: "agent_tool", agentId: "s", tool: "AskUserQuestion" });
  });

  it("a pending question keeps later PermissionRequest/Notification as input waits", () => {
    const h = new HookAdapter();
    h.handle({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", session_id: "s" });
    expect(h.handle({ hook_event_name: "PermissionRequest", session_id: "s" })).toContainEqual({ type: "agent_waiting", agentId: "s", need: "input" });
    expect(h.handle({ hook_event_name: "Notification", session_id: "s", notification_type: "idle_prompt" })).toContainEqual({ type: "agent_waiting", agentId: "s", need: "next_prompt" });
    h.handle({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", session_id: "s" });
    const plain = h.handle({ hook_event_name: "PermissionRequest", session_id: "s" });
    expect(plain.find((e) => e.type === "agent_waiting")).toEqual({ type: "agent_waiting", agentId: "s" });
  });

  it("passes AgentEvents through and ignores junk", () => {
    const h = new HookAdapter();
    expect(h.handle({ type: "agent_done", agentId: "x" })).toEqual([{ type: "agent_done", agentId: "x" }]);
    expect(h.handle("nope")).toEqual([]);
    expect(summarize({ command: "a".repeat(200) })!.length).toBeLessThanOrEqual(80);
  });
});

describe("server tracker", () => {
  it("keeps live agents with their last state for replay", () => {
    const t = new AgentTracker();
    t.apply({ type: "agent_spawn", agentId: "p", kind: "claude" });
    t.apply({ type: "agent_spawn", agentId: "c", parentId: "p", kind: "claude" });
    t.apply({ type: "agent_tool", agentId: "c", tool: "Read" });
    const snap = t.snapshot();
    expect(snap.agents.map((a) => a.spawn.agentId)).toEqual(["p", "c"]);
    expect(snap.agents[1]!.last).toEqual({ type: "agent_tool", agentId: "c", tool: "Read" });
    t.apply({ type: "agent_despawn", agentId: "p" });
    expect(t.ids()).toEqual([]);
  });

  it("a next_prompt wait does not replace a blocking wait as the replayed state", () => {
    const t = new AgentTracker();
    t.apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    t.apply({ type: "agent_waiting", agentId: "a", need: "input" });
    t.apply({ type: "agent_waiting", agentId: "a", need: "next_prompt" });
    expect(t.snapshot().agents[0]!.last).toEqual({ type: "agent_waiting", agentId: "a", need: "input" });
    t.apply({ type: "agent_done", agentId: "a" });
    t.apply({ type: "agent_waiting", agentId: "a", need: "next_prompt" });
    expect(t.snapshot().agents[0]!.last).toEqual({ type: "agent_waiting", agentId: "a", need: "next_prompt" });
  });

  it("tracker keeps the latest usage and replays it in the snapshot", () => {
    const t = new AgentTracker();
    const u: Usage = { type: "usage", fiveHour: { usedPercentage: 40, resetsAt: 1893456000 } };
    t.usage = u;
    expect(t.snapshot().usage).toEqual(u);
    expect(SnapshotSchema.safeParse(t.snapshot()).success).toBe(true);
  });

  it("parseUsageUpdate accepts one window and rejects junk", () => {
    expect(parseUsageUpdate({ fiveHour: { usedPercentage: 40, resetsAt: 1893456000 } })?.type).toBe("usage");
    for (const bad of [{}, [], "x", null, { fiveHour: { usedPercentage: 140, resetsAt: 1 } }, { sevenDay: { usedPercentage: "5", resetsAt: 1 } }]) expect(parseUsageUpdate(bad)).toBeNull();
  });
});

describe("mail truck routing", () => {
  const start = (id: string, cwd: string) => ({ hook_event_name: "SessionStart", session_id: id, cwd });

  it("routes a git push to the session working in that repo", () => {
    const a = new HookAdapter();
    a.handle(start("a", "/w/app"));
    a.handle(start("b", "/w/other"));
    expect(a.git("/w/app", "push")).toEqual([{ type: "agent_mail", agentId: "a", direction: "push" }]);
    expect(a.git("/w/none", "pull")).toEqual([]);
  });

  it("prefers the closest cwd, then the most recent session", () => {
    let t = 0;
    const a = new HookAdapter(() => ++t);
    a.handle(start("a", "/w/app"));
    a.handle(start("b", "/w/app/packages/ui"));
    a.handle(start("c", "/w/app"));
    expect(a.git("/w/app/packages/ui", "pull")).toEqual([{ type: "agent_mail", agentId: "b", direction: "pull" }]);
    expect(a.git("/w/app/", "pull")).toEqual([{ type: "agent_mail", agentId: "c", direction: "pull" }]);
  });

  it("attributes mail to the sub-agent that last used a tool", () => {
    const a = new HookAdapter();
    a.handle(start("s", "/w/app"));
    const sub = a.handle({ hook_event_name: "SubagentStart", session_id: "s", agent_id: "x" }).find((e) => e.type === "agent_spawn")!;
    a.handle({ hook_event_name: "PreToolUse", session_id: "s", agent_id: "x", tool_name: "Bash" });
    expect(a.git("/w/app", "push")).toEqual([{ type: "agent_mail", agentId: sub.agentId, direction: "push" }]);
    a.handle({ hook_event_name: "SubagentStop", session_id: "s", agent_id: "x" });
    expect(a.git("/w/app", "push")).toEqual([{ type: "agent_mail", agentId: "s", direction: "push" }]);
  });

  it("remote-only GitHub tools count as a push", () => {
    const a = new HookAdapter();
    const tool_name = "mcp__plugin_github_github__push_files";
    expect(mailForTool(tool_name)).toBe("push");
    expect(a.handle({ hook_event_name: "PostToolUse", session_id: "s", tool_name })).toContainEqual({ type: "agent_mail", agentId: "s", direction: "push" });
    expect(a.handle({ hook_event_name: "PostToolUseFailure", session_id: "s", tool_name }).some((e) => e.type === "agent_mail")).toBe(false);
  });

  it("parseGitEvent rejects junk", () => {
    for (const x of [{}, { repo: "", direction: "push" }, { repo: "/x", direction: "merge" }]) expect(parseGitEvent(x)).toBeNull();
    expect(parseGitEvent({ repo: "/x", direction: "pull" })).toEqual({ repo: "/x", direction: "pull" });
  });

  it("tracker never stores agent_mail", () => {
    const t = new AgentTracker();
    t.apply({ type: "agent_spawn", agentId: "a", kind: "claude" });
    t.apply({ type: "agent_tool", agentId: "a", tool: "Read" });
    t.apply({ type: "agent_mail", agentId: "a", direction: "push" });
    t.apply({ type: "agent_mail", agentId: "ghost", direction: "push" });
    const s = t.snapshot();
    expect(s.agents).toHaveLength(1);
    expect(s.agents[0]?.last).toEqual({ type: "agent_tool", agentId: "a", tool: "Read" });
  });
});
