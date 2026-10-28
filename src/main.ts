import type { AgentEvent } from "../shared/events";
import { SCENE_WARM } from "./art/palette";
import { createRegistry } from "./characters";
import { toCanvas } from "./engine/canvas";
import { gridToScreen } from "./engine/iso";
import { startLoop } from "./engine/loop";
import { connectWs, startMock, type EventSink } from "./net/source";
import { Ambient } from "./scene/ambient";
import { Camera, viewportFor } from "./scene/camera";
import { WorldView } from "./scene/compose";
import { Office } from "./scene/office";
import { OFFICE } from "./world/layout";
import { renderBackground, VIEW_H, VIEW_W, worldContentRows } from "./world/roomRender";

/**
 * Screensaver entry point: full-window, no cursor, no interaction.
 * Query params: ?mock=1|random|stress[&n=30][&speed=2]  ?ws=ws://host/events  ?freeze=S (QA)
 */
const params = new URLSearchParams(location.search);
const pal = SCENE_WARM;

const registry = createRegistry();
const office = new Office(OFFICE, registry);
const view = new WorldView(OFFICE, pal);
const ambient = new Ambient(OFFICE, view.origin, pal);
const camera = new Camera(view.width, view.height, worldContentRows(OFFICE));

const canvas = document.createElement("canvas");
document.body.append(canvas);
const ctx = canvas.getContext("2d", { alpha: false })!;
let vp = viewportFor(view.width, view.height, innerWidth, innerHeight, devicePixelRatio, VIEW_W, VIEW_H);
let sky: HTMLCanvasElement;

function fit(): void {
  vp = viewportFor(view.width, view.height, innerWidth, innerHeight, devicePixelRatio, VIEW_W, VIEW_H);
  canvas.width = vp.w;
  canvas.height = vp.h;
  canvas.style.width = `${vp.cssW}px`;
  canvas.style.height = `${vp.cssH}px`;
  canvas.style.left = "0px";
  canvas.style.top = "0px";
  ctx.imageSmoothingEnabled = false;
  sky = toCanvas(renderBackground(vp.w, vp.h, pal));
}
addEventListener("resize", fit);
fit();

/** QA only: `?freeze=S` stops the clock and incoming events after S seconds (frames keep rendering). */
const freezeAt = params.has("freeze") ? Number(params.get("freeze")) : Infinity;
let simTime = 0;
const frozen = () => simTime >= freezeAt;

const sink: EventSink = {
  event: (e) => frozen() || office.apply(e),
  snapshot: (s) => frozen() || office.applySnapshot(s),
};
const mock = params.get("mock");
if (mock) startMock(mock === "1" ? "scripted" : mock, sink, params);
else connectWs(params.get("ws") ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`, sink);

/** Camera focus: centroid of busy agents, else of everyone, else the world centre. */
function focus(): { x: number; y: number } | null {
  const all = [...office.agents.values()];
  const busy = all.filter((a) => a.state === "working" || a.state === "waiting" || a.state === "walking");
  const pick = busy.length ? busy : all;
  if (!pick.length) return null;
  let x = 0;
  let y = 0;
  for (const a of pick) {
    const s = gridToScreen(a.x, a.y, view.origin);
    x += s.x;
    y += s.y - 12;
  }
  // Half-way between the activity and the world centre: follows the action without losing the overview.
  return { x: (x / pick.length + view.width / 2) / 2, y: (y / pick.length + view.height / 2) / 2 };
}

const loop = startLoop((rawDt) => {
  const dt = frozen() ? 0 : rawDt;
  simTime += dt;
  const t = simTime;
  office.update(dt);
  camera.update(dt, vp.w, vp.h, focus());
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sky, 0, 0);
  ambient.drawSky(ctx, vp.w, vp.h, t);
  ctx.setTransform(1, 0, 0, 1, -Math.round(camera.x), -Math.round(camera.y));
  view.draw(ctx, t, office.actors(), (c) => {
    ambient.draw(c, t);
    ambient.drawLinks(c, office.links(), t);
    ambient.drawSleepy(c, office.agents.values(), t);
    ambient.drawSpeech(c, office.speeches(), office.agents);
  });
});

// Hook for QA tooling (Playwright): live stats, viewport and the simulation.
(window as unknown as { __agentOffice: unknown }).__agentOffice = { office, stats: loop.stats, apply: (e: AgentEvent) => office.apply(e), viewport: () => vp, camera };
