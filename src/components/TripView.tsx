import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPlaces, reverseGeocode, type GeoResult } from '../lib/geo';
import { navigate, ui, useIsDark, useNarrow, useRoutes } from '../lib/hooks';
import { shareUrl } from '../lib/share';
import { tripStore, useSettings } from '../lib/store';
import { CATEGORIES, CATEGORY_LABEL, download, externalMapUrl, fmtDistance, fmtDuration, fmtMoney, uid } from '../lib/util';
import type { Category, RouteResult, Trip } from '../types';
import { PersonAvatar, PlaceAvatar } from './Avatar';
import { ChatPanel } from './ChatPanel';
import { Icon } from './Icon';
import { Itinerary, type DaySel } from './Itinerary';
import { MapView, type MapDay, type MapHandle, type MapInset } from './MapView';
import { PlaceModal } from './Modals';
import { ThemeButton } from './Settings';
import { Menu, Modal, confirmDialog, toast } from './ui';

type Pending = { lat: number; lng: number; name: string; address?: string; loading?: boolean };
type Tab = 'plan' | 'chat';
type Snap = 'peek' | 'half' | 'full';

/** 侧栏宽度 + 左右留白，地图据此把内容放在没被挡住的区域 */
const SIDEBAR_INSET = 372 + 12;
const PEEK = 150;

export function TripView({ trip, readOnly, onSaveShared }: { trip: Trip; readOnly?: boolean; onSaveShared?: () => void }) {
  const dark = useIsDark();
  const narrow = useNarrow();
  const routes = useRoutes(trip);
  const settings = useSettings();
  const mapRef = useRef<MapHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedDay, setSelectedDay] = useState<DaySel>('all');
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [targetDay, setTargetDay] = useState(0);
  const [chatOpen, setChatOpen] = useState(!readOnly && (!!settings.apiKey || trip.days.every((d) => !d.places.length)));
  const [tab, setTab] = useState<Tab>('plan');
  const [snap, setSnap] = useState<Snap>('half');
  const [hiddenCats, setHiddenCats] = useState<Category[]>([]);
  const [editPlace, setEditPlace] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);

  // 天数变少时修正选择
  useEffect(() => {
    if (selectedDay !== 'all' && selectedDay >= trip.days.length) setSelectedDay(trip.days.length - 1);
  }, [trip.days.length, selectedDay]);

  const mapDays: MapDay[] = useMemo(
    () => trip.days.map((d, i) => ({ id: d.id, places: d.places, route: routes[d.id], active: selectedDay === 'all' || selectedDay === i })),
    [trip.days, routes, selectedDay],
  );
  const activeCount = mapDays.filter((d) => d.active).reduce((s, d) => s + d.places.length, 0);
  const fitKey = `${trip.id}|${selectedDay}|${activeCount}|${narrow ? tab : ''}`;
  // 窄屏时地图下方被抽屉（和地点卡片）挡住
  const inset: MapInset = narrow
    ? { bottom: selectedPlace ? PEEK + 260 : snap === 'half' ? Math.round(window.innerHeight * 0.45) : PEEK }
    : { left: SIDEBAR_INSET };

  // 当前显示的这几天里，每种类型有几个地点
  const catCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    mapDays.filter((d) => d.active).forEach((d) => d.places.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1)));
    return CATEGORIES.filter((c) => counts.has(c)).map((c) => [c, counts.get(c)!] as const);
  }, [mapDays]);

  const selectPlace = (id: string) => {
    setSelectedPlace(id);
    setPending(null);
    const p = trip.days.flatMap((d) => d.places).find((x) => x.id === id);
    if (p) {
      setHiddenCats((h) => h.filter((c) => c !== p.category));
      // 等这次渲染把新的遮挡范围交给地图后再移动
      setTimeout(() => mapRef.current?.flyTo(p.lat, p.lng, 14));
    }
    document.querySelector(`[data-pid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (narrow) setSnap('peek');
  };

  const startAdd = (dayIndex: number) => {
    setTargetDay(dayIndex);
    if (narrow) setSnap('full');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const onMapClick = async ({ lat, lng }: { lat: number; lng: number }) => {
    setSelectedPlace(null);
    if (readOnly) return;
    setTargetDay(selectedDay === 'all' ? targetDay : selectedDay);
    setPending({ lat, lng, name: '', loading: true });
    if (narrow) setSnap('peek');
    const r = await reverseGeocode(lat, lng).catch(() => null);
    setPending((p) => (p && p.lat === lat && p.lng === lng ? { ...p, name: r?.name || '自定义地点', address: r?.displayName, loading: false } : p));
  };

  const addPending = (category: Category) => {
    if (!pending) return;
    const day = Math.min(targetDay, trip.days.length - 1);
    tripStore.update(trip.id, (t) => {
      t.days[day].places.push({ id: uid(), name: pending.name.trim() || '自定义地点', lat: pending.lat, lng: pending.lng, category, address: pending.address?.slice(0, 300) });
    });
    toast(`已添加到第 ${day + 1} 天`, 'success');
    setPending(null);
  };

  const doShare = async () => {
    const url = await shareUrl(trip);
    setShare(url);
  };

  const deleteTrip = async () => {
    if (await confirmDialog({ title: `删除「${trip.name}」？`, message: '行程和对应的 AI 对话都会从这个浏览器里删除，无法恢复。', okText: '删除', danger: true })) {
      tripStore.remove(trip.id);
      navigate('/');
    }
  };

  const canUndo = !readOnly && tripStore.canUndo(trip.id);
  const showPlan = !narrow || tab === 'plan';
  const showChat = !readOnly && (narrow ? tab === 'chat' : chatOpen);

  const sideContent = (
    <>
      {!readOnly && (
        <SearchBox
          inputRef={searchRef}
          getCenter={() => mapRef.current?.center()}
          hint={`添加到第 ${(selectedDay === 'all' ? Math.min(targetDay, trip.days.length - 1) : selectedDay) + 1} 天`}
          onFocus={() => narrow && setSnap('full')}
          onPick={(r) => {
            if (selectedDay !== 'all') setTargetDay(selectedDay);
            setSelectedPlace(null);
            setPending({ lat: r.lat, lng: r.lng, name: r.name, address: r.displayName });
            mapRef.current?.flyTo(r.lat, r.lng, 14);
            if (narrow) setSnap('peek');
          }}
        />
      )}
      <Itinerary
        trip={trip}
        routes={routes}
        readOnly={readOnly}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        selectedPlaceId={selectedPlace}
        onSelectPlace={selectPlace}
        onAddPlace={startAdd}
      />
    </>
  );

  return (
    <div className="trip-page">
      <header className="titlebar">
        <button className="tb-round" onClick={() => navigate('/')} title="返回首页">
          <Icon name="back" size={18} />
        </button>
        <div className="tb-brand" onClick={() => navigate('/')}>
          <span className="logo-mark">途</span>
          <div className="tb-names">
            <div className="tb-name">途迹</div>
            <div className="tb-sub">{readOnly ? '分享的行程 · 只读' : 'AI 旅行计划'}</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {readOnly ? (
          <button className="btn btn-primary" onClick={onSaveShared}>
            <Icon name="download" size={15} /> 保存到我的行程
          </button>
        ) : (
          <>
            <button className="tb-round" disabled={!canUndo} onClick={() => tripStore.undo(trip.id)} title="撤销（AI 的一整次修改会一起撤销）">
              <Icon name="undo" size={17} />
            </button>
            <button className="btn tb-btn" onClick={doShare}>
              <Icon name="share" size={15} /> <span className="hide-sm">分享</span>
            </button>
            {!narrow && (
              <button className={'btn tb-btn' + (chatOpen ? ' btn-soft' : '')} onClick={() => setChatOpen(!chatOpen)}>
                <Icon name="sparkles" size={15} /> AI 助手
              </button>
            )}
            <Menu
              trigger={
                <button className="tb-round" title="更多">
                  <Icon name="more" size={18} />
                </button>
              }
              items={[
                { label: '导出为 JSON', icon: 'download', onClick: () => download(`${trip.name}.json`, JSON.stringify(trip, null, 2)) },
                { label: '设置', icon: 'settings', onClick: ui.openSettings },
                'sep',
                { label: '删除行程', icon: 'trash', danger: true, onClick: deleteTrip },
              ]}
            />
          </>
        )}
        <ThemeButton />
        <button className="me-btn" onClick={ui.openSettings} title={settings.nickname ? `${settings.nickname} · 设置` : '设置昵称和头像'}>
          <PersonAvatar name={settings.nickname || '我'} size={36} title="" />
        </button>
      </header>

      <main className={'trip-main' + (narrow ? ' narrow' : '')}>
        <section className="panel map-stage" style={showPlan ? undefined : { display: 'none' }}>
          <MapView
            ref={mapRef}
            days={mapDays}
            dark={dark}
            fitKey={fitKey}
            inset={inset}
            hiddenCats={hiddenCats}
            selectedPlaceId={selectedPlace}
            onSelectPlace={selectPlace}
            onMapClick={onMapClick}
            pending={pending}
            onPendingClose={() => setPending(null)}
            pendingContent={
              pending && (
                <PendingCard
                  trip={trip}
                  pending={pending}
                  day={Math.min(targetDay, trip.days.length - 1)}
                  onDay={setTargetDay}
                  onName={(name) => setPending({ ...pending, name })}
                  onAdd={addPending}
                  onClose={() => setPending(null)}
                />
              )
            }
          />

          {catCounts.length > 0 && (
            <div className="cat-filter" style={narrow ? undefined : { left: SIDEBAR_INSET + 12 }}>
              {catCounts.map(([c, n]) => {
                const off = hiddenCats.includes(c);
                return (
                  <button
                    key={c}
                    className={`cat-chip cat-${c}` + (off ? ' off' : '')}
                    title={off ? `显示${CATEGORY_LABEL[c]}` : `隐藏${CATEGORY_LABEL[c]}`}
                    onClick={() => setHiddenCats(off ? hiddenCats.filter((x) => x !== c) : [...hiddenCats, c])}
                  >
                    <span className="cat-dot" />
                    {CATEGORY_LABEL[c]}
                    <span className="n">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {narrow ? (
            <Sheet snap={snap} onSnap={setSnap}>
              {sideContent}
            </Sheet>
          ) : (
            <aside className="sidebar">{sideContent}</aside>
          )}

          {selectedPlace && (!narrow || snap === 'peek') && (
            <PlaceCard
              key={selectedPlace}
              trip={trip}
              placeId={selectedPlace}
              routes={routes}
              readOnly={readOnly}
              style={narrow ? undefined : { left: SIDEBAR_INSET + 12 }}
              onEdit={() => setEditPlace(selectedPlace)}
              onClose={() => setSelectedPlace(null)}
            />
          )}
        </section>

        {showChat && (
          <aside className="panel chat-panel">
            <ChatPanel trip={trip} onClose={narrow ? undefined : () => setChatOpen(false)} />
          </aside>
        )}
      </main>

      {narrow && !readOnly && (
        <nav className="tabbar">
          {(
            [
              ['plan', 'map', '行程'],
              ['chat', 'sparkles', 'AI 助手'],
            ] as [Tab, Parameters<typeof Icon>[0]['name'], string][]
          ).map(([k, icon, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              <Icon name={icon} size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      {editPlace && <PlaceModal trip={trip} placeId={editPlace} onClose={() => setEditPlace(null)} />}
      {share && <ShareModal url={share} trip={trip} onClose={() => setShare(null)} />}
    </div>
  );
}

/** 窄屏底部抽屉：拖动把手在三档高度间切换，点一下也能切换 */
function Sheet({ snap, onSnap, children }: { snap: Snap; onSnap: (s: Snap) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const snapHeights = (): [Snap, number][] => {
    const total = ref.current?.parentElement?.clientHeight ?? 600;
    return [
      ['peek', PEEK],
      ['half', total * 0.52],
      ['full', total - 44],
    ];
  };

  return (
    <div ref={ref} className={`sheet snap-${snap}` + (height !== null ? ' dragging' : '')} style={height !== null ? { height } : undefined}>
      <button
        className="sheet-handle"
        aria-label="展开或收起行程"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: ref.current!.offsetHeight, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = e.clientY - d.y;
          if (Math.abs(dy) > 4) d.moved = true;
          if (d.moved) {
            const [, , [, max]] = snapHeights();
            setHeight(Math.max(PEEK - 40, Math.min(max, d.h - dy)));
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (!d.moved) {
            onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
            return;
          }
          const h = ref.current!.offsetHeight;
          const nearest = snapHeights().reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a));
          setHeight(null);
          onSnap(nearest[0]);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setHeight(null);
        }}
      />
      {children}
    </div>
  );
}

/** 选中地点后浮在地图上的卡片：头像、类型、关键数字和常用操作 */
function PlaceCard({
  trip,
  placeId,
  routes,
  readOnly,
  style,
  onEdit,
  onClose,
}: {
  trip: Trip;
  placeId: string;
  routes: Record<string, RouteResult>;
  readOnly?: boolean;
  style?: React.CSSProperties;
  onEdit: () => void;
  onClose: () => void;
}) {
  const di = trip.days.findIndex((d) => d.places.some((p) => p.id === placeId));
  if (di < 0) return null;
  const day = trip.days[di];
  const pi = day.places.findIndex((p) => p.id === placeId);
  const p = day.places[pi];
  const next = routes[day.id]?.legs[pi];

  const toggleVisited = () =>
    tripStore.update(trip.id, (t) => {
      const q = t.days[di].places[pi];
      q.visited = !q.visited || undefined;
    });
  const remove = () => {
    tripStore.update(trip.id, (t) => {
      t.days[di].places.splice(pi, 1);
    });
    toast(`已删除「${p.name}」，可撤销`);
    onClose();
  };

  const info = [
    ['到达', p.time ?? '—'],
    ['停留', p.duration ? fmtDuration(p.duration * 60) : '—'],
    ['花费', p.cost ? fmtMoney(p.cost, trip.currency) : p.cost === 0 ? '免费' : '—'],
  ];

  return (
    <div className={`place-card cat-${p.category}`} style={style}>
      <div className="pc-head">
        <PlaceAvatar category={p.category} size={46} visited={p.visited} />
        <div className="pc-title">
          <div className="pc-name">{p.name}</div>
          <div className="pc-sub tabular">
            <span className="cat-name">{CATEGORY_LABEL[p.category]}</span>
            <span>
              第 {di + 1} 天 · 第 {pi + 1} 站
            </span>
          </div>
        </div>
        <button className="modal-x" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={13} stroke={2.2} />
        </button>
      </div>

      <div className="pc-actions">
        {!readOnly && (
          <button className={'pc-act' + (p.visited ? ' done' : ' primary')} onClick={toggleVisited}>
            <Icon name="check" size={17} stroke={2.2} />
            {p.visited ? '已打卡' : '打卡'}
          </button>
        )}
        <a className="pc-act" href={externalMapUrl(p)} target="_blank" rel="noreferrer">
          <Icon name="navigate" size={17} />
          导航
        </a>
        {!readOnly && (
          <button className="pc-act" onClick={onEdit}>
            <Icon name="edit" size={17} />
            编辑
          </button>
        )}
        {!readOnly && (
          <button className="pc-act danger" onClick={remove}>
            <Icon name="trash" size={17} />
            删除
          </button>
        )}
      </div>

      <div className="pc-info">
        {info.map(([k, v]) => (
          <div key={k}>
            <div className="pc-k">{k}</div>
            <div className="pc-v">{v}</div>
          </div>
        ))}
      </div>

      {next && pi < day.places.length - 1 && (
        <div className="pc-addr tabular">
          到下一站「{day.places[pi + 1].name}」{fmtDistance(next.distance)} · {fmtDuration(next.duration)}
        </div>
      )}
      {p.notes && <div className="pc-text">{p.notes}</div>}
      {p.address && <div className="pc-addr">{p.address}</div>}
    </div>
  );
}

function PendingCard({
  trip,
  pending,
  day,
  onDay,
  onName,
  onAdd,
  onClose,
}: {
  trip: Trip;
  pending: Pending;
  day: number;
  onDay: (d: number) => void;
  onName: (n: string) => void;
  onAdd: (c: Category) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState<Category>('sight');
  return (
    <div className="pp">
      <div className="pp-head">
        <PlaceAvatar category={cat} size={30} />
        <input className="pp-name" value={pending.loading ? '正在识别地点…' : pending.name} disabled={pending.loading} onChange={(e) => onName(e.target.value)} />
        <button className="modal-x" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={12} stroke={2.2} />
        </button>
      </div>
      {pending.address && <div className="pp-addr">{pending.address}</div>}
      <div className="pp-cats">
        {(['sight', 'food', 'hotel', 'shopping', 'activity', 'transport'] as Category[]).map((c) => (
          <button key={c} className={`chip chip-xs cat-${c}` + (cat === c ? ' active' : '')} onClick={() => setCat(c)}>
            <span className="cat-dot" />
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="pp-actions">
        <select className="input input-sm" value={day} onChange={(e) => onDay(Number(e.target.value))}>
          {trip.days.map((d, i) => (
            <option key={d.id} value={i}>
              第 {i + 1} 天
            </option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" disabled={pending.loading} onClick={() => onAdd(cat)}>
          <Icon name="plus" size={14} stroke={2.2} /> 添加
        </button>
      </div>
    </div>
  );
}

function SearchBox({
  inputRef,
  getCenter,
  hint,
  onPick,
  onFocus,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  getCenter: () => { lat: number; lng: number } | undefined;
  hint: string;
  onPick: (r: GeoResult) => void;
  onFocus?: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await searchPlaces(q.trim(), { near: getCenter() }));
    } catch (e) {
      toast(e instanceof Error ? e.message : '搜索失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="side-search">
      <form
        className="search-pill"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={q}
          onFocus={onFocus}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setResults(null);
          }}
          placeholder={`搜索地点 · ${hint}`}
          onKeyDown={(e) => e.key === 'Escape' && setResults(null)}
        />
        {loading ? <span className="spinner sm" /> : q && (
          <button type="button" className="icon-btn sm" onClick={() => (setQ(''), setResults(null))}>
            <Icon name="x" size={14} />
          </button>
        )}
      </form>
      {results && (
        <div className="search-results">
          {results.length === 0 && <div className="sr-empty">没有找到，试试加上城市名或用当地语言</div>}
          {results.map((r, i) => (
            <button
              key={i}
              className="sr-item"
              onClick={() => {
                onPick(r);
                setResults(null);
              }}
            >
              <Icon name="pin" size={15} />
              <div style={{ minWidth: 0 }}>
                <div className="sr-name">{r.name}</div>
                <div className="sr-addr">{r.displayName}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareModal({ url, trip, onClose }: { url: string; trip: Trip; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };
  return (
    <Modal
      title="分享行程"
      onClose={onClose}
      footer={
        <>
          {typeof navigator.share === 'function' && (
            <button className="btn" onClick={() => navigator.share({ title: trip.name, url }).catch(() => {})}>
              系统分享
            </button>
          )}
          <button className="btn btn-primary" onClick={copy}>
            <Icon name="copy" size={15} /> 复制链接
          </button>
        </>
      }
    >
      <p className="modal-msg">整份行程已经压缩进这个链接里。对方打开后可以查看地图和每日安排，也能一键保存到自己的浏览器。之后的修改不会自动同步，需要重新分享。</p>
      <textarea className="input share-url" readOnly value={url} rows={3} onFocus={(e) => e.target.select()} />
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        链接长度 {url.length} 字符{url.length > 8000 ? '，较长，部分聊天软件可能会截断' : ''}
      </div>
    </Modal>
  );
}
