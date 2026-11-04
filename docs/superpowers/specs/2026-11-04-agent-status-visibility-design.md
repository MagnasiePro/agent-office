# Agent status visibility and usage gauges — design

Date: 2026-11-04

## Why

With several Claude Code sessions open, the scene does not answer the two questions the owner actually asks when glancing at it:

1. **Who is waiting for me?** Today a waiting agent only shows a small `!` / `?` bubble that gets lost in the scene.
2. **Who is really working?** A working agent looks almost like an idle one; nothing shows it is producing something.

The owner also wants to see Claude usage limits (5-hour window and weekly) without leaving the scene.

The repo is public: everything must work for any user, be configurable, and be in English (code, on-screen text, docs).

## Goals

- A waiting agent is impossible to miss, and "needs permission" reads differently from "waiting for your answer".
- A working agent visibly acts on the object in front of it, and its location tells what kind of work it does.
- A parent agent whose sub-agent is running goes for a coffee instead of standing at the whiteboard.
- 5h and weekly usage are drawn as two marker pies on the existing whiteboard.
- A neutral status line script feeds usage to the server; installing it does not break an existing status line.

## Non-goals

- No HUD, side panel, roster, counters or per-agent text labels (rejected in review: "too much content, too much text").
- No changes to idle / done behaviour beyond the small `?` on finished sessions (they stay as they are, which keeps the contrast with waiting/working agents).
- No usage numbers or reset countdowns on screen.

## Anti-goals

- Text overlays or UI chrome on top of the scene. Everything must look like part of the pixel-art world.
- Anything that slows down or blocks Claude Code (hooks and status line must fail silently when the server is down).
- Anything that overwrites a user's existing Claude Code configuration without a backup or a way back.

## Design

### 1. Waiting agents (owner's choice, from the mockup)

| State | Effect |
|---|---|
| `waiting` with `need: "permission"` | Red light beam rising from the floor + red floor ring pulsing fast (~1 s), big `!` bubble bobbing above the head |
| `waiting` with `need: "input"` | Same effect in blue, slower (~1.8 s), `?` bubble |

What counts as "waiting for your answer" (owner's choice: real questions only):

- Blue beacon only for real questions: `PreToolUse` of `AskUserQuestion` and `ExitPlanMode` become `agent_waiting` with `need: "input"` in `server/hook-adapter.ts` (not a station visit). The agent goes back to work on its next `PostToolUse` / tool / prompt, like a permission wait.
- A session that simply finished its turn (`Stop`, then the `idle_prompt` notification) is **not** a beacon: victory jump, coffee break as today, with only today's small `?` bubble above its head. `idle_prompt` therefore maps to `agent_waiting` with a new `need: "next_prompt"` value (small `?` only), not to the beacon.
- `ExitPlanMode` is removed from the whiteboard row below.

The bubble becomes larger than today's (it must read at screen-saver distance). Beam and ring are drawn in the existing pixel style (palette colours, dithering like the shadows in `src/scene/compose.ts`), not as smooth CSS-like gradients. The ring goes under the agent (with the shadows); the beam and bubble go over it.

### 2. Working agents: station by task (owner's request, mapping detail is my call)

| Tool(s) | Station | Visible activity |
|---|---|---|
| `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | own desk (PC) | Monitor flickers / scrolling code lines, small sparks |
| `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, **`WebSearch`, `WebFetch`, `mcp__*`** | library | Reading anim; a book glows / pages flutter |
| `Bash`, `BashOutput`, `KillShell` | server rack | Rack LEDs blink fast while the agent is there |
| `TodoWrite` | whiteboard | Writing anim |
| `Task`, `Agent` (parent while a sub-agent runs) | cafeteria | Coffee break with a cup until its sub-agents finish, then back to work on the next event |
| `SendMessage` | mailbox | unchanged |

Changes vs today (`shared/tool-stations.json`): web tools and MCP move from `window` to `library`; `Task`/`Agent` move from `whiteboard` to `cafe`. The `window` station stays available for user config but nothing maps to it by default.

Parent on a coffee break (my call): holds a cup with rising steam and the coffee machine steams while it stands there, so it reads differently from idle agents lounging nearby. A parent waiting on a sub-agent gets priority on coffee-bar slots; idle agents never take a slot already reserved and fall back to the lounge as today. Its state is `working` (it counts as busy for the camera), and it leaves the cafeteria on its own next event (usually the sub-agent's report-back).

Station activity effects run only while an agent is in `working` state at that station's slot, so a lit-up object always means "someone is working here".

### 3. Usage pies on the whiteboard (owner's choice: option A)

- Two pies drawn in marker style on the whiteboard: left = 5h window, right = 7 days, small `5h` / `7d` handwriting under them.
- Slice = percentage used. Colour: orange (5h) and blue (7d), switching to red at ≥ 90 %.
- No data yet / data older than its reset time → empty pie outlines.
- If the layout has several whiteboards, draw on the first one only.

### 4. Usage data source: neutral status line

Claude Code passes usage limits only to the status line command (JSON on stdin, `rate_limits.five_hour` / `rate_limits.seven_day` with `used_percentage` and `resets_at`; present for Claude.ai subscription accounts only). Hooks do not receive them.

- New script `scripts/statusline.mjs`: reads stdin, POSTs the usage part to `http://localhost:<port>/usage` with a short timeout (fire-and-forget, never blocks, never prints errors), and prints a minimal neutral status line (model name + current folder).
- New installer, same style as `scripts/claude-hooks.mjs` (`install [port]`, `uninstall`, `status`, timestamped backup of `~/.claude/settings.json`, `CLAUDE_SETTINGS` override):
  - No existing `statusLine` → install ours.
  - Existing `statusLine` → keep it: ours wraps it (forwards the same stdin to the previous command and prints its output instead of our neutral line). The previous command is stored inside our own command string (my call: e.g. base64 in an argument), so nothing extra lives in `settings.json` or a sidecar file, and `uninstall` restores it exactly. If the current `statusLine` is no longer ours, `uninstall` leaves it untouched and says so.
- Server: `POST /usage` validates the payload (zod, in `shared/events.ts`), stores the latest value, broadcasts a `usage` message over the WebSocket, and includes it in the snapshot sent to new clients.
- Mock modes (`?mock=…`) and the demo feed fake usage so the pies are visible without a real account.

### 5. Configuration and docs

- Tool → station mapping stays in `shared/tool-stations.json` (already user-editable).
- README "What you see" table and `docs/configuration.md` updated: new states look, new mapping, status line install/uninstall, `/usage` endpoint and payload, privacy note (only percentages and reset times leave the status line, to localhost).

## Constraints

- Pixel-art rendering through the existing bitmap pipeline (`Bitmap`, `paintMatrix`, palette in `src/art/palette.ts`), no smooth canvas effects.
- Performance: no measurable FPS drop on the 30-agent stress test (`pnpm perf`, `?mock=stress&n=30`).
- Tests: unit tests for the new mapping, the parent coffee behaviour, `/usage` validation and the status line installer (install over an existing status line, uninstall restores it). Visual test updated for the new waiting look.
- Everything in English.

## Left to the builder

- Exact pixel shapes, sizes and timings of beam, ring, sparks, LEDs, book glow, pies (keep them in the style of the mockup and existing art).
- Whether station activity is drawn in furniture frames or as an overlay layer.
- How the parent returns from the cafeteria (on the sub-agent's report-back or on its own next event).
