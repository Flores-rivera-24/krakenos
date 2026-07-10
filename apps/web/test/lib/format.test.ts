import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, formatRelative, formatUptime, timeAgo } from '@/lib/format';
import { setLocale } from '@/lib/i18n';

describe('formatBytes', () => {
  it('usa GB a partir de 1 GiB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  it('usa MB por debajo de 1 GiB', () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});

describe('formatUptime', () => {
  it('compone días, horas y minutos', () => {
    expect(formatUptime(90061)).toBe('1d 1h 1m'); // 1d + 1h + 1m + 1s
  });

  it('omite las unidades en cero pero siempre muestra minutos', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(120)).toBe('2m');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('describe intervalos relativos en español', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5_000).toISOString())).toBe('hace un momento');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('hace 5m');
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe('hace 3h');
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString())).toBe('hace 2d');
  });

  it('localiza los intervalos relativos en inglés (US-177)', () => {
    setLocale('en', { persist: false });
    const now = Date.now();
    try {
      expect(timeAgo(new Date(now - 5_000).toISOString())).toBe('just now');
      expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
      expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago');
      expect(formatRelative(new Date(now - 86_400_000))).toBe('1 day ago');
      expect(formatRelative(new Date(now - 2 * 86_400_000))).toBe('2 days ago');
    } finally {
      setLocale('es', { persist: false });
    }
  });
});
