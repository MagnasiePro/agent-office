import { parseEvent, type AgentEvent } from "../shared/events";

/**
 * Converts raw Claude Code hook payloads (stdin JSON of a hook, forwarded with curl) into AgentEvents.
 *
 * | hook_event_name   | emitted events                                                         |
 * |-------------------|------------------------------------------------------------------------|
 * | SessionStart      | agent_spawn (session agent)                                            |
 * | UserPromptSubmit  | agent_spawn if the session is new                                      |
 * | PreToolUse        | agent_tool; for Task/Agent also agent_spawn of a sub-agent             |
 * |                   | AskUserQuestion / ExitPlanMode → agent_waiting need input (no agent_tool) |
 * | PostToolUse(…)    | resumes work after a permission prompt; Task/Agent: closes sub-agent   |
 * | PermissionRequest | agent_waiting ("!" bubble)                                             |
 * | Notification      | agent_waiting; idle_prompt → need "next_prompt" ("?"), else "!"       |
 * | Stop, StopFailure | agent_done                                                             |
 * | SubagentStart     | binds the sub-agent's `agent_id` (spawns one if no Task call announced it) |
 * | SubagentStop      | agent_done + agent_despawn of that sub-agent (by agent_id, else latest)|
 * | SessionEnd        | agent_despawn (sub-agents follow their parent)                         |
 *
 * The session agent id is `session_id`. Tool calls made *inside* a sub-agent are attributed to it
 * when the payload carries an `agent_id` (bound at SubagentStart); otherwise they show on the session agent.
 * A payload that already is a valid AgentEvent is passed through unchanged.
 */
export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  message?: string;
  notification_type?: string;
  agent_id?: string;
  agent_type?: string;
  /** Not sent by Claude Code: lets other tools reuse this endpoint with their own character (e.g. "codex"). */
  agent_kind?: string;
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
/** Tools that block on the user: shown as a real question, resumed by their PostToolUse. */
const QUESTION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

interface Session {
  /** Sub-agents currently alive: screen id, the Task call that announced it, the hook agent_id once known. */
  open: { id: string; toolUseId?: string; agentId?: string }[];
  count: number;
  /** Agents showing a "!" bubble, resumed by their next PostToolUse. */
  waiting: Set<string>;
}

export function summarize(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of ["file_path", "notebook_path", "command", "pattern", "url", "query", "description", "prompt"]) {
    const v = input[k];
    if (typeof v === "string" && v) {
      const s = k.endsWith("path") ? (v.split("/").pop() ?? v) : v;
      return s.length > 80 ? `${s.slice(0, 77)}…` : s;
    }
  }
  return undefined;
}

export class HookAdapter {
  private sessions = new Map<string, Session>();

  handle(raw: unknown): AgentEvent[] {
    const direct = parseEvent(raw);
    if (direct) return [direct];
    if (!raw || typeof raw !== "object") return [];
    const p = raw as HookPayload;
    const main = p.session_id || "claude-session";
    const out: AgentEvent[] = [];
    const session = this.ensure(main, p, out);
    const actor = (p.agent_id && session.open.find((s) => s.agentId === p.agent_id)?.id) || main;

    switch (p.hook_event_name) {
      case "SessionStart":
        break;
      case "UserPromptSubmit":
        // A new prompt ends the "?" wait: send the agent back to work.
        if (session.waiting.delete(main)) out.push({ type: "agent_tool", agentId: main, tool: "UserPromptSubmit" });
        break;
      case "PreToolUse": {
        if (!p.tool_name) break;
        if (QUESTION_TOOLS.has(p.tool_name)) {
          session.waiting.add(actor);
          out.push({ type: "agent_waiting", agentId: actor, need: "input", reason: summarize(p.tool_input) });
          break;
        }
        out.push({ type: "agent_tool", agentId: actor, tool: p.tool_name, summary: summarize(p.tool_input) });
        if (SUBAGENT_TOOLS.has(p.tool_name)) {
          const childId = `${main}/${p.tool_use_id ?? `sub-${++session.count}`}`;
          session.open.push({ id: childId, toolUseId: p.tool_use_id });
          const label = typeof p.tool_input?.subagent_type === "string" ? p.tool_input.subagent_type : summarize(p.tool_input);
          out.push({ type: "agent_spawn", agentId: childId, parentId: main, kind: p.agent_kind ?? "claude", label });
        }
        break;
      }
      case "PostToolUse":
      case "PostToolUseFailure":
        if (session.waiting.delete(actor) && p.tool_name) out.push({ type: "agent_tool", agentId: actor, tool: p.tool_name, summary: summarize(p.tool_input) });
        if (p.tool_name && SUBAGENT_TOOLS.has(p.tool_name)) {
          const i = session.open.findIndex((s) => s.toolUseId && s.toolUseId === p.tool_use_id);
          if (i >= 0) this.close(session, i, out);
        }
        break;
      case "SubagentStart": {
        if (!p.agent_id || session.open.some((s) => s.agentId === p.agent_id)) break;
        const announced = session.open.find((s) => !s.agentId);
        if (announced) announced.agentId = p.agent_id;
        else {
          const childId = `${main}/${p.agent_id}`;
          session.open.push({ id: childId, agentId: p.agent_id });
          out.push({ type: "agent_spawn", agentId: childId, parentId: main, kind: p.agent_kind ?? "claude", label: p.agent_type });
        }
        break;
      }
      case "SubagentStop": {
        const i = p.agent_id ? session.open.findIndex((s) => s.agentId === p.agent_id) : -1;
        this.close(session, i >= 0 ? i : session.open.length - 1, out);
        break;
      }
      case "PermissionRequest":
      case "Notification":
        session.waiting.add(actor);
        out.push({ type: "agent_waiting", agentId: actor, reason: p.message?.slice(0, 200), ...(p.notification_type === "idle_prompt" ? { need: "next_prompt" as const } : {}) });
        break;
      case "Stop":
      case "StopFailure":
        session.waiting.delete(main);
        out.push({ type: "agent_done", agentId: main });
        break;
      case "SessionEnd":
        out.push({ type: "agent_despawn", agentId: main });
        this.sessions.delete(main);
        break;
    }
    return out;
  }

  private ensure(main: string, p: HookPayload, out: AgentEvent[]): Session {
    let s = this.sessions.get(main);
    if (!s) {
      s = { open: [], count: 0, waiting: new Set() };
      this.sessions.set(main, s);
      if (p.hook_event_name !== "SessionEnd") {
        out.push({ type: "agent_spawn", agentId: main, kind: p.agent_kind ?? "claude", label: p.cwd?.split("/").pop() });
      }
    }
    return s;
  }

  private close(s: Session, index: number, out: AgentEvent[]): void {
    const sub = s.open[index];
    if (!sub) return;
    s.open.splice(index, 1);
    out.push({ type: "agent_done", agentId: sub.id }, { type: "agent_despawn", agentId: sub.id });
  }
}
