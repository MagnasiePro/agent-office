import { z } from "zod";

/**
 * Event contract between event producers (Claude Code hooks, simulator) and the renderer.
 * Single source of truth, validated on both ends.
 */

/** Agent type. Known values today: "claude" (and the demo "robot"); any string is accepted and falls back to the default character. */
export const AgentKindSchema = z.string().min(1).max(64);
export type AgentKind = z.infer<typeof AgentKindSchema>;
export const KNOWN_KINDS = ["claude", "robot"] as const;

const id = z.string().min(1).max(200);
const text = z.string().max(500).optional();

export const AgentSpawnSchema = z.object({
  type: z.literal("agent_spawn"),
  agentId: id,
  parentId: id.optional(),
  kind: AgentKindSchema,
  label: text,
});
export const AgentToolSchema = z.object({ type: z.literal("agent_tool"), agentId: id, tool: z.string().min(1).max(200), summary: text });
/** `need`: "permission" (default, red "!") = blocked on an approval; "input" (blue beacon) = a real question; "next_prompt" (small "?") = turn finished, waiting for the next prompt. */
export const AgentWaitingSchema = z.object({ type: z.literal("agent_waiting"), agentId: id, reason: text, need: z.enum(["permission", "input", "next_prompt"]).optional() });
export const AgentDoneSchema = z.object({ type: z.literal("agent_done"), agentId: id });
export const AgentDespawnSchema = z.object({ type: z.literal("agent_despawn"), agentId: id });

export const AgentEventSchema = z.discriminatedUnion("type", [AgentSpawnSchema, AgentToolSchema, AgentWaitingSchema, AgentDoneSchema, AgentDespawnSchema]);

export type AgentSpawnEvent = z.infer<typeof AgentSpawnSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Rate-limit usage windows as Claude Code reports them; `resetsAt` is Unix epoch seconds. Both windows absent = no data. */
export const UsageWindowSchema = z.object({ usedPercentage: z.number().min(0).max(100), resetsAt: z.number().int().positive() });
export type UsageWindow = z.infer<typeof UsageWindowSchema>;
export const UsageSchema = z.object({ type: z.literal("usage"), fiveHour: UsageWindowSchema.optional(), sevenDay: UsageWindowSchema.optional() });
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Sent by the server to each new WebSocket client: the agents currently alive, each as its
 * spawn event plus its latest state event, so a (re)connecting screen catches up.
 */
export const SnapshotSchema = z.object({
  type: z.literal("snapshot"),
  agents: z.array(z.object({ spawn: AgentSpawnSchema, last: AgentEventSchema.optional() })),
  usage: UsageSchema.optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ServerMessageSchema = z.union([AgentEventSchema, SnapshotSchema, UsageSchema]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function parseEvent(raw: unknown): AgentEvent | null {
  const r = AgentEventSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  const r = ServerMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseUsage(raw: unknown): Usage | null {
  const r = UsageSchema.safeParse(raw);
  return r.success ? r.data : null;
}
