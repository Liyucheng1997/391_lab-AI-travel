import type { Trip } from '../types';
import { normalizeTrip } from './store';

// 没有后端：把整个行程压缩后放进链接的 # 部分，打开链接即可只读查看

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeTrip(trip: Trip): Promise<string> {
  const slim = {
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    currency: trip.currency,
    budget: trip.budget,
    notes: trip.notes,
    members: trip.members,
    days: trip.days.map((d) => ({
      title: d.title,
      notes: d.notes,
      routeMode: d.routeMode,
      places: d.places.map(({ id: _id, ...p }) => ({ ...p, lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) })),
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(slim));
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeTrip(data: string): Promise<Trip | null> {
  try {
    const bytes = await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'));
    return normalizeTrip(JSON.parse(new TextDecoder().decode(bytes)), true);
  } catch {
    return null;
  }
}

export async function shareUrl(trip: Trip): Promise<string> {
  const base = location.href.split('#')[0];
  return `${base}#/share/${await encodeTrip(trip)}`;
}
