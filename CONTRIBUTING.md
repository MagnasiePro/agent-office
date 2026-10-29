# Contributing

Issues and pull requests are welcome. Good first contributions: a new character, a piece of furniture or a room, a new visual state, or support for another coding agent (it only needs to send events to [`POST /events`](docs/configuration.md#event-api)).

- [Before opening a pull request](#before-opening-a-pull-request)
- [Architecture](#architecture)
- [Adding a character](#adding-a-character)
- [Adding furniture, a workstation or a room](#adding-furniture-a-workstation-or-a-room)
- [Design and quality references](#design-and-quality-references)

## Before opening a pull request

```bash
pnpm typecheck && pnpm test
```

Then check the result in the gallery (`pnpm dev`, then <http://localhost:4317/gallery>). `pnpm test:visual` runs the browser tests.

Out of scope for now: mouse interaction, sound, persistence and authentication.

## Architecture

```
shared/              contract shared by the page and the server
  events.ts            AgentEvent and Snapshot (zod)
  tool-stations.json   tool → workstation type → animation
  scenario.ts          scripted, random and stress scenarios (simulator and ?mock)
server/              Node (tsx)
  index.ts             HTTP, WebSocket /events, POST /hook, POST /events, demo
  hook-adapter.ts      Claude Code hook payload → AgentEvent
  tracker.ts           live agents, replayed as a snapshot on every (re)connection
src/engine/          generic engine, knows no character
  bitmap, shape, isoPaint   pixels, auto-shaded masks, isometric primitives
  iso.ts               2:1 projection (32×16 tiles) and topological depth sort
  pathfinding.ts       4-connected A* with thin walls (partitions)
  agent.ts             position, movement and animation of one agent
  sprite.ts            CharacterDefinition → pre-rendered frames (mirrors, tint, poof)
  loop.ts              requestAnimationFrame loop capped at 30 fps, paused when hidden
src/characters/      one file per character, registry, kinds.json
src/world/           palette, furniture, office plan (layout.ts), static rendering
src/scene/           simulation (office.ts), compositor, camera, ambience, bubbles
saver/               macOS screen savers and the lock screen option
```

Sprites are fully procedural (no image files): a 24-colour palette, integer scaling for crisp pixels, at most 30 fps and no rendering while the page is hidden.

The simulation (`src/scene/office.ts`) is pure logic, tested with a fake clock. An agent's life cycle:

```
spawning → idle ⇄ walking → working ⇄ waiting → done → (returning) → despawning
```

## Adding a character

1. Create `src/characters/mycharacter.ts` exporting a `CharacterDefinition`. [`robot.ts`](src/characters/robot.ts) (~150 lines) is a good model. It defines:
   - the palette, and the colours that are never tinted (`fixedColors`);
   - `full` and `mini` sizes: frame, foot anchor, shadow, head;
   - the animations: reuse `STANDARD_ANIMATIONS` and `poseFor()` from `pose.ts` for the same feel;
   - `draw(bitmap, ctx)`, which draws one frame seen from the front (SE) or the back (NE);
   - where it likes to rest (`idlePreferences`).
2. Register it in `src/characters/index.ts`: `.register(MY_CHARACTER)`.
3. Map an agent kind to it in `src/characters/kinds.json`, e.g. `"codex": "mycharacter"`.

The engine provides the SW/NW mirrors, per-instance variants (tint, accessory), the appear/leave poof, the shadow, bubbles and depth sorting. To use PNG spritesheets instead, `draw` only has to copy an image's pixels into the given `Bitmap`.

## Adding furniture, a workstation or a room

- **Furniture**: a `FurnitureDef` in `src/world/furniture.ts`, with a footprint in tiles and `draw(painter, palette, frame)` built from `box`, `planeX`, `planeY` and `planeZ`. Add it to `ALL_FURNITURE` to see it in the gallery.
- **Workstation**: in `src/world/layout.ts`, `put(FURNITURE, x, y)`, then `station(id, type, room, [{ x, y, dir }])` with the tiles where agents stand and the direction they face. A workstation can have several spots; when they are all taken, agents wait nearby.
- **Which tool goes where**: `shared/tool-stations.json` maps exact tool names (`tools`) and prefixes such as `mcp__` (`prefixes`) to a workstation type, and each type to its `animations`.
- **Room**: add a `Room` (position, size, floor `planks`, `tiles` or `checker`, optional rug), its `partitions` and their `doors`, and optionally `windows`, `posters`, `fairyLights` and `lamps`. Depth sorting, pathfinding and the camera adapt on their own.

## Design and quality references

- [`docs/art-direction.md`](docs/art-direction.md): style guide (palette, lighting, outlines, proportions, design decisions).
- [`docs/qa-report.md`](docs/qa-report.md): acceptance criteria, test results, performance measurements, bugs found and fixed.
- [`docs/screenshots/`](docs/screenshots/): screenshots of each milestone and of the QA.
