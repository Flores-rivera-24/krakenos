import { describe, expect, it } from 'vitest';
import { domainStateOf } from '../../src/integrations/domain-state.js';

describe('domainStateOf', () => {
  it.each([
    ['none', 'not-configured'],
    [' none ', 'not-configured'],
    ['mock', 'demo'],
    ['openwrt', 'configured'],
    ['pihole', 'configured'],
    ['hue', 'configured'],
    // IoT admite varios backends: basta uno de demostración para que parte de lo visible sea inventado.
    ['hue,govee', 'configured'],
    ['mock,hue', 'demo'],
    ['hue, mock', 'demo'],
  ])('%s → %s', (kind, esperado) => {
    expect(domainStateOf(kind)).toBe(esperado);
  });

  it('`none` dentro de una lista no es «sin configurar» (solo vale como valor único)', () => {
    expect(domainStateOf('none,hue')).toBe('configured');
  });
});
