import { describe, it, expect } from 'vitest';
import { generateKeyBetween, formatSortKey, INITIAL_SORT_KEY, buildInitialKeys } from '../utils/fractional-index';

describe('formatSortKey', () => {
  it('zero-pads the integer part to 7 digits', () => {
    expect(formatSortKey(1)).toBe('0000001.000000');
  });

  it('formats 1000 correctly', () => {
    expect(formatSortKey(1000)).toBe('0001000.000000');
  });

  it('formats a fractional value', () => {
    expect(formatSortKey(1000.5)).toBe('0001000.500000');
  });

  it('throws for negative values', () => {
    expect(() => formatSortKey(-1)).toThrow();
  });

  it('throws for values >= 10,000,000', () => {
    expect(() => formatSortKey(10_000_000)).toThrow();
  });
});

describe('INITIAL_SORT_KEY', () => {
  it('equals "0001000.000000"', () => {
    expect(INITIAL_SORT_KEY).toBe('0001000.000000');
  });
});

describe('generateKeyBetween', () => {
  it('generates initial key when both args are null', () => {
    const key = generateKeyBetween(null, null);
    expect(key).toBe('0001000.000000');
  });

  it('generates a key after a given key', () => {
    const key = generateKeyBetween('0001000.000000', null);
    expect(key > '0001000.000000').toBe(true);
  });

  it('generates a key before a given key', () => {
    const key = generateKeyBetween(null, '0001000.000000');
    expect(key < '0001000.000000').toBe(true);
  });

  it('generates a key strictly between two keys', () => {
    const a = '0001000.000000';
    const b = '0002000.000000';
    const mid = generateKeyBetween(a, b);
    expect(mid > a).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('maintains lexicographic order across multiple insertions', () => {
    let lo = '0001000.000000';
    let hi = '0002000.000000';
    const keys: string[] = [lo, hi];

    for (let i = 0; i < 10; i++) {
      const mid = generateKeyBetween(lo, hi);
      keys.push(mid);
      lo = mid;
    }

    const sorted = [...keys].sort();
    expect(sorted[0]).toBe('0001000.000000');
    // All inserted keys should be strictly between lo (0001000) and hi (0002000)
    for (const k of keys.slice(2)) {
      expect(k > '0001000.000000').toBe(true);
      expect(k < '0002000.000000').toBe(true);
    }
  });

  it('throws when after >= before', () => {
    expect(() => generateKeyBetween('0002000.000000', '0001000.000000')).toThrow();
  });
});

describe('buildInitialKeys', () => {
  it('returns evenly spaced keys', () => {
    const keys = buildInitialKeys(3);
    expect(keys).toHaveLength(3);
    expect(keys[0]! < keys[1]!).toBe(true);
    expect(keys[1]! < keys[2]!).toBe(true);
  });

  it('first key equals formatSortKey(1000)', () => {
    const keys = buildInitialKeys(1);
    expect(keys[0]).toBe('0001000.000000');
  });
});
