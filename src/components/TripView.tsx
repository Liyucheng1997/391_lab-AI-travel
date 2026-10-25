import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPlaces, reverseGeocode, type GeoResult } from '../lib/geo';
import { navigate, ui, useIsDark, useNarrow, useRoutes } from '../lib/hooks';
import { shareUrl } from '../lib/share';
import { tripStore, useSettings } from '../lib/store';
import { CATEGORY_LABEL, download, uid } from '../lib/util';
import type { Category, Trip } from '../types';
import { ChatPanel } from './ChatPanel';
import { Icon } from './Icon';
import { Itinerary, type DaySel } from './Itinerary';
import { MapView, type MapDay, type MapHandle } from './MapView';
import { ThemeButton } from './Settings';
import { Menu, Modal, confirmDialog, toast } from './ui';

type Pending = { lat: number; lng: number; name: string; address?: string; loading?: boolean };
type Tab = 'list' | 'map' | 'chat';

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
  const [tab, setTab] = useState<Tab>('list');
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

  const selectPlace = (id: string) => {
    setSelectedPlace(id);
    const p = trip.days.flatMap((d) => d.places).find((x) => x.id === id);
    if (p) mapRef.current?.flyTo(p.lat, p.lng, 14);
    document.querySelector(`[data-pid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (narrow && tab === 'list') setTab('map');
  };

  const startAdd = (dayIndex: number) => {
    setTargetDay(dayIndex);
    if (narrow) setTab('map');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const onMapClick = async ({ lat, lng }: { lat: number; lng: number }) => {
    setSelectedPlace(null);
    if (readOnly) return;
    setTargetDay(selectedDay === 'all' ? targetDay : selectedDay);
    setPending({ lat, lng, name: '', loading: true });
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

  const showList = !narrow || tab === 'list';
  const showMap = !narrow || tab === 'map';
  const showChat = !readOnly && (narrow ? tab === 'chat' : chatOpen);

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
      </header>

      <main className={'trip-main' + (narrow ? ' narrow' : '')}>
        <aside className="panel itin-panel" hidden={!showList}>
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
        </aside>

        <section className="panel map-panel" style={showMap ? undefined : { display: 'none' }}>
          <MapView
            ref={mapRef}
            days={mapDays}
            dark={dark}
            fitKey={fitKey}
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
          {!readOnly && (
            <SearchBox
              inputRef={searchRef}
              getCenter={() => mapRef.current?.center()}
              hint={selectedDay === 'all' ? `添加到第 ${Math.min(targetDay, trip.days.length - 1) + 1} 天` : `添加到第 ${selectedDay + 1} 天`}
              onPick={(r) => {
                if (selectedDay !== 'all') setTargetDay(selectedDay);
                setPending({ lat: r.lat, lng: r.lng, name: r.name, address: r.displayName });
                mapRef.current?.flyTo(r.lat, r.lng, 14);
              }}
            />
          )}
        </section>

        {showChat && (
          <aside className="panel chat-panel">
            <ChatPanel trip={trip} onClose={narrow ? undefined : () => setChatOpen(false)} />
          </aside>
        )}
      </main>

      {narrow && (
        <nav className="tabbar">
          {(
            [
              ['list', 'list', '行程'],
              ['map', 'map', '地图'],
              ...(readOnly ? [] : [['chat', 'sparkles', 'AI 助手']]),
            ] as [Tab, Parameters<typeof Icon>[0]['name'], string][]
          ).map(([k, icon, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              <Icon name={icon} size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      {share && <ShareModal url={share} trip={trip} onClose={() => setShare(null)} />}
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
        <input className="pp-name" value={pending.loading ? '正在识别地点…' : pending.name} disabled={pending.loading} onChange={(e) => onName(e.target.value)} />
        <button className="modal-x" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={12} stroke={2.2} />
        </button>
      </div>
      {pending.address && <div className="pp-addr">{pending.address}</div>}
      <div className="pp-cats">
        {(['sight', 'food', 'hotel', 'shopping', 'activity', 'transport'] as Category[]).map((c) => (
          <button key={c} className={'chip chip-xs' + (cat === c ? ' active' : '')} onClick={() => setCat(c)}>
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
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  getCenter: () => { lat: number; lng: number } | undefined;
  hint: string;
  onPick: (r: GeoResult) => void;
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
    <div className="map-search">
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
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setResults(null);
          }}
          placeholder={`搜索地点，回车查找 · ${hint}`}
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
