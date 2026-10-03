import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { anchorageSanity, buildCohorts, loadConstants, validateConEdLike, validateSoCalLike, whatIf, type CohortSpec, type ConstantsJson } from '@thermal-reserve/model';
import raw from '../../../../data/constants.json';
import spec from '../../../../data/cohort_spec.json';
import { WhatIf } from './WhatIf';
import { Validation } from './Validation';

const constants = loadConstants(raw as ConstantsJson);
const render = (el: React.ReactElement, path: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);
const two = (x: number) => x.toFixed(2);

describe('W5 /whatif', () => {
  it('default inputs show the model result (W5 acceptance: 1.40 ± 0.05 MMcf/day) and every formula line', () => {
    const html = render(<WhatIf />, '/whatif');
    const r = whatIf({ participationPct: 16.7, setbackF: 5, outdoorF: -20, days: 3, tier2Pct: 0 }, constants);
    expect(Math.abs(r.mmcfPerDay - 1.4)).toBeLessThanOrEqual(0.05);
    expect(html).toContain(`${two(r.mmcfPerDay)}<span>MMcf/day</span>`);
    for (const line of r.formulaLines) expect(html).toContain(line.replace(/&/g, '&amp;'));
    expect(html).toContain('Show the math');
  });

  it('reads inputs from the shareable URL and clamps out-of-range values', () => {
    const html = render(<WhatIf />, '/whatif?p=6.7&setback=5&days=99');
    const r = whatIf({ participationPct: 6.7, setbackF: 5, outdoorF: -20, days: 10, tier2Pct: 0 }, constants);
    expect(html).toContain(`${two(r.mmcfPerDay)}<span>MMcf/day</span>`);
    expect(html).toContain('over 10 days');
  });
});

describe('W6 /validation', () => {
  const cohorts = buildCohorts(spec as CohortSpec, constants.uaMeanBtuHPerF);
  const html = render(<Validation />, '/validation');

  it('shows ConEd retention and pass status from validateConEdLike', () => {
    const v = validateConEdLike(cohorts, constants);
    expect(html).toContain(`<strong>${v.retention.toFixed(3)}</strong>`);
    expect(html).toContain(v.pass ? '✓ Pass' : '△ Gap');
  });

  it('shows the SoCal daily result and states the gap when it is outside the band', () => {
    const v = validateSoCalLike(cohorts, constants);
    expect(html).toContain(`<strong>${v.dailyPct.toFixed(2)}%</strong>`);
    if (!v.pass) {
      expect(html).toContain('△ Gap');
      expect(html).toContain('Gap, stated plainly.');
    }
  });

  it('shows the Anchorage figure and the tuned parameters from cohort_spec', () => {
    expect(html).toContain(`<strong>${two(anchorageSanity(cohorts, constants).mcfPerHomeDay)}</strong>`);
    const s = spec as CohortSpec;
    expect(html).toContain(`${s.heating[0].caBtuPerF.toLocaleString('en-US')} BTU/°F`);
    expect(html).toContain(`${s.mass[1].tauMassH} h`);
  });
});
