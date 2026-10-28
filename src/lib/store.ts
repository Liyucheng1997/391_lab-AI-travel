import { useSyncExternalStore } from 'react';
import type { Category, Day, Place, RouteMode, Settings, Trip } from '../types';
import { sampleTrip } from './sample';
import { uid } from './util';

const TRIPS_KEY = 'tuji.v1.trips';
const SETTINGS_KEY = 'tuji.v1.settings';
const SEEDED_KEY = 'tuji.v1.seeded';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  authMode: 'apiKey',
  baseURL: '',
  nickname: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  webSearch: false,
  theme: 'system',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('保存失败', e);
  }
}

// ---------- 数据校验：导入文件和分享链接都要过这一遍 ----------

const CATEGORIES: Category[] = ['sight', 'food', 'hotel', 'transport', 'shopping', 'activity', 'other'];
const MODES: RouteMode[] = ['driving', 'walking', 'cycling', 'straight'];
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normalizePlace(raw: any): Place | null {
  const lat = num(raw?.lat);
  const lng = num(raw?.lng);
  const name = str(raw?.name, 200);
  if (lat === undefined || lng === undefined || !name || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    id: str(raw.id, 40) || uid(),
    name,
    lat,
    lng,
    category: CATEGORIES.includes(raw.category) ? raw.category : 'other',
    time: /^\d{1,2}:\d{2}$/.test(raw.time ?? '') ? raw.time : undefined,
    duration: num(raw.duration),
    cost: num(raw.cost),
    address: str(raw.address, 300),
    notes: str(raw.notes),
    visited: raw.visited === true || undefined,
  };
}

export function normalizeTrip(raw: any, freshIds = false): Trip | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) return null;
  const now = Date.now();
  const days: Day[] = raw.days.slice(0, 60).map((d: any) => ({
    id: (!freshIds && str(d?.id, 40)) || uid(),
    title: str(d?.title, 100),
    notes: str(d?.notes),
    routeMode: MODES.includes(d?.routeMode) ? d.routeMode : 'driving',
    places: (Array.isArray(d?.places) ? d.places : [])
      .slice(0, 80)
      .map(normalizePlace)
      .filter(Boolean)
      .map((p: Place) => (freshIds ? { ...p, id: uid() } : p)),
  }));
  return {
    id: (!freshIds && str(raw.id, 40)) || uid(),
    name: str(raw.name, 100) || '未命名行程',
    destination: str(raw.destination, 100) || '',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate ?? '') ? raw.startDate : undefined,
    currency: str(raw.currency, 8) || 'CNY',
    budget: num(raw.budget),
    notes: str(raw.notes),
    members: normalizeMembers(raw.members),
    days: days.length ? days : [emptyDay()],
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
}

export function normalizeMembers(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = [...new Set(raw.map((m) => str(m, 20)?.trim()).filter(Boolean) as string[])].slice(0, 20);
  return list.length ? list : undefined;
}

export const emptyDay = (): Day => ({ id: uid(), routeMode: 'driving', places: [] });

// ---------- 行程仓库 ----------

type Listener = () => void;

function loadTrips(): Trip[] {
  const list = read<unknown[]>(TRIPS_KEY, []);
  let trips = (Array.isArray(list) ? list : []).map((t) => normalizeTrip(t)).filter(Boolean) as Trip[];
  if (!trips.length && !localStorage.getItem(SEEDED_KEY)) {
    trips = [sampleTrip()];
    write(TRIPS_KEY, trips);
  }
  try {
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {}
  return trips;
}

let trips: Trip[] = loadTrips();
const listeners = new Set<Listener>();
const undoStacks = new Map<string, Trip[]>();

function commit(next: Trip[]) {
  trips = next;
  write(TRIPS_KEY, trips);
  listeners.forEach((l) => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const tripStore = {
  all: () => trips,
  get: (id: string) => trips.find((t) => t.id === id),
  subscribe,

  create(partial: Partial<Trip> = {}): Trip {
    const now = Date.now();
    const trip: Trip = {
      id: uid(),
      name: '新的旅行',
      destination: '',
      currency: 'CNY',
      days: [emptyDay()],
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    commit([trip, ...trips]);
    return trip;
  },

  add(trip: Trip) {
    commit([trip, ...trips.filter((t) => t.id !== trip.id)]);
  },

  remove(id: string) {
    undoStacks.delete(id);
    localStorage.removeItem(chatKey(id));
    commit(trips.filter((t) => t.id !== id));
  },

  /** 保存一个撤销点。AI 一次运行只存一个，撤销时整段回退 */
  checkpoint(id: string) {
    const t = tripStore.get(id);
    if (!t) return;
    const stack = undoStacks.get(id) ?? [];
    stack.push(structuredClone(t));
    if (stack.length > 50) stack.shift();
    undoStacks.set(id, stack);
  },

  canUndo: (id: string) => (undoStacks.get(id)?.length ?? 0) > 0,

  undo(id: string) {
    const prev = undoStacks.get(id)?.pop();
    if (prev) commit(trips.map((t) => (t.id === id ? { ...prev, updatedAt: Date.now() } : t)));
  },

  update(id: string, mutate: (draft: Trip) => void, opts: { undo?: boolean } = {}) {
    const cur = tripStore.get(id);
    if (!cur) return;
    if (opts.undo !== false) tripStore.checkpoint(id);
    const draft = structuredClone(cur);
    mutate(draft);
    draft.updatedAt = Date.now();
    commit(trips.map((t) => (t.id === id ? draft : t)));
  },

  replaceAll(next: Trip[]) {
    undoStacks.clear();
    commit(next);
  },
};

export function useTrips() {
  return useSyncExternalStore(subscribe, tripStore.all);
}

export function useTrip(id: string | undefined) {
  return useSyncExternalStore(subscribe, () => (id ? tripStore.get(id) : undefined));
}

// ---------- 设置 ----------

let settings: Settings = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
const settingListeners = new Set<Listener>();

export const settingsStore = {
  get: () => settings,
  set(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    write(SETTINGS_KEY, settings);
    settingListeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    settingListeners.add(l);
    return () => settingListeners.delete(l);
  },
};

export function useSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}

// ---------- 每个行程的 AI 对话 ----------

export const chatKey = (tripId: string) => `tuji.v1.chat.${tripId}`;
export const loadChat = <T>(tripId: string): T[] => read<T[]>(chatKey(tripId), []);
export const saveChat = (tripId: string, messages: unknown[]) => write(chatKey(tripId), messages);
export const clearChat = (tripId: string) => localStorage.removeItem(chatKey(tripId));
