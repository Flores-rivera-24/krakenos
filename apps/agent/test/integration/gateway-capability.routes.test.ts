import type { FirewallRule, QosRule } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IptablesFirewallManager } from '../../src/firewall/iptables.firewall.js';
import { resolveGatewayCapability } from '../../src/privileged/gateway-capability.js';
import {
  PrivilegedCommandError,
  type CommandResult,
  type CommandRunner,
} from '../../src/privileged/runner.js';
import { TcQosManager } from '../../src/qos/tc.qos.js';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { InMemoryPeerStore } from '../../src/vpn/peer-store.js';
import { WireguardVpnManager } from '../../src/vpn/wireguard.vpn.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Capacidad de puerta de enlace en VPN, cortafuegos y QoS.
 *
 * Tres cosas que ningún test general caza:
 * 1. **Contrato**: `additionalProperties:false` PODA, así que la capacidad (o su `reason`)
 *    puede desaparecer de camino al navegador sin un error. Se compara lo **servido** con lo
 *    que produce el código, no con una lista escrita a mano.
 * 2. **Una escritura que el equipo no puede aplicar no llega al helper ni al almacén**
 *    (antes: la regla se guardaba y el helper fallaba después → regla «creada» nunca aplicada).
 * 3. **Un fallo del helper no es un 500 genérico**, y su `stderr` no sale al cliente.
 */

const STDERR_SECRETO = 'sudo: /etc/krakenos/clave-secreta: permiso denegado no-es-un-secreto';

/** Runner de pega: cuenta las llamadas y, si se le pide, falla como el helper real. */
function fakeRunner(fail: boolean): CommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv: string[]): Promise<CommandResult> {
      calls.push(argv);
      if (fail) {
        throw new PrivilegedCommandError(argv, { stdout: '', stderr: STDERR_SECRETO, code: 1 });
      }
      return { stdout: 'ok', stderr: '', code: 0 };
    },
  };
}

interface Montaje {
  app: FastifyInstance;
  runner: ReturnType<typeof fakeRunner>;
  fwStore: MemoryJsonStore<FirewallRule>;
  qosStore: MemoryJsonStore<QosRule>;
  peers: InMemoryPeerStore;
  headers: Record<string, string>;
}

async function montar(opts: {
  platform: NodeJS.Platform;
  helperExists: boolean;
  fallaElHelper?: boolean;
}): Promise<Montaje> {
  const runner = fakeRunner(opts.fallaElHelper ?? false);
  const fwStore = new MemoryJsonStore<FirewallRule>();
  const qosStore = new MemoryJsonStore<QosRule>();
  const peers = new InMemoryPeerStore();
  const app = await buildTestApp({
    routes: true,
    gateway: { platform: opts.platform, helperExists: opts.helperExists },
    firewall: new IptablesFirewallManager({ runner, store: fwStore, chain: 'KRAKENOS' }),
    qos: new TcQosManager({ runner, store: qosStore, interface: 'eth0', linkKbit: 100_000 }),
    vpn: new WireguardVpnManager({
      runner,
      store: peers,
      interface: 'wg0',
      endpoint: 'vpn.test',
      listenPort: 51820,
      subnet: '10.8.0.0/24',
      dns: '10.8.0.1',
      serverPublicKey: 'SERVERPUBKEY',
    }),
  });
  // Varias apps comparten `prisma/test.db`: cada montaje parte limpio.
  await resetDb(app);
  const admin = await seedUser(app);
  return { app, runner, fwStore, qosStore, peers, headers: authHeader(signAccess(app, admin)) };
}

/** El copy del agente, verbatim: la web lo trae igual en su catálogo (`errors.code.*`). */
const COPY = {
  GATEWAY_UNSUPPORTED:
    'Este equipo no puede hacer de puerta de enlace (VPN, cortafuegos o QoS). Usa los de tu router.',
  GATEWAY_REQUIRES_SETUP:
    'Falta instalar el helper de puerta de enlace en este equipo: sin él no se puede aplicar el cambio.',
} as const;

const ESCRITURAS = [
  {
    dominio: 'firewall',
    url: '/api/firewall/rules',
    payload: { name: 'Bloquear', action: 'deny' },
  },
  { dominio: 'qos', url: '/api/qos/rules', payload: { name: 'Juegos', target: '10.0.0.5' } },
  { dominio: 'vpn', url: '/api/vpn/peers', payload: { name: 'Móvil' } },
] as const;

const ESTADOS = [
  {
    nombre: 'supported',
    platform: 'linux',
    helperExists: true,
    esperado: { status: 'supported' },
  },
  {
    nombre: 'unsupported (Windows)',
    platform: 'win32',
    helperExists: false,
    esperado: { status: 'unsupported', reason: 'platform' },
  },
  {
    nombre: 'requires-setup (Linux sin helper)',
    platform: 'linux',
    helperExists: false,
    esperado: { status: 'requires-setup', reason: 'helper-missing' },
  },
] as const;

describe.each(ESTADOS)('contrato de la capacidad — $nombre', (estado) => {
  let m: Montaje;
  beforeAll(async () => {
    m = await montar({ platform: estado.platform, helperExists: estado.helperExists });
  });
  afterAll(async () => {
    await m.app.close();
  });

  it('el entorno de prueba produce el estado que se quiere probar', () => {
    // Si la función pura cambiara, esto lo dice antes de que los demás parezcan raros.
    expect(
      resolveGatewayCapability({
        kind: 'iptables',
        helperPath: '/x',
        platform: estado.platform,
        pathExists: () => estado.helperExists,
      }),
    ).toEqual(estado.esperado);
  });

  it.each(['/api/firewall/status', '/api/qos/status'])(
    '%s sirve exactamente { capability } con las claves de la capacidad, sin podar',
    async (url) => {
      const res = await m.app.inject({ method: 'GET', url, headers: m.headers });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['capability']);
      expect(body.capability).toEqual(estado.esperado);
      expect(Object.keys(body.capability as object).sort()).toEqual(
        Object.keys(estado.esperado).sort(),
      );
    },
  );

  it('/api/vpn/status sirve las claves del estado del gestor MÁS capability', async () => {
    const res = await m.app.inject({ method: 'GET', url: '/api/vpn/status', headers: m.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Derivado del código: lo que devuelve el gestor, sin lista a mano.
    const delGestor = Object.keys(
      await new WireguardVpnManager({
        runner: fakeRunner(false),
        store: new InMemoryPeerStore(),
        interface: 'wg0',
        endpoint: 'vpn.test',
        listenPort: 51820,
        subnet: '10.8.0.0/24',
        dns: '10.8.0.1',
        serverPublicKey: 'SERVERPUBKEY',
      }).getStatus(),
    );
    expect(Object.keys(body).sort()).toEqual([...delGestor, 'capability'].sort());
    expect(body.capability).toEqual(estado.esperado);
  });

  it.each(['/api/firewall/rules', '/api/qos/rules', '/api/vpn/peers'])(
    'la lectura %s sigue sirviendo en cualquier estado (la UI la necesita para el aviso)',
    async (url) => {
      const res = await m.app.inject({ method: 'GET', url, headers: m.headers });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    },
  );
});

describe('una escritura que este equipo no puede aplicar', () => {
  it.each([
    {
      nombre: 'Windows',
      platform: 'win32',
      helperExists: false,
      status: 501,
      code: 'GATEWAY_UNSUPPORTED',
    },
    {
      nombre: 'Windows aunque haya helper',
      platform: 'win32',
      helperExists: true,
      status: 501,
      code: 'GATEWAY_UNSUPPORTED',
    },
    {
      nombre: 'Linux sin helper',
      platform: 'linux',
      helperExists: false,
      status: 503,
      code: 'GATEWAY_REQUIRES_SETUP',
    },
  ] as const)(
    '$nombre: responde $status $code, no llama al runner y no toca el almacén',
    async (caso) => {
      const m = await montar({ platform: caso.platform, helperExists: caso.helperExists });
      try {
        for (const e of ESCRITURAS) {
          const res = await m.app.inject({
            method: 'POST',
            url: e.url,
            headers: m.headers,
            payload: e.payload,
          });
          expect(res.statusCode, e.dominio).toBe(caso.status);
          expect(res.json().code, e.dominio).toBe(caso.code);
          expect(res.json().message, e.dominio).toBe(COPY[caso.code]);
        }
        // PATCH y DELETE también (con un id cualquiera: el bloqueo va antes de buscarlo).
        for (const [method, url] of [
          ['PATCH', '/api/firewall/rules/x'],
          ['DELETE', '/api/firewall/rules/x'],
          ['PATCH', '/api/qos/rules/x'],
          ['DELETE', '/api/qos/rules/x'],
          ['DELETE', '/api/vpn/peers/x'],
        ] as const) {
          const res = await m.app.inject({
            method,
            url,
            headers: m.headers,
            payload: method === 'PATCH' ? { enabled: false } : undefined,
          });
          expect(res.statusCode, `${method} ${url}`).toBe(caso.status);
          expect(res.json().code, `${method} ${url}`).toBe(caso.code);
        }
        expect(m.runner.calls).toEqual([]);
        expect(await m.fwStore.list()).toEqual([]);
        expect(await m.qosStore.list()).toEqual([]);
        expect(await m.peers.list()).toEqual([]);
      } finally {
        await m.app.close();
      }
    },
  );

  it('un viewer sigue recibiendo 403 (la autorización va antes que la capacidad)', async () => {
    const m = await montar({ platform: 'win32', helperExists: false });
    try {
      const viewer = await seedUser(m.app, { email: 'v@krakenos.test', role: 'viewer' });
      const res = await m.app.inject({
        method: 'POST',
        url: '/api/firewall/rules',
        headers: authHeader(signAccess(m.app, viewer)),
        payload: { name: 'x', action: 'deny' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await m.app.close();
    }
  });

  it('con el equipo soportado, la escritura llega al runner y al almacén (control positivo)', async () => {
    const m = await montar({ platform: 'linux', helperExists: true });
    try {
      const res = await m.app.inject({
        method: 'POST',
        url: '/api/firewall/rules',
        headers: m.headers,
        payload: { name: 'Bloquear', action: 'deny' },
      });
      expect(res.statusCode).toBe(201);
      expect(m.runner.calls.length).toBeGreaterThan(0);
      expect(await m.fwStore.list()).toHaveLength(1);
    } finally {
      await m.app.close();
    }
  });
});

describe('un comando privilegiado que falla (PrivilegedCommandError)', () => {
  let m: Montaje;
  beforeAll(async () => {
    // Equipo soportado: el bloqueo de capacidad no interviene, falla el helper de verdad.
    m = await montar({ platform: 'linux', helperExists: true, fallaElHelper: true });
  });
  afterAll(async () => {
    await m.app.close();
  });

  it.each(ESCRITURAS)(
    '$dominio: 503 PRIVILEGED_COMMAND_FAILED, sin el stderr del helper en el cuerpo',
    async (e) => {
      const res = await m.app.inject({
        method: 'POST',
        url: e.url,
        headers: m.headers,
        payload: e.payload,
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.code).toBe('PRIVILEGED_COMMAND_FAILED');
      expect(body.message).toEqual(expect.any(String));
      // Ni el stderr, ni la ruta, ni el comando salen al cliente.
      expect(res.body).not.toContain('clave-secreta');
      expect(res.body).not.toContain('permiso denegado');
      expect(res.body).not.toContain('/etc/krakenos');
      expect(res.body).not.toContain('KRAKENOS');
    },
  );
});
