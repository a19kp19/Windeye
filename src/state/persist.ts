import { FURNITURE_DEFAULTS } from "../model/templates";
import type { Plan, Weather } from "../model/types";

const KEY = "windeye:v1";

export interface Saved {
  plan: Plan;
  weather: Weather;
  templateId: string | null;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Compact, URL-safe encoding of a plan (deflate + base64url). */
export async function encodeShare(s: Saved): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  return b64url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShare(code: string): Promise<Saved | null> {
  try {
    const raw = await pipe(unb64url(code), new DecompressionStream("deflate-raw"));
    return parseSaved(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}

// Share links are untrusted input: anything that gets past here is rendered and simulated as-is.
const MAX_ITEMS = 2000;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown) => num(v) && v > 0;
const str = (v: unknown): v is string => typeof v === "string";
const vec = (v: unknown) => isObj(v) && num(v.x) && num(v.y);
const oneOf = (v: unknown, xs: readonly unknown[]) => xs.includes(v);
const optional = (v: unknown, xs: readonly unknown[]) => v === undefined || xs.includes(v);
const list = (v: unknown, ok: (x: Obj) => boolean) =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => isObj(x) && ok(x));

function planOk(p: Obj): boolean {
  if (p.version !== 1 || !str(p.name) || !pos(p.ceiling) || !num(p.northDeg)) return false;
  const wallsOk = list(
    p.walls,
    (w) =>
      str(w.id) &&
      vec(w.a) &&
      vec(w.b) &&
      pos(w.thickness) &&
      oneOf(w.kind, ["exterior", "interior", "party"]),
  );
  if (!wallsOk) return false;
  const wallIds = new Set((p.walls as Obj[]).map((w) => w.id));
  return (
    list(
      p.openings,
      (o) =>
        str(o.id) &&
        wallIds.has(o.wallId) &&
        oneOf(o.kind, ["window", "door"]) &&
        num(o.offset) &&
        pos(o.width) &&
        pos(o.height) &&
        oneOf(o.state, ["closed", "tilted", "open"]) &&
        optional(o.hinge, ["a", "b"]) &&
        optional(o.swing, [1, -1]) &&
        optional(o.passage, [true, false]),
    ) &&
    list(
      p.fans,
      (f) =>
        str(f.id) && vec(f.pos) && num(f.angle) && pos(f.size) && num(f.speed) && typeof f.on === "boolean",
    ) &&
    list(
      p.furniture,
      (f) =>
        str(f.id) &&
        str(f.kind) &&
        Object.hasOwn(FURNITURE_DEFAULTS, f.kind) &&
        vec(f.pos) &&
        pos(f.w) &&
        pos(f.d) &&
        num(f.angle) &&
        pos(f.height),
    ) &&
    list(p.labels, (l) => str(l.id) && vec(l.pos) && str(l.name))
  );
}

/** A saved or shared state if it has the full shape the app relies on, else null. */
export function parseSaved(x: unknown): Saved | null {
  if (!isObj(x) || !isObj(x.plan) || !isObj(x.weather) || !planOk(x.plan)) return null;
  const w = x.weather;
  if (!num(w.windFromDeg) || !num(w.windSpeed) || w.windSpeed < 0) return null;
  if (!oneOf(w.exposure, ["sheltered", "suburban", "open"])) return null;
  return {
    plan: x.plan as unknown as Plan,
    weather: w as unknown as Weather,
    templateId: str(x.templateId) ? x.templateId : null,
  };
}

export function saveLocal(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / quota — the app still works, it just won't remember.
  }
}

export function loadLocal(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSaved(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
