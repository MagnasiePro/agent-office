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

- `pre-push`: writes a marker file `<git common dir>/agent-office-push` (private to the repo, shared by its worktrees; never a guessable name in a shared `/tmp`) listing the tracking refs the push will move and to which commit. No network call.
- `reference-transaction committed`: reads the ref updates on stdin; if any line touches `refs/remotes/`:
  - the moved ref and commit are listed in a marker < 120 s old → **push** (the line is removed; one POST per marker);
  - otherwise → **pull**.
  It then sends `POST http://localhost:<port>/git` `{ "repo": "<git rev-parse --show-toplevel>", "direction": "push" | "pull" }` with `curl -s -m 0.5`, in the background, output discarded.
- Any other event/state: exit immediately. **Always exit 0** (a non-zero `reference-transaction prepared` would abort git's transaction; a non-zero `pre-push` would abort the push).

A failed push never updates `refs/remotes/…`, so it never sends anything (owner asked for this).

Installer (same conventions as `claude-hooks.mjs` / `statusline.mjs`): `install [port]` (port must be digits), `uninstall` (removes exactly the `hook.agent-office-push` and `hook.agent-office-refs` sections), `status`. It honours `GIT_CONFIG_GLOBAL` (tests never touch the real `~/.gitconfig`). After installing it checks that git actually lists the hook (`git hook list pre-push`); if not (older git), it removes what it wrote and says git is too old.

### 2. Server: who gets the mail

- `HookAdapter` remembers, per Claude Code session, its `cwd` and the last actor (the session agent or sub-agent behind its latest hook event), with a timestamp.
- `POST /git` → `adapter.git(repo, direction)`: picks a session whose `cwd` equals `repo` or is inside it (`repo + "/"` prefix) before one whose `cwd` is a parent folder of `repo`, then the closest `cwd`, then the most recently active, and emits `{ type: "agent_mail", agentId: <its last actor>, direction }`. No matching session → no event (`202`, `accepted: 0`).
- Remote-only tools: `PostToolUse` of a tool whose name ends with one of the suffixes in `shared/tool-stations.json` → `"mail": { "push": ["__push_files", "__create_or_update_file", "__delete_file"], "pull": [] }` emits `agent_mail` for that actor.
- `agent_mail` is transient: the tracker does not store it as `last` and snapshots never replay it.

### 3. Office: the errand and the truck

- New event `agent_mail { agentId, direction: "push" | "pull" }`.
- One truck, one mailbox. Pending mail is a queue; the truck serves everything pending in one trip (drops all pulls, collects all posted pushes).
- **Push:** the agent starts an errand: walks to the mailbox slot carrying a letter, posts it (mailbox "outgoing" +1, flag up), resumes. When at least one letter is posted and the truck is idle, the truck comes, stops, collects (flag down), leaves.
- **Pull:** the truck comes (if idle; else on its next trip), drops one letter per pending pull (flag up), leaves. Each addressee then runs an errand: walks to the mailbox, takes its letter (flag down when empty), carries it for ~3 s.
- An errand is short and takes priority: tool events and `next_prompt` waits received during an errand are queued and replayed when it ends (like events received while spawning).
- A blocking wait (permission / input) cancels the errand so its beacon shows at once: a letter being posted drops into the mailbox anyway (truck called), a letter being fetched stays in the box until the wait ends.
- A despawn cancels the errand too, but the agent's outgoing letters (the one in hand and any still queued) are posted for it and the truck called; so is a push that arrives while the agent is on its way out. A pull letter for a gone agent is dropped.
- The truck stops ~1 s to load/unload; whole visit ≈ 8–10 s.

### 4. Office layout and art (owner: "adapt the office if needed")

- No road (owner): the truck drives through the void along the grid line `y = 10.5`, from past the right edge of the world, and stops in front of the mailbox. No shadow on the void.
- One mailbox only (owner): the existing mailbox moves from `(0, 7)` to the front edge of the open space, `(11, 8)`; its station slot `(11, 7)` faces `SE`. Nothing stays at `(0, 7)`.
- The flag is driven by state (overlay), not by time: `MAILBOX` becomes a 1-frame sprite with the flag down; the overlay draws it up when the mailbox holds mail.
- Truck (approved preview v3): pixel-art van ≈ 2.4 × 1.1 tiles, ink outline on every edge like the furniture, mail-red body (`red` sides, `coral1` top, `coral0` shaded face), white side stripe, `sky2` cab window, windscreen with two headlights, rear doors, wheels turning while it moves. **No envelope or letter drawn on the outside of the truck** (owner). Two facings: arriving (cab towards the mailbox, up-left) and leaving (cab towards the viewer, windscreen visible); the part of the van further back is drawn first so the cab never overlaps the cargo box wrongly. It is the front-most object there, drawn in the overlay before the beacons.
- Carried letter: a 4×3 cream/ink envelope at the agent's hand (overlay), like the coffee mug.

### 5. Demo, mock, docs

- The scripted scenario and the random scenario include a push and a pull so `?mock=1` and the demo show the truck.
- `docs/configuration.md`: git hook install/uninstall/status, requirements (git ≥ 2.54), what is detected and what is not, `POST /git`, `agent_mail`. README "What you see": one row for the truck.

## Constraints

Same as the previous feature: pixel art with `SCENE_WARM` colours only, no new dependencies, no perf regression at `?mock=stress&n=30`, all in English, every installer reversible and tested against temp config files only.

## Left to the builder

- Exact truck and envelope pixels and timings.
- Exact stop position of the truck along its lane in front of the mailbox.
