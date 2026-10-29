<h1 align="center">Agent Office</h1>

<p align="center">
  A pixel-art office at night where every Claude Code session is a little character at work.<br>
  Runs in the browser or as a macOS screen saver.
</p>

<p align="center">
  <img src="docs/screenshots/m3b-world-overview.png" alt="The Agent Office scene: an open space, a lab and a cafeteria at night" width="820">
</p>

Each Claude Code session, and each sub-agent it starts, walks to the workstation that matches the tool it is using: typing at a desk, reading in the lab, running commands at the servers. When it needs you, a bubble pops up above its head. When it's idle, it takes a coffee break or falls asleep.

## Contents

- [What you see](#what-you-see)
- [Quick start](#quick-start)
- [Use it as a screen saver](#use-it-as-a-screen-saver)
- [Further reading](#further-reading)

## What you see

<p align="center">
  <img src="docs/screenshots/states-sprites.png" alt="Every animation of the Clawd character, in the four directions" width="820">
</p>

| State | On screen |
|---|---|
| **Working** | At a workstation; the animation depends on the tool (typing, reading, terminal…) |
| **Needs permission** | Red **!** bubble |
| **Waiting for you** | Blue **?** bubble |
| **Done** | A small victory jump with sparkles, then a coffee break |
| **Idle** | Wanders, chats, goes to the cafeteria, falls asleep after ~25 s |
| **Sub-agent** | A mini version of its parent, with its own tint |

A waiting agent goes back to work as soon as it uses a tool or you send a new prompt.

## Quick start

Requirements: Node.js 20.11+ and pnpm.

**1. Start the server**

```bash
git clone https://github.com/MagnasiePro/agent-office.git
cd agent-office
pnpm install
pnpm dev
```

Open <http://localhost:4317>. A demo plays until the first real event arrives.

**2. Connect Claude Code**

```bash
node scripts/claude-hooks.mjs install
```

This adds hooks to `~/.claude/settings.json`: it merges with your existing hooks and saves a backup first. Every Claude Code session now shows up in the office, including those already open (from their next event). Undo with `node scripts/claude-hooks.mjs uninstall`.

> [!TIP]
> <http://localhost:4317/gallery> shows every character, animation and piece of furniture.

## Use it as a screen saver

macOS only. Tested on macOS 26.

**1. Keep the server running in the background.** It starts at login and restarts on its own:

```bash
scripts/launchagent.sh install
```

**2. Build and install the screen saver:**

```bash
saver/legacy/build.sh
```

**3. Select it:** System Settings → Wallpaper → Screen Saver → **AgentOffice**.

**4. Lock the Mac when the screen saver starts:** System Settings → Lock Screen → **Require password after screen saver begins**. Leaving the screen saver then goes through the real macOS lock screen.

> [!NOTE]
> **Company Mac with a forced screen saver?** If your organization's MDM profile enforces the screen saver, macOS ignores your choice and shows its own. Ask your administrator to lift it. A menu bar app ([`saver/lock/`](saver/lock/README.md)) can show the scene instead, but it is **less secure than the macOS lock screen and not recommended on a company Mac**.

After updating the code, run `scripts/launchagent.sh install` again. Other screen saver variants and troubleshooting are in [`saver/README.md`](saver/README.md).

## Further reading

| Document | For |
|---|---|
| [Configuration](docs/configuration.md) | Commands, settings, the event API, manual hook setup, testing without a server |
| [Contributing](CONTRIBUTING.md) | Architecture, adding a character, furniture or a room, checks before a pull request |
| [Screen saver](saver/README.md) | Screen saver variants, how they work, limitations |
| [Art direction](docs/art-direction.md) | Palette, lighting, proportions, design decisions |

## License

[MIT](LICENSE). The `saver/` folder reuses an MIT-licensed screen saver template (see [`saver/LICENSE`](saver/LICENSE)).
