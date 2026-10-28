import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { boundsOf } from '../lib/geo';
import { CATEGORY_ICON } from '../lib/util';
import type { Category, Place, RouteResult } from '../types';
import { iconSvg } from './Icon';

const STYLE = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

/** 汉字用系统字体在本地绘制，字形是简体中文的，也省去下载字库 */
const CJK_FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

/** 地图上能显示的边距（被浮动面板挡住的部分），单位像素 */
export interface MapInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

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
  /** 隐藏这些类型的标记 */
  hiddenCats?: Category[];
  inset?: MapInset;
}

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const { days, dark, fitKey, selectedPlaceId, dots, hiddenCats } = props;
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
      map.current?.flyTo({ center: [lng, lat], zoom: Math.max(map.current.getZoom(), zoom), offset: insetOffset(cbs.current.inset), duration: 700 });
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
      localIdeographFontFamily: CJK_FONT,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), dots ? 'bottom-right' : 'top-right');
    m.on('style.load', () => {
      localizeLabels(m);
      ensureLayers(m);
      setReady((n) => n + 1);
    });
    m.on('click', (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as HTMLElement).closest('.mk')) return;
      cbs.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    // 放大到街区级别后显示地点名称
    const syncLabels = () => box.current?.classList.toggle('mk-labels', m.getZoom() >= 12.5);
    m.on('zoom', syncLabels);
    syncLabels();
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
        if (hiddenCats?.includes(p.category)) return;
        const selected = p.id === selectedPlaceId;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = ['mk', `cat-${p.category}`, dots ? 'mk-dot' : '', d.active ? 'mk-active' : '', p.visited ? 'mk-visited' : '', selected ? 'mk-selected' : '']
          .filter(Boolean)
          .join(' ');
        if (!dots) {
          const ico = document.createElement('span');
          ico.className = 'mk-ico';
          ico.innerHTML = iconSvg(CATEGORY_ICON[p.category], d.active ? 15 : 12, 2.2);
          el.append(ico);
          if (d.active || p.visited) {
            const badge = document.createElement('span');
            badge.className = 'mk-badge';
            if (p.visited) badge.innerHTML = iconSvg('check', 9, 3.4);
            else badge.textContent = String(i + 1);
            el.append(badge);
          }
          if (d.active || selected) {
            const label = document.createElement('span');
            label.className = 'mk-label';
            label.textContent = p.name;
            el.append(label);
          }
        }
        el.title = p.name;
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          cbs.current.onSelectPlace?.(p.id);
        });
        markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
      });
    }
  }, [days, selectedPlaceId, dots, hiddenCats]);

  // 视野
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const active = days.filter((d) => d.active).flatMap((d) => d.places);
    const pts = active.length ? active : days.flatMap((d) => d.places);
    const b = boundsOf(pts);
    if (!b) return;
    const ins = cbs.current.inset ?? {};
    const w = box.current!.clientWidth - (ins.left ?? 0) - (ins.right ?? 0);
    const h = box.current!.clientHeight - (ins.top ?? 0) - (ins.bottom ?? 0);
    const pad = Math.max(24, Math.min(80, Math.round(Math.min(w, h) / 6)));
    if (pts.length === 1) m.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 13, offset: insetOffset(ins), duration: 600 });
    else
      m.fitBounds(b, {
        padding: { top: pad + (ins.top ?? 0), right: pad + (ins.right ?? 0), bottom: pad + (ins.bottom ?? 0), left: pad + (ins.left ?? 0) },
        maxZoom: 15,
        duration: 600,
      });
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
    m.easeTo({ center: [lng, lat], offset: insetOffset(cbs.current.inset), duration: 500 });
  }, [props.pending]);

  return (
    <div className="map-box" ref={box}>
      {props.pending && createPortal(props.pendingContent, popupNode.current)}
    </div>
  );
});

/** 让目标点落在没被面板挡住的区域中央 */
function insetOffset(ins: MapInset = {}): [number, number] {
  return [((ins.left ?? 0) - (ins.right ?? 0)) / 2, ((ins.top ?? 0) - (ins.bottom ?? 0)) / 2];
}

/** name 以汉字或假名开头（U+2E80 到 U+9FFF，不含韩文） */
const NAME = ['to-string', ['get', 'name']];
const IS_CJK_NAME = ['all', ['has', 'name'], ['>=', NAME, String.fromCharCode(0x2e80)], ['<', NAME, String.fromCharCode(0xa000)]];

/** 底图标签优先用简体中文名，没有中文名时退回原样式的写法（英文名 / 当地名） */
function localizeLabels(m: maplibregl.Map) {
  for (const layer of m.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    const field = m.getLayoutProperty(layer.id, 'text-field');
    if (!Array.isArray(field) || JSON.stringify(field).includes('housenumber')) continue;
    // 没有中文名时，当地名称本身是汉字 / 假名（中国、日本等）就直接用，否则才用原样式的英文名
    const zh = (f: unknown) => ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name:zh-Hant'], ['case', IS_CJK_NAME, ['get', 'name'], f]];
    // 按缩放级别切换的写法里 zoom 必须在最外层，所以只包每一档的输出
    const next = field[0] === 'step' ? field.map((x, i) => (i >= 2 && i % 2 === 0 ? zh(x) : x)) : zh(field);
    m.setLayoutProperty(layer.id, 'text-field', next);
  }
}

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
