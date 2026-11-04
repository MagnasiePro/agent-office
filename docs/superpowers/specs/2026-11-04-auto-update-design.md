# Offered updates: design

Date: 2026-11-04. Branch: `feat/auto-update` (from `main`).

## Intent

Agent Office is installed by `git clone` and often runs unattended (LaunchAgent + screen saver), so nobody notices when a new version exists, neither the maintainer nor other users of the public repo. The app should **notice that a newer release exists and offer it**. It never updates on its own: applying is a deliberate command the user runs and confirms.

## Goals

- A clear notion of "version": GitHub releases tagged `vX.Y.Z`, only published once CI passes.
- A visible but unobtrusive notice on the screen (browser and screen saver), outside the scene.
- A one-command, confirmed, safe apply for git checkouts.
- Off switch documented with the other settings.

## Non-goals

- Silent or scheduled auto-apply.
- Updating non-git installs (zip download): the notice and `check` still work, `apply` points to the release page.
- A dedicated `rollback` command (the apply prints the exact undo instead).
- Playwright visual tests in CI.

## Anti-goals (failure even if it works)

- Touching the user's uncommitted work (no auto-stash, no reset, no merge commit).
- Text drawn **on** the scene, or any change under `src/scene/*` (PR #4 is editing it).
- Changing the user's LaunchAgent settings (e.g. `DEMO=0`, custom `PORT`) during an update.
- Breaking the app when offline or rate-limited by GitHub.

## Decisions (made with the user)

### 1. What is a version

- A version is a **GitHub release with tag `vX.Y.Z`**. Commits on `main` between releases offer nothing.
- **CI (new, GitHub Actions)**:
  - on every pull request and push to `main`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`;
  - on push of a tag `v*`: the same checks, then check the tag equals `v` + `package.json` `version`, then create the GitHub release with generated notes. Any failure → no release → nothing offered to users.
- **A committed `CLAUDE.md`** at the repo root carries the release rule: when a batch of work is merged on `main` and ready, bump `version` in `package.json`, commit, tag `vX.Y.Z` and push the tag; CI publishes the release. Claude never tags or pushes a tag without the maintainer's explicit go (it is a public action). The file also states the standing project rules: everything in English, no text overlays on the scene, every feature opt-in/configurable, never touch user config without backup and exact undo.

### 2. How the user hears about it

- **Server check**: at startup, then every 24 h, the server reads `https://api.github.com/repos/MagnasiePro/agent-office/releases/latest` (no token) and compares its `tag_name` with `package.json` `version`. Network error, non-200 or rate limit → ignored, retried next cycle. Drafts and pre-releases are already excluded by `/releases/latest`.
- **`/health`** gains `update: { current, latest, available, url }` (`latest`/`url` null until a check succeeds). Existing fields unchanged.
- **Log line** when an update is found: `[agent-office] update available: v0.1.0 → v0.3.0 (node scripts/update.mjs apply)`.
- **Notice on screen: option B, right column** (chosen from mockups). Only while `available` is true, the page reserves a narrow dark column on the right edge of the window; the scene canvas is fitted into the remaining width. At the bottom of the column, stacked: an amber dot, `vX.Y.Z available`, `update.mjs apply` (muted). No update → no column, the scene fills the screen exactly as today. Same page in the browser and in the screen saver. Implemented in `src/main.ts` / `index.html` only (HTML element next to the canvas; `fit()` subtracts the column width), never in `src/scene/*`.
- **Off switch**: `UPDATE_CHECK=0` → no network request, `update.available` stays false, no column. Default on. Documented in `docs/configuration.md` next to `PORT`/`DEMO`, and passed through by `scripts/launchagent.sh install` like `PORT`/`DEMO`.
- A local version equal to or newer than the latest release (e.g. a dev branch) shows nothing.

### 3. How it is applied: `node scripts/update.mjs check|apply`

- `check`: prints current version, latest release, release URL. Changes nothing. An explicit command always checks, even with `UPDATE_CHECK=0` (that variable only governs the server's background check).
- `apply`: prints the plan and asks `y/N` (`--yes` skips the prompt). Then:
  1. `git fetch --tags origin`, then `git merge --ff-only vX.Y.Z`: moves exactly to the release, not to the tip of `main`.
  2. `pnpm install --frozen-lockfile`, then `pnpm build`.
  3. If the LaunchAgent is installed **and its plist `WorkingDirectory` is this checkout**, restart it **without rewriting its plist** (new `scripts/launchagent.sh restart` = `launchctl kickstart -k`), so the user's `PORT`/`DEMO`/`UPDATE_CHECK` survive. If it points to another checkout, say so and don't restart it. No LaunchAgent → print "restart your server". *(Builder's call, settled in review.)*
  4. If anything under `saver/` changed between the old commit and the tag, print the rebuild command (`saver/legacy/build.sh`); native binaries are not rebuilt automatically. *(Builder's call.)*
- **Guards: refuse with an explanation, change nothing**, when:
  - HEAD is not on the `main` branch (feature branch or detached HEAD): moving a feature branch to a release is never what the user meant. *(Builder's call.)*
  - the working tree has uncommitted changes;
  - fast-forward to the tag is impossible (local commits / diverged branch);
  - the folder is not a git checkout → print the release URL;
  - already up to date.
- **Undo**: before step 1, print the starting commit and the exact commands to go back (`git reset --hard <sha> && pnpm install --frozen-lockfile && pnpm build`, then restart).

## Constraints

- Public repo: works for any user, all code/docs/UI text in English.
- Node 20.11+, pnpm; no new runtime dependency for this (semver comparison is a few lines; `fetch` is built in).
- Follow the installer conventions of `scripts/claude-hooks.mjs` (plain `.mjs`, subcommands, clear messages).
- Built on `main`, its own PR. PR #4 also edits `server/index.ts` (`/health`), `src/main.ts` (`fit()`) and `docs/configuration.md`: keep these edits small and self-contained so whichever PR merges second rebases easily.
- `README.md` currently says to re-run `scripts/launchagent.sh install` after updating, which rewrites the plist; replace it with the `update.mjs apply` flow.
- Tests (`pnpm test`, Vitest): version comparison, check result shaping (success, error, rate limit), apply guards (dirty tree, non-ff, not git, up to date), with git and network mocked. `pnpm typecheck` passes.
- Docs: `docs/configuration.md` (setting + "Updates" section), `README.md` (short mention), `CLAUDE.md`.

## Left to the builder

- Where the shared check logic lives (e.g. exported from `scripts/update.mjs` and imported by the server, or a small module both use) as long as the server and the CLI agree.
- Column width, font and colours (match the scene's palette, readable at screen-saver distance, no text over the canvas). How often the page re-reads `/health` (it must pick up an update found while the page is open, e.g. hourly, and drop the column after the server restarts on the new version).
- CI details: Node version(s), action versions, caching.
- Exact wording of messages.
