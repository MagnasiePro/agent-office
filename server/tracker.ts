import type { AgentEvent, AgentSpawnEvent, Snapshot, Usage } from "../shared/events";

/** Server-side memory of live agents, replayed to every (re)connecting screen. */
export class AgentTracker {
  /** Latest plan usage, replayed to every (re)connecting screen. */
  usage: Usage | undefined;
  private agents = new Map<string, { spawn: AgentSpawnEvent; last?: AgentEvent }>();

  apply(e: AgentEvent): void {
    if (e.type === "agent_spawn") {
      if (!this.agents.has(e.agentId)) this.agents.set(e.agentId, { spawn: e });
      return;
    }
    if (e.type === "agent_despawn") {
      this.agents.delete(e.agentId);
      for (const [id, a] of this.agents) if (a.spawn.parentId === e.agentId) this.agents.delete(id);
      return;
    }
    if (e.type === "agent_mail") return; // a transient delivery: never a state to replay
    const a = this.agents.get(e.agentId);
    if (a) {
      // A finished-session "?" must not hide a blocking wait a reconnecting screen should still show.
      const l = a.last;
      const blocking = l?.type === "agent_waiting" && l.need !== "next_prompt";
      if (!(blocking && e.type === "agent_waiting" && e.need === "next_prompt")) a.last = e;
    }
    else if (e.type !== "agent_done") this.agents.set(e.agentId, { spawn: { type: "agent_spawn", agentId: e.agentId, kind: "claude" }, last: e });
  }

  ids(): string[] {
    return [...this.agents.keys()];
  }

  snapshot(): Snapshot {
    // Parents first so sub-agents spawn next to them.
    const list = [...this.agents.values()].sort((a, b) => Number(!!a.spawn.parentId) - Number(!!b.spawn.parentId));
    return { type: "snapshot", agents: list, ...(this.usage ? { usage: this.usage } : {}) };
  }
}
