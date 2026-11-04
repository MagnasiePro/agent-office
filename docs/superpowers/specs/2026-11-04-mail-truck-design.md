# Mail truck for git push / pull — design

Date: 2026-11-04

## Why

Pushing and pulling code are the moments an agent's work leaves or enters the machine. The owner wants them to be visible as a little story: a mail truck drives up, and the agent posts or collects mail at the mailbox. The trigger must be the **real** push or pull happening, not a guess from a command string: any push or pull, whatever started it (agent's `git`, `gh pr create`, a script…), and only when it actually happened.

The repo is public: everything opt-in, configurable, harmless for any user's git setup, in English.

## Goals

- A successful push shows: agent walks to the mailbox carrying a letter → posts it (flag up) → truck arrives → picks up the mail (flag down) → truck leaves.
- A pull/fetch that actually brought something shows: truck arrives → drops mail (flag up) → truck leaves → the agent walks to the mailbox → takes a letter (flag down) → walks away carrying it for a moment.
- Detection comes from git itself through a global, additive git hook — no command-string parsing.
- Remote-only tools that push without git (GitHub MCP `push_files`, `create_or_update_file`, `delete_file`) also trigger a push.

## Non-goals

- No truck for a failed push, an "Already up to date" pull, a commit, a checkout or a rebase.
- No tag-only pushes and no pushes to a raw URL (git keeps no remote-tracking ref for them). Accepted miss.
- No per-commit detail, no text, no counts on screen.

## Anti-goals

- Anything that can slow down, block or break git for the user: the hook must always exit 0, return in milliseconds, and never replace existing repo hooks (husky, `.git/hooks`, `core.hooksPath`).
- Writing to the user's global git config without a clean, exact uninstall.

## Design

### 1. Git hook (owner's decision: hook, not per tool)

Git ≥ 2.54 supports config-based hooks that run **in addition** to a repo's own hooks. `node scripts/git-hooks.mjs install [port]` adds to the global git config:

```ini
[hook "agent-office-push"]
    event = pre-push
    command = sh "<repo>/scripts/git-hook.sh" <port> pre-push
[hook "agent-office-refs"]
    event = reference-transaction
    command = sh "<repo>/scripts/git-hook.sh" <port> refs
```

Two sections because a hook command can't tell which event invoked it; git appends its own arguments (`pre-push`: remote name and URL; `reference-transaction`: the state) after ours and passes the ref lines on stdin. Verified on git 2.54 in a temp repo: the config hooks run in addition to `.git/hooks/pre-push`, and both `git push` and `git fetch` produce a `committed` transaction on `refs/remotes/…` while a commit does not.

`scripts/git-hook.sh` (POSIX sh — node start-up on every ref update would slow git):

- `pre-push`: writes a marker file `${TMPDIR:-/tmp}/agent-office-push-<hash of the git common dir>` (touch). No network call.
- `reference-transaction committed`: reads the ref updates on stdin; if any line touches `refs/remotes/`:
  - marker exists and is < 120 s old → **push** (delete the marker);
  - otherwise → **pull**.
  It then sends `POST http://localhost:<port>/git` `{ "repo": "<git rev-parse --show-toplevel>", "direction": "push" | "pull" }` with `curl -s -m 0.5`, in the background, output discarded.
- Any other event/state: exit immediately. **Always exit 0** (a non-zero `reference-transaction prepared` would abort git's transaction; a non-zero `pre-push` would abort the push).

A failed push never updates `refs/remotes/…`, so it never sends anything (owner asked for this).

Installer (same conventions as `claude-hooks.mjs` / `statusline.mjs`): `install [port]` (port must be digits), `uninstall` (removes exactly the `hook.agent-office-push` and `hook.agent-office-refs` sections), `status`. It honours `GIT_CONFIG_GLOBAL` (tests never touch the real `~/.gitconfig`). After installing it checks that git actually lists the hook (`git hook list pre-push`); if not (older git), it removes what it wrote and says git is too old.

### 2. Server: who gets the mail

- `HookAdapter` remembers, per Claude Code session, its `cwd` and the last actor (session agent or sub-agent) that used a tool, with a timestamp.
- `POST /git` → `adapter.git(repo, direction)`: picks the session whose `cwd` equals `repo` or is inside it (`repo + "/"` prefix), most recently active first, and emits `{ type: "agent_mail", agentId: <its last actor>, direction }`. No matching session → no event (`202`, `accepted: 0`).
- Remote-only tools: `PostToolUse` of a tool whose name ends with one of the suffixes in `shared/tool-stations.json` → `"mail": { "push": ["__push_files", "__create_or_update_file", "__delete_file"], "pull": [] }` emits `agent_mail` for that actor.
- `agent_mail` is transient: the tracker does not store it as `last` and snapshots never replay it.

### 3. Office: the errand and the truck

- New event `agent_mail { agentId, direction: "push" | "pull" }`.
- One truck, one mailbox. Pending mail is a queue; the truck serves everything pending in one trip (drops all pulls, collects all posted pushes).
- **Push:** the agent starts an errand: walks to the mailbox slot carrying a letter, posts it (mailbox "outgoing" +1, flag up), resumes. When at least one letter is posted and the truck is idle, the truck comes, stops, collects (flag down), leaves.
- **Pull:** the truck comes (if idle; else on its next trip), drops one letter per pending pull (flag up), leaves. Each addressee then runs an errand: walks to the mailbox, takes its letter (flag down when empty), carries it for ~3 s.
- An errand is short and takes priority: tool / waiting events received during an errand are queued and replayed when it ends (like events received while spawning). A despawn cancels it.
- The truck stops ~1 s to load/unload; whole visit ≈ 8–10 s.

### 4. Office layout and art (owner: "adapt the office if needed")

- A road in the void in front of the open space and lab: grid strip `y ∈ [9.6, 11.4]`, from `x = 10` to past the right edge of the world, drawn in the static layer (asphalt in palette inks, dashed centre line). Not walkable, not a room.
- The mailbox moves to the front edge of the open space, `(11, 8)`, facing the road; its station slot `(11, 7)` faces `SE`. The old mailbox spot `(0, 7)` is freed.
- The flag is driven by state (overlay), not by time: `MAILBOX` becomes a 1-frame sprite with the flag down; the overlay draws it up when the mailbox holds mail.
- Truck: small pixel-art van (palette colours, mail-red body, cream window, dark wheels) drawn in two facings (arriving toward the mailbox, leaving away), driving along the road, stopping in front of the mailbox. It is the front-most object there, drawn in the overlay before the beacons.
- Carried letter: a 4×3 cream/ink envelope at the agent's hand (overlay), like the coffee mug.

### 5. Demo, mock, docs

- The scripted scenario and the random scenario include a push and a pull so `?mock=1` and the demo show the truck.
- `docs/configuration.md`: git hook install/uninstall/status, requirements (git ≥ 2.54), what is detected and what is not, `POST /git`, `agent_mail`. README "What you see": one row for the truck.

## Constraints

Same as the previous feature: pixel art with `SCENE_WARM` colours only, no new dependencies, no perf regression at `?mock=stress&n=30`, all in English, every installer reversible and tested against temp config files only.

## Left to the builder

- Exact truck, road, envelope pixels and timings.
- Exact stop position of the truck along the road in front of the mailbox.
