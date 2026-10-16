import { describe, expect, it } from 'vitest';
import { resolveGatewayCapability } from '../../src/privileged/gateway-capability.js';

/**
 * Tabla plataforma × kind × helper de `resolveGatewayCapability`. La función es pura: la
 * plataforma y la comprobación del fichero se inyectan, así que la tabla corre igual en Linux
 * que en la CI de Windows.
 */
const HELPER = '/usr/local/bin/krakenos-helper';
const hay = () => true;
const noHay = () => false;

describe('resolveGatewayCapability', () => {
  it.each(['mock', 'wireguard', 'iptables', 'tc'])(
    'win32 + %s → unsupported/platform, esté o no el helper',
    (kind) => {
      const unsupported = { status: 'unsupported', reason: 'platform' };
      expect(
        resolveGatewayCapability({ kind, helperPath: HELPER, platform: 'win32', pathExists: hay }),
      ).toEqual(unsupported);
      expect(
        resolveGatewayCapability({
          kind,
          helperPath: HELPER,
          platform: 'win32',
          pathExists: noHay,
        }),
      ).toEqual(unsupported);
    },
  );

  it.each(['wireguard', 'iptables', 'tc'])(
    'linux + %s sin helper → requires-setup/helper-missing',
    (kind) => {
      expect(
        resolveGatewayCapability({
          kind,
          helperPath: HELPER,
          platform: 'linux',
          pathExists: noHay,
        }),
      ).toEqual({ status: 'requires-setup', reason: 'helper-missing' });
    },
  );

  it.each(['wireguard', 'iptables', 'tc'])('linux + %s con helper → supported', (kind) => {
    expect(
      resolveGatewayCapability({ kind, helperPath: HELPER, platform: 'linux', pathExists: hay }),
    ).toEqual({ status: 'supported' });
  });

  it('linux + mock → supported aunque no haya helper (el mock no lo usa)', () => {
    expect(
      resolveGatewayCapability({
        kind: 'mock',
        helperPath: HELPER,
        platform: 'linux',
        pathExists: noHay,
      }),
    ).toEqual({ status: 'supported' });
  });

  it('comprueba la ruta que se le pasa, no una fija', () => {
    const vistas: string[] = [];
    resolveGatewayCapability({
      kind: 'tc',
      helperPath: '/opt/otro/helper',
      platform: 'linux',
      pathExists: (p) => {
        vistas.push(p);
        return true;
      },
    });
    expect(vistas).toEqual(['/opt/otro/helper']);
  });

  it('sin inyección usa la plataforma y el disco reales (el helper de /nonexistent no existe)', () => {
    const cap = resolveGatewayCapability({ kind: 'wireguard', helperPath: '/nonexistent/helper' });
    expect(cap.status).toBe(process.platform === 'win32' ? 'unsupported' : 'requires-setup');
  });
});
