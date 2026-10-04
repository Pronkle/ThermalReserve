import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { RunResult, SampleHome } from '@thermal-reserve/model';
import { useCohortStates, useHouseholds, useSimConfig } from '../lib/stdb';
import { heatStatus } from '../lib/household';
import { anchors, homeMode } from '../lib/ops';
import 'leaflet/dist/leaflet.css';

const colors = { normal: '#7A869A', holding: '#5BC0EB', recovering: '#F2A541', overridden: '#9AA8BF', exempt: '#9AA8BF' };
export interface FleetMapProps { homes: SampleHome[]; run: RunResult; hour: number; }
type Mode = keyof typeof colors;
type MapProps = FleetMapProps & { modes: Map<number, Mode>; households: ReturnType<typeof useHouseholds> };
function Dots({ homes, run, hour, modes, households }: MapProps) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    const householdRenderer = L.svg({ padding: 0.5 });
    for (const home of homes) {
      const mode = modes.get(home.id) ?? homeMode(home, run, hour);
      L.circleMarker([home.lat, home.lon], { renderer, radius: 3, color: colors[mode], weight: mode === 'overridden' ? 2 : 1, fillOpacity: mode === 'exempt' || mode === 'overridden' ? 0 : 0.8 })
        .bindTooltip(`Sample home ${home.id} · ${mode}`).addTo(group);
    }
    for (const home of households) {
      const mode = heatStatus(home).mode as Mode;
      const marker = L.circleMarker([home.lat, home.lon], { renderer: householdRenderer, className: home.online ? 'household-map-dot' : '', radius: 8, color: '#E6EDF7', weight: 2, fillColor: colors[mode], fillOpacity: mode === 'exempt' || mode === 'overridden' ? 0 : 0.9 }).addTo(group);
      const tooltip = document.createElement('span'); tooltip.textContent = `${home.nickname} · ${mode}`;
      marker.bindTooltip(tooltip);
    }
    return () => { group.remove(); renderer.remove(); householdRenderer.remove(); };
  }, [map, homes, run, hour, modes, households]);
  return null;
}
export default function FleetMap(props: FleetMapProps) {
  const states = useCohortStates();
  const config = useSimConfig();
  const households = useHouseholds();
  const modes = new Map<number, Mode>();
  if (config?.status === 'running') for (const home of props.homes) {
    const cohortMode = states.find(state => state.cohortId === home.cohortId)?.mode;
    modes.set(home.id, home.exempt ? 'exempt' : config.strategy !== 'BASELINE' && home.overrideHour !== null && home.overrideHour <= props.hour ? 'overridden' : cohortMode === 'holding' || cohortMode === 'recovering' ? cohortMode : 'normal');
  }
  const [tilesReady, setTilesReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (tilesReady) return;
    const timeout = window.setTimeout(() => setFallback(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [tilesReady]);
  if (fallback) return <div className="map-fallback"><span>Map tiles unavailable · anchor overview</span><svg viewBox="0 0 800 250" role="img" aria-label="Sample homes near Southcentral Alaska placement anchors">
    <polyline points={anchors.map(a => `${(a.lon + 151.4) * 330},${230 - (a.lat - 60.4) * 170}`).join(' ')} fill="none" stroke="#2B3A52" />
    {props.homes.map(home => { const mode = modes.get(home.id) ?? homeMode(home, props.run, props.hour); return <circle key={home.id} cx={(home.lon + 151.4) * 330} cy={230 - (home.lat - 60.4) * 170} r={2} stroke={colors[mode]} fill={mode === 'exempt' || mode === 'overridden' ? 'none' : colors[mode]}><title>Sample home {home.id} · {mode}</title></circle>; })}
    {households.map(home => <circle key={home.identity.toHexString()} cx={(home.lon + 151.4) * 330} cy={230 - (home.lat - 60.4) * 170} className={home.online ? 'household-map-dot' : ''} r={6} stroke="#E6EDF7" strokeWidth={2} fill={home.exempt || home.overridden ? 'none' : colors[heatStatus(home).mode as Mode]}><title>{home.nickname}</title></circle>)}
    {anchors.filter((_, i) => [0, 8, 9, 10, 11].includes(i)).map(a => <text key={a.name} x={(a.lon + 151.4) * 330} y={218 - (a.lat - 60.4) * 170} fill="#E6EDF7" fontSize="11">{a.name.split(' / ')[0]}</text>)}
  </svg></div>;
  return <MapContainer center={[61.2, -149.9]} zoom={10} preferCanvas className="fleet-map" scrollWheelZoom={false} aria-label="Anchorage sample homes">
    <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={{ tileload: () => setTilesReady(true) }} />
    <Dots {...props} modes={modes} households={households} />
  </MapContainer>;
}
