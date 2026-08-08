/**
 * String fractional-index keys that are lexicographically ordered.
 * Format: 7-digit integer part + '.' + 6-digit fractional part → "0001000.000000"
 * This guarantees lex order matches numeric order for values in [0, 9999999.999999].
 * Precision degrades after ~40 consecutive inserts at the same spot; rebalance then.
 */

const MIN_GAP = 1e-5;

export function formatSortKey(n: number): string {
  if (n < 0 || n >= 10_000_000) throw new Error('Sort key out of range');
  const fixed = n.toFixed(6);
  const dot = fixed.indexOf('.');
  const intPart = fixed.slice(0, dot).padStart(7, '0');
  const fracPart = fixed.slice(dot + 1);
  return `${intPart}.${fracPart}`;
}

export const INITIAL_SORT_KEY = formatSortKey(1000);

/**
 * Returns a key strictly between `after` and `before`.
 * Pass null for either end to mean "no bound" (prepend / append).
 */
export function generateKeyBetween(
  after: string | null,
  before: string | null,
): string {
  const a = after !== null ? parseFloat(after) : 0;
  const b = before !== null ? parseFloat(before) : a + 2000;

  if (a >= b) {
    throw new Error(`Cannot generate key: "${after}" is not less than "${before}"`);
  }

  const mid = (a + b) / 2;

  if (b - a < MIN_GAP) {
    throw new Error('Sort keys too close — run rebalanceSortKeys for this day');
  }

  return formatSortKey(mid);
}

/**
 * Generates evenly-spaced keys for a fresh sequence of `count` items.
 * Use when inserting many events at once or when rebalancing a crowded day.
 */
export function buildInitialKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => formatSortKey((i + 1) * 1000));
}
