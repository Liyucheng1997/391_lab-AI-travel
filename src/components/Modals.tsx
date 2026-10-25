import { useState } from 'react';
import { emptyDay, tripStore } from '../lib/store';
import { CATEGORY_LABEL, fmtDayDate } from '../lib/util';
import type { Category, Place, Trip } from '../types';
import { Modal } from './ui';

const CATS = Object.keys(CATEGORY_LABEL) as Category[];
const CURRENCIES = ['CNY', 'JPY', 'USD', 'EUR', 'GBP', 'HKD', 'KRW', 'THB'];

const numOrUndef = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));

export function PlaceModal({ trip, placeId, onClose }: { trip: Trip; placeId: string; onClose: () => void }) {
  const dayIdx = trip.days.findIndex((d) => d.places.some((p) => p.id === placeId));
  const place = trip.days[dayIdx]?.places.find((p) => p.id === placeId);
  const [f, setF] = useState(() => ({
    name: place?.name ?? '',
    category: place?.category ?? 'sight',
    time: place?.time ?? '',
    duration: place?.duration?.toString() ?? '',
    cost: place?.cost?.toString() ?? '',
    address: place?.address ?? '',
    notes: place?.notes ?? '',
    visited: !!place?.visited,
    day: dayIdx,
  }));
  if (!place) return null;
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const save = () => {
    tripStore.update(trip.id, (t) => {
      const from = t.days[dayIdx];
      const i = from.places.findIndex((p) => p.id === placeId);
      const p: Place = {
        ...from.places[i],
        name: f.name.trim() || place.name,
        category: f.category,
        time: f.time || undefined,
        duration: numOrUndef(f.duration),
        cost: numOrUndef(f.cost),
        address: f.address.trim() || undefined,
        notes: f.notes.trim() || undefined,
        visited: f.visited || undefined,
      };
      if (f.day === dayIdx) from.places[i] = p;
      else {
        from.places.splice(i, 1);
        t.days[f.day].places.push(p);
      }
    });
    onClose();
  };

  return (
    <Modal
      title="编辑地点"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <label className="form-label">名称</label>
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">类型</label>
          <div className="chip-row">
            {CATS.map((c) => (
              <button key={c} type="button" className={'chip' + (f.category === c ? ' active' : '')} onClick={() => set({ category: c })}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">安排在</label>
          <select className="input" value={f.day} onChange={(e) => set({ day: Number(e.target.value) })}>
            {trip.days.map((d, i) => (
              <option key={d.id} value={i}>
                第 {i + 1} 天 {fmtDayDate(trip, i)} {d.title ?? ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">到达时间</label>
          <input className="input" type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
          <label className="form-label" style={{ width: 'auto' }}>
            停留
          </label>
          <input className="input tabular" inputMode="numeric" placeholder="分钟" value={f.duration} onChange={(e) => set({ duration: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">预计花费</label>
          <input className="input tabular" inputMode="decimal" placeholder={trip.currency} value={f.cost} onChange={(e) => set({ cost: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">地址</label>
          <input className="input" value={f.address} onChange={(e) => set({ address: e.target.value })} />
        </div>
        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <label className="form-label" style={{ paddingTop: 7 }}>
            备注
          </label>
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="门票、预约、推荐菜…" />
        </div>
        <label className="form-check" style={{ paddingLeft: 104 }}>
          <input type="checkbox" checked={f.visited} onChange={(e) => set({ visited: e.target.checked })} />
          已打卡
        </label>
        <div className="muted tabular" style={{ paddingLeft: 104, fontSize: 12 }}>
          坐标 {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
        </div>
      </div>
    </Modal>
  );
}

export function TripInfoModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [f, setF] = useState({
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate ?? '',
    days: String(trip.days.length),
    currency: trip.currency,
    budget: trip.budget?.toString() ?? '',
    notes: trip.notes ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const dayCount = Math.min(60, Math.max(1, Math.round(Number(f.days)) || 1));
  const losing = trip.days.slice(dayCount).reduce((s, d) => s + d.places.length, 0);

  const save = () => {
    tripStore.update(trip.id, (t) => {
      t.name = f.name.trim() || t.name;
      t.destination = f.destination.trim();
      t.startDate = f.startDate || undefined;
      t.currency = f.currency;
      t.budget = numOrUndef(f.budget);
      t.notes = f.notes.trim() || undefined;
      while (t.days.length < dayCount) t.days.push(emptyDay());
      t.days.length = dayCount;
    });
    onClose();
  };

  return (
    <Modal
      title="行程信息"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <label className="form-label">名称</label>
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">目的地</label>
          <input className="input" value={f.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="例如：日本 京都" />
        </div>
        <div className="form-row">
          <label className="form-label">出发日期</label>
          <input className="input" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">天数</label>
          <input className="input tabular" type="number" min={1} max={60} value={f.days} onChange={(e) => set({ days: e.target.value })} />
        </div>
        {losing > 0 && <div className="form-warn">减少天数会删除最后几天中的 {losing} 个地点</div>}
        <div className="form-row">
          <label className="form-label">币种</label>
          <select className="input" value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="form-label" style={{ width: 'auto' }}>
            预算
          </label>
          <input className="input tabular" inputMode="decimal" value={f.budget} onChange={(e) => set({ budget: e.target.value })} />
        </div>
        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <label className="form-label" style={{ paddingTop: 7 }}>
            备注
          </label>
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

export function DayModal({ trip, dayIndex, onClose }: { trip: Trip; dayIndex: number; onClose: () => void }) {
  const day = trip.days[dayIndex];
  const [title, setTitle] = useState(day?.title ?? '');
  const [notes, setNotes] = useState(day?.notes ?? '');
  if (!day) return null;
  const save = () => {
    tripStore.update(trip.id, (t) => {
      t.days[dayIndex].title = title.trim() || undefined;
      t.days[dayIndex].notes = notes.trim() || undefined;
    });
    onClose();
  };
  return (
    <Modal
      title={`第 ${dayIndex + 1} 天`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <label className="form-label">主题</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：东山寺庙线" autoFocus />
        </div>
        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <label className="form-label" style={{ paddingTop: 7 }}>
            备注
          </label>
          <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
