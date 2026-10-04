import type { ReactNode } from 'react';
import type { Scenario } from '@thermal-reserve/model';
import { clockLabel } from '../lib/ops';

// One hover box for all three /ops charts (they share syncId, so the same hour is hovered in each). Same text size
// everywhere, and the side is chosen from the hovered hour, not from each chart's own overflow check, so the three
// boxes always sit on the same side of the cursor: right for the first half of the run, left after it.
export const TOOLTIP_OFFSET = 10;

export interface TooltipEntry { name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: unknown }

export function ChartTooltip({ active, label, payload, scenario, line }: {
  active?: boolean; label?: unknown; payload?: readonly TooltipEntry[]; scenario: Scenario;
  line: (entry: TooltipEntry) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const hour = Number(label);
  const left = hour > scenario.hours / 2;
  return <div style={{
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px',
    fontSize: 10, lineHeight: 1.3, whiteSpace: 'nowrap', pointerEvents: 'none',
    transform: left ? `translateX(calc(-100% - ${2 * TOOLTIP_OFFSET}px))` : undefined,
  }}>
    <strong style={{ display: 'block', marginBottom: 2 }}>{clockLabel(scenario, hour)}</strong>
    {payload.filter(entry => entry.value !== undefined && entry.value !== null).map(entry => <div key={String(entry.dataKey)} style={{ color: entry.color }}>{line(entry)}</div>)}
  </div>;
}

/** Tooltip props shared by the three charts: never flipped by recharts (the box flips itself), kept inside vertically. */
export const tooltipProps = { allowEscapeViewBox: { x: true, y: false }, offset: TOOLTIP_OFFSET, isAnimationActive: false } as const;
