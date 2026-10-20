import type { IntegrationDomain } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { createCameraManager } from '../../src/cameras/index.js';
import { createDnsManager } from '../../src/dns/index.js';
import { createDriver } from '../../src/drivers/index.js';
import { createFirewallManager } from '../../src/firewall/index.js';
import { DomainNotConfiguredError } from '../../src/integrations/not-configured.js';
import { createIotManager } from '../../src/iot/index.js';
import { createQosManager } from '../../src/qos/index.js';
import { createVlanManager } from '../../src/vlan/index.js';
import { createVpnManager } from '../../src/vpn/index.js';

/**
 * Las implementaciones `none` (sin configurar) de los ocho dominios.
 *
 * Invariante: una instalación nueva **no enseña datos inventados**. Cada método de un manager
 * `none` es, por declaración, o una **lectura vacía** (con el valor exacto que se devuelve) o
 * una **escritura que lanza** `DomainNotConfiguredError` (→ 409 `DOMAIN_NOT_CONFIGURED`).
 * Un método nuevo sin clasificar hace fallar el test: es el punto en el que alguien tiene que
 * decidir qué significa «sin configurar» para él, en vez de heredar un default silencioso.
 */

type Fn = (...args: unknown[]) => unknown;

interface Spec {
  domain: IntegrationDomain;
  manager: object;
  /** método → valor que devuelve (comparado con `toEqual`). */
  reads: Record<string, unknown>;
  /** métodos que deben rechazar con `DomainNotConfiguredError`. */
  writes: string[];
}

const specs: Spec[] = [
  {
    domain: 'driver',
    manager: createDriver({ kind: 'none' }),
    reads: {
      healthcheck: false,
      scanArp: [],
      scanMdns: [],
      listAccessPoints: [],
      listWifiNetworks: [],
      getWifiNetwork: null,
      listNetworkClients: null,
    },
    writes: [
      'getTrafficSample',
      'blockDevice',
      'unblockDevice',
      'getWifi',
      'updateWifi',
      'getGuestNetwork',
      'updateGuestNetwork',
      'updateWifiNetwork',
    ],
  },
  {
    domain: 'vpn',
    manager: createVpnManager({ kind: 'none', endpoint: 'x', listenPort: 51820 }),
    reads: {
      getStatus: {
        enabled: false,
        publicKey: '',
        endpoint: null,
        listenPort: 51820,
        peerCount: 0,
      },
      listPeers: [],
    },
    writes: ['createPeer', 'removePeer'],
  },
  {
    domain: 'firewall',
    manager: createFirewallManager({ kind: 'none' }),
    reads: { listRules: [], getRule: null },
    writes: ['createRule', 'updateRule', 'removeRule'],
  },
  {
    domain: 'qos',
    manager: createQosManager({ kind: 'none' }),
    reads: { listRules: [], getRule: null },
    writes: ['createRule', 'updateRule', 'removeRule'],
  },
  {
    domain: 'vlan',
    manager: createVlanManager({ kind: 'none' }),
    reads: { listVlans: [], getVlan: null, getByTag: null },
    writes: ['createVlan', 'updateVlan', 'removeVlan'],
  },
  {
    domain: 'dns',
    manager: createDnsManager({ kind: 'none' }),
    reads: {
      getStats: { totalQueries: 0, blockedQueries: 0, blockedPercent: 0, blocklistSize: 0 },
      listBlocked: [],
      recentQueries: [],
      listFeeds: [],
    },
    writes: ['addBlocked', 'removeBlocked', 'setFeedEnabled'],
  },
  {
    domain: 'iot',
    manager: createIotManager({ kind: 'none' }).manager,
    reads: { listDevices: [], getDevice: null },
    writes: ['setState'],
  },
  {
    domain: 'cameras',
    manager: createCameraManager({ kind: 'none' }),
    reads: {
      listCameras: [],
      getSnapshot: null,
      startStream: null,
      stopStream: undefined,
      readStreamPlaylist: null,
      readStreamSegment: null,
      reapIdleStreams: 0,
      recordClip: null,
      getMotionFrame: null,
      stop: undefined,
    },
    writes: [],
  },
];

/** Métodos públicos de la clase concreta (sin el constructor). */
function methodsOf(manager: object): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(manager)).filter(
    (n) => n !== 'constructor' && typeof (manager as Record<string, unknown>)[n] === 'function',
  );
}

describe('managers «sin configurar» (kind none)', () => {
  it('cubre los ocho dominios (guard de tamaño)', () => {
    expect(specs.map((s) => s.domain).sort()).toEqual(
      ['cameras', 'dns', 'driver', 'firewall', 'iot', 'qos', 'vlan', 'vpn'].sort(),
    );
  });

  for (const spec of specs) {
    describe(spec.domain, () => {
      it('se declara sin configurar (kind y marca)', () => {
        const m = spec.manager as { kind?: string; notConfigured?: boolean };
        expect(m.kind).toBe('none');
        expect(m.notConfigured).toBe(true);
      });

      it('TODO método está clasificado como lectura vacía o escritura (sin huecos ni sobrantes)', () => {
        const clasificados = [...Object.keys(spec.reads), ...spec.writes].sort();
        expect(methodsOf(spec.manager).sort()).toEqual(clasificados);
      });

      for (const [method, esperado] of Object.entries(spec.reads)) {
        it(`${method}() devuelve la lectura vacía declarada`, async () => {
          const fn = (spec.manager as Record<string, Fn>)[method]!;
          await expect(Promise.resolve(fn.call(spec.manager, 'x', 'y'))).resolves.toEqual(esperado);
        });
      }

      for (const method of spec.writes) {
        it(`${method}() rechaza con 409 DOMAIN_NOT_CONFIGURED`, async () => {
          const fn = (spec.manager as Record<string, Fn>)[method]!;
          const err = await Promise.resolve(fn.call(spec.manager, 'x', {})).then(
            () => null,
            (e: unknown) => e,
          );
          expect(err).toBeInstanceOf(DomainNotConfiguredError);
          expect(err).toMatchObject({
            statusCode: 409,
            code: 'DOMAIN_NOT_CONFIGURED',
            domain: spec.domain,
          });
        });
      }
    });
  }
});

describe('createIotManager con none', () => {
  it('no envuelve en composite ni inventa backends (los ids no llevan prefijo de un backend que no existe)', () => {
    const bundle = createIotManager({ kind: 'none' });
    expect(bundle.kinds).toEqual([]);
    expect(bundle.manager.constructor.name).toBe('NoneIotManager');
  });

  it('un `none` mezclado con backends reales no es «sin configurar»: se trata como lista de backends', () => {
    // `none` solo vale como valor único; en una lista sería un backend desconocido.
    expect(() => createIotManager({ kind: 'none,hue' })).toThrow();
  });
});
