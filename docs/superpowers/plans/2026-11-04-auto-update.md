# Offered Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a newer GitHub release, show it in a right-side column outside the scene, and apply it on demand with `node scripts/update.mjs apply`.

**Architecture:** One plain-JS module `scripts/update.mjs` holds the version logic (compare, fetch latest release, apply guards) and doubles as the CLI; the server imports it (via `allowJs`) for its background check and `/health` field; `src/main.ts` reads `/health` and reserves a column. CI on GitHub Actions validates and publishes releases from `v*` tags.

**Tech Stack:** Node 20.11+, TypeScript via tsx, Vitest, Vite, bash, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-04-auto-update-design.md`

## Global Constraints

- All code, docs, messages and UI text in English.
- No new runtime dependency; built-in `fetch` and `node:child_process`.
- Never edit `src/scene/*`. Keep edits to `server/index.ts`, `src/main.ts`, `docs/configuration.md` small (PR #4 touches them).
- Release source: `https://api.github.com/repos/MagnasiePro/agent-office/releases/latest`, tag format `vX.Y.Z`.
- `UPDATE_CHECK=0` disables the server's background check only; the CLI always checks.
- Check interval: 24 h. `apply` never stashes, resets or creates merge commits.

## Review Focus

- GitHub returns 403 (rate limit) or the machine is offline → server keeps running, `available: false`, no crash, no log spam (Task 1 test `fetchLatest returns null on non-200 / throw`).
- Tag with odd shape (`v0.3.0-beta`, `0.3.0`, missing `tag_name`) → no false "update available" (Task 1 tests on `compareVersions` and `parseRelease`).
- `/health` unreachable from the page (mock mode, server down) → no column, scene unchanged (Task 3: `fetch` wrapped in catch).
- `apply` on a feature branch or detached HEAD → refuse, nothing changed (Task 4 guard test).
- LaunchAgent pointing at another checkout → not restarted, warning printed (Task 4 test on `agentRoot`).

---

### Task 1: Version logic in `scripts/update.mjs`

**Files:**
- Create: `scripts/update.mjs`
- Modify: `tsconfig.json` (add `"allowJs": true`)
- Test: `tests/unit/update.test.ts`

**Interfaces:**
- Produces:
  - `compareVersions(a: string, b: string): number` — strips a leading `v`; returns <0, 0, >0; any input not matching `^\d+\.\d+\.\d+$` after strip compares as "not newer" (returns 0).
  - `parseRelease(body: unknown): { latest: string; url: string } | null` — from `{ tag_name, html_url }`; `latest` without the `v`.
  - `fetchLatest(fetchFn = fetch): Promise<{ latest: string; url: string } | null>` — GET `RELEASES_URL` with `accept: application/vnd.github+json`, 5 s timeout (`AbortSignal.timeout`); null on throw or non-200.
  - `checkUpdate(current: string, fetchFn = fetch): Promise<UpdateInfo>` where `UpdateInfo = { current: string; latest: string | null; available: boolean; url: string | null }`.
  - `readVersion(root: string): string` — `package.json` version.
  - `RELEASES_URL`, `ROOT` constants.

- [ ] **Step 1: Write failing tests** (`tests/unit/update.test.ts`, import from `../../scripts/update.mjs`)
  - `compareVersions("0.1.0", "v0.3.0") < 0`, `("1.10.0", "1.9.0") > 0`, `("v1.0.0", "1.0.0") === 0`, `("0.1.0", "v0.3.0-beta") === 0`, `("0.1.0", "garbage") === 0`.
  - `parseRelease({ tag_name: "v0.3.0", html_url: "https://x" })` → `{ latest: "0.3.0", url: "https://x" }`; `parseRelease({})` → null; `parseRelease(null)` → null.
  - `fetchLatest` with a fake fetch returning `{ ok: false, status: 403 }` → null; fake fetch that throws → null.
  - `checkUpdate("0.1.0", fakeOk("v0.3.0"))` → `{ current: "0.1.0", latest: "0.3.0", available: true, url }`; `checkUpdate("0.3.0", fakeOk("v0.3.0")).available === false`; network failure → `{ latest: null, available: false, url: null }`.
- [ ] **Step 2:** `pnpm test tests/unit/update.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement the exports above. The CLI entry (`main()`) runs only when `import.meta.url === pathToFileURL(process.argv[1]).href`; for now `check` prints `current`, `latest`, `url` or "up to date"/"could not reach GitHub". Header comment in the style of `scripts/claude-hooks.mjs` (usage lines).
- [ ] **Step 4:** `pnpm test` and `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(update): version check against the latest GitHub release`.

### Task 2: Server background check and `/health`

**Files:**
- Modify: `server/index.ts` (settings block near `DEMO`, `/health` handler)

**Interfaces:**
- Consumes: `checkUpdate`, `readVersion`, `UpdateInfo` from Task 1.
- Produces: `/health` → `{ ..., update: UpdateInfo }`.

- [ ] **Step 1:** Add `const UPDATE_CHECK = process.env.UPDATE_CHECK !== "0";` with a one-line doc comment like `DEMO`. `let update: UpdateInfo = { current: readVersion(ROOT), latest: null, available: false, url: null }`. If enabled: run `checkUpdate` now and every 24 h (`setInterval(...).unref()`); on a newly found version log once `[agent-office] update available: v<current> → v<latest> (node scripts/update.mjs apply)`.
- [ ] **Step 2:** Add `update` to the `/health` JSON.
- [ ] **Step 3:** Verify: `pnpm typecheck`; start on a free port (`PORT=4399 pnpm dev`, background), `curl -s localhost:4399/health` shows `update.current: "0.1.0"`; with `UPDATE_CHECK=0` no request is made (`latest: null`). Stop the server.
- [ ] **Step 4:** Commit `feat(server): background update check exposed in /health`.

### Task 3: Right-side notice column in the page

**Files:**
- Modify: `src/main.ts` (`fit()` and a small block after it), `index.html` (style for `#update`)

**Interfaces:**
- Consumes: `/health` `update` field (Task 2).

- [ ] **Step 1:** In `index.html`, style `#update`: `position: absolute; top: 0; right: 0; bottom: 0; width: 120px; background: #0b0812; color: #b9a8d9; font: 12px/1.35 ui-monospace, Menlo, monospace; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; padding: 14px 12px; box-sizing: border-box;` plus `.dot` (amber `#f3b23c`, 8 px circle) and `.muted` (`#6d5f8a`). Hidden by default (`display: none` unless `.on`).
- [ ] **Step 2:** In `src/main.ts`: an `<aside id="update">` with dot, `v<latest> available`, muted `update.mjs apply`. `let column = 0;` and `fit()` passes `innerWidth - column` to `viewportFor`. `refreshUpdate()` fetches `/health` (skip when `mock` is set), catches every error, toggles `.on`, sets `column = on ? 120 : 0`, calls `fit()` only if `column` changed. Run at start and every hour (`setInterval`).
  Split the DOM toggle into `showUpdate(info: { available: boolean; latest: string | null })` and expose it on the existing `__agentOffice` QA hook.
- [ ] **Step 3:** Verify in the browser preview (dev server on a free port): call `__agentOffice.showUpdate({ available: true, latest: "0.3.0" })` → column on the right, canvas css width = window width − 120, no text over the canvas; `showUpdate({ available: false, latest: null })` → column gone, canvas full width. `pnpm typecheck`, `pnpm test`.
- [ ] **Step 4:** Commit `feat(page): update notice in a right-side column outside the scene`.

### Task 4: `apply` command and LaunchAgent restart

**Files:**
- Modify: `scripts/update.mjs`, `scripts/launchagent.sh`
- Test: `tests/unit/update.test.ts`

**Interfaces:**
- Produces:
  - `preflight(git: (args: string[]) => { code: number; out: string }, tag: string): string | null` — returns the refusal message or null. Checks in order: not a git checkout (`rev-parse --is-inside-work-tree` fails) → message with release URL hint; branch (`rev-parse --abbrev-ref HEAD`) not `main` (includes `HEAD` = detached); dirty (`status --porcelain` non-empty); tag already an ancestor of HEAD → "already up to date"; HEAD not an ancestor of tag (`merge-base --is-ancestor HEAD <tag>` fails) → "diverged".
  - `agentRoot(plistText: string): string | null` — `WorkingDirectory` string from the plist XML.
  - `saverChanged(git, from: string, tag: string): boolean` — `diff --name-only <from> <tag> -- saver/` non-empty.

- [ ] **Step 1: Failing tests** with a fake `git` built from a map `args.join(" ") → { code, out }`:
  - not a work tree → message contains "not a git checkout"; branch `feat/x` → contains "main"; `HEAD` → contains "main"; porcelain ` M src/main.ts` → contains "uncommitted"; `merge-base --is-ancestor v0.3.0 HEAD` code 0 → contains "up to date"; `merge-base --is-ancestor HEAD v0.3.0` code 1 → contains "diverged"; all clean → null.
  - `agentRoot` on a sample plist with `<key>WorkingDirectory</key><string>/a/b</string>` → `/a/b`; no key → null.
  - `saverChanged` true when diff output `saver/lock/x.swift`, false on empty.
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implement, then the `apply` CLI flow: `checkUpdate` → if not available, print and exit 0; `git fetch --tags origin`; `preflight` (exit 1 with message); print plan + undo (`git reset --hard <sha> && pnpm install --frozen-lockfile && pnpm build`); prompt `Apply vX.Y.Z? [y/N]` via `node:readline/promises` unless `--yes`; `git merge --ff-only v<latest>`, `pnpm install --frozen-lockfile`, `pnpm build` (spawnSync, `stdio: "inherit"`, stop on first non-zero exit, print undo again); `saverChanged` → print `saver/legacy/build.sh`; LaunchAgent at `~/Library/LaunchAgents/com.agent-office.server.plist`: `agentRoot` equal to `ROOT` → `scripts/launchagent.sh restart`, different → warn with its path, missing → "restart your server".
- [ ] **Step 4:** `scripts/launchagent.sh`: add `restart)` → `launchctl kickstart -k "$DOMAIN/$LABEL"`; add `UPDATE_CHECK="${UPDATE_CHECK:-1}"` and its `<key>UPDATE_CHECK</key>` entry next to `DEMO`; update the usage comments and `usage:` line.
- [ ] **Step 5:** `pnpm test`, `pnpm typecheck`, `bash -n scripts/launchagent.sh`, `node scripts/update.mjs check` → prints current 0.1.0 and "could not reach GitHub"/no release message (no release exists yet). Commit `feat(update): confirmed apply with guards and LaunchAgent restart`.

### Task 5: CI, release rule, docs

**Files:**
- Create: `.github/workflows/ci.yml`, `CLAUDE.md`
- Modify: `docs/configuration.md`, `README.md:87`

- [ ] **Step 1:** `ci.yml`: triggers `pull_request`, `push` on `main` and tags `v*`. Job `check` (ubuntu-latest): checkout, `pnpm/action-setup`, `actions/setup-node` with Node 20 and pnpm cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Job `release` (`needs: check`, `if: startsWith(github.ref, 'refs/tags/v')`, `permissions: contents: write`): fail unless `${GITHUB_REF_NAME}` = `v$(node -p "require('./package.json').version")`; then `gh release create "$GITHUB_REF_NAME" --generate-notes --verify-tag` with `GH_TOKEN: ${{ github.token }}`.
- [ ] **Step 2:** `CLAUDE.md`: release rule (bump `package.json` → commit → tag `vX.Y.Z` → push tag; CI publishes; never tag/push a tag without the maintainer's explicit go) and the standing rules (English everywhere, no text overlays on the scene, features opt-in/configurable, user config only with backup and exact undo).
- [ ] **Step 3:** `docs/configuration.md`: `UPDATE_CHECK` row in Settings; `update.mjs` and `launchagent.sh restart` in commands; new "Updates" section (what is checked and when, the right column, `check`/`apply`, guards, undo, saver rebuild hint, how releases are made). `README.md`: replace the line "After updating the code, run `scripts/launchagent.sh install` again." with the `node scripts/update.mjs apply` flow and a link to the Updates section.
- [ ] **Step 4:** Validate the workflow YAML parses (`node -e` with a quick check or `npx --yes yaml-lint` not allowed → use `ruby -ryaml -e 'YAML.load_file(...)'`), `pnpm test`, `pnpm typecheck`. Commit `ci: checks on PRs and releases from v* tags; docs and release rule`.
