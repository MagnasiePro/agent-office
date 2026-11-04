# Agent Office: rules for Claude

## Project rules

- Everything in English: code, comments, docs, commit messages, UI text.
- The scene shows no text overlays. Anything textual (like the update notice) lives outside the canvas.
- The repo is public: every feature must work for any user and be opt-in or configurable (environment variables are documented in `docs/configuration.md`).
- Never modify a user's config (`~/.claude/settings.json`, LaunchAgents...) without a backup and an exact undo.

## Releases

Users are offered an update only when a GitHub release `vX.Y.Z` exists (see `docs/configuration.md#updates`). CI creates that release from the tag once typecheck, tests and build pass.

When a batch of work is merged on `main` and ready to ship:

1. Bump `version` in `package.json` (semver) and commit it on `main`.
2. Tag that commit `vX.Y.Z` (same version) and push the tag.
3. Check the CI run: a failing check means no release; fix, bump again, re-tag.

Never create or push a tag, or publish a release, without the maintainer's explicit go: it is a public action that reaches every user.
