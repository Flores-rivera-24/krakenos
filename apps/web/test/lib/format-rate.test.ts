import { describe, expect, it } from 'vitest';
import { formatRate } from '@/lib/format';

describe('formatRate', () => {
  it('formatea Mbps', () => {
    expect(formatRate(1_250_000)).toBe('10.0 Mbps'); // 1.25 MB/s = 10 Mbps
  });

  it('formatea Kbps', () => {
    expect(formatRate(10_000)).toBe('80 Kbps');
  });

  it('formatea bps para tasas bajas', () => {
    expect(formatRate(50)).toBe('400 bps');
  });
});
