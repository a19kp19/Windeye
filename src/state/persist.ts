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
    return validate(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}

function validate(x: unknown): Saved | null {
  const s = x as Saved;
  if (!s || typeof s !== "object" || !s.plan || s.plan.version !== 1 || !Array.isArray(s.plan.walls))
    return null;
  if (!s.weather || typeof s.weather.windSpeed !== "number") return null;
  return { plan: s.plan, weather: s.weather, templateId: s.templateId ?? null };
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
    return raw ? validate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
