import { useState } from 'react';
import { optimizeOrder } from '../lib/geo';
import { emptyDay, tripStore, useSettings } from '../lib/store';
import { CATEGORY_LABEL, ROUTE_LABEL, fmtDateRange, fmtDayDate, fmtDistance, fmtDuration, fmtMoney, tripStats } from '../lib/util';
import type { Day, RouteMode, RouteResult, Trip } from '../types';
import { AvatarStack, PlaceAvatar, tripPeople } from './Avatar';
import { Icon } from './Icon';
import { DayModal, PlaceModal, TripInfoModal } from './Modals';
import { Menu, confirmDialog, toast } from './ui';

export type DaySel = number | 'all';

interface Props {
  trip: Trip;
  routes: Record<string, RouteResult>;
  readOnly?: boolean;
  selectedDay: DaySel;
  onSelectDay: (d: DaySel) => void;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  onAddPlace: (dayIndex: number) => void;
}

export function Itinerary(props: Props) {
  const { trip, readOnly, selectedDay, onSelectDay } = props;
  const [editTrip, setEditTrip] = useState(false);
  const { nickname } = useSettings();
  const stats = tripStats(trip);
  const people = readOnly ? (trip.members ?? []) : tripPeople(nickname, trip.members);
  const shownDays = selectedDay === 'all' ? trip.days.map((d, i) => [d, i] as const) : [[trip.days[selectedDay], selectedDay] as const];

  const addDay = () => {
    tripStore.update(trip.id, (t) => {
      t.days.push(emptyDay());
    });
    onSelectDay(trip.days.length);
  };

  return (
    <div className="itin">
      <div className="itin-head">
        <div className="itin-title-row">
          <div style={{ minWidth: 0 }}>
            <div className="itin-dest">{trip.destination || '目的地未定'}</div>
            <h1 className="itin-title">{trip.name}</h1>
          </div>
          {!readOnly && (
            <button className="icon-btn" onClick={() => setEditTrip(true)} title="编辑行程信息">
              <Icon name="edit" size={17} />
            </button>
          )}
        </div>
        <div className="itin-meta tabular">
          <span>
            <Icon name="calendar" size={14} /> {fmtDateRange(trip)}
          </span>
          <span>
            <Icon name="pin" size={14} /> {stats.places} 个地点
          </span>
          {stats.visited > 0 && <span className="status-dot ok">已打卡 {stats.visited}</span>}
        </div>
        {(stats.cost > 0 || trip.budget) && (
          <div className="budget">
            <div className="budget-text tabular">
              <span>预计花费 {fmtMoney(stats.cost, trip.currency)}</span>
              {trip.budget ? <span className="muted">预算 {fmtMoney(trip.budget, trip.currency)}</span> : null}
            </div>
            {trip.budget ? (
              <div className="budget-bar">
                <div className={stats.cost > trip.budget ? 'over' : ''} style={{ width: `${Math.min(100, (stats.cost / trip.budget) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        )}
        {people.length > 0 &&
          (readOnly ? (
            <div className="itin-people">
              <AvatarStack names={people} />
              <span>{people.length} 人同行</span>
            </div>
          ) : (
            <button className="itin-people" onClick={() => setEditTrip(true)} title="编辑同行的人">
              <AvatarStack names={people} />
              <span>{people.length > 1 ? `${people.length} 人同行` : '添加同行的人'}</span>
            </button>
          ))}
        {trip.notes && <div className="itin-notes">{trip.notes}</div>}
      </div>

      <div className="day-tabs">
        <button className={'chip' + (selectedDay === 'all' ? ' active' : '')} onClick={() => onSelectDay('all')}>
          全部
        </button>
        {trip.days.map((d, i) => (
          <button key={d.id} className={'chip tabular' + (selectedDay === i ? ' active' : '')} onClick={() => onSelectDay(i)}>
            第 {i + 1} 天
          </button>
        ))}
        {!readOnly && (
          <button className="chip chip-add" onClick={addDay} title="添加一天">
            <Icon name="plus" size={14} stroke={2.2} />
          </button>
        )}
      </div>

      <div className="itin-days">
        {shownDays.map(([d, i]) => d && <DayCard key={d.id} {...props} day={d} index={i} />)}
      </div>

      {editTrip && <TripInfoModal trip={trip} onClose={() => setEditTrip(false)} />}
    </div>
  );
}

function DayCard({ trip, routes, readOnly, day, index, selectedPlaceId, onSelectPlace, onAddPlace, onSelectDay, selectedDay }: Props & { day: Day; index: number }) {
  const [editPlace, setEditPlace] = useState<string | null>(null);
  const [editDay, setEditDay] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const route = routes[day.id];
  const cost = day.places.reduce((s, p) => s + (p.cost ?? 0), 0);

  const setMode = (m: RouteMode) =>
    tripStore.update(trip.id, (t) => {
      t.days[index].routeMode = m;
    });

  const onDrop = (e: React.DragEvent, pos: number) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/x-place');
    if (!id) return;
    tripStore.update(trip.id, (t) => {
      let from = -1;
      let fi = -1;
      t.days.forEach((d, di) => {
        const k = d.places.findIndex((p) => p.id === id);
        if (k >= 0) {
          from = di;
          fi = k;
        }
      });
      if (from < 0) return;
      const [p] = t.days[from].places.splice(fi, 1);
      const target = from === index && fi < pos ? pos - 1 : pos;
      t.days[index].places.splice(target, 0, p);
    });
  };

  const optimize = () => {
    const next = optimizeOrder(day.places);
    if (next.every((p, i) => p.id === day.places[i].id)) {
      toast('当前顺序已经是最短路线');
      return;
    }
    tripStore.update(trip.id, (t) => {
      t.days[index].places = next;
    });
    toast('已按最短路线重新排序，可撤销', 'success');
  };

  const removeDay = async () => {
    if (trip.days.length === 1) return toast('至少要保留一天');
    if (day.places.length && !(await confirmDialog({ title: `删除第 ${index + 1} 天？`, message: `其中的 ${day.places.length} 个地点会一起删除。`, okText: '删除', danger: true })))
      return;
    tripStore.update(trip.id, (t) => {
      t.days.splice(index, 1);
    });
    if (selectedDay !== 'all') onSelectDay(Math.max(0, index - 1));
  };

  return (
    <section
      className="day-card"
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        if (!day.places.length) setDragOver(0);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
      }}
      onDrop={(e) => !readOnly && onDrop(e, dragOver ?? day.places.length)}
    >
      <header className="day-head">
        <button className="day-head-main" onClick={() => onSelectDay(index)}>
          <div className="day-label tabular">
            第 {index + 1} 天<span className="muted">{fmtDayDate(trip, index)}</span>
          </div>
          {day.title && <div className="day-title">{day.title}</div>}
        </button>
        {!readOnly && (
          <Menu
            trigger={
              <button className="icon-btn" title="这一天的操作">
                <Icon name="more" size={18} />
              </button>
            }
            items={[
              { label: '编辑主题和备注', icon: 'edit', onClick: () => setEditDay(true) },
              { label: '优化路线顺序', icon: 'wand', onClick: optimize },
              'sep',
              { label: '删除这一天', icon: 'trash', danger: true, onClick: removeDay },
            ]}
          />
        )}
      </header>

      <div className="day-sub tabular">
        <span>{day.places.length} 个地点</span>
        {route && route.distance > 0 && (
          <span>
            {fmtDistance(route.distance)} · {route.approximate && route.mode !== 'straight' ? '约 ' : ''}
            {fmtDuration(route.duration)}
          </span>
        )}
        {cost > 0 && <span>{fmtMoney(cost, trip.currency)}</span>}
        {!readOnly ? (
          <select className="mode-select" value={day.routeMode} onChange={(e) => setMode(e.target.value as RouteMode)} title="路线方式">
            {(Object.keys(ROUTE_LABEL) as RouteMode[]).map((m) => (
              <option key={m} value={m}>
                {ROUTE_LABEL[m]}
              </option>
            ))}
          </select>
        ) : (
          <span>{ROUTE_LABEL[day.routeMode]}</span>
        )}
      </div>
      {day.notes && <div className="day-notes">{day.notes}</div>}

      <ol className="place-list">
        {day.places.map((p, i) => (
          <li key={p.id}>
            {i > 0 && route?.legs[i - 1] && (
              <div className="leg tabular">
                {fmtDistance(route.legs[i - 1].distance)} · {fmtDuration(route.legs[i - 1].duration)}
              </div>
            )}
            {dragOver === i && <div className="drop-line" />}
            <div
              className={'place-row' + (p.id === selectedPlaceId ? ' selected' : '')}
              data-pid={p.id}
              draggable={!readOnly}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/x-place', p.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (readOnly) return;
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setDragOver(e.clientY < r.top + r.height / 2 ? i : i + 1);
              }}
              onClick={() => onSelectPlace(p.id)}
              onDoubleClick={() => !readOnly && setEditPlace(p.id)}
            >
              <PlaceAvatar category={p.category} size={32} badge={i + 1} visited={p.visited} />
              <div className="place-main">
                <div className="place-name">{p.name}</div>
                <div className="place-meta tabular">
                  {[p.time, CATEGORY_LABEL[p.category], p.duration ? fmtDuration(p.duration * 60) : '', p.cost ? fmtMoney(p.cost, trip.currency) : '']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {p.notes && <div className="place-notes">{p.notes}</div>}
              </div>
              {!readOnly && (
                <div className="row-actions">
                  <button
                    className="icon-btn"
                    title={p.visited ? '取消打卡' : '打卡'}
                    onClick={(e) => {
                      e.stopPropagation();
                      tripStore.update(trip.id, (t) => {
                        const q = t.days[index].places[i];
                        q.visited = !q.visited || undefined;
                      });
                    }}
                  >
                    <Icon name="check" size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    title="编辑"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditPlace(p.id);
                    }}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      tripStore.update(trip.id, (t) => {
                        t.days[index].places.splice(i, 1);
                      });
                      toast(`已删除「${p.name}」，可撤销`);
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {dragOver === day.places.length && day.places.length > 0 && <div className="drop-line" />}
      </ol>

      {!day.places.length && (
        <div className="day-empty">{readOnly ? '这一天还没有安排' : dragOver === 0 ? '放到这里' : '还没有安排，搜索地点、点击地图或让 AI 帮你规划'}</div>
      )}
      {!readOnly && (
        <button className="btn btn-ghost btn-sm add-place" onClick={() => onAddPlace(index)}>
          <Icon name="plus" size={14} stroke={2.2} /> 添加地点
        </button>
      )}

      {editPlace && <PlaceModal trip={trip} placeId={editPlace} onClose={() => setEditPlace(null)} />}
      {editDay && <DayModal trip={trip} dayIndex={index} onClose={() => setEditDay(false)} />}
    </section>
  );
}
