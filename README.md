# Agent Office

An isometric pixel-art macOS screen saver: a small office at night where every Claude Code session (and every sub-agent) is a character walking to the workstation that matches the tool it is using.

![Overview](docs/screenshots/m3b-world-overview.png)

- **L-shaped world**: open space (18 desks), lab (bookshelf, servers, whiteboard, window), cafeteria (coffee, tables, sofa), separated by low partitions with doors.
- **"Clawd" mascot** (coral); sub-agents as a mini version, with a tint + accessory per instance; a 2nd demo character, "Bolt" (blue robot).
- **Readable at a glance**: each session state has its own sprite (see [Agent states](#agent-states)); fake-text bubbles = conversation (briefing, report, coffee break).
- **Rendering**: 100% procedural sprites (no images), 24-color palette, integer scale (crisp pixels), 30 fps max, zero rendering when the screen is hidden.

## Agent states

![Scene with agents in different states](docs/screenshots/states-scene.png)

| State | What you see | Trigger (Claude Code hook) |
|---|---|---|
| Working | at a station, animation depends on the tool (typing, reading, terminal…) | `PreToolUse` |
| Blocked: permission | red **"!"** bubble, the robot lights its bulb | `PermissionRequest`, `Notification` (permission) |
| Waiting for your instruction | blue **"?"** bubble | `Notification` of type `idle_prompt` |
| Idle | wanders, chats, goes to the cafeteria; after ~25 s of rest it **falls asleep** (rising "z") | no event |
| Done | small victory jump with sparkles, then a break | `Stop` |
| Sub-agent | mini version, own tint, linked to its parent | `Task` / `Agent`, `SubagentStart` |
| Appear / leave | pixel cloud | `SessionStart` / `SessionEnd` |

A waiting agent ("!" or "?") goes back to work on its next tool or as soon as you send a new prompt.

![All states, in the 4 directions](docs/screenshots/states-sprites.png)

The gallery (`/gallery`) shows every animation in the 4 directions, for both characters and their mini versions.

## Run

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:4317 (scene) and http://localhost:4317/gallery (gallery of all sprites, animations, furniture, bubbles).
In dev, a **demo** runs on its own and stops as soon as a real event arrives (`DEMO=0 pnpm dev` to turn it off).

| Command | Effect |
|---|---|
| `pnpm dev` | server (Vite as middleware) + `/events` WebSocket + `POST /hook` on port 4317 (`PORT=…`) |
| `pnpm sim` | plays the scripted scenario to the server (`--random`, `--stress 30`, `--speed 2`) |
| `pnpm build && pnpm start` | production build (serves `dist/`) |
| `pnpm test` | unit tests (Vitest) |
| `pnpm test:visual` | browser tests (Playwright; `npx playwright install chromium` the first time) |
| `pnpm perf` | measures FPS/CPU over 5 min → `docs/qa/perf.json` |

Without a server: `/?mock=1` (scripted scenario then random), `/?mock=random`, `/?mock=stress&n=30`, with `&speed=3` to speed things up.

## Architecture

```
shared/          contract shared by front and back
  events.ts        AgentEvent + Snapshot (zod)
  tool-stations.json  tool → station type → animation
  scenario.ts      scripted / random / stress scenarios (simulator and ?mock)
server/          Node (tsx)
  index.ts         HTTP + WebSocket /events + POST /hook + POST /events + demo
  hook-adapter.ts  Claude Code hook payload → AgentEvent
  tracker.ts       live agents, replayed (snapshot) on every (re)connection
src/engine/      generic engine (knows no character)
  bitmap, shape, isoPaint   pixels, auto-shaded masks, iso primitives
  iso.ts           2:1 projection (32×16 tile) + topological depth sort
  pathfinding.ts   4-connected A* + thin walls (partitions)
  agent.ts         position, movement, animation of an agent
  sprite.ts        CharacterDefinition → pre-rendered frames (mirrors, tint, generic poof)
  loop.ts          rAF loop capped at 30 fps, stopped if document.hidden
src/characters/  one file per character + registry + kinds.json
src/world/       palette, furniture, office plan (layout.ts), static rendering
src/scene/       simulation (office.ts), compositor, camera, ambience, bubbles
```

The simulation (`src/scene/office.ts`) is pure logic, tested with a fake clock. Agent lifecycle:
`spawning → idle ⇄ walking → working ⇄ waiting → done → (returning) → despawning`.

## Event format

```ts
type AgentEvent =
  | { type: "agent_spawn"; agentId: string; parentId?: string; kind: AgentKind; label?: string }
  | { type: "agent_tool"; agentId: string; tool: string; summary?: string }
  | { type: "agent_waiting"; agentId: string; reason?: string; need?: "permission" | "input" }
  | { type: "agent_done"; agentId: string }
  | { type: "agent_despawn"; agentId: string };
```

- `agent_waiting`: `need: "permission"` (default, red "!") or `"input"` (blue "?", the agent is waiting for your next message).
- `AgentKind`: `"claude"` today (and `"robot"` for the demo). Any string is accepted; an unknown kind gets the default character.
- Direct sending: `POST /events` with an `AgentEvent` (or an array). Responds `202`, or `400` if invalid.
- On the screen side, the WebSocket `ws://host/events` receives the `AgentEvent`s, starting with a `{ type: "snapshot", agents: [...] }` that resynchronizes the screen after a (re)connection. Reconnection is automatic (1 s → 10 s).
- Robustness: an event for an unknown agent creates it (`agent_tool`, `agent_waiting`) or is ignored (`agent_done`, `agent_despawn`); a double `agent_done` has no effect; sub-agents disappear with their parent.

```bash
curl -X POST localhost:4317/events -H 'content-type: application/json' -d '{"type":"agent_spawn","agentId":"demo","kind":"claude"}'
```

```bash
curl -X POST localhost:4317/events -H 'content-type: application/json' -d '{"type":"agent_tool","agentId":"demo","tool":"Bash","summary":"pnpm test"}'
```

## Adding a character

1. Create `src/characters/mycharacter.ts` exporting a `CharacterDefinition` (see `robot.ts`, ~150 lines): palette, untinted colors (`fixedColors`), `full` / `mini` sizes (frame, foot anchor, shadow, head), animations (reuse `STANDARD_ANIMATIONS` and `poseFor()` from `pose.ts` for the same feel), a `draw(bitmap, ctx)` function that draws one frame from the front (SE) or the back (NE), and rest preferences (`idlePreferences`).
2. Register it in `src/characters/index.ts`: `.register(MY_CHARACTER)`.
3. Map an `AgentKind` in `src/characters/kinds.json`: `"codex": "mycharacter"`.

The engine provides the SW/NW mirrors, per-instance variants (tint, accessory), the spawn/despawn poof, the shadow, bubbles and depth sorting. To switch to PNG spritesheets later, `draw` just needs to copy the pixels of an image into the provided `Bitmap`.

## Adding a station, a piece of furniture or a room

- **Furniture**: a `FurnitureDef` in `src/world/furniture.ts` (footprint in tiles, `draw(painter, palette, frame)` with `box` / `planeX` / `planeY` / `planeZ`). It shows up in the gallery via `ALL_FURNITURE`.
- **Station**: in `src/world/layout.ts`, `put(FURNITURE, x, y)` then `station(id, type, room, [{ x, y, dir }])` (tiles where agents stand and their facing). Several slots per station; when all are taken, agents wait nearby.
- **Station type / tool**: `shared/tool-stations.json` (exact `tools`, `prefixes` such as `mcp__`, `animations` per station type).
- **Room**: add a `Room` (position, size, floor `planks` | `tiles` | `checker`, optional rug), the `partitions` with their `doors`, and optionally `windows` / `posters` / `fairyLights` / `lamps`. The engine, depth sorting, A* and camera adapt on their own.

## Next step: hooking up Claude Code

The server already accepts raw hook payloads on `POST /hook` (detailed mapping in `server/hook-adapter.ts`):

| Hook | Effect on screen |
|---|---|
| `SessionStart`, `UserPromptSubmit` | the session appears (assigned desk); `UserPromptSubmit` also takes an agent out of waiting |
| `PreToolUse` | the agent goes to the tool's station; `Task` / `Agent` spawns a sub-agent |
| `PostToolUse` (Task), `SubagentStop` | the sub-agent returns to report, then disappears |
| `PermissionRequest`, `Notification` | "!" bubble (permission requested); `Notification` of type `idle_prompt`: "?" bubble (waiting for your instruction). The next tool or prompt puts it back to work |
| `SubagentStart` | links the sub-agent's `agent_id` (its tools are shown on it) |
| `Stop` | small victory jump, then a coffee break |
| `SessionEnd` | the session disappears |

Automatic installation (merges with existing hooks, idempotent, timestamped backup of the file):

```bash
node scripts/claude-hooks.mjs install
```

`node scripts/claude-hooks.mjs status` / `uninstall`. Hooks are picked up by already-open sessions on their next event. The script also adds `PermissionRequest`, `PostToolUseFailure`, `StopFailure` and `SubagentStart`, handled by the adapter.

Manual equivalent (minimal) in `~/.claude/settings.json`, which covers all Claude Code sessions, terminal and desktop app alike:

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

The hook receives the event JSON on stdin; `curl --data-binary @-` forwards it as is. `-m 1` and `|| true` guarantee that a screen that is off never slows down or blocks Claude Code.

To check during integration:
- tool calls made *inside* a sub-agent are attributed to the sub-agent through the `agent_id` received at `SubagentStart`; without an `agent_id`, they show on the session's agent;
- the Claude Desktop app (chat) has no hooks: only Claude Code sessions are visible, including those of the desktop app.

## macOS screen saver

1. Start the server at login (LaunchAgent `com.agent-office.server`, restarted automatically, logs in `~/Library/Logs/agent-office.log`):

   ```bash
   scripts/launchagent.sh install
   ```

   `scripts/launchagent.sh status` / `uninstall`; re-run `install` after a code update (if `bootstrap` fails right after `bootout`, re-run the command). `DEMO=0 scripts/launchagent.sh install` disables the demo.

2. Install the saver (recommended: the lightweight `.saver`, tested on macOS 26):

   ```bash
   saver/legacy/build.sh
   ```

3. System Settings → Wallpaper → Screen Saver → **AgentOffice** (no space). After a rebuild: `killall legacyScreenSaver ScreenSaverEngine`.

The `.saver` only embeds a `WKWebView` showing `http://localhost:4317/`: UI changes (`pnpm build`) are picked up without rebuilding it. It disables WebKit's occlusion detection, otherwise the page is considered hidden and flickers / goes black, and drives frames by hand (see [`saver/README.md`](saver/README.md)).

There is also an app-extension variant (`saver/install.sh`, "Agent Office" with a space), closer to Apple's own savers but less tested.

**MDM-managed Macs**: if a profile enforces the saver (`moduleName` in `/Library/Managed Preferences/com.apple.screensaver.plist`), macOS launches that one full screen regardless of the choice in Settings. Ask the administrator to remove this key, or use the lock screen app instead: `lock/build.sh` installs a menu bar app that runs the scene server itself, shows the scene full screen on ⌃⌥⌘L or after some idle time, and unlocks with Touch ID or your login password. `lock/build.sh package` makes a self-contained zip to share (see [`lock/README.md`](lock/README.md)).

The page is already in screen saver mode: full screen, hidden cursor, no interaction, dark background, automatic integer scale, rendering stopped when the page is hidden.

## Quality

- `docs/art-direction.md`: style guide (palette, lighting, outlines, proportions, design decisions).
- `docs/qa-report.md`: acceptance criteria, test results, performance measurements, bugs found and fixed.
- `docs/screenshots/`: screenshots of each milestone and of the QA (4 resolutions).

## Contributing

The project is open to everyone: issues and pull requests welcome. Easy leads: a new character (`src/characters/`), a piece of furniture or a room (`src/world/`), new visual states, support for other coding agents (send `AgentEvent`s to `POST /events`).

Before opening a PR:

```bash
pnpm typecheck && pnpm test
```

and check the rendering in the gallery (`pnpm dev` then `/gallery`); `pnpm test:visual` runs the browser tests.

Out of scope for now: mouse interactions, sounds, persistence, authentication (the server has no authentication: do not expose it to the Internet).

## License

[MIT](LICENSE). The `saver/` folder reuses a screen saver template under the MIT license (see `saver/LICENSE`).
