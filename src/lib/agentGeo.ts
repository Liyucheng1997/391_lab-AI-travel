import { searchPlaces, type GeoResult } from './geo';

const cache = new Map<string, GeoResult[]>();

/** AI 工具用的地理编码：先带上目的地查，查不到再单独查 */
export async function geocodeForAgent(query: string, destination: string): Promise<GeoResult[]> {
  const tries = destination && !query.includes(destination) ? [`${query} ${destination}`, query] : [query];
  for (const q of tries) {
    const key = q.toLowerCase();
    let hits = cache.get(key);
    if (!hits) {
      try {
        hits = await searchPlaces(q, { limit: 5 });
      } catch {
        hits = [];
      }
      cache.set(key, hits);
    }
    if (hits.length) return hits;
  }
  return [];
}
