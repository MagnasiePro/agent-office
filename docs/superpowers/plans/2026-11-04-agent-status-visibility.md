# Agent Status Visibility and Usage Gauges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make waiting and working agents readable at a glance, move agents to task-appropriate places (coffee while a sub-agent runs), and draw 5h / 7d Claude usage as two pies on the whiteboard, fed by an opt-in status line script.

**Architecture:** The hook adapter turns real questions (`AskUserQuestion`, `ExitPlanMode`) into `agent_waiting {need:"input"}`. `Office` keeps two new per-agent facts (`station`, `awaitingPrompt`) that overlay painters in `Ambient` read. Beacons, station effects and pies are all overlay drawing in world space with palette colours, no new sprites pipeline. Usage travels as a new `usage` server message: status line script → `POST /usage` → server memory → WebSocket + snapshot → `main.ts` → `Ambient.drawUsage`.

**Tech Stack:** TypeScript, zod 4, Canvas 2D (pixel overlay), Node `http` + `ws`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-status-visibility-design.md`

## Global Constraints

- Everything in English: code, comments, on-screen text, docs, commit messages.
- Pixel-art only: every overlay pixel uses a colour from `SCENE_WARM` (`src/art/palette.ts`); integer coordinates, `fillRect` of whole pixels, no gradients, no `globalAlpha` blending (dither with `bayer()` instead). The visual test "scene palette only" must stay green.
- No HUD, panel, counters or per-agent text labels. The only text in the scene is the `5h` / `7d` handwriting on the whiteboard.
- Hooks and the status line never block or slow Claude Code: network calls time out at 500 ms and fail silently.
- Installers never lose user config: timestamped backup before writing, `CLAUDE_SETTINGS` env override, exact restore on uninstall.
- No new dependencies.
- Perf: `?mock=stress&n=30` must keep its current FPS (`pnpm perf`).

## Review Focus

1. **Status line installed over an existing one, then uninstalled** → the user's previous `statusLine` object comes back byte-identical (command, padding, refreshInterval). Pinned in Task 4.
2. **Server down while the status line runs** → the previous / neutral line still prints, exit code 0, under 1 s. Pinned in Task 4.
3. **Usage window past its `resetsAt`** (laptop asleep over the reset) → pie drawn empty, not stale-full. Pinned in Task 7 (`pieFraction`).
4. **A turn that starts directly with `AskUserQuestion`** (agent still idle from the previous turn, or replayed from a snapshot) → blue beacon, not the small `?`. Pinned in Task 2.
5. **Malformed or out-of-range usage** (`usedPercentage` 140, string, missing body) → `400`, last good value kept. Pinned in Task 3.

---

### Task 1: Event contract, tool mapping, hook adapter

**Files:**
- Modify: `shared/events.ts`
- Modify: `shared/tool-stations.json`
- Modify: `server/hook-adapter.ts`
- Test: `tests/unit/events.test.ts`

**Interfaces:**
- Produces (in `shared/events.ts`):
  - `UsageWindowSchema = z.object({ usedPercentage: z.number().min(0).max(100), resetsAt: z.number().int().positive() })` — `resetsAt` is Unix epoch **seconds** (as Claude Code sends it).
  - `UsageSchema = z.object({ type: z.literal("usage"), fiveHour: UsageWindowSchema.optional(), sevenDay: UsageWindowSchema.optional() })`, `export type Usage`.
  - `parseUsage(raw: unknown): Usage | null`.
  - `AgentWaitingSchema.need` becomes `z.enum(["permission", "input", "next_prompt"]).optional()`: `input` = a real question (blue beacon), `next_prompt` = turn finished, waiting for the next prompt (small `?`).
  - `SnapshotSchema` gains `usage: UsageSchema.optional()`.
  - `ServerMessageSchema = z.union([AgentEventSchema, SnapshotSchema, UsageSchema])`.
- Produces (mapping): station type `"coffee"`; `Task`/`Agent` → `coffee`; `WebFetch`/`WebSearch` and prefix `mcp__` → `library`; `ExitPlanMode` removed from `tools`; `animations.coffee = "idle"`.
- Produces (adapter): `const QUESTION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"])`. On `PreToolUse` of one of them: emit `{type:"agent_waiting", agentId: actor, need:"input", reason: summarize(tool_input)}` **instead of** `agent_tool`, and add `actor` to `session.waiting` (so the existing `PostToolUse` branch resumes it). `Notification` with `notification_type === "idle_prompt"` now emits `need: "next_prompt"` (was `"input"`).

- [ ] **Step 1: Write the failing tests** in `tests/unit/events.test.ts`
  - `"parses usage messages and rejects out-of-range values"`: `parseServerMessage({type:"usage", fiveHour:{usedPercentage:62, resetsAt:1762300000}})` is truthy; `parseUsage({type:"usage", fiveHour:{usedPercentage:140, resetsAt:1}})` is `null`; `parseUsage({type:"usage", sevenDay:{usedPercentage:"5", resetsAt:1}})` is `null`; `parseUsage({type:"usage"})` is truthy (both windows absent = "no data").
  - In `"tool → station mapping"`: `stationForTool("WebSearch") === "library"`, `stationForTool("mcp__github__x") === "library"`, `stationForTool("Task") === "coffee"`, `stationForTool("Agent") === "coffee"`, `stationForTool("ExitPlanMode") === "desk"` (falls to default; it never reaches a station anyway), `animationForStation("coffee") === "idle"`.
  - `"maps idle_prompt to next_prompt"`: `Notification {notification_type:"idle_prompt", session_id:"s"}` → contains `{type:"agent_waiting", agentId:"s", need:"next_prompt"}`.
  - `"turns AskUserQuestion and ExitPlanMode into an input wait, resumed by PostToolUse"`: feed `PreToolUse {tool_name:"AskUserQuestion", session_id:"s"}` → events contain `{type:"agent_waiting", agentId:"s", need:"input"}` and no `agent_tool`; then `PostToolUse {tool_name:"AskUserQuestion", session_id:"s"}` → contains `{type:"agent_tool", agentId:"s", tool:"AskUserQuestion"}`.

- [ ] **Step 2: Run** `pnpm test tests/unit/events.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the schema, mapping and adapter changes listed in Interfaces. Update the adapter's doc table (`PreToolUse` row: "AskUserQuestion / ExitPlanMode → agent_waiting need input").

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — Expected: all PASS. (Office tests may now fail where they rely on `Task` → whiteboard; fix them in Task 2, or adjust here if trivial.)

- [ ] **Step 5: Commit** — `feat(events): usage message, question tools wait for input, web/MCP to library, Task to coffee`

---

### Task 2: Office behaviour — coffee bar, finished sessions, station facts

**Files:**
- Modify: `src/world/layout.ts` (StationType, cafeteria stations)
- Modify: `src/engine/agent.ts` (two public fields)
- Modify: `src/scene/office.ts`
- Test: `tests/unit/office.test.ts`

**Interfaces:**
- Consumes: mapping from Task 1 (`Task` → `"coffee"`).
- Produces:
  - `StationType` gains `"coffee"`. In `layout.ts`, slots `(1,10,"NE")` and `(2,10,"NE")` move out of station `"cafe"` into `station("coffee-bar", "coffee", "cafe", …)`. Idle preferences never name `"coffee"`, so idle agents can't take those slots: that is the "working parent has priority" rule, no eviction logic.
  - `Agent.station: string | null` — station type the agent is working at; set on arrival in `goToStation`, cleared to `null` whenever the agent leaves `working` (`release()` is the single place to clear it).
  - `Agent.awaitingPrompt: boolean` — true while a finished session waits for its next prompt; cleared on any `agent_tool` / `agent_waiting(permission)` / `agent_despawn`.
  - `agent_waiting` with `need === "next_prompt"`: set `a.awaitingPrompt = true`, change nothing else (no state, anim or position change; `m.finished` untouched). `need === "input"` always gives the beacon wait (state `waiting`, anim `waiting_input`), whatever the agent was doing.

- [ ] **Step 1: Write the failing tests** in `tests/unit/office.test.ts`
  - `"a parent waiting on a sub-agent takes a coffee at the bar"`: spawn `p`, run 1, `agent_tool p Task`, run 20 → `agent("p").state === "working"`, `agent("p").station === "coffee"`, tile is in `slotOf("coffee")`.
  - `"idle agents never take the coffee-bar slots"`: spawn 6 agents, run 120 s with no tools → no agent stands on a `slotOf("coffee")` tile.
  - `"a finished session awaiting its next prompt keeps its coffee break, with no beacon"`: spawn, run 1, `agent_tool Edit`, run 15, `agent_done`, run 5, `agent_waiting need:"next_prompt"`, run 2 → `state !== "waiting"`, `awaitingPrompt === true`; then `agent_tool Read`, run 1 → `awaitingPrompt === false`.
  - `"a real question on an idle agent still gets the beacon"`: spawn, run 3 (idle), `agent_waiting need:"input"`, run 2 → `state === "waiting"`, anim `waiting_input`, `awaitingPrompt === false`.
  - `"station is set while working and cleared when leaving"`: `agent_tool Bash`, run 15 → `station === "terminal"`; `agent_waiting` (permission), run 2 → `station === null`.
  - Rename the existing `"shows a question-mark wait for idle_prompt…"` test to `"shows an input wait for a real question and resumes on the next tool"` (body unchanged).

- [ ] **Step 2: Run** `pnpm test tests/unit/office.test.ts` — Expected: new tests FAIL.

- [ ] **Step 3: Implement** the layout, agent fields and `Office.apply` / `goToStation` / `release` changes from Interfaces.

- [ ] **Step 4: Run** `pnpm test` — Expected: all PASS, including the 30-sub-agent no-overlap test.

- [ ] **Step 5: Commit** — `feat(office): coffee bar for parents waiting on sub-agents, finished sessions keep their break`

---

### Task 3: Server usage endpoint and client plumbing

**Files:**
- Modify: `server/index.ts`
- Modify: `server/tracker.ts`
- Modify: `src/net/source.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/events.test.ts` (tracker part)

**Interfaces:**
- Consumes: `UsageSchema`, `parseUsage`, `Usage` (Task 1).
- Produces:
  - `AgentTracker.usage: Usage | undefined` (public field) and `snapshot()` includes `usage` when set.
  - `POST /usage`: body is a `Usage` (`type` may be omitted by the sender; the server adds `type:"usage"` before `parseUsage`). Invalid → `400 {error:"invalid usage"}`, stored value untouched. Valid → store in `tracker.usage`, broadcast the JSON to all clients, `202`. Does **not** call `external()` (usage alone must not stop the demo).
  - Demo: when `DEMO` is on, start with `tracker.usage = { type:"usage", fiveHour:{usedPercentage:62, resetsAt: now+2h}, sevenDay:{usedPercentage:34, resetsAt: now+3d} }`. `stopDemo` resets it to `{type:"usage"}` and broadcasts that, unless a real `/usage` arrived before.
  - `EventSink.usage?(u: Usage): void`; `connectWs` routes `usage` messages to it and calls it with `snapshot.usage` when present.
  - `startMock` calls `sink.usage?.(…)` once at start with the same fake values as the demo.
  - `main.ts` keeps `let usage: Usage | null` updated by `sink.usage` (respecting `frozen()`), and passes it to the overlay in Task 7.

- [ ] **Step 1: Write the failing test** `"tracker keeps the latest usage and replays it in the snapshot"`: `t.usage = u; expect(t.snapshot().usage).toEqual(u)`; and `SnapshotSchema.safeParse(t.snapshot()).success === true`.

- [ ] **Step 2: Run** `pnpm test tests/unit/events.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the tracker field, `/usage` route (reuse `readJson` / `json`), broadcast of non-agent messages (generalise `broadcast` or add `broadcastRaw(msg)`; only `AgentEvent`s go through `tracker.apply`), demo usage, client routing.

- [ ] **Step 4: Verify** `pnpm test && pnpm typecheck` PASS, then with `pnpm dev` running:
  - `curl -s -XPOST localhost:4317/usage -H 'content-type: application/json' -d '{"fiveHour":{"usedPercentage":140,"resetsAt":1}}'` → `400`
  - `curl -s -XPOST localhost:4317/usage -H 'content-type: application/json' -d '{"fiveHour":{"usedPercentage":40,"resetsAt":1893456000}}'` → `202`
  - `curl -s localhost:4317/health` unchanged shape.

- [ ] **Step 5: Commit** — `feat(server): POST /usage, usage in snapshot and over the WebSocket`

---

### Task 4: Status line script and installer

**Files:**
- Create: `scripts/statusline.mjs`
- Test: `tests/unit/statusline.test.ts`

**Interfaces:**
- Produces one script with four commands, same conventions as `scripts/claude-hooks.mjs` (`FILE = process.env.CLAUDE_SETTINGS ?? ~/.claude/settings.json`, `MARK = "# agent-office"`, timestamped backup in `save()`):
  - `install [port=4317]`: if `settings.statusLine` is already ours, decode its stored previous one and rebuild (idempotent). Otherwise remember the existing `settings.statusLine` object (any shape, or none). Write `settings.statusLine = { ...previous, type:"command", command }` where `command = node "<absolute path of this script>" run <port> <prev> # agent-office` and `<prev>` is `base64url(JSON.stringify(previous))` or `-` when none. Keeping `...previous` preserves `padding` / `refreshInterval`.
  - `uninstall`: if the current `statusLine` is ours → restore the decoded previous object exactly, or delete the key when `-`. If it is not ours → print `Agent Office status line not installed (current status line left untouched)` and write nothing.
  - `status`: prints whether ours is installed and whether it wraps a previous command.
  - `run <port> <prev>`: read all stdin (JSON). In parallel: (a) `fetch("http://localhost:<port>/usage", {method:"POST", body, signal: AbortSignal.timeout(500)})` with body `{fiveHour, sevenDay}` mapped from `rate_limits.five_hour` / `seven_day` (`used_percentage` → `usedPercentage`, `resets_at` → `resetsAt`), skipped when `rate_limits` is absent, errors swallowed; (b) if `<prev>` has a `command`, run it with `sh -c`, the same stdin, and print its stdout unchanged; else print `[<model.display_name>] <basename(workspace.current_dir)>`. Always exit 0.

- [ ] **Step 1: Write the failing tests** in `tests/unit/statusline.test.ts` (run the script with `execFileSync("node", [script, …], { env: { ...process.env, CLAUDE_SETTINGS: tmp }, input })`, temp dir via `mkdtempSync`):
  - `"installs a neutral status line when none exists, and uninstall removes it"`: settings `{}` → after install `statusLine.command` contains `run 4317 -` and `# agent-office`; after uninstall `statusLine` is `undefined`.
  - `"wraps an existing status line and restores it byte-identical"`: settings `{statusLine:{type:"command", command:"echo mine", padding:2, refreshInterval:10}}` → install, install again (idempotent), uninstall → `statusLine` deep-equals the original.
  - `"leaves a status line it does not own untouched on uninstall"`: install, then overwrite `statusLine` with `{type:"command", command:"echo other"}`, uninstall → still `echo other`.
  - `"run prints the previous command's output"`: `run 1 <b64 of {type:"command",command:"cat >/dev/null; echo wrapped"}>` with stdin `{}` → stdout `wrapped\n`.
  - `"run prints a neutral line and exits fast when the server is down"`: `run 1 -` (port 1 = nothing listening) with stdin `{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/a/b/proj"},"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":1893456000}}}` → stdout `[Opus] proj\n`, elapsed < 1000 ms, no stderr.

- [ ] **Step 2: Run** `pnpm test tests/unit/statusline.test.ts` — Expected: FAIL (script missing).

- [ ] **Step 3: Implement** `scripts/statusline.mjs` per Interfaces (header comment listing the commands, like `claude-hooks.mjs`).

- [ ] **Step 4: Run** `pnpm test` — Expected: PASS. Then manual: `echo '{"rate_limits":{"five_hour":{"used_percentage":40,"resets_at":1893456000}}}' | node scripts/statusline.mjs run 4317 -` with `pnpm dev` running → server receives it (pie appears after Task 7).

- [ ] **Step 5: Commit** — `feat(scripts): status line that feeds usage to Agent Office and wraps any existing one`

---

### Task 5: Waiting beacons

**Files:**
- Modify: `src/scene/compose.ts` (`WorldView.draw` gets an `underlay` callback)
- Modify: `src/scene/ambient.ts`
- Modify: `src/characters/pose.ts` (sprite bubbles off for waiting anims)
- Modify: `src/main.ts`
- Test: `tests/visual/visual.spec.ts`

**Interfaces:**
- Consumes: `Agent.state`, `Agent.anim`, `Agent.awaitingPrompt` (Task 2); `drawAlertBubble`, `drawAskBubble` (`src/engine/emotes.ts`).
- Produces:
  - `WorldView.draw(ctx, time, actors, overlay?, underlay?)` — `underlay` runs right after the shadows, before depth-sorted items.
  - `Ambient.drawBeaconRings(ctx, agents: Iterable<Agent>, t: number): void` — underlay. For each agent with `state === "waiting"`: dithered ellipse ring around the feet (≈ shadow size + 4 px), red (`pal.red` / `pal.coral1`) for `anim === "waiting"`, blue (`pal.sky1`) for `"waiting_input"`; radius pulses with period 1.0 s (red) / 1.8 s (blue).
  - `Ambient.drawBeacons(ctx, agents, t): void` — overlay. For waiting agents: a dithered vertical beam (same colour, density fading upward over ~48 px, flickering with the same period) and the `!` / `?` bubble drawn at **2× scale** (cache the bubble bitmap, `drawImage` at double size, `imageSmoothingEnabled` already false) bobbing 2 px above the head. For `awaitingPrompt` agents that are not waiting: today's 1× `?` bubble above the head, no beam, no ring.
  - `pose.ts`: `waiting` / `waiting_input` return `bubble: null` (the overlay owns the bubble now; arms / eyes animation unchanged).

- [ ] **Step 1: Add the visual test** `"waiting agents get a beacon"`: `?mock=` off, page with `apply()` hook: spawn `a` and `b`, freeze-free run 3 s, apply `agent_waiting a` (permission) and `agent_tool b Read` then `agent_waiting b need:"input"`, wait 1 s, screenshot; assert the image contains pixels of `SCENE_WARM.red` within 30 px above agent `a`'s screen position and `SCENE_WARM.sky1` above `b` (use the existing helpers in `tests/visual/helpers.ts` for palette checks), and the "scene palette only" check still passes.

- [ ] **Step 2: Run** `pnpm test:visual -g beacon` — Expected: FAIL.

- [ ] **Step 3: Implement** the underlay hook, the two `Ambient` methods, the `pose.ts` change, and wire them in `main.ts` (`view.draw(ctx, t, actors, overlay, (c) => ambient.drawBeaconRings(c, office.agents.values(), t))`; `drawBeacons` inside the overlay, after `drawSpeech`).

- [ ] **Step 4: Run** `pnpm test && pnpm test:visual` — Expected: PASS. Screenshot `?mock=1` around 20–30 s and look at it: red and blue beacons clearly distinct, readable at screen-saver distance.

- [ ] **Step 5: Commit** — `feat(scene): pulsing beacon for agents waiting on you`

---

### Task 6: Station activity effects and the coffee cup

**Files:**
- Modify: `src/scene/ambient.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Agent.state`, `Agent.station`, `Agent.dir`, position (Task 2).
- Produces: `Ambient.drawStationFx(ctx, agents: Iterable<Agent>, t: number): void` — overlay, before `drawBeacons`. For each agent with `state === "working"` and a `station`, the object tile is the agent tile plus one step in `dir` (`NE` → y−1, `NW` → x−1, `SE` → y+1, `SW` → x+1). Effects, drawn relative to that tile's `gridToScreen` with a per-type height offset:
  - `desk`: monitor flicker (2–3 cream / mint pixel rows toggling at ~6 Hz) + 2 sparks rising 0–8 px.
  - `library`: one book spine on the shelf glowing butter, 1–2 page pixels fluttering.
  - `terminal`: 4–6 LED pixels on the rack face blinking fast (mint / red, phase per LED).
  - `whiteboard`: marker dot moving along a short stroke.
  - `coffee`: steam (3 cream pixels drifting up, dithered) above the machine, **and** a cup (3×3 white/ink pixels) at the agent's hand + 2 steam pixels above it.
  - any other station: nothing.
- Exact pixel shapes, offsets and timings are the builder's call; tune them by screenshot.

- [ ] **Step 1: Add the visual test** `"working agents light up their station"`: apply `agent_tool a Bash`, wait until `a` is working, take two screenshots 150 ms apart, assert the 40×40 px region above the rack differs between them while a region of empty floor does not.

- [ ] **Step 2: Run** `pnpm test:visual -g "light up"` — Expected: FAIL.

- [ ] **Step 3: Implement** `drawStationFx` and wire it in `main.ts`.

- [ ] **Step 4: Run** `pnpm test:visual` and `pnpm perf` (or `?mock=stress&n=30` with the FPS stat) — Expected: PASS, FPS not lower than `docs/qa/perf-stress30.json`.

- [ ] **Step 5: Commit** — `feat(scene): stations come alive while an agent works there; coffee cup for waiting parents`

---

### Task 7: Usage pies on the whiteboard

**Files:**
- Modify: `src/world/furniture.ts` (`WHITEBOARD`: remove the flow chart and red underline, keep frame, tray, sticky notes moved to the right edge `ly 24..27`)
- Create: `src/scene/usagePies.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/usagePies.test.ts`

**Interfaces:**
- Consumes: `Usage` (Task 1), `usage` variable in `main.ts` (Task 3), `worldToScreen`, `UNIT` (`src/engine/iso.ts`), `OFFICE.furniture` (first placement with `def.id === "whiteboard"`).
- Produces in `src/scene/usagePies.ts`:
  - `pieFraction(w: UsageWindow | undefined, nowSec: number): number | null` — `null` when `w` is missing or `w.resetsAt <= nowSec`, else `usedPercentage / 100` clamped to [0, 1].
  - `drawUsagePies(ctx, usage: Usage | null, layout: WorldLayout, origin: Vec2, pal: ScenePalette, nowSec: number): void` — paints on the whiteboard surface plane (the same plane `WHITEBOARD.draw` paints with `planeX(6.01, 2, 30, 16, 41, …)`, in local units from the placement origin `(pl.x * UNIT, pl.y * UNIT)`). Iterate the board's local `(ly, lz)` pixels; map each to the screen with `worldToScreen(pl.x*UNIT + 6, pl.y*UNIT + 2 + ly, 16 + lz)` + `origin`. Pies: 5h centred `(ly 7, lz 14)`, 7d centred `(ly 17, lz 14)`, radius 5 units. Outline always (ink); slice from 12 o'clock clockwise filled with `pal.coral1`-ish orange (5h) / `pal.sky1` (7d), `pal.red` when fraction ≥ 0.9; `null` fraction → outline only. `5h` / `7d` in a 3×5 pixel hand font under each pie (lz 4..8). Verify the projection against the static board by screenshot; if `planeX` uses a different unit convention, follow `isoPaint.ts`.

- [ ] **Step 1: Write the failing tests** `tests/unit/usagePies.test.ts`:
  - `pieFraction(undefined, 0) === null`
  - `pieFraction({usedPercentage: 62, resetsAt: 2000}, 1000) === 0.62`
  - `pieFraction({usedPercentage: 62, resetsAt: 1000}, 1000) === null` (past reset → empty)
  - `pieFraction({usedPercentage: 100, resetsAt: 2000}, 1000) === 1`

- [ ] **Step 2: Run** `pnpm test tests/unit/usagePies.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `pieFraction`, `drawUsagePies`, the whiteboard cleanup, and call `drawUsagePies(c, usage, OFFICE, view.origin, pal, Date.now() / 1000)` in the overlay right after `ambient.draw`.

- [ ] **Step 4: Run** `pnpm test && pnpm test:visual` (update the gallery / furniture baseline if the whiteboard change breaks a pixel comparison) — Expected: PASS. Screenshot `?mock=1`: two pies readable on the board, labels legible, palette-only check green.

- [ ] **Step 5: Commit** — `feat(scene): 5h and weekly usage drawn as pies on the whiteboard`

---

### Task 8: Docs and final check

**Files:**
- Modify: `README.md` ("What you see" table; short "Usage on the whiteboard" note with the install command)
- Modify: `docs/configuration.md` (Commands/Settings unchanged; new section "Status line (usage pies)": `node scripts/statusline.mjs install [port]`, `status`, `uninstall`, wrapping behaviour, privacy note "only the two percentages and reset times are sent, to localhost"; hooks table: `AskUserQuestion`/`ExitPlanMode` = blue beacon, `idle_prompt` = small `?` on a finished session; Event API: new `need: "next_prompt"` value; Event API: `POST /usage` payload and the `usage` WebSocket / snapshot field; tool → station table updated)
- Modify: `docs/screenshots/` (refresh `m3b-world-overview.png` and `states-scene.png` with `scripts/screenshot.mjs` if it supports it)

- [ ] **Step 1: Update** the docs above, all in English.
- [ ] **Step 2: Run** `pnpm typecheck && pnpm test && pnpm test:visual` — Expected: all PASS.
- [ ] **Step 3: End-to-end check** with `pnpm dev` + `DEMO=0`: install hooks and status line in a throwaway settings file (`CLAUDE_SETTINGS=/tmp/x.json`), replay hook payloads with curl (`PreToolUse AskUserQuestion` → blue beacon; `PreToolUse Task` → parent walks to the coffee bar with a cup; `Stop` then `Notification idle_prompt` → small `?`, no beacon), pipe a status line payload → pies fill.
- [ ] **Step 4: Commit** — `docs: beacons, coffee bar, usage pies and status line setup`
