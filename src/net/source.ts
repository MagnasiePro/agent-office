import { parseServerMessage, type AgentEvent, type Snapshot, type Usage } from "../../shared/events";
import { play, randomScenario, scriptedScenario, stressScenario } from "../../shared/scenario";

export interface EventSink {
  event(e: AgentEvent): void;
  snapshot(s: Snapshot): void;
  usage?(u: Usage): void;
  status?(s: "connecting" | "open" | "closed"): void;
}

/** WebSocket client with exponential back-off reconnection (1 s → 10 s). Returns a stop function. */
export function connectWs(url: string, sink: EventSink): () => void {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (stopped) return;
    sink.status?.("connecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      delay = 1000;
      sink.status?.("open");
    };
    ws.onmessage = (m) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(m.data));
      } catch {
        return;
      }
      const msg = parseServerMessage(raw);
      if (!msg) return console.warn("[agent-office] ignored invalid message", raw);
      if (msg.type === "snapshot") {
        sink.snapshot(msg);
        if (msg.usage) sink.usage?.(msg.usage);
      } else if (msg.type === "usage") sink.usage?.(msg);
      else sink.event(msg);
    };
    ws.onclose = () => {
      sink.status?.("closed");
      if (stopped) return;
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}

/**
 * In-browser simulator for `?mock=…` (no server needed):
 *   mock=1 / scripted → scripted session then random sessions forever
 *   mock=random       → random sessions
 *   mock=stress&n=30  → one parent with n busy sub-agents
 */
export function startMock(mode: string, sink: EventSink, params: URLSearchParams): () => void {
  const speed = Number(params.get("speed") ?? 1);
  const emit = (e: AgentEvent) => sink.event(e);
  const now = Math.floor(Date.now() / 1000);
  sink.usage?.({ type: "usage", fiveHour: { usedPercentage: 62, resetsAt: now + 2 * 3600 }, sevenDay: { usedPercentage: 34, resetsAt: now + 3 * 86400 } });
  if (mode === "stress") return play(stressScenario(Number(params.get("n") ?? 30)), emit, { speed });
  if (mode === "random") return play(randomScenario(Math.random, ["claude", "claude", "robot"]), emit, { speed });
  let stopRandom: (() => void) | undefined;
  const stopScripted = play(scriptedScenario("main"), emit, { speed });
  const t = setTimeout(() => (stopRandom = play(randomScenario(Math.random, ["claude", "claude", "robot"]), emit, { speed })), 72_000 / speed);
  return () => {
    stopScripted();
    clearTimeout(t);
    stopRandom?.();
  };
}
