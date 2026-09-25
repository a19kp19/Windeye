import { FURNITURE_DEFAULTS } from "../model/templates";
import type { Exposure, OpeningKind, OpeningState, Plan, WallKind, Weather } from "../model/types";

const KEY = "windeye:v1";

export interface Saved {
  plan: Plan;
  weather: Weather;
  templateId: string | null;
}

/** What a link or the autosave yields: weather fields that were missing or unusable are left out. */
export type Loaded = Omit<Saved, "weather"> & { weather: Partial<Weather> };

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

/** Far above any real plan (a template is ~10 kB); stops a tiny link from inflating to gigabytes. */
const MAX_JSON_BYTES = 4_000_000;

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Compact, URL-safe encoding of a plan (deflate + base64url). */
export async function encodeShare(s: Saved): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  return b64url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShare(code: string): Promise<Loaded | null> {
  try {
    const raw = await inflate(unb64url(code));
    return raw ? parseSaved(JSON.parse(new TextDecoder().decode(raw))) : null;
  } catch {
    return null;
  }
}

// Share links are untrusted input: anything that gets past here is rendered and simulated as-is.
const MAX_ITEMS = 2000;
/**
 * Metres. Generous for any home, but keeps plan maths in range: at 1e300 m the canvas grid loop's
 * `x += step` no longer advances and the page hangs.
 */
const MAX_COORD = 10_000;
const MAX_SIZE = 100;
/** m/s. Beyond hurricane force; also bounds the wind-barb loop and the lattice time step. */
const MAX_WIND = 60;
const MAX_FAN_SPEED = 30;
// Records (not arrays) so adding a kind to the model is a type error here, not silently dropped plans.
const WALL_KINDS: Record<WallKind, true> = { exterior: true, interior: true, party: true };
const OPENING_KINDS: Record<OpeningKind, true> = { window: true, door: true };
const OPENING_STATES: Record<OpeningState, true> = { closed: true, tilted: true, open: true };
const EXPOSURES: Record<Exposure, true> = { sheltered: true, suburban: true, open: true };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const within = (v: unknown, lo: number, hi: number) => num(v) && v >= lo && v <= hi;
const size = (v: unknown) => num(v) && v > 0 && v <= MAX_SIZE;
const str = (v: unknown): v is string => typeof v === "string";
const vec = (v: unknown) =>
  isObj(v) && within(v.x, -MAX_COORD, MAX_COORD) && within(v.y, -MAX_COORD, MAX_COORD);
const known = (v: unknown, set: object) => str(v) && Object.hasOwn(set, v);
const optional = (v: unknown, xs: readonly unknown[]) => v === undefined || xs.includes(v);
const list = (v: unknown, ok: (x: Obj) => boolean) =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => isObj(x) && ok(x));

function planOk(p: Obj): boolean {
  if (p.version !== 1 || !str(p.name) || !size(p.ceiling) || !num(p.northDeg)) return false;
  const wallsOk = list(
    p.walls,
    (w) => str(w.id) && vec(w.a) && vec(w.b) && size(w.thickness) && known(w.kind, WALL_KINDS),
  );
  if (!wallsOk) return false;
  const wallIds = new Set((p.walls as Obj[]).map((w) => w.id));
  return (
    list(
      p.openings,
      (o) =>
        str(o.id) &&
        wallIds.has(o.wallId) &&
        known(o.kind, OPENING_KINDS) &&
        within(o.offset, -3 * MAX_COORD, 3 * MAX_COORD) &&
        size(o.width) &&
        size(o.height) &&
        known(o.state, OPENING_STATES) &&
        optional(o.hinge, ["a", "b"]) &&
        optional(o.swing, [1, -1]) &&
        optional(o.passage, [true, false]),
    ) &&
    list(
      p.fans,
      (f) =>
        str(f.id) &&
        vec(f.pos) &&
        num(f.angle) &&
        size(f.size) &&
        within(f.speed, 0, MAX_FAN_SPEED) &&
        typeof f.on === "boolean",
    ) &&
    list(
      p.furniture,
      (f) =>
        str(f.id) &&
        known(f.kind, FURNITURE_DEFAULTS) &&
        vec(f.pos) &&
        size(f.w) &&
        size(f.d) &&
        num(f.angle) &&
        size(f.height),
    ) &&
    list(p.labels, (l) => str(l.id) && vec(l.pos) && str(l.name))
  );
}

function parseWeather(w: Obj): Partial<Weather> {
  const out: Partial<Weather> = {};
  if (num(w.windFromDeg)) out.windFromDeg = w.windFromDeg;
  if (num(w.windSpeed)) out.windSpeed = Math.min(MAX_WIND, Math.max(0, w.windSpeed));
  if (known(w.exposure, EXPOSURES)) out.exposure = w.exposure as Exposure;
  return out;
}

/**
 * A saved or shared state if its plan has the full shape the app relies on, else null. Weather never
 * costs you the plan: unusable fields are dropped and the app keeps its current values for them.
 */
export function parseSaved(x: unknown): Loaded | null {
  if (!isObj(x) || !isObj(x.plan) || !planOk(x.plan)) return null;
  return {
    plan: x.plan as unknown as Plan,
    weather: isObj(x.weather) ? parseWeather(x.weather) : {},
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

export function loadLocal(): Loaded | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSaved(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
