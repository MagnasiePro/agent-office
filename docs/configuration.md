# Configuration

Everything beyond the [quick start](../README.md#quick-start): commands, settings, the event API and how Claude Code hooks map to what you see.

- [Commands](#commands)
- [Settings](#settings)
- [Testing without a server](#testing-without-a-server)
- [Claude Code hooks](#claude-code-hooks)
- [Status line (usage pies)](#status-line-usage-pies)
- [Event API](#event-api)
- [Background server and screen saver](#background-server-and-screen-saver)
- [Updates](#updates)

## Commands

| Command | Effect |
|---|---|
| `pnpm dev` | Development server on port 4317: scene, `/gallery`, `/events` WebSocket, `POST /hook`, `POST /events`, `POST /usage` |
| `pnpm build && pnpm start` | Production build, served from `dist/` |
| `pnpm sim` | Plays a scripted scenario against the server (`--random`, `--stress 30`, `--speed 2`) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:visual` | Browser tests (Playwright; run `npx playwright install chromium` once) |
| `pnpm typecheck` | TypeScript check |
| `pnpm perf` | Measures FPS and CPU over 5 minutes → `docs/qa/perf.json` |
| `node scripts/update.mjs check` | Current version and latest release ([Updates](#updates)) |
| `node scripts/update.mjs apply` | Update this checkout to the latest release, after confirmation |

## Settings

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4317` | Server port |
| `DEMO` | on | Built-in demo that stops at the first real event. `DEMO=0` turns it off |
| `UPDATE_CHECK` | on | Daily look for a new release on GitHub ([Updates](#updates)). `UPDATE_CHECK=0` turns it off: no network request, no notice |

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
| `PreToolUse` | The agent walks to the tool's workstation (table below); `Task` / `Agent` spawns a sub-agent and its parent goes for a coffee |
| `PreToolUse` (`AskUserQuestion`, `ExitPlanMode`) | Blue beacon and **?**: Claude is asking you something; it goes back to work on its next tool or prompt |
| `SubagentStart` | Links the sub-agent, so its own tool calls show on it |
| `PostToolUse` (Task), `SubagentStop` | The sub-agent reports back, then leaves |
| `PermissionRequest`, `Notification` | Red beacon and **!**; a `Notification` of type `idle_prompt` only adds a small **?** on a finished session, no beacon |
| `Stop` | Victory jump, then a coffee break |
| `SessionEnd` | The session leaves |

The install script also registers `PostToolUseFailure` and `StopFailure`.

Tool to workstation (editable in [`shared/tool-stations.json`](../shared/tool-stations.json)); the station lights up while the agent works there:

| Tools | Workstation | Effect |
|---|---|---|
| `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | Desk | Monitor flashes |
| `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, `WebSearch`, `WebFetch`, `mcp__*` | Library | Open glowing book |
| `Bash`, `BashOutput`, `KillShell` | Server rack | Progress bar runs |
| `TodoWrite` | Whiteboard | Marker writes |
| `Task`, `Agent` | Cafeteria bar | Parent takes a coffee (mug and steam) while its sub-agent works |
| `SendMessage` | Mailbox | — |
| Any other tool | Desk | Monitor flashes |

## Git hook (mail truck)

`node scripts/git-hooks.mjs install [port]` adds two global git hooks (config-based, so git 2.54 or newer is required) that run next to your repo hooks, never instead of them. `status` and `uninstall` do what they say; uninstall removes exactly what install added and honours `GIT_CONFIG_GLOBAL`. The hook always exits 0 and posts in the background, so it never slows or blocks git.

How it detects a push or a pull:

- A `pre-push` hook records which remote-tracking refs the push will move, and to which commit, in a marker file `agent-office-push` inside the repo's git directory (shared by its worktrees).
- A `reference-transaction` hook sees the committed `refs/remotes/*` update. If it matches the marker, it is a push (one event per push); any other update of a remote-tracking ref is a pull. That includes IDE auto-fetch, and `git fetch --all` sends one pull (one truck) per remote that moved.

Not detected or misreported (see the header of [`scripts/git-hook.sh`](../scripts/git-hook.sh)): failed pushes and "Already up to date" pulls send nothing; tag-only pushes and pushes to a raw URL are not detected; `git push --no-verify` and non-default fetch refspecs are reported as a pull.

On screen the truck drives up, the agent posts a letter (push) or collects one (pull), and the truck leaves. An agent showing a waiting beacon finishes its wait first; a wait that starts mid-errand interrupts it (a letter in hand is posted anyway). A sub-agent that ends right after a push still gets its letter posted.

Remote-only GitHub MCP tools (no local git involved) count as a push on `PostToolUse`: the tool names ending with a suffix of `mail.push` in [`shared/tool-stations.json`](../shared/tool-stations.json) (`__push_files`, `__create_or_update_file`, `__delete_file` by default; `mail.pull` is empty).

The hook sends `POST /git` with `{"repo": "/path/to/repo", "direction": "push" | "pull"}`. The server answers `202`, or `400` with `{"error":"invalid JSON"}` or `{"error":"invalid git event"}`. It picks a session working in the repo or below it before one in a parent folder, then the closest working directory, then the most recently active, and the mail goes to the agent (or sub-agent) behind the session's latest hook event. Privacy: only the repo path leaves git, and only to localhost.

```bash
curl -X POST localhost:4317/git -H 'content-type: application/json' \
  -d '{"repo":"/path/to/repo","direction":"push"}'
```

## Status line (usage pies)

`node scripts/statusline.mjs install [port]` registers a Claude Code status line that sends your usage to the server, so the whiteboard shows two pies: 5-hour window (left) and 7 days (right), red from 90 %. They are empty until data arrives or once a window has reset. `status` and `uninstall` do what they say.

- It edits `~/.claude/settings.json` (`CLAUDE_SETTINGS` overrides the path), is idempotent and writes a timestamped backup first.
- An existing status line keeps working: ours wraps it, passes it the same input and prints its output. `uninstall` restores it exactly. Without one, a minimal line (model and folder) is shown.
- Privacy: only the two percentages and their reset times are sent, to `localhost`, with a 500 ms timeout. Failures are silent.
- Claude Code only provides usage to Claude.ai Pro and Max subscribers. Without a subscription the pies stay empty.
- The demo shows fake usage until the first real agent event.

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
  | { type: "agent_waiting"; agentId: string; reason?: string; need?: "permission" | "input" | "next_prompt" }
  | { type: "agent_done"; agentId: string }
  | { type: "agent_despawn"; agentId: string }
  | { type: "agent_mail"; agentId: string; direction: "push" | "pull" };
```

```bash
curl -X POST localhost:4317/events -H 'content-type: application/json' \
  -d '{"type":"agent_spawn","agentId":"demo","kind":"claude"}'
curl -X POST localhost:4317/events -H 'content-type: application/json' \
  -d '{"type":"agent_tool","agentId":"demo","tool":"Bash","summary":"pnpm test"}'
```

Usage goes to `POST /usage` (it does not stop the demo):

```bash
curl -X POST localhost:4317/usage -H 'content-type: application/json' \
  -d '{"fiveHour":{"usedPercentage":62,"resetsAt":1790000000},"sevenDay":{"usedPercentage":34,"resetsAt":1790400000}}'
```

Each window is optional but at least one is required: `usedPercentage` is 0 to 100, `resetsAt` is epoch seconds. The server answers `202`, or `400` `{"error":"invalid usage"}`.

- `agent_mail` is transient: it plays the mail truck visit and is not replayed in the snapshot. `POST /git` sends it for you (see [Git hook](#git-hook-mail-truck)).
- `need`: `"permission"` (default, red beacon and **!**), `"input"` (blue beacon and **?**, a real question) or `"next_prompt"` (small **?** only, a finished session waiting for your next message).
- `kind`: `"claude"`, or `"robot"` for the demo character. Any other value gets the default character.
- An event for an unknown agent creates it (`agent_tool`, `agent_waiting`) or is ignored (`agent_done`, `agent_despawn`). A repeated `agent_done` does nothing. Sub-agents leave with their parent.
- The screen listens on the WebSocket `ws://host/events`. It first receives `{ "type": "snapshot", "agents": [...], "usage"? }` to catch up after a (re)connection, and the latest `usage` if known, then each `AgentEvent` and `{ "type": "usage", "fiveHour"?, "sevenDay"? }` message. It reconnects on its own (1 s, backing off to 10 s).

The schema lives in [`shared/events.ts`](../shared/events.ts).

## Background server and screen saver

`scripts/launchagent.sh install` installs a LaunchAgent (`com.agent-office.server`) that starts the server at login and restarts it if it stops. Logs: `~/Library/Logs/agent-office.log`. Also `status`, `restart` (keeps its settings) and `uninstall`. Run `install` again to change `PORT`, `DEMO` or `UPDATE_CHECK`; if `bootstrap` fails right after `bootout`, run it once more.

The screen saver only displays `http://localhost:4317/` in a web view, so a `pnpm build` is picked up without rebuilding it. After rebuilding the screen saver itself, run `killall legacyScreenSaver ScreenSaverEngine`. Variants, internals and limitations: [`saver/README.md`](../saver/README.md).

## Updates

Agent Office offers updates; it never installs them on its own.

**What counts as an update.** A GitHub release tagged `vX.Y.Z`, newer than `version` in your `package.json`. Commits on `main` between releases are not offered.

**How you hear about it.** The server checks the [latest release](https://github.com/MagnasiePro/agent-office/releases/latest) at startup and every 24 hours. When one is newer, it logs `update available: v0.1.0 → v0.2.0`, reports it in `GET /health` (`update: { current, latest, available, url }`), and the screen shows a narrow column on the right edge, beside the scene, with the new version. No update, no column. Offline or rate-limited by GitHub: nothing happens, it tries again later. `UPDATE_CHECK=0` turns the check off.

**Applying it.** In your clone:

```bash
node scripts/update.mjs apply
```

It shows what it will do and asks for confirmation (`--yes` skips the question), then runs `git merge --ff-only vX.Y.Z`, `pnpm install --frozen-lockfile` and `pnpm build`, and restarts the background server if it runs from this folder (`scripts/launchagent.sh restart`, which keeps your settings). It refuses, without changing anything, when:

- you are not on `main` (a feature branch or a detached HEAD);
- you have uncommitted changes (it never stashes or resets your work);
- your `main` has local commits, so it cannot fast-forward;
- the folder is not a git clone (download the release instead).

Before changing anything it prints the commit you are on and the exact command to go back. If the release changed the screen saver, it reminds you to rebuild it with `saver/legacy/build.sh`.
