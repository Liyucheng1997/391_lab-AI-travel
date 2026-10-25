import type { Category, Day, Place, Trip } from '../types';
import { uid } from './util';

type P = [name: string, lat: number, lng: number, category: Category, time?: string, duration?: number, cost?: number, notes?: string];

const day = (title: string, places: P[], routeMode: Day['routeMode'] = 'driving'): Day => ({
  id: uid(),
  title,
  routeMode,
  places: places.map(
    ([name, lat, lng, category, time, duration, cost, notes]): Place => ({ id: uid(), name, lat, lng, category, time, duration, cost, notes }),
  ),
});

function nextMonthDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 首次打开时的示例行程：让没有 API Key 的访客也能直接体验 */
export function sampleTrip(): Trip {
  const now = Date.now();
  return {
    id: uid(),
    name: '京都三日 · 寺庙与美食',
    destination: '日本 京都',
    startDate: nextMonthDate(),
    currency: 'CNY',
    budget: 6000,
    notes: '示例行程。可以随意修改，或在右侧让 AI 帮你调整。',
    createdAt: now,
    updatedAt: now,
    days: [
      day('东山经典线', [
        ['京都站', 34.9858, 135.7588, 'transport', '08:30', 20, 0, '寄存行李，买 ICOCA 卡'],
        ['伏见稻荷大社', 34.9671, 135.7727, 'sight', '09:00', 120, 0, '千本鸟居，建议早去避开人流'],
        ['清水寺', 34.9949, 135.785, 'sight', '11:45', 90, 25],
        ['二年坂·三年坂', 34.9963, 135.7808, 'shopping', '13:20', 60, 150, '午餐可吃汤豆腐'],
        ['八坂神社', 35.0037, 135.7785, 'sight', '14:40', 40, 0],
        ['花见小路', 35.0018, 135.7752, 'food', '17:30', 120, 400, '祇园晚餐，可能偶遇艺伎'],
        ['四条乌丸酒店', 35.0037, 135.7596, 'hotel', '20:30', undefined, 800],
      ]),
      day('岚山与金阁', [
        ['金阁寺', 35.0394, 135.7292, 'sight', '09:00', 60, 25],
        ['龙安寺', 35.0345, 135.7182, 'sight', '10:15', 50, 30, '枯山水石庭'],
        ['岚山竹林小径', 35.017, 135.6713, 'sight', '11:30', 45, 0],
        ['天龙寺', 35.0158, 135.6737, 'sight', '12:30', 60, 30],
        ['渡月桥', 35.0128, 135.6779, 'sight', '14:00', 40, 0],
        ['锦市场', 35.005, 135.7649, 'food', '16:30', 90, 200, '京都的厨房，边走边吃'],
        ['四条乌丸酒店', 35.0037, 135.7596, 'hotel', '20:00', undefined, 800],
      ]),
      day('哲学之道', [
        ['银阁寺', 35.027, 135.7982, 'sight', '09:00', 60, 25],
        ['哲学之道', 35.0236, 135.7944, 'sight', '10:10', 50, 0, '沿水渠步行到南禅寺'],
        ['南禅寺', 35.011, 135.794, 'sight', '11:10', 60, 30, '水路阁'],
        ['平安神宫', 35.016, 135.7824, 'sight', '13:30', 50, 0],
        ['京都站', 34.9858, 135.7588, 'transport', '16:00', undefined, 0, '返程'],
      ]),
    ],
  };
}
