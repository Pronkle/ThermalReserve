import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { RunResult, SampleHome } from '@thermal-reserve/model';
import { anchors, homeMode } from '../lib/ops';
import 'leaflet/dist/leaflet.css';

const colors = { normal: '#7A869A', holding: '#5BC0EB', recovering: '#F2A541', overridden: '#9AA8BF', exempt: '#9AA8BF' };
export interface FleetMapProps { homes: SampleHome[]; run: RunResult; hour: number; }
function Dots({ homes, run, hour }: FleetMapProps) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    for (const home of homes) {
      const mode = homeMode(home, run, hour);
      L.circleMarker([home.lat, home.lon], { renderer, radius: 3, color: colors[mode], weight: mode === 'overridden' ? 2 : 1, fillOpacity: mode === 'exempt' || mode === 'overridden' ? 0 : 0.8 })
        .bindTooltip(`Sample home ${home.id} · ${mode}`).addTo(group);
    }
    return () => { group.remove(); renderer.remove(); };
  }, [map, homes, run, hour]);
  return null;
}
export default function FleetMap(props: FleetMapProps) {
  const [tilesReady, setTilesReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (tilesReady) return;
    const timeout = window.setTimeout(() => setFallback(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [tilesReady]);
  if (fallback) return <div className="map-fallback"><span>Map tiles unavailable · anchor overview</span><svg viewBox="0 0 800 250" role="img" aria-label="Sample homes near Southcentral Alaska placement anchors">
    <polyline points={anchors.map(a => `${(a.lon + 151.4) * 330},${230 - (a.lat - 60.4) * 170}`).join(' ')} fill="none" stroke="#2B3A52" />
    {props.homes.map(home => { const mode = homeMode(home, props.run, props.hour); return <circle key={home.id} cx={(home.lon + 151.4) * 330} cy={230 - (home.lat - 60.4) * 170} r={2} stroke={colors[mode]} fill={mode === 'exempt' || mode === 'overridden' ? 'none' : colors[mode]}><title>Sample home {home.id} · {mode}</title></circle>; })}
    {anchors.filter((_, i) => [0, 8, 9, 10, 11].includes(i)).map(a => <text key={a.name} x={(a.lon + 151.4) * 330} y={218 - (a.lat - 60.4) * 170} fill="#E6EDF7" fontSize="11">{a.name.split(' / ')[0]}</text>)}
  </svg></div>;
  return <MapContainer center={[61.2, -149.9]} zoom={10} preferCanvas className="fleet-map" scrollWheelZoom={false} aria-label="Anchorage sample homes">
    <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={{ tileload: () => setTilesReady(true) }} />
    <Dots {...props} />
  </MapContainer>;
}
