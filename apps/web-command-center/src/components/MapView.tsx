import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { live } from '../live-store.js';
import { config } from '../config.js';
import { assetColor } from '../util.js';

const SEV_COLOR: Record<string, string> = { info: '#3aa0ff', minor: '#8aa0b8', major: '#ff8a3c', critical: '#ff5d57' };
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: config.mapStyle,
      center: config.center,
      zoom: config.zoom,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on('load', () => {
      for (const id of ['geofences', 'routes', 'features', 'trails', 'headings', 'assets', 'incidents', 'selection']) {
        map.addSource(id, { type: 'geojson', data: empty });
      }
      // Operation features (canonical geometry; styling applied here, not stored on the feature)
      map.addLayer({ id: 'features-fill', type: 'fill', source: 'features', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#b98cff', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'features-line', type: 'line', source: 'features', filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]], paint: { 'line-color': '#b98cff', 'line-width': 1.6, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'features-point', type: 'circle', source: 'features', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#b98cff', 'circle-stroke-color': '#0a0f16', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'features-label', type: 'symbol', source: 'features', filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['coalesce', ['get', 'label'], ['get', 'name']], 'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Open Sans Regular', 'Noto Sans Regular'] },
        paint: { 'text-color': '#b98cff', 'text-halo-color': '#0a0f16', 'text-halo-width': 1 } });
      map.addLayer({ id: 'geofences-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'geofences-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 1.4, 'line-dasharray': [2, 1.5], 'line-opacity': 0.7 } });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', paint: { 'line-color': '#7c9cff', 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [1, 1] } });
      map.addLayer({ id: 'trails-line', type: 'line', source: 'trails', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.4 } });
      map.addLayer({ id: 'headings-line', type: 'line', source: 'headings', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6 } });
      map.addLayer({ id: 'incidents-circle', type: 'circle', source: 'incidents', paint: {
        'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-opacity': 0.22,
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'selection-ring', type: 'circle', source: 'selection', paint: {
        'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#37c6cb', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'assets-circle', type: 'circle', source: 'assets', paint: {
        'circle-radius': ['case', ['get', 'sel'], 8, 6],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['match', ['get', 'link'], 'offline', '#ff5d57', 'delayed', '#e8a640', '#0a0f16'],
        'circle-stroke-width': 2 } });
      map.addLayer({ id: 'assets-label', type: 'symbol', source: 'assets',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Open Sans Regular', 'Noto Sans Regular'] },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0a0f16', 'text-halo-width': 1.2 } });

      const pick = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) live.select(String(f.properties?.id));
      };
      map.on('click', 'assets-circle', pick);
      map.on('click', 'incidents-circle', (e) => { const f = e.features?.[0]; if (f) live.select(null); void f; });
      for (const l of ['assets-circle', 'incidents-circle']) {
        map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
      }

      let raf = 0; let last = 0;
      const tick = (ts: number) => {
        if (ts - last > 120) { last = ts; redraw(map); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      map.once('remove', () => cancelAnimationFrame(raf));
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  return <div className="map-root" ref={ref} />;
}

function redraw(map: MLMap) {
  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
  const sel = live.selectedId;

  const assetFeats = [...live.assets.values()].filter((a) => a.position).map((a) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [a.position!.lon, a.position!.lat] },
    properties: { id: a.id, name: a.name, color: assetColor(a.type), link: a.link, sel: a.id === sel },
  }));
  src('assets')?.setData({ type: 'FeatureCollection', features: assetFeats });

  const headingFeats = [...live.assets.values()].filter((a) => a.position && a.heading != null).map((a) => {
    const rad = (a.heading! * Math.PI) / 180, len = 0.012;
    const lat2 = a.position!.lat + Math.cos(rad) * len;
    const lon2 = a.position!.lon + (Math.sin(rad) * len) / Math.cos((a.position!.lat * Math.PI) / 180);
    return { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[a.position!.lon, a.position!.lat], [lon2, lat2]] }, properties: { color: assetColor(a.type) } };
  });
  src('headings')?.setData({ type: 'FeatureCollection', features: headingFeats });

  const trailFeats = [...live.trails.entries()].filter(([, pts]) => pts.length > 1).map(([id, pts]) => {
    const a = live.assets.get(id);
    return { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: pts }, properties: { color: a ? assetColor(a.type) : '#6c8199' } };
  });
  src('trails')?.setData({ type: 'FeatureCollection', features: trailFeats });

  const incFeats = [...live.incidents.values()].filter((i) => i.location && i.status !== 'closed').map((i) => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [i.location!.lon, i.location!.lat] },
    properties: { id: i.id, color: SEV_COLOR[i.severity] ?? '#ff8a3c' },
  }));
  src('incidents')?.setData({ type: 'FeatureCollection', features: incFeats });

  const gfFeats = live.geofences.map((g) => ({
    type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: g.polygon }, properties: { color: g.color ?? '#37c6cb' },
  }));
  src('geofences')?.setData({ type: 'FeatureCollection', features: gfFeats });

  const rtFeats = live.routes.map((r) => ({
    type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: r.waypoints }, properties: {},
  }));
  src('routes')?.setData({ type: 'FeatureCollection', features: rtFeats });

  const featFeats = [...live.features.values()].map((f) => ({
    type: 'Feature' as const,
    geometry: { type: f.geometryType, coordinates: f.coordinates } as GeoJSON.Geometry,
    properties: { id: f.id, name: (f.properties?.name as string) ?? '', label: (f.properties?.label as string) ?? '' },
  }));
  src('features')?.setData({ type: 'FeatureCollection', features: featFeats });

  const selAsset = sel ? live.assets.get(sel) : undefined;
  src('selection')?.setData(selAsset?.position
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [selAsset.position.lon, selAsset.position.lat] }, properties: {} }] }
    : empty);
}
