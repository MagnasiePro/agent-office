# Agent Office — lock screen option for managed Macs

An option of the screen saver, not a replacement: use the saver (`saver/legacy/build.sh`, see [`../README.md`](../README.md)) whenever you can. This option is a workaround for Macs whose MDM profile forces the screen saver (`moduleName` enforced, see `saver/README.md` → Limitations), so a third-party saver never shows.

It is a menu bar app that shows the Agent Office scene full screen and only goes away with **Touch ID or your login password**.

It's an ordinary app, so it needs no screen-saver setting and no admin rights. It contains everything: the scene server, the built scene and the Claude Code hooks installer. You don't need to run `pnpm dev` or the LaunchAgent.

## Install (from the repository)

Requirements: Xcode command-line tools, Node.js and pnpm.

```bash
saver/lock/build.sh
```

This builds `saver/lock/build/Agent Office.app` (scene, server bundled into one file, icon rendered by `scripts/app-icon.ts`), copies it to `~/Applications` and launches it. On first launch a setup sheet offers to:

- add the Claude Code hooks (`~/.claude/settings.json`, merged and backed up; same script as `scripts/claude-hooks.mjs`);
- open at login;
- grant Accessibility permission, for the shortcut blocker (optional, see Security).

`saver/lock/build.sh build` only builds; `saver/lock/build.sh uninstall` quits and removes the app (hooks: `node scripts/claude-hooks.mjs uninstall`).

## Share it with colleagues

```bash
saver/lock/build.sh package
```

This produces `saver/lock/build/AgentOffice.zip` (~45 MB, Apple silicon), with Node.js embedded so recipients need nothing else installed. They unzip it, move **Agent Office** to Applications and open it; the setup sheet does the rest.

The app is signed ad hoc, not notarized, so the first time macOS blocks it. Recipients choose System Settings → Privacy & Security → **Open Anyway**, or run `xattr -dr com.apple.quarantine "/Applications/Agent Office.app"`. Some managed Macs refuse unnotarized apps entirely. With an Apple Developer account, `SIGN_ID="Developer ID Application: …" saver/lock/build.sh package` signs with your certificate (notarization isn't scripted).

## Use

| | |
|---|---|
| Lock now | **⌃⌥⌘L**, the menu bar item, or `open agent-office://lock` (Shortcuts, Raycast, Stream Deck…) |
| Shortcut | menu → Change Shortcut…, then press the new combination (must include ⌃, ⌥ or ⌘). If macOS or another app already owns it, the menu says **Unavailable**. Keyboard remappers (Karabiner, a tiling window manager…) can swallow a combination before it gets here |
| Lock when idle | menu → Lock When Idle (Never / 1–30 min, default 5). Skipped while an app holds a display-sleep assertion (video, call), like the real screen saver |
| Unlock | touch the Touch ID sensor at any time, or move the mouse / press a key → password field at the bottom → Return. Esc hides it |
| Scene server | started by the app if nothing answers on the scene URL (a dev server or the LaunchAgent wins), restarted if it dies, stopped on quit. Logs: `~/Library/Logs/AgentOffice-server.log` |
| Scene URL | `defaults write dev.agent-office.lock sceneURL http://localhost:4317/` |

First try (recommended): `"$HOME/Applications/Agent Office.app/Contents/MacOS/AgentOffice" --lock --test-unlock-after 60`. It locks, then unlocks by itself after 60 s even if something goes wrong.

## Security

While locked:

- **Cover**: one borderless window per display at `CGShieldingWindowLevel()` (above everything, including the menu bar and notifications), on all Spaces; new displays are covered too. Clicks never reach the page.
- **Kiosk mode** (`NSApplication.presentationOptions`): no Dock, menu bar, Cmd-Tab, Force Quit (⌥⌘⎋), Apple menu, hide or log out/restart. If another app takes focus, the lock takes it back at once.
- **Shortcut blocker** (needs Accessibility; menu → Block System Shortcuts While Locked): a `CGEventTap` swallows ⌘/⌃ shortcuts, ⌥Space, function and media keys, the Globe key, scroll and trackpad gestures. Plain typing still reaches the password field. Without it, other apps' global hotkeys (Spotlight, Raycast, Shortcuts…) still fire behind the overlay. They can't type into the app they open, but a hotkey bound to a script would run.
- **Unlock**: Touch ID (a biometrics-only `LAContext` kept armed), or your login password checked through Open Directory (`ODRecord.verifyPassword`, which also works for directory/mobile accounts). After 3 failures there is a 30 s cooldown. There is no unlock URL or command.

It is still a **privacy curtain, not the macOS login window**:

- Anyone who can already run commands as you (SSH, Screen Sharing, a remote session) can `pkill` it.
- Holding the power button restarts the Mac, which lands on the real login screen (password / FileVault).
- Siri, if enabled, can still act behind the overlay, and hot corners still trigger.
- For a real lock, **⌃⌘Q** still works, and your organization's own lock policy applies on top.
- Ad-hoc builds change signature on every rebuild, so macOS forgets the Accessibility permission. Re-enable it after `saver/lock/build.sh` (System Settings → Privacy & Security → Accessibility).
