export type Category = 'sight' | 'food' | 'hotel' | 'transport' | 'shopping' | 'activity' | 'other';
export type RouteMode = 'driving' | 'walking' | 'cycling' | 'straight';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  /** 计划到达时间 HH:MM */
  time?: string;
  /** 停留时长（分钟） */
  duration?: number;
  /** 预计花费，单位为行程币种 */
  cost?: number;
  address?: string;
  notes?: string;
  visited?: boolean;
}

export interface Day {
  id: string;
  title?: string;
  notes?: string;
  routeMode: RouteMode;
  places: Place[];
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  /** YYYY-MM-DD，可为空 */
  startDate?: string;
  currency: string;
  budget?: number;
  notes?: string;
  days: Day[];
  createdAt: number;
  updatedAt: number;
}

export type Effort = 'low' | 'medium' | 'high';
export type ThemePref = 'light' | 'dark' | 'system';

export interface Settings {
  apiKey: string;
  authMode: 'apiKey' | 'bearer';
  baseURL: string;
  model: string;
  effort: Effort;
  webSearch: boolean;
  theme: ThemePref;
}

export interface RouteLeg {
  distance: number; // 米
  duration: number; // 秒
}

export interface RouteResult {
  mode: RouteMode;
  coords: [number, number][]; // [lng, lat]
  distance: number;
  duration: number;
  legs: RouteLeg[];
  approximate: boolean;
}
