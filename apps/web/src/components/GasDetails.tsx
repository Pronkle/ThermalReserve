import type { ReactNode } from 'react';

export function GasDetails({ chart, metrics }: { chart: ReactNode; metrics: ReactNode }) {
  return <details className="gas-details panel">
    <summary>Gas details (MMcf)</summary>
    {metrics}
    {chart}
  </details>;
}
