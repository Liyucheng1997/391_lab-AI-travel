import type { Place, RouteMode, RouteResult } from '../types';

export interface GeoResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Nominatim 的使用规范要求每秒不超过 1 次请求，这里串行排队
let geoQueue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = geoQueue.then(fn, fn);
  geoQueue = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

export function searchPlaces(query: string, opts: { limit?: number; near?: { lat: number; lng: number } } = {}): Promise<GeoResult[]> {
  return throttled(async () => {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(opts.limit ?? 6), 'accept-language': 'zh-CN,zh,en' });
    if (opts.near) {
      const { lat, lng } = opts.near;
      params.set('viewbox', `${lng - 0.6},${lat + 0.6},${lng + 0.6},${lat - 0.6}`);
    }
    const res = await fetch(`${NOMINATIM}/search?${params}`);
    if (!res.ok) throw new Error(`地点搜索失败（${res.status}）`);
    const data = (await res.json()) as any[];
    return data.map((d) => ({
      name: d.name || String(d.display_name).split(',')[0],
      displayName: d.display_name,
      lat: Number(d.lat),
      lng: Number(d.lon),
      type: d.type,
    }));
  });
}

export function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
  return throttled(async () => {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '18', 'accept-language': 'zh-CN,zh,en' });
    const res = await fetch(`${NOMINATIM}/reverse?${params}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.error) return null;
    return { name: d.name || String(d.display_name).split(',')[0], displayName: d.display_name, lat, lng, type: d.type };
  });
}

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- 路线 ----------

// FOSSGIS 公共 OSRM 服务，分别提供驾车 / 步行 / 骑行
const OSRM: Record<Exclude<RouteMode, 'straight'>, string> = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
};
const SPEED: Record<RouteMode, number> = { driving: 30 / 3.6, walking: 4.5 / 3.6, cycling: 14 / 3.6, straight: 30 / 3.6 };

const routeCache = new Map<string, Promise<RouteResult>>();

function straightRoute(places: Place[], mode: RouteMode): RouteResult {
  const legs = places.slice(1).map((p, i) => {
    const distance = haversine(places[i], p);
    return { distance, duration: distance / SPEED[mode] };
  });
  return {
    mode,
    coords: places.map((p) => [p.lng, p.lat]),
    distance: legs.reduce((s, l) => s + l.distance, 0),
    duration: legs.reduce((s, l) => s + l.duration, 0),
    legs,
    approximate: true,
  };
}

export function getRoute(places: Place[], mode: RouteMode): Promise<RouteResult> {
  if (places.length < 2) return Promise.resolve({ mode, coords: [], distance: 0, duration: 0, legs: [], approximate: true });
  if (mode === 'straight') return Promise.resolve(straightRoute(places, mode));
  // 相距太远（跨城、跨国）的路段公共路由服务算不了，退化为直线
  const tooFar = places.slice(1).some((p, i) => haversine(places[i], p) > 300_000);
  if (tooFar || places.length > 60) return Promise.resolve(straightRoute(places, mode));

  const coordStr = places.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const key = `${mode}|${coordStr}`;
  const cached = routeCache.get(key);
  if (cached) return cached;

  const job = (async (): Promise<RouteResult> => {
    try {
      const res = await fetch(`${OSRM[mode]}/${coordStr}?overview=full&geometries=geojson&steps=false`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const r = data.routes?.[0];
      if (!r) throw new Error('no route');
      return {
        mode,
        coords: r.geometry.coordinates,
        distance: r.distance,
        duration: r.duration,
        legs: r.legs.map((l: any) => ({ distance: l.distance, duration: l.duration })),
        approximate: false,
      };
    } catch {
      routeCache.delete(key);
      return straightRoute(places, mode);
    }
  })();
  routeCache.set(key, job);
  return job;
}

// ---------- 路线顺序优化：最近邻 + 2-opt，首尾地点保持不动 ----------

export function optimizeOrder(places: Place[]): Place[] {
  if (places.length <= 3) return places;
  const first = places[0];
  const lastIsHotelOrEnd = places[places.length - 1].category === 'hotel' || places[places.length - 1].category === 'transport';
  const end = lastIsHotelOrEnd ? places[places.length - 1] : null;
  const pool = places.slice(1, end ? -1 : undefined);

  const order: Place[] = [first];
  const rest = [...pool];
  while (rest.length) {
    const cur = order[order.length - 1];
    let best = 0;
    let bestD = Infinity;
    rest.forEach((p, i) => {
      const d = haversine(cur, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    order.push(rest.splice(best, 1)[0]);
  }
  if (end) order.push(end);

  const total = (arr: Place[]) => arr.slice(1).reduce((s, p, i) => s + haversine(arr[i], p), 0);
  let improved = true;
  let route = order;
  const fixedTail = end ? 1 : 0;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1 - fixedTail; i++) {
      for (let k = i + 1; k < route.length - fixedTail; k++) {
        const next = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (total(next) + 1 < total(route)) {
          route = next;
          improved = true;
        }
      }
    }
  }
  return route;
}

export function boundsOf(points: { lat: number; lng: number }[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
