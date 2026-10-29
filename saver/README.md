# Agent Office — macOS screen saver (app extension)

Native screen saver that shows the Agent Office scene (`http://localhost:4317/`) full screen.

It is built as an **app extension** (`.appex`, extension point `com.apple.screensaver`), the format Apple's own savers use (Hello, Flurry, Drift…), rather than a legacy `.saver`: since macOS 26, the `legacyScreenSaver` engine falls back to Hello full screen for third-party `.saver` bundles (see WebViewScreenSaver, issue #97).

Based on [AppexSaverMinimal](https://github.com/AerialScreensaver/AppexSaverMinimal) by Guillaume Louel (MIT license, see `LICENSE` and `UPSTREAM-README.md`). Changes: a full-screen web view instead of the rainbow, `dev.agent-office.saver` identifiers, outgoing network access (sandbox), ATS `NSAllowsLocalNetworking`, no options sheet, local signing by default.

## Install

Requirements: Xcode, and the Agent Office server running (`scripts/launchagent.sh install` at the repository root).

```bash
saver/install.sh
```

The script builds in Release with **local signing** (no Apple Developer account), copies the app to `~/Applications/AgentOfficeSaver.app`, registers it with PlugInKit and restarts `WallpaperAgent`. Then: System Settings → Wallpaper → Screen Saver → **Agent Office**.

Uninstall: `saver/install.sh uninstall`.

Custom URL (default `http://localhost:4317/`): the `url` key of the `dev.agent-office.saver.Extension` domain (read through `ScreenSaverDefaults` from the extension's sandbox container).

## Lightweight `.saver` variant (tested, works)

`saver/legacy/build.sh` builds a minimal `.saver` (`AgentOffice.saver`, URL hard-coded in `saver/legacy/AgentOfficeLegacyView.swift`) into `~/Library/Screen Savers/`; it renders full screen without flickering on macOS 26. Select **AgentOffice** (no space) in Settings, after `killall legacyScreenSaver` if needed.

## Flicker / black screen in a screen saver WKWebView

Inside a screen saver, WebKit thinks the window is hidden: `document.hidden` stays true, `requestAnimationFrame` stops and the content is hidden (`hideContentUntilPendingUpdate`), even though JS keeps running. Workaround applied in both views:

- `windowOcclusionDetectionEnabled = false` on the `WKWebView` and `pageVisibilityBasedProcessSuppressionEnabled = false` (private APIs, via KVC);
- an injected script that forces `document.hidden = false` and `window.__forceManualFrames`, then a `CADisplayLink` that calls `window.__agentOfficeManualTick()` (see `src/engine/loop.ts`).

## Limitations

- **Private API**: Apple has not documented this extension point for third parties; a macOS update may break it. Distribution outside the App Store only; for other Macs, sign with a Developer ID and notarize.
- **Managed Macs (MDM)**: a configuration profile that enforces `com.apple.screensaver` → `moduleName` (e.g. `Hello`) overrides the choice made in Settings: the preview shows Agent Office but full screen launches the enforced saver. Check with `plutil -p "/Library/Managed Preferences/com.apple.screensaver.plist"`. Only the MDM administrator can lift this constraint; until then, the lock screen option ([`lock/`](lock/README.md)) shows the scene from a menu bar app instead.
- Diagnostics: `log stream --predicate 'subsystem BEGINSWITH "dev.agent-office"'` shows the extension and page loading.
