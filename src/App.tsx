import { useEffect, useState } from 'react';
import { Home } from './components/Home';
import { Icon } from './components/Icon';
import { SettingsModal } from './components/Settings';
import { TripView } from './components/TripView';
import { toast } from './components/ui';
import { navigate, ui, useHashRoute, useIsDark } from './lib/hooks';
import { decodeTrip } from './lib/share';
import { tripStore, useTrip } from './lib/store';
import type { Trip } from './types';

export function App() {
  const route = useHashRoute();
  const dark = useIsDark();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => ui.onOpenSettings(() => setSettingsOpen(true)), []);

  let page;
  if (route[0] === 'trip' && route[1]) page = <TripPage id={route[1]} />;
  else if (route[0] === 'share' && route[1]) page = <SharePage data={route[1]} />;
  else page = <Home />;

  return (
    <>
      {page}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

function TripPage({ id }: { id: string }) {
  const trip = useTrip(id);
  if (!trip) return <Missing text="找不到这个行程，可能已经被删除了。" />;
  return <TripView key={trip.id} trip={trip} />;
}

function SharePage({ data }: { data: string }) {
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  useEffect(() => {
    decodeTrip(data).then(setTrip);
  }, [data]);
  if (trip === undefined)
    return (
      <div className="center-page">
        <span className="spinner" />
      </div>
    );
  if (!trip) return <Missing text="分享链接无法打开，可能复制得不完整。" />;
  return (
    <TripView
      trip={trip}
      readOnly
      onSaveShared={() => {
        const copy = { ...trip, createdAt: Date.now(), updatedAt: Date.now() };
        tripStore.add(copy);
        toast('已保存到我的行程', 'success');
        navigate(`/trip/${copy.id}`);
      }}
    />
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="center-page">
      <Icon name="map" size={34} stroke={1.4} className="muted" />
      <div className="muted" style={{ fontSize: 14 }}>
        {text}
      </div>
      <button className="btn btn-primary" onClick={() => navigate('/')}>
        回到首页
      </button>
    </div>
  );
}
