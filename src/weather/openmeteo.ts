export interface Place {
  name: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface Forecast {
  /** Local wall-clock times at the location, "YYYY-MM-DDTHH:MM". */
  times: string[];
  temp: number[];
  /** 10 m wind, m/s. */
  windSpeed: number[];
  windDir: number[];
  utcOffsetSeconds: number;
  timezone: string;
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const j = (await res.json()) as {
    results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[];
  };
  return (j.results ?? []).map((r) => ({
    name: r.name,
    region: r.admin1,
    country: r.country,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export async function fetchForecast(lat: number, lon: number, signal?: AbortSignal): Promise<Forecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    "&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto&forecast_days=3";
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Forecast failed (${res.status})`);
  const j = (await res.json()) as {
    utc_offset_seconds: number;
    timezone: string;
    hourly: {
      time: string[];
      temperature_2m: number[];
      wind_speed_10m: number[];
      wind_direction_10m: number[];
    };
  };
  const h = j.hourly;
  // Hours the API has no data for come back as null; keep the series up to the first gap.
  let n = 0;
  while (
    n < h.time.length &&
    [h.temperature_2m[n], h.wind_speed_10m[n], h.wind_direction_10m[n]].every((v) => Number.isFinite(v))
  )
    n++;
  if (n === 0) throw new Error("no forecast data for this place");
  return {
    times: h.time.slice(0, n),
    temp: h.temperature_2m.slice(0, n),
    windSpeed: h.wind_speed_10m.slice(0, n),
    windDir: h.wind_direction_10m.slice(0, n),
    utcOffsetSeconds: j.utc_offset_seconds,
    timezone: j.timezone,
  };
}

/** Index of the forecast hour containing "now" at the location. */
export function currentHourIndex(f: Forecast, nowMs = Date.now()): number {
  const local = new Date(nowMs + f.utcOffsetSeconds * 1000).toISOString().slice(0, 13);
  const i = f.times.findIndex((t) => t.slice(0, 13) === local);
  return i < 0 ? 0 : i;
}
