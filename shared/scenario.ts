import type { AgentEvent } from "./events";

/** An event scheduled `at` seconds after the scenario starts. */
export interface TimedEvent {
  at: number;
  event: AgentEvent;
}

/**
 * Scripted, realistic session: the main agent reads, edits, runs bash, fans out three
 * sub-agents in parallel, asks for a permission, then finishes.
 */
export function scriptedScenario(main = "main"): TimedEvent[] {
  const s1 = `${main}/explore-1`;
  const s2 = `${main}/explore-2`;
  const s3 = `${main}/research`;
  const ev: [number, AgentEvent][] = [
    [0, { type: "agent_spawn", agentId: main, kind: "claude", label: "Claude" }],
    [1.5, { type: "agent_tool", agentId: main, tool: "Read", summary: "src/app.ts" }],
    [3, { type: "agent_mail", agentId: main, direction: "pull" }],
    [5, { type: "agent_tool", agentId: main, tool: "Grep", summary: "TODO" }],
    [8.5, { type: "agent_tool", agentId: main, tool: "Edit", summary: "src/app.ts" }],
    [13, { type: "agent_tool", agentId: main, tool: "Bash", summary: "pnpm test" }],
    [15, { type: "agent_mail", agentId: main, direction: "push" }],
    [18, { type: "agent_tool", agentId: main, tool: "Task", summary: "Explore the codebase" }],
    [18.6, { type: "agent_spawn", agentId: s1, parentId: main, kind: "claude", label: "Explore" }],
    [19.0, { type: "agent_spawn", agentId: s2, parentId: main, kind: "claude", label: "Explore" }],
    [19.4, { type: "agent_spawn", agentId: s3, parentId: main, kind: "claude", label: "Research" }],
    [20.2, { type: "agent_tool", agentId: s1, tool: "Glob", summary: "**/*.ts" }],
    [20.6, { type: "agent_tool", agentId: s2, tool: "Grep", summary: "createServer" }],
    [21.0, { type: "agent_tool", agentId: s3, tool: "WebSearch", summary: "pixel art isometric" }],
    [25, { type: "agent_tool", agentId: s1, tool: "Read", summary: "server/index.ts" }],
    [26, { type: "agent_tool", agentId: s2, tool: "Bash", summary: "git log" }],
    [27, { type: "agent_tool", agentId: s3, tool: "WebFetch", summary: "docs" }],
    [31, { type: "agent_done", agentId: s1 }],
    [32.5, { type: "agent_despawn", agentId: s1 }],
    [33, { type: "agent_tool", agentId: s2, tool: "Read", summary: "README.md" }],
    [35, { type: "agent_done", agentId: s3 }],
    [36.5, { type: "agent_despawn", agentId: s3 }],
    [38, { type: "agent_done", agentId: s2 }],
    [39.5, { type: "agent_despawn", agentId: s2 }],
    [41, { type: "agent_waiting", agentId: main, reason: "Allow Bash: rm -rf dist?" }],
    [47, { type: "agent_tool", agentId: main, tool: "Bash", summary: "rm -rf dist && pnpm build" }],
    [51, { type: "agent_tool", agentId: main, tool: "Write", summary: "CHANGELOG.md" }],
    [55, { type: "agent_tool", agentId: main, tool: "SendMessage", summary: "Report" }],
    [58, { type: "agent_done", agentId: main }],
    [70, { type: "agent_despawn", agentId: main }],
  ];
  return ev.map(([at, event]) => ({ at, event }));
}

const TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "TodoWrite", "Read", "Edit", "Bash"];

/**
 * Endless random sessions. Pure generator driven by an injected rng so it is reproducible in tests.
 * Each session: one main agent doing tool calls, sometimes fanning out 1–3 sub-agents.
 */
export function* randomScenario(rng: () => number = Math.random, kinds: readonly string[] = ["claude"]): Generator<TimedEvent> {
  let t = 0;
  let session = 0;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
  while (true) {
    const main = `rnd-${session++}`;
    yield { at: t, event: { type: "agent_spawn", agentId: main, kind: pick(kinds) } };
    const steps = 4 + Math.floor(rng() * 6);
    const mailStep = Math.floor(rng() * steps);
    const direction = rng() < 0.5 ? "push" : "pull";
    for (let i = 0; i < steps; i++) {
      t += 2.5 + rng() * 4;
      if (i === mailStep) yield { at: t, event: { type: "agent_mail", agentId: main, direction } };
      const r = rng();
      if (r < 0.15) {
        yield { at: t, event: { type: "agent_waiting", agentId: main, reason: "permission" } };
        t += 3 + rng() * 3;
        yield { at: t, event: { type: "agent_tool", agentId: main, tool: "Bash" } };
      } else if (r < 0.3) {
        yield { at: t, event: { type: "agent_tool", agentId: main, tool: "Task" } };
        const n = 1 + Math.floor(rng() * 3);
        const subs = Array.from({ length: n }, (_, k) => `${main}/sub-${i}-${k}`);
        let st = t;
        for (const s of subs) {
          st += 0.4;
          yield { at: st, event: { type: "agent_spawn", agentId: s, parentId: main, kind: "claude" } };
        }
        // Sub-agent work is interleaved by sorting at the end of this block.
        const block: TimedEvent[] = [];
        for (const s of subs) {
          let ct = st + 0.8;
          for (let j = 0, m = 2 + Math.floor(rng() * 3); j < m; j++) {
            block.push({ at: ct, event: { type: "agent_tool", agentId: s, tool: pick(TOOLS) } });
            ct += 3 + rng() * 4;
          }
          block.push({ at: ct, event: { type: "agent_done", agentId: s } });
          block.push({ at: ct + 1.5, event: { type: "agent_despawn", agentId: s } });
        }
        block.sort((a, b) => a.at - b.at);
        yield* block;
        t = Math.max(t, block[block.length - 1]?.at ?? t) + 1;
      } else {
        yield { at: t, event: { type: "agent_tool", agentId: main, tool: pick(TOOLS) } };
      }
    }
    t += 3;
    yield { at: t, event: { type: "agent_done", agentId: main } };
    t += 6 + rng() * 6;
    yield { at: t, event: { type: "agent_despawn", agentId: main } };
    t += 2;
  }
}

/** Stress: one parent and `n` sub-agents all busy at once, forever. */
export function* stressScenario(n: number, rng: () => number = Math.random): Generator<TimedEvent> {
  yield { at: 0, event: { type: "agent_spawn", agentId: "boss", kind: "claude" } };
  for (let i = 0; i < n; i++) yield { at: 0.5 + i * 0.1, event: { type: "agent_spawn", agentId: `w${i}`, parentId: "boss", kind: i % 4 === 3 ? "robot" : "claude" } };
  let t = 2;
  while (true) {
    const i = Math.floor(rng() * n);
    yield { at: t, event: { type: "agent_tool", agentId: rng() < 0.1 ? "boss" : `w${i}`, tool: TOOLS[Math.floor(rng() * TOOLS.length)]! } };
    t += 0.3 + rng() * 0.6;
  }
}

/**
 * Plays timed events with real timers. `loop` restarts the scripted list (with fresh ids).
 * Returns a stop function.
 */
export function play(source: Iterable<TimedEvent> | (() => Iterable<TimedEvent>), emit: (e: AgentEvent) => void, opts: { loop?: boolean; speed?: number } = {}): () => void {
  const speed = opts.speed ?? 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = () => {
    const it = (typeof source === "function" ? source() : source)[Symbol.iterator]();
    const start = Date.now();
    const step = () => {
      if (stopped) return;
      const n = it.next();
      if (n.done) {
        if (opts.loop) timer = setTimeout(run, 4000 / speed);
        return;
      }
      const wait = Math.max(0, start + (n.value.at * 1000) / speed - Date.now());
      timer = setTimeout(() => {
        emit(n.value.event);
        step();
      }, wait);
    };
    step();
  };
  run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
