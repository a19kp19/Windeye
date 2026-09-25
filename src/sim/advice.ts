import type { Plan } from "../model/types";
import { formatAge } from "../ui/format";
import { breezeWord } from "./comfort";
import type { Metrics } from "./metrics";
import type { RasterSummary } from "./protocol";

export interface Advice {
  tone: "good" | "tip" | "warn";
  text: string;
}

/** Plain-language reading of the simulation: what's wrong and the one thing to try next. */
export function advise(plan: Plan, m: Metrics, r: RasterSummary): Advice[] {
  const out: Advice[] = [];
  const info = new Map(r.openings.map((o) => [o.id, o]));
  const exterior = plan.openings.filter((o) => info.get(o.id)?.exterior);
  const openExt = exterior.filter((o) => o.state !== "closed");
  const fansOn = plan.fans.filter((f) => f.on);

  if (exterior.length === 0) {
    out.push({ tone: "warn", text: "No windows yet. Pick the Window tool (N) and click an outside wall." });
    return out;
  }
  if (openExt.length === 0) {
    out.push({
      tone: "warn",
      text: "Every window is shut, so air only changes through leaks. Open two on different sides of the home.",
    });
    return out;
  }

  // One façade only?
  const dirs = openExt.map((o) => {
    const i = info.get(o.id)!;
    return Math.atan2(-i.ny, -i.nx);
  });
  const spread = Math.max(
    ...dirs.map((a) => Math.max(...dirs.map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))))),
  );
  if (spread < Math.PI / 4 && fansOn.length === 0) {
    out.push({
      tone: "tip",
      text: "All the open windows face the same way. A one-sided home breathes slowly — open a window on another side, or set a fan in one window blowing out.",
    });
  }

  // Stalest room and the most direct fix.
  const home = m.home;
  const stale = [...m.rooms]
    .filter((x) => x.area >= 2 && x.meanAge > Math.max(1.8 * home.meanAge, 240))
    .sort((a, b) => b.meanAge - a.meanAge)[0];
  if (stale) {
    const own = plan.openings.filter((o) => {
      const i = info.get(o.id);
      return i && (i.roomIn === stale.index || i.roomOut === stale.index);
    });
    const shutWindow = own.find((o) => o.kind === "window" && o.state !== "open" && info.get(o.id)?.exterior);
    const shutDoor = own.find((o) => o.kind === "door" && o.state === "closed" && !info.get(o.id)?.exterior);
    const age = formatAge(stale.meanAge);
    if (shutWindow) {
      out.push({
        tone: "tip",
        text: `${stale.name}: its air is ${age} old. Open its window ${shutWindow.state === "tilted" ? "fully" : ""} to give it its own supply.`.replace(
          "  ",
          " ",
        ),
      });
    } else if (shutDoor) {
      out.push({
        tone: "tip",
        text: `${stale.name} is cut off (air age ${age}). Open its door to join it to the breeze.`,
      });
    } else {
      out.push({
        tone: "tip",
        text: `${stale.name} is a dead end (air age ${age}). A fan in its doorway blowing in will stir it up.`,
      });
    }
  }

  const tilted = openExt.filter((o) => o.state === "tilted");
  if (tilted.length && home.ach < 6) {
    out.push({
      tone: "tip",
      text: "Tilted windows pass only about a tenth of the air of an open one. For a quick airing, open them wide for 5–10 minutes instead.",
    });
  }

  // Comfort.
  if (m.comfort.length) {
    const best = [...m.comfort].sort((a, b) => b.speed - a.speed)[0];
    const f = plan.furniture.find((x) => x.id === best.id);
    const what = f ? f.kind : "seat";
    if (best.speed < 0.15) {
      out.push({
        tone: "tip",
        text: "No one will feel a breeze on the beds or sofa. Aim a fan at them — around 0.8 m/s feels roughly 2.5 °C cooler.",
      });
    } else if (best.cooling >= 0.8) {
      out.push({
        tone: "good",
        text: `The ${what} gets a ${breezeWord(best.speed)} breeze (${best.speed.toFixed(1)} m/s) — it feels about ${best.cooling.toFixed(1)} °C cooler there.`,
      });
    }
  }

  if (home.ach >= 8 && home.flushMinutes > 0) {
    out.push({
      tone: "good",
      text: `Whole home: about ${home.ach.toFixed(0)} air changes an hour — most of the air is replaced in ~${Math.max(1, Math.round(home.flushMinutes))} min.`,
    });
  }
  return out.slice(0, 4);
}
