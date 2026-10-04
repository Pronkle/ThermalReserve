import { presets, type Preset } from '../lib/pressure-ui';
export function PresetBar({ busy, onPreset }: { busy: boolean; onPreset(preset: Preset): void }) {
  return <div className="preset-bar" aria-label="Demo presets">{presets.map(preset => <button disabled={busy} key={preset.id} title={preset.provisional ? 'Assumed preset; model verification pending' : 'Model-verified preset; assumed participation'} onClick={() => onPreset(preset)}>{preset.name}</button>)}</div>;
}
