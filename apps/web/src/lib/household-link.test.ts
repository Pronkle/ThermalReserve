import { expect, it } from 'vitest';
import { householdLinkCode } from './household';

it('matches the companion link code for both normalized identity forms', async () => {
  expect(await householdLinkCode('c200abe32fb6aa00112233445566778899aabbccddeeff00112233445566778899')).toBe('LOWM3V');
  expect(await householdLinkCode('0xC200ABE32FB6AA00112233445566778899AABBCCDDEEFF00112233445566778899')).toBe('LOWM3V');
});
