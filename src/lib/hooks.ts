import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RouteResult, Trip } from '../types';
import { getRoute } from './geo';
import { useSettings } from './store';

/** 为行程的每一天计算路线；地点或方式变化时重算 */
export function useRoutes(trip: Trip | undefined): Record<string, RouteResult> {
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({});
  const key = trip ? trip.days.map((d) => d.id + d.routeMode + d.places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')).join('|') : '';
  useEffect(() => {
    if (!trip) return;
    let alive = true;
    for (const d of trip.days) {
      getRoute(d.places, d.routeMode).then((r) => alive && setRoutes((prev) => ({ ...prev, [d.id]: r })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!trip) return {};
  // 只返回和当前地点数量对得上的路线，避免显示过期的路段
  const valid: Record<string, RouteResult> = {};
  for (const d of trip.days) {
    const r = routes[d.id];
    if (r && r.mode === d.routeMode && r.legs.length === Math.max(0, d.places.length - 1)) valid[d.id] = r;
  }
  return valid;
}

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
const subscribeMq = (cb: () => void) => {
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};

export function useIsDark(): boolean {
  const { theme } = useSettings();
  const sysDark = useSyncExternalStore(subscribeMq, () => mq?.matches ?? false);
  return theme === 'dark' || (theme === 'system' && sysDark);
}

const narrowMq = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 900px)') : null;
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      narrowMq?.addEventListener('change', cb);
      return () => narrowMq?.removeEventListener('change', cb);
    },
    () => narrowMq?.matches ?? false,
  );
}

// ---------- 简单的哈希路由 ----------

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useHashRoute(): string[] {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export const navigate = (path: string) => {
  location.hash = path;
};

// ---------- 全局界面事件：打开设置 ----------

type UiListener = () => void;
const settingsListeners = new Set<UiListener>();
export const ui = {
  openSettings: () => settingsListeners.forEach((l) => l()),
  onOpenSettings(l: UiListener) {
    settingsListeners.add(l);
    return () => {
      settingsListeners.delete(l);
    };
  },
};
