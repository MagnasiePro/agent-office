# Mail Truck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mail truck (no road, one mailbox moved to the open-space edge) and a mailbox errand show every real git push and pull, detected by an additive global git hook.

**Architecture:** A POSIX-sh git hook, registered through git ≥ 2.54 config-based hooks, posts `{repo, direction}` to `POST /git`. `HookAdapter` maps the repo to the session agent that last used a tool there and emits a transient `agent_mail` event. `Office` runs a truck state machine and short mailbox errands. `Ambient`-style painters draw the truck, flag and envelope (overlay); no road.

**Tech Stack:** TypeScript, zod 4, POSIX sh + curl, Node `child_process` for tests, Canvas 2D pixel overlay, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-mail-truck-design.md`

## Global Constraints

- Everything in English: code, comments, docs, commit messages.
- Pixel art only: `SCENE_WARM` colours, integer coordinates, whole-pixel `fillRect`, `bayer()` dithering, no gradients, no `globalAlpha`. Visual test "scene palette only" stays green.
- No HUD, no on-screen text.
- The git hook **always exits 0**, returns in milliseconds, makes its network call in the background with `curl -s -m 0.5`, and never replaces repo hooks.
- Installers: digits-only port, exact uninstall, `GIT_CONFIG_GLOBAL` / `CLAUDE_SETTINGS` honoured; tests never touch the real `~/.gitconfig` or `~/.claude/settings.json`.
- No new dependencies. No perf regression at `?mock=stress&n=30` (30 fps).
- Port 4318 may be held by a stray dev server: run Playwright through a temporary config on a spare port, never commit it, never kill that process.

## Review Focus

1. **A repo-level `pre-push` that rejects the push** → git aborts the push, no `refs/remotes` update, no truck; our hook must not change the repo hook's exit status. Pinned in Task 2.
2. **The hook during a plain commit, rebase or checkout** → exits 0 immediately, sends nothing. Pinned in Task 2.
3. **Two sessions in the same repo (a worktree and the main checkout, or nested folders)** → the mail goes to the session whose `cwd` matches best (longest prefix), then most recently active. Pinned in Task 1.
4. **Agent despawns mid-errand or while its letter waits in the mailbox** → errand cancelled, truck still completes its trip, flag ends down once the box is empty. Pinned in Task 3.
5. **Tool events arriving during an errand** → replayed after the errand, in order. Pinned in Task 3.

---

### Task 1: Contract, adapter routing, tracker

**Files:**
- Modify: `shared/events.ts`, `shared/tool-stations.json`, `shared/toolMapping.ts`, `server/hook-adapter.ts`, `server/tracker.ts`, `server/index.ts`
- Test: `tests/unit/events.test.ts`

**Interfaces:**
- Produces:
  - `AgentMailSchema = z.object({ type: z.literal("agent_mail"), agentId: id, direction: z.enum(["push", "pull"]) })`, part of `AgentEventSchema`; `type AgentMailEvent`.
  - `GitEventSchema = z.object({ repo: z.string().min(1).max(1000), direction: z.enum(["push", "pull"]) })`, `parseGitEvent(raw: unknown): { repo: string; direction: "push" | "pull" } | null`.
  - `ToolStationConfig.mail: { push: string[]; pull: string[] }` (tool-name suffixes); `mailForTool(tool: string, config?): "push" | "pull" | null`. JSON: `"mail": { "push": ["__push_files", "__create_or_update_file", "__delete_file"], "pull": [] }`.
  - `HookAdapter`: each `Session` stores `cwd?: string`, `lastActor: string`, `lastSeen: number` (updated on every payload that names an actor; `Date.now()` injectable via constructor `now = Date.now`). `git(repo: string, direction): AgentEvent[]` — normalise `repo` (strip trailing `/`); candidate sessions: `cwd === repo` or `cwd.startsWith(repo + "/")` or `repo.startsWith(cwd + "/")` (a git hook in a sub-repo of the session folder); pick the longest `cwd`, then the latest `lastSeen`; emit `{type:"agent_mail", agentId: session.lastActor, direction}`; none → `[]`.
  - `PostToolUse` (not `PostToolUseFailure`) with `mailForTool(tool_name)` non-null → also emit `agent_mail` for the actor.
  - `AgentTracker.apply`: `agent_mail` never becomes `last` and never creates an agent.
  - `POST /git` in `server/index.ts`: `parseGitEvent` → 400 `{"error":"invalid git event"}` on failure; else `adapter.git(...)`, broadcast, `202 {accepted}`; calls `external()` only when an event was emitted.

- [ ] **Step 1: Write failing tests** in `tests/unit/events.test.ts`:
  - `"routes a git push to the session working in that repo"`: payloads `SessionStart {session_id:"a", cwd:"/w/app"}`, `SessionStart {session_id:"b", cwd:"/w/other"}`; `adapter.git("/w/app", "push")` → `[{type:"agent_mail", agentId:"a", direction:"push"}]`; `adapter.git("/w/none", "pull")` → `[]`.
  - `"prefers the closest cwd, then the most recent session"`: sessions `a` cwd `/w/app`, `b` cwd `/w/app/packages/ui`, `c` cwd `/w/app` seen later (fake clock) → `git("/w/app/packages/ui", "pull")` targets `b`; `git("/w/app", "pull")` targets `c`.
  - `"attributes mail to the sub-agent that last used a tool"`: session `s` spawns a sub-agent via `SubagentStart {agent_id:"x"}`, then `PreToolUse {agent_id:"x", tool_name:"Bash"}` → `git(cwd, "push")` → `agentId === "s/x"`-style id the adapter assigned (read it from the spawn event).
  - `"remote-only GitHub tools count as a push"`: `PostToolUse {tool_name:"mcp__plugin_github_github__push_files"}` → contains `{type:"agent_mail", direction:"push"}`; `PostToolUseFailure` of the same → no mail.
  - `"parseGitEvent rejects junk"`: `{}`, `{repo:"", direction:"push"}`, `{repo:"/x", direction:"merge"}` → `null`; valid → object.
  - `"tracker never stores agent_mail"`: spawn `a`, apply `agent_tool a Read`, apply `agent_mail a push` → snapshot `last` is still the `agent_tool`.
- [ ] **Step 2: Run** `pnpm test tests/unit/events.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces. `src/scene/office.ts` must compile: until Task 3, `agent_mail` is ignored there.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(events): agent_mail event, POST /git routing to the session working in the repo`

---

### Task 2: Git hook script and installer

**Files:**
- Create: `scripts/git-hook.sh`, `scripts/git-hooks.mjs`
- Test: `tests/unit/githooks.test.ts`

**Interfaces:**
- `scripts/git-hook.sh <port> <pre-push|refs> [git args…]`, POSIX sh, ≤ ~40 lines:
  - marker path: `${TMPDIR:-/tmp}/agent-office-push-$(printf %s "$(git rev-parse --git-common-dir 2>/dev/null)" | cksum | cut -d' ' -f1)`; resolve the common dir to an absolute path first (`cd` + `pwd -P`) so worktrees share the marker.
  - `pre-push`: `touch` the marker; drain stdin (`cat >/dev/null`); exit 0.
  - `refs`: only when git's state argument (`$3`) is `committed`; read stdin; if no line contains ` refs/remotes/` → exit 0. Direction = `push` if the marker exists and is younger than 120 s (`find "$m" -mmin -2` or compare `date +%s` with `stat` — must work on macOS and Linux; prefer `find -mmin`), then remove the marker; else `pull`. `repo=$(git rev-parse --show-toplevel 2>/dev/null)` (empty → exit 0). JSON-escape `repo` (backslash and double quote). Send `curl -s -m 0.5 -o /dev/null -X POST "http://localhost:$port/git" -H 'content-type: application/json' --data-binary "$json" >/dev/null 2>&1 &`. Exit 0.
  - Every path ends in `exit 0`; no `set -e`.
- `scripts/git-hooks.mjs install [port=4317] | uninstall | status` — header comment like `claude-hooks.mjs`. Uses `git config --global` through `execFileSync("git", …)` (so `GIT_CONFIG_GLOBAL` is honoured):
  - `install`: port `/^\d+$/` else usage on stderr + exit 1 without writing; remove our two sections if present (idempotent), then `git config --global --add hook.agent-office-push.event pre-push`, `hook.agent-office-push.command 'sh "<abs script>" <port> pre-push'`, same for `agent-office-refs` with event `reference-transaction` and arg `refs`; then verify `git hook list pre-push` (run in a temp repo created with `git init` in `os.tmpdir()`) mentions `agent-office-push`; if not, remove both sections and print `git >= 2.54 is required for config-based hooks (found <git --version>)`, exit 1.
  - `uninstall`: `git config --global --remove-section hook.agent-office-push` and `…-refs`, ignoring "no such section".
  - `status`: prints installed or not, and the port.

- [ ] **Step 1: Write failing tests** in `tests/unit/githooks.test.ts`. Every test uses a fresh temp dir with `HOME`, `GIT_CONFIG_GLOBAL=<tmp>/gitconfig`, `TMPDIR=<tmp>/t`, `GIT_AUTHOR/COMMITTER` env set, a bare remote and a clone, and a tiny `http.createServer` on an ephemeral port collecting `POST /git` bodies (install with that port):
  - `"install is idempotent and uninstall removes exactly our sections"`: pre-existing `[user] name = x` and `[hook "other"]` stay byte-identical after install×2 + uninstall.
  - `"rejects a non-numeric port without writing"`.
  - `"a successful push sends push"`: commit + `git push` → exactly one body `{repo:<clone toplevel>, direction:"push"}` (await up to 2 s).
  - `"a rejected push sends nothing"`: remote moved ahead (push from a second clone), non-ff `git push` fails → no body within 1.5 s.
  - `"a repo pre-push that fails still aborts the push and sends nothing"`: `.git/hooks/pre-push` = `exit 1` → `git push` exit code ≠ 0, remote unchanged, no body.
  - `"a fetch that brings commits sends pull; an empty fetch sends nothing"`.
  - `"a plain commit and a checkout send nothing"`.
  - `"git is not slowed down or broken when the server is down"`: install with a closed port; `git push` succeeds; total time of `git commit` < 1 s.
- [ ] **Step 2: Run** `pnpm test tests/unit/githooks.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both scripts.
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS. Also `sh -n scripts/git-hook.sh` and, if available, `shellcheck scripts/git-hook.sh` (skip if not installed).
- [ ] **Step 5: Commit** — `feat(scripts): additive global git hook that reports real pushes and pulls`

---

### Task 3: Office — mailbox, truck, errands

**Files:**
- Modify: `src/world/layout.ts` (mailbox placement, `truckLane`), `src/world/furniture.ts` (`MAILBOX` 1 frame, flag down), `src/engine/agent.ts`, `src/scene/office.ts`
- Create: `src/scene/mail.ts` (truck + mailbox state machine, pure)
- Test: `tests/unit/mail.test.ts`, `tests/unit/office.test.ts`

**Interfaces:**
- Consumes: `AgentMailEvent` (Task 1).
- Produces:
  - `WorldLayout.truckLane: { y: number; from: number; stop: number }` — the grid line the truck drives along (no road is drawn), where it appears and where it stops. Values: `{ y: 10.5, from: layout.w + 5, stop: 11.9 }`. The single `MAILBOX` moves from `(0, 7)` to `(11, 8)`; station `mailbox` slot `{ x: 11, y: 7, dir: "SE" }`; nothing remains at `(0, 7)`. Check pathfinding still reaches every station (existing test "never steps through a partition" + a new reachability assertion for the mailbox slot).
  - `src/scene/mail.ts`: `class MailService` with `truck: { x: number; facing: "in" | "out"; state: "away" | "arriving" | "stopped" | "leaving" }`, `box: { outgoing: number; incoming: string[] /* addressee ids */ }`, `get flagUp(): boolean` (`outgoing > 0 || incoming.length > 0`), `requestPickup(): void`, `requestDelivery(agentId: string): void`, `takeLetter(agentId: string): boolean`, `post(): void`, `update(dt: number): void`, `onDelivered?: (agentId: string) => void`. Truck speed ≈ 3 tiles/s, stop 1.2 s; it serves every pending pickup/delivery in one trip and starts another trip if more arrived after it left.
  - `Agent.carrying: "letter" | null`.
  - `Office`: owns a `MailService` (`office.mail`). `agent_mail push` → errand: `carrying = "letter"`, walk to the mailbox slot, on arrival wait 0.6 s, `mail.post()`, `carrying = null`, `mail.requestPickup()`, errand ends. `agent_mail pull` → `mail.requestDelivery(id)`; `onDelivered(id)` → errand: walk to the slot, `takeLetter(id)`, `carrying = "letter"` for 3 s (clear on the next event or after 3 s), errand ends. During an errand, other events for that agent go to `m.pending` and are replayed in order when it ends (reuse the spawning replay). Despawn cancels the errand; an undelivered letter for a gone agent is dropped from `incoming` (flag goes down when empty). Errand state: `Meta.errand: "post" | "fetch" | null`; agent state while walking/standing there: `walking` then `working` with `station = "mailbox"`.
- [ ] **Step 1: Write failing tests**:
  - `tests/unit/mail.test.ts`: `"a pickup brings the truck, takes the outgoing mail, and leaves"` (after `post()` + `requestPickup()`, update loop → state goes arriving → stopped → leaving → away; `outgoing` becomes 0 while stopped; `flagUp` false after); `"deliveries are dropped in one trip and announced"` (two `requestDelivery` → one trip, `onDelivered` called for both, `incoming` has both until taken); `"mail requested while leaving triggers a second trip"`.
  - `tests/unit/office.test.ts`: `"a push sends the agent to post a letter, then the truck picks it up"` (agent at desk via Edit, `agent_mail push` → within 15 s agent tile is the mailbox slot and `carrying === "letter"`, later `office.mail.box.outgoing` hits 1 then 0, truck back `away` within 30 s); `"a pull brings the truck first, then the agent collects"` (truck reaches `stopped` before the agent reaches the slot; afterwards `carrying === "letter"`, `flagUp` false); `"events during an errand are replayed afterwards"` (`agent_tool Bash` sent mid-errand → after the errand the agent ends `working` at a terminal slot); `"despawn mid-errand drops its letter"` (pull, despawn before collecting → `incoming` empty, `flagUp` false).
- [ ] **Step 2: Run** `pnpm test tests/unit/mail.test.ts tests/unit/office.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` — Expected: PASS (including the 30-sub-agent no-overlap test).
- [ ] **Step 5: Commit** — `feat(office): mailbox errands and a mail truck for pushes and pulls`

---

### Task 4: Truck, flag and envelope art (no road)

**Files:**
- Modify: `src/scene/ambient.ts` (painters), `src/main.ts` (wiring)
- Create: `src/scene/truck.ts` (truck sprite bitmaps, cached)
- Test: `tests/visual/visual.spec.ts`

**Interfaces:**
- Consumes: `WorldLayout.truckLane`, `office.mail` (`truck`, `flagUp`), `Agent.carrying` (Task 3).
- Produces:
  - **No road and no shadow** under the truck (it drives through the void).
  - `truckSprite(facing: "in" | "out", frame: number): Bitmap` in `src/scene/truck.ts`, matching the approved preview (`.superpowers/brainstorm/*/content/mail-truck-v3.html`, function `truck`): iso van ≈ 38 × 18 world units (2.4 × 1.1 tiles), cargo box 22 high, cab 12 long × 15 high; ink outline on every visible edge; `red` sides, `coral1` top, `coral0` shaded face; white 2-px stripe on the side; `sky2` cab window and windscreen with **two** butter headlights on the front face (one at each side); rear-door line and red tail lights when the back faces the viewer; ink wheels with a 2-frame turn while moving. **No envelope/letter on the truck.** Draw the further-back block first (`"in"`: cab, then cargo; `"out"`: cargo, then cab).
  - `Ambient.drawMail(ctx, office: Office, t: number): void` — overlay, called after `drawStationFx` and before `drawSpeech`: truck at `gridToScreen(truck.x, truckLane.y)` when not `away`; mailbox flag up (butter flag on a wood post, same look as the old frame 1) at the mailbox's screen position when `flagUp`; for each agent with `carrying === "letter"` a 4×3 cream envelope with ink outline at the hand (follow the mug placement from the coffee effect).
- [ ] **Step 1: Add visual test** `"the mail truck drives up to the mailbox"`: via `__agentOffice.apply`, spawn `a`, `agent_tool a Edit`, wait until working, `agent_mail a pull`; poll `office.mail.truck.state` until `"stopped"`; screenshot; assert ≥ 20 `SCENE_WARM.red` pixels inside the box around the truck's screen position (compute it in-page from `view.origin` + `gridToScreen`) and that the flag region shows `SCENE_WARM.butter`; existing palette-only test still passes.
- [ ] **Step 2: Run** the test on a temporary Playwright config (spare port) — Expected: FAIL.
- [ ] **Step 3: Implement** the sprite and painters; tune by full-frame 1920×1080 screenshots (truck arriving, stopped, agent carrying a letter), looked at with the Read tool.
- [ ] **Step 4: Run** `pnpm test && pnpm test:visual` (temp config) and check `?mock=stress&n=30` still runs at 30 fps — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(scene): mail truck, mailbox flag and carried letters`

---

### Task 5: Demo, mock and docs

**Files:**
- Modify: `shared/scenario.ts`, `README.md`, `docs/configuration.md`, `docs/screenshots/m3b-world-overview.png` (only if the truck is visible in a natural frame)
- Test: `tests/unit/events.test.ts` (existing "scenarios only produce valid events, in time order")

**Interfaces:**
- Consumes: `agent_mail` (Task 1), the office behaviour (Task 3).
- Produces: `scriptedScenario` gets a `pull` right after the session starts (≈ t 3) and a `push` after the edits (≈ t 15); `randomScenario` emits `agent_mail` occasionally (≈ 1 per session, random direction).
- Docs: README "What you see" row "**Push / pull** — a mail truck drives up; the agent posts or collects a letter", plus one quick-start line `node scripts/git-hooks.mjs install`; `docs/configuration.md` section "Git hook (mail truck)": install/uninstall/status, git ≥ 2.54, how detection works (pre-push marker + `refs/remotes` update), what is not detected (failed pushes, up-to-date pulls, tag-only pushes, raw-URL pushes), remote-only GitHub tools via `mail` suffixes in `tool-stations.json`, `POST /git` payload and 400 rule, `agent_mail` in the Event API, privacy (only the repo path, to localhost).
- [ ] **Step 1: Update** the scenarios; run `pnpm test tests/unit/events.test.ts` — Expected: PASS (scenario validity test covers the new events).
- [ ] **Step 2: Update** the docs; refresh the screenshot if a natural `?mock=1` frame shows the truck.
- [ ] **Step 3: End-to-end** with a throwaway `GIT_CONFIG_GLOBAL` and `CLAUDE_SETTINGS`, a dev server on a spare port, a temp repo with a bare remote: install both hooks + claude hooks; send a `SessionStart` payload with `cwd` = the temp repo; `git push` → truck comes; `git fetch` with new commits → truck delivers. Uninstall restores both config files exactly.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm test:visual` (temp config) — Expected: PASS.
- [ ] **Step 5: Commit** — `docs: mail truck and git hook setup`
