import { lazy, Suspense } from 'react';
import type { FleetMapProps } from './FleetMap';
const FleetMap = lazy(() => import('./FleetMap'));
export function MapPreview(props: FleetMapProps) {
  const placeholder = <div className="map-loading">Loading Anchorage map…</div>;
  return typeof window === 'undefined' ? placeholder : <Suspense fallback={placeholder}><FleetMap {...props} /></Suspense>;
}
