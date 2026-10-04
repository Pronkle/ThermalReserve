import { expect, it } from 'vitest';
import { heatStatus, eventCountdown, householdDayStart } from './household';
import { constants } from './ops';
import { householdUrl } from '../components/JoinQr';

it('keeps final community savings on the last simulation day', () => {
  expect(householdDayStart(0, 96)).toBe(0);
  expect(householdDayStart(24, 96)).toBe(24);
  expect(householdDayStart(95.5, 96)).toBe(72);
  expect(householdDayStart(96, 96)).toBe(72);
  expect(householdDayStart(0, 0)).toBe(0);
});

it('shows exemption and override before any cohort setback', () => {
  const home = { exempt: false, overridden: false, targetF: constants.setpointDayF - 5, taF: constants.setpointDayF - 4 };
  expect(heatStatus(home).name).toBe('Holding −5.0°F');
  expect(heatStatus({ ...home, exempt: true }).name).toBe('Exempt');
  expect(heatStatus({ ...home, overridden: true })).toMatchObject({ name: 'Overridden', targetF: constants.setpointDayF });
  expect(heatStatus({ ...home, targetF: constants.setpointDayF }).name).toBe('Recovering');
  expect(heatStatus({ ...home, targetF: constants.setpointDayF, taF: constants.setpointDayF }).name).toBe('Normal');
  expect(heatStatus({ ...home, targetF: constants.setpointDayF, taF: constants.setpointDayF - 0.2 }).name).toBe('Normal');
  expect(heatStatus({ ...home, targetF: constants.setpointDayF, taF: constants.setpointDayF - 0.3 }).name).toBe('Recovering');
});
it('uses simulation time for the start and end countdown', () => {
  expect(eventCountdown(11.5, 12, 84)).toBe('Starts in 0h 30m of simulation time');
  expect(eventCountdown(83.5, 12, 84)).toBe('Ends in 0h 30m of simulation time');
  expect(eventCountdown(84, 12, 84)).toBe('Event ended');
});
it('keeps a QR joiner on the operator’s failover database', () => {
  expect(householdUrl('https://boreaflux.vercel.app', 'thermal-reserve', 'thermal-reserve')).toBe('https://boreaflux.vercel.app/home');
  expect(householdUrl('https://boreaflux.vercel.app', 'thermal-reserve-backup', 'thermal-reserve')).toBe('https://boreaflux.vercel.app/home?db=thermal-reserve-backup');
});
