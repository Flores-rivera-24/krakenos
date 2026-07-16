import { describe, expect, it } from 'vitest';
import { buildIssueUrl } from '@/lib/feedback';

describe('buildIssueUrl (US-218)', () => {
  it('construye la URL del issue con plantilla, versión y modo pre-rellenados', () => {
    const url = buildIssueUrl('bug', { version: '0.1.0', deployMode: 'systemd' });
    expect(url).toBe(
      'https://github.com/Flores-rivera-24/krakenos/issues/new?template=bug.yml&version=0.1.0&deploy=systemd',
    );
  });

  it('omite los campos ausentes sin dejar parámetros vacíos', () => {
    expect(buildIssueUrl('feature')).toBe(
      'https://github.com/Flores-rivera-24/krakenos/issues/new?template=feature.yml',
    );
    expect(buildIssueUrl('hardware-report', { version: null, deployMode: null })).not.toContain(
      'version=',
    );
  });

  it('escapa los valores (una versión rara no rompe la URL)', () => {
    const url = buildIssueUrl('bug', { version: '0.1.0 beta&x' });
    expect(url).toContain('version=0.1.0+beta%26x');
  });
});
