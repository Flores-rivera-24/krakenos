import { describe, expect, it } from 'vitest';
import { buildSetupUrl } from '../../src/modules/setup/setup-url.js';

describe('setup URL (US-105)', () => {
  it('incrusta el token en el query y respeta el esquema/host/puerto', () => {
    expect(buildSetupUrl({ scheme: 'http', host: '192.168.1.50', port: 3001, token: 'abc123' })).toBe(
      'http://192.168.1.50:3001/setup?token=abc123',
    );
  });

  it('escapa caracteres especiales del token', () => {
    expect(buildSetupUrl({ scheme: 'https', host: 'krakenos.local', port: 443, token: 'a/b+c' })).toBe(
      'https://krakenos.local:443/setup?token=a%2Fb%2Bc',
    );
  });
});
