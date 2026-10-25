import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { boundsOf } from '../lib/geo';
import type { Place, RouteResult } from '../types';

const STYLE = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

export interface MapDay {
  id: string;
  places: Place[];
  route?: RouteResult;
  active: boolean;
}

export interface MapHandle {
  flyTo(lat: number, lng: number, zoom?: number): void;
  center(): { lat: number; lng: number };
}

interface Props {
  days: MapDay[];
  dark: boolean;
  fitKey: string;
  selectedPlaceId?: string | null;
  onSelectPlace?: (id: string) => void;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  pending?: { lat: number; lng: number } | null;
  pendingContent?: ReactNode;
  onPendingClose?: () => void;
  /** 足迹地图：只画小圆点，不编号 */
  dots?: boolean;
}

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const { days, dark, fitKey, selectedPlaceId, dots } = props;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(0);
  const cbs = useRef(props);
  cbs.current = props;
  const popupNode = useRef(document.createElement('div'));
  const popup = useRef<maplibregl.Popup | null>(null);
  const pendingMarker = useRef<maplibregl.Marker | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 15) {
      map.current?.flyTo({ center: [lng, lat], zoom: Math.max(map.current.getZoom(), zoom), duration: 700 });
    },
    center() {
      const c = map.current?.getCenter();
      return { lat: c?.lat ?? 0, lng: c?.lng ?? 0 };
    },
  }));

  // 初始化地图
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: dark ? STYLE.dark : STYLE.light,
      center: [110, 30],
      zoom: 2.2,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.on('style.load', () => {
      ensureLayers(m);
      setReady((n) => n + 1);
    });
    m.on('click', (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as HTMLElement).closest('.mk')) return;
      cbs.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换深浅色底图
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    map.current?.setStyle(dark ? STYLE.dark : STYLE.light);
  }, [dark]);

  // 路线
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource('routes') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features = days
      .filter((d) => d.route && d.route.coords.length > 1)
      .map((d) => ({
        type: 'Feature' as const,
        properties: { active: d.active, straight: d.route!.mode === 'straight' || d.route!.approximate },
        geometry: { type: 'LineString' as const, coordinates: d.route!.coords },
      }));
    src.setData({ type: 'FeatureCollection', features });
  }, [days, ready]);

  // 标记点
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    // 非当前天先画，当前天的标记压在上面
    const ordered = [...days].sort((a, b) => Number(a.active) - Number(b.active));
    for (const d of ordered) {
      d.places.forEach((p, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = ['mk', dots ? 'mk-dot' : '', d.active ? 'mk-active' : '', p.visited ? 'mk-visited' : '', p.id === selectedPlaceId ? 'mk-selected' : '']
          .filter(Boolean)
          .join(' ');
        if (!dots) el.textContent = p.visited ? '✓' : String(i + 1);
        el.title = p.name;
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          cbs.current.onSelectPlace?.(p.id);
        });
        markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
      });
    }
  }, [days, selectedPlaceId, dots]);

  // 视野
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const active = days.filter((d) => d.active).flatMap((d) => d.places);
    const pts = active.length ? active : days.flatMap((d) => d.places);
    const b = boundsOf(pts);
    if (!b) return;
    const pad = Math.min(80, Math.round(Math.min(box.current!.clientWidth, box.current!.clientHeight) / 6));
    if (pts.length === 1) m.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 13, duration: 600 });
    else m.fitBounds(b, { padding: pad, maxZoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // 临时点（搜索结果 / 点击地图）
  useEffect(() => {
    const m = map.current;
    pendingMarker.current?.remove();
    popup.current?.remove();
    pendingMarker.current = null;
    popup.current = null;
    if (!m || !props.pending) return;
    const { lat, lng } = props.pending;
    const el = document.createElement('div');
    el.className = 'mk-pending';
    pendingMarker.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
    popup.current = new maplibregl.Popup({ offset: 18, closeButton: false, maxWidth: '300px', className: 'tj-popup' })
      .setLngLat([lng, lat])
      .setDOMContent(popupNode.current)
      .addTo(m);
    popup.current.on('close', () => cbs.current.onPendingClose?.());
    m.easeTo({ center: [lng, lat], duration: 500 });
  }, [props.pending]);

  return (
    <div className="map-box" ref={box}>
      {props.pending && createPortal(props.pendingContent, popupNode.current)}
    </div>
  );
});

function ensureLayers(m: maplibregl.Map) {
  if (m.getSource('routes')) return;
  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue('--primary').trim() || '#0071e3';
  const dark = document.documentElement.dataset.theme === 'dark';
  m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addLayer({
    id: 'routes-inactive',
    type: 'line',
    source: 'routes',
    filter: ['==', ['get', 'active'], false],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': dark ? '#636366' : '#aeaeb2', 'line-width': 3, 'line-opacity': 0.6 },
  });
  m.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: 'routes',
    filter: ['all', ['==', ['get', 'active'], true], ['==', ['get', 'straight'], false]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': dark ? '#000' : '#fff', 'line-width': 8, 'line-opacity': 0.9 },
  });
  m.addLayer({
    id: 'routes-active',
    type: 'line',
    source: 'routes',
    filter: ['all', ['==', ['get', 'active'], true], ['==', ['get', 'straight'], false]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': primary, 'line-width': 4.5 },
  });
  m.addLayer({
    id: 'routes-active-dashed',
    type: 'line',
    source: 'routes',
    filter: ['all', ['==', ['get', 'active'], true], ['==', ['get', 'straight'], true]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': primary, 'line-width': 3, 'line-dasharray': [1.5, 2] },
  });
}
