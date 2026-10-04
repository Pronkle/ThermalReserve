import { GasOps } from './GasOps';
import { useSearchParams } from 'react-router-dom';
import { pressureReady } from '../lib/pressure-ui';
import { PressureOps } from './PressureOps';

// The gas console remains the fallback while the pressure shell is built.
export function Ops() {
  const [params] = useSearchParams();
  return params.get('ui') === 'gas' || !pressureReady() ? <GasOps /> : <PressureOps />;
}
