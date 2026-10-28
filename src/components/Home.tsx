import { useMemo, useState } from 'react';
import { navigate, ui, useIsDark } from '../lib/hooks';
import { normalizeTrip, tripStore, useSettings, useTrips } from '../lib/store';
import { fmtDateRange, pickFile, tripStats } from '../lib/util';
import type { Trip } from '../types';
import { setPendingPrompt } from './ChatPanel';
import { Icon } from './Icon';
import { MapView, type MapDay } from './MapView';
import { AvatarStack, PersonAvatar, tripPeople } from './Avatar';
import { ThemeButton } from './Settings';
import { toast } from './ui';

const EXAMPLES = ['11 月去京都 4 天，喜欢寺庙和美食，预算 6000 元', '从米兰出发，托斯卡纳自驾 5 天', '带父母去成都 3 天，节奏慢一点'];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export function Home() {
  const trips = useTrips();
  const settings = useSettings();
  const dark = useIsDark();
  const [prompt, setPrompt] = useState('');

  const start = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!settings.apiKey.trim()) {
      toast('先填入你的 Claude API Key，AI 才能帮你规划');
      ui.openSettings();
      return;
    }
    const trip = tripStore.create({ name: '新的旅行' });
    setPendingPrompt(trip.id, t);
    navigate(`/trip/${trip.id}`);
  };

  const newBlank = () => {
    const trip = tripStore.create({ name: '新的旅行' });
    navigate(`/trip/${trip.id}`);
  };

  const importTrip = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = (Array.isArray(data) ? data : [data]).map((t) => normalizeTrip(t, true)).filter(Boolean) as Trip[];
      if (!list.length) throw new Error('没有可识别的行程');
      list.forEach((t) => tripStore.add(t));
      toast(`导入了 ${list.length} 个行程`, 'success');
    } catch (e) {
      toast(`导入失败：${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  const total = useMemo(() => {
    let places = 0, visited = 0, days = 0;
    for (const t of trips) {
      const s = tripStats(t);
      places += s.places;
      visited += s.visited;
      days += t.days.length;
    }
    return { places, visited, days };
  }, [trips]);

  const footprint: MapDay[] = useMemo(() => trips.flatMap((t) => t.days.map((d) => ({ id: d.id, places: d.places, active: true }))), [trips]);

  return (
    <div className="home">
      <header className="titlebar home-bar">
        <div className="tb-brand">
          <span className="logo-mark">途</span>
          <div className="tb-names">
            <div className="tb-name">途迹</div>
            <div className="tb-sub">AI 旅行计划</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <ThemeButton />
        <button className="me-btn" onClick={ui.openSettings} title={settings.nickname ? `${settings.nickname} · 设置` : '设置昵称和头像'}>
          <PersonAvatar name={settings.nickname || '我'} size={36} title="" />
        </button>
      </header>

      <div className="home-scroll">
        <section className="hero">
          <div className="hero-greet">
            {greeting()}{settings.nickname ? `，${settings.nickname}` : ''} 👋
          </div>
          <h1 className="hero-title">
            下一段旅程，交给 <span className="hl">AI</span> 来规划
          </h1>
          <p className="hero-sub">说出目的地、天数和喜好，Claude 会把每天的地点排进地图、连好路线。你可以继续拖拽调整、打卡记录，再把行程分享给同行的人。</p>
          <form
            className="ask-pill"
            onSubmit={(e) => {
              e.preventDefault();
              start(prompt);
            }}
          >
            <Icon name="sparkles" size={18} className="ask-ico" />
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：11 月去京都 4 天，喜欢寺庙和美食" />
            <button className="btn btn-primary" type="submit" disabled={!prompt.trim()}>
              开始规划
            </button>
          </form>
          <div className="examples">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" onClick={() => setPrompt(e)}>
                {e}
              </button>
            ))}
          </div>
          {!settings.apiKey && (
            <div className="hero-note">
              还没有 API Key？可以先打开下面的示例行程体验地图规划，或
              <button className="link-btn" onClick={ui.openSettings}>
                填入你的 Key
              </button>
              。
            </div>
          )}
        </section>

        <section className="home-section">
          <div className="sec-head">
            <div>
              <div className="sec-eyebrow">MY TRIPS</div>
              <h2 className="sec-title">我的行程</h2>
            </div>
            <button className="btn btn-sm" onClick={importTrip}>
              <Icon name="upload" size={14} /> 导入
            </button>
          </div>
          <div className="trip-grid">
            <button className="trip-card new-card" onClick={newBlank}>
              <div className="new-ico">
                <Icon name="plus" size={22} stroke={2} />
              </div>
              <div className="new-title">新建空白行程</div>
              <div className="muted">自己在地图上一点点安排</div>
            </button>
            {trips.map((t) => (
              <TripCard key={t.id} trip={t} nickname={settings.nickname} />
            ))}
          </div>
        </section>

        {total.places > 0 && (
          <section className="home-section">
            <div className="sec-head">
              <div>
                <div className="sec-eyebrow">FOOTPRINT</div>
                <h2 className="sec-title">足迹</h2>
              </div>
            </div>
            <div className="stat-row">
              <Stat label="行程" value={trips.length} />
              <Stat label="天数" value={total.days} />
              <Stat label="地点" value={total.places} />
              <Stat label="已打卡" value={total.visited} />
            </div>
            <div className="footprint card">
              <MapView days={footprint} dark={dark} fitKey={`fp${trips.length}`} dots />
            </div>
          </section>
        )}

        <footer className="home-foot">数据只保存在你的浏览器 · 无需注册 · 地图 © OpenStreetMap · CARTO</footer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat card">
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">{value}</div>
    </div>
  );
}

function TripCard({ trip, nickname }: { trip: Trip; nickname: string }) {
  const s = tripStats(trip);
  const people = tripPeople(nickname, trip.members);
  return (
    <button className="trip-card" onClick={() => navigate(`/trip/${trip.id}`)}>
      <RoutePreview trip={trip} />
      <div className="tc-body">
        <div className="tc-dest">{trip.destination || '目的地未定'}</div>
        <div className="tc-name">{trip.name}</div>
        <div className="tc-foot">
          <div className="tc-meta tabular">
            {fmtDateRange(trip)} · {trip.days.length} 天 · {s.places} 个地点
          </div>
          {people.length > 1 && <AvatarStack names={people} size={22} max={3} />}
        </div>
      </div>
    </button>
  );
}

/** 行程卡片封面：把所有地点投影成一张抽象路线图 */
function RoutePreview({ trip }: { trip: Trip }) {
  const pts = trip.days.flatMap((d) => d.places);
  const W = 320, H = 132, P = 18;
  if (!pts.length)
    return (
      <div className="tc-cover empty">
        <Icon name="map" size={28} stroke={1.4} />
      </div>
    );
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p.lng * k);
  const ys = pts.map((p) => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((W - 2 * P) / (maxX - minX || 1), (H - 2 * P) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const proj = (lat: number, lng: number) => [ox + (lng * k - minX) * scale, oy + (-lat - minY) * scale];
  return (
    <svg className="tc-cover" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {trip.days.map((d) => (
        <polyline
          key={d.id}
          points={d.places.map((p) => proj(p.lat, p.lng).join(',')).join(' ')}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.55"
        />
      ))}
      {pts.map((p) => {
        const [x, y] = proj(p.lat, p.lng);
        return <circle key={p.id} className={`cat-${p.category}`} cx={x} cy={y} r="4" fill="var(--c)" stroke="var(--panel)" strokeWidth="1.5" />;
      })}
    </svg>
  );
}
