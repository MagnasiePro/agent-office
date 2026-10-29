# Configuration

Everything beyond the [quick start](../README.md#quick-start): commands, settings, the event API and how Claude Code hooks map to what you see.

- [Commands](#commands)
- [Settings](#settings)
- [Testing without a server](#testing-without-a-server)
- [Claude Code hooks](#claude-code-hooks)
- [Event API](#event-api)
- [Background server and screen saver](#background-server-and-screen-saver)

## Commands

| Command | Effect |
|---|---|
| `pnpm dev` | Development server on port 4317: scene, `/gallery`, `/events` WebSocket, `POST /hook`, `POST /events` |
| `pnpm build && pnpm start` | Production build, served from `dist/` |
| `pnpm sim` | Plays a scripted scenario against the server (`--random`, `--stress 30`, `--speed 2`) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:visual` | Browser tests (Playwright; run `npx playwright install chromium` once) |
| `pnpm typecheck` | TypeScript check |
| `pnpm perf` | Measures FPS and CPU over 5 minutes → `docs/qa/perf.json` |

## Settings

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4317` | Server port |
| `DEMO` | on | Built-in demo that stops at the first real event. `DEMO=0` turns it off |

```bash
DEMO=0 PORT=5000 pnpm dev
```

The background server takes the same variables: `DEMO=0 scripts/launchagent.sh install`.

> [!WARNING]
> The server has no authentication. Keep it on `localhost`; don't expose it to a network.

## Testing without a server

Add a query string to the page URL to run a local simulation:

| URL | Scenario |
|---|---|
| `/?mock=1` | Scripted scenario, then random |
| `/?mock=random` | Random |
| `/?mock=stress&n=30` | 30 agents at once |

Add `&speed=3` to speed things up.

## Claude Code hooks

`node scripts/claude-hooks.mjs install [port]` adds the hooks to `~/.claude/settings.json`. It is idempotent, merges with your existing hooks and writes a timestamped backup first. `status` and `uninstall` do what they say. Open sessions pick the hooks up on their next event.

What each hook does on screen (mapping in [`server/hook-adapter.ts`](../server/hook-adapter.ts)):

| Hook | On screen |
|---|---|
| `SessionStart`, `UserPromptSubmit` | The session appears at its desk; a new prompt also ends a wait |
| `PreToolUse` | The agent walks to the tool's workstation; `Task` / `Agent` spawns a sub-agent |
| `SubagentStart` | Links the sub-agent, so its own tool calls show on it |
| `PostToolUse` (Task), `SubagentStop` | The sub-agent reports back, then leaves |
| `PermissionRequest`, `Notification` | Red **!** bubble; a `Notification` of type `idle_prompt` shows a blue **?** |
| `Stop` | Victory jump, then a coffee break |
| `SessionEnd` | The session leaves |

The install script also registers `PostToolUseFailure` and `StopFailure`.

<details>
<summary>Manual setup (minimal hooks)</summary>

Add this to `~/.claude/settings.json`. It covers every Claude Code session, in the terminal and in the desktop app.

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "PostToolUse":      [{ "matcher": "Task|Agent", "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://localhost:4317/hook -H 'content-type: application/json' --data-binary @- >/dev/null || true" }] }]
  }
}
```

Each hook receives the event JSON on stdin and `curl --data-binary @-` forwards it as is. `-m 1` and `|| true` make sure a stopped server never slows down or blocks Claude Code.

</details>

Good to know:

- Tool calls made inside a sub-agent are shown on the sub-agent thanks to the `agent_id` received at `SubagentStart`. Without it, they show on the session's agent.
- Claude Desktop chats have no hooks: only Claude Code sessions appear, including the ones run from the desktop app.

## Event API

Any tool can drive the office, not only Claude Code: send `AgentEvent`s to `POST /events`, one or an array. The server answers `202`, or `400` if the event is invalid.

```ts
type AgentEvent =
  | { type: "agent_spawn"; agentId: string; parentId?: string; kind: AgentKind; label?: string }
  | { type: "agent_tool"; agentId: string; tool: string; summary?: string }
  | { type: "agent_waiting"; agentId: string; reason?: string; need?: "permission" | "input" }
  | { type: "agent_done"; agentId: string }
  | { type: "agent_despawn"; agentId: string };
```

```bash
curl -X POST localhost:4317/events -H 'content-type: application/json' \
  -d '{"type":"agent_spawn","agentId":"demo","kind":"claude"}'
curl -X POST localhost:4317/events -H 'content-type: application/json' \
  -d '{"type":"agent_tool","agentId":"demo","tool":"Bash","summary":"pnpm test"}'
```

- `need`: `"permission"` (default, red **!**) or `"input"` (blue **?**, waiting for your next message).
- `kind`: `"claude"`, or `"robot"` for the demo character. Any other value gets the default character.
- An event for an unknown agent creates it (`agent_tool`, `agent_waiting`) or is ignored (`agent_done`, `agent_despawn`). A repeated `agent_done` does nothing. Sub-agents leave with their parent.
- The screen listens on the WebSocket `ws://host/events`. It first receives `{ "type": "snapshot", "agents": [...] }` to catch up after a (re)connection, then each `AgentEvent`. It reconnects on its own (1 s, backing off to 10 s).

The schema lives in [`shared/events.ts`](../shared/events.ts).

## Background server and screen saver

`scripts/launchagent.sh install` installs a LaunchAgent (`com.agent-office.server`) that starts the server at login and restarts it if it stops. Logs: `~/Library/Logs/agent-office.log`. Also `status` and `uninstall`. Run `install` again after updating the code; if `bootstrap` fails right after `bootout`, run it once more.

The screen saver only displays `http://localhost:4317/` in a web view, so a `pnpm build` is picked up without rebuilding it. After rebuilding the screen saver itself, run `killall legacyScreenSaver ScreenSaverEngine`. Variants, internals and limitations: [`saver/README.md`](../saver/README.md).
