import type { ReactNode } from 'react';

export function GasDetails({ chart, metrics, open = false }: { chart: ReactNode; metrics: ReactNode; open?: boolean }) {
  return <details className="gas-details panel" open={open}>
    <summary>Gas details (MMcf)</summary>
    {metrics}
    {chart}
  </details>;
}
