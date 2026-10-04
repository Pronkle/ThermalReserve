import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { buildPreview } from './lib/preview';

describe('W0 route acceptance', () => {
  it.each([
    ['/ops', 'Operator console', 'theme-dark'],
    ['/ops?ui=gas', 'Operator console', 'theme-dark'],
    ['/home', 'Your home', 'theme-light'],
    ['/whatif', 'What-if calculator', 'theme-light'],
    ['/validation', 'Validation', 'theme-light'],
  ])('renders %s without a Spacetime connection', (path, heading, theme) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html).toContain(theme);
    expect(html).toContain('aria-current="page"');
  });

  it('gets nonempty chart data from the model package', () => {
    const preview = buildPreview();
    expect(preview.strategy).toBe('BASELINE');
    expect(preview.hours.length).toBeGreaterThan(0);
    expect(preview.hours.every(hour => Number.isFinite(hour.fleetGasMMcfh))).toBe(true);
  });
});
