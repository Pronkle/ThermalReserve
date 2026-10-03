import { describe, expect, it } from 'vitest';
import { databaseName } from './stdb';

describe('database failover', () => {
  function storage() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  }
  it('retains a URL-selected backup across navigation and allows clearing it', () => {
    const tab = storage();
    expect(databaseName('?db=thermal-reserve-backup', 'thermal-reserve', tab)).toBe('thermal-reserve-backup');
    expect(databaseName('', 'thermal-reserve', tab)).toBe('thermal-reserve-backup');
    expect(databaseName('?db=', 'thermal-reserve', tab)).toBe('thermal-reserve');
    expect(databaseName('', 'thermal-reserve', tab)).toBe('thermal-reserve');
  });
  it('honors the URL even if browser storage is unavailable', () => {
    const unavailable = { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('unavailable'); }, removeItem: () => {} };
    expect(databaseName('?db=thermal-reserve-backup', 'thermal-reserve', unavailable)).toBe('thermal-reserve-backup');
    expect(databaseName('', 'thermal-reserve', unavailable)).toBe('thermal-reserve');
  });
});
