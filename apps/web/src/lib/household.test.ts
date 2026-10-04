import { expect, it } from 'vitest';
import { heatStatus, eventCountdown } from './household';
import { constants } from './ops';
import { householdUrl } from '../components/JoinQr';

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
  expect(householdUrl('https://thermal-reserve.vercel.app', 'thermal-reserve', 'thermal-reserve')).toBe('https://thermal-reserve.vercel.app/home');
  expect(householdUrl('https://thermal-reserve.vercel.app', 'thermal-reserve-backup', 'thermal-reserve')).toBe('https://thermal-reserve.vercel.app/home?db=thermal-reserve-backup');
});
