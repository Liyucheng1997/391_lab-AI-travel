import type { IconName } from '../components/Icon';
import type { Category, RouteMode, Trip } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const CATEGORY_LABEL: Record<Category, string> = {
  sight: '景点',
  food: '美食',
  hotel: '住宿',
  transport: '交通',
  shopping: '购物',
  activity: '体验',
  other: '其他',
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

/** 每种类型的头像图标；颜色在 app.css 的 --cat-* 变量里 */
export const CATEGORY_ICON: Record<Category, IconName> = {
  sight: 'catSight',
  food: 'catFood',
  hotel: 'catHotel',
  transport: 'catTransport',
  shopping: 'catShopping',
  activity: 'catActivity',
  other: 'catOther',
};

/** 人物头像：取昵称第一个字，颜色按名字固定分配 */
export const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';
export function avatarTone(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 6;
}

/** 在外部地图里打开（国内用高德，其他地方用 Google 地图） */
export function externalMapUrl(p: { lat: number; lng: number; name: string }): string {
  const inChina = p.lng > 73 && p.lng < 135.5 && p.lat > 18 && p.lat < 53.6;
  return inChina
    ? `https://uri.amap.com/marker?position=${p.lng},${p.lat}&name=${encodeURIComponent(p.name)}&coordinate=wgs84&callnative=1`
    : `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

export const ROUTE_LABEL: Record<RouteMode, string> = {
  driving: '驾车',
  walking: '步行',
  cycling: '骑行',
  straight: '直线',
};

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function dayDate(trip: Pick<Trip, 'startDate'>, index: number): Date | null {
  if (!trip.startDate) return null;
  const [y, m, d] = trip.startDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d + index);
}

export function fmtDayDate(trip: Pick<Trip, 'startDate'>, index: number): string {
  const d = dayDate(trip, index);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}` : '';
}

export function fmtDateRange(trip: Trip): string {
  if (!trip.startDate) return `${trip.days.length} 天`;
  const a = dayDate(trip, 0)!;
  const b = dayDate(trip, Math.max(0, trip.days.length - 1))!;
  const f = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return trip.days.length > 1 ? `${a.getFullYear()}年${f(a)} – ${f(b)}` : `${a.getFullYear()}年${f(a)}`;
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} 米`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`;
}

export function fmtDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${Math.max(1, min)} 分钟`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', JPY: '¥', USD: '$', EUR: '€', GBP: '£', HKD: 'HK$', KRW: '₩', THB: '฿' };
export const currencySymbol = (c: string) => CURRENCY_SYMBOL[c] ?? c + ' ';
export const fmtMoney = (v: number, c: string) => currencySymbol(c) + Math.round(v).toLocaleString('zh-CN');

export function tripStats(trip: Trip) {
  let places = 0;
  let visited = 0;
  let cost = 0;
  for (const d of trip.days) {
    for (const p of d.places) {
      places++;
      if (p.visited) visited++;
      cost += p.cost ?? 0;
    }
  }
  return { places, visited, cost };
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
