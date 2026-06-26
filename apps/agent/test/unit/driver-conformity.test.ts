import type { HardwareDriver, IotManager } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { AsusDriver } from '../../src/drivers/asus.driver.js';
import { MikrotikDriver } from '../../src/drivers/mikrotik.driver.js';
import { OmadaDriver } from '../../src/drivers/omada.driver.js';
import { UnifiDriver } from '../../src/drivers/unifi.driver.js';
import { KasaIotManager } from '../../src/iot/kasa.iot.js';
import { MerossIotManager } from '../../src/iot/meross.iot.js';
import { ShellyIotManager } from '../../src/iot/shelly.iot.js';
import { SwitchBotIotManager } from '../../src/iot/switchbot.iot.js';

/**
 * Suite de conformidad de drivers (US-100). Cada driver real (UniFi/MikroTik/
 * Omada/ASUS) e integración IoT (Kasa-Tapo/Shelly/Meross/SwitchBot) se prueba al
 * mismo **contrato de fallo**, sobre su transporte inyectable mockeado para que
 * **falle** de tres formas. Sin hardware real (e2e → US-86).
 *
 * El contrato que TODO driver debe cumplir ante un transporte que falla:
 *  1. **No cuelga**: cada operación se asienta (resuelve o rechaza) dentro de un
 *     tiempo acotado; nunca deja una promesa pendiente.
 *  2. **No filtra basura como éxito**: si resuelve, el valor tiene la **forma del
 *     contrato** (array donde toca, objeto con WAN numérico finito, etc.); si no
 *     puede, **lanza un `Error` limpio**. Nunca devuelve la respuesta malformada
 *     del transporte tal cual.
 *  3. `healthcheck()` **nunca lanza**: siempre resuelve un booleano.
 *
 * Degradar (devolver `[]`/`null`/`false`) y lanzar un `Error` son ambos
 * conformes; devolver datos con forma corrupta (p. ej. `NaN` en el WAN) no lo es.
 */

type Behavior = 'timeout' | 'cut' | 'garbage';

/** Forma malformada que un transporte roto resolvería en modo `garbage`. */
const GARBAGE = { unexpectedShape: true, notAnArray: 'nope', count: Number.NaN };

/**
 * Transporte que falla: un `Proxy` cuyos métodos (sea cual sea su nombre, así
 * sirve para todas las formas de transporte) rechazan (`timeout`/`cut`) o
 * resuelven basura (`garbage`). Se castea al tipo concreto que pida cada driver
 * —solo se invocan sus métodos, nunca se inspecciona la clase real—.
 */
function failingTransport(behavior: Behavior): never {
  const handler = async (): Promise<unknown> => {
    if (behavior === 'garbage') return GARBAGE;
    if (behavior === 'cut') throw new Error('ECONNRESET: el transporte cayó a mitad de la llamada');
    // timeout: rechazo diferido (la operación expira), no inmediato.
    return new Promise((_resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ETIMEDOUT: el transporte no respondió')), 10);
      t.unref?.();
    });
  };
  return new Proxy(
    {},
    {
      get: () => handler,
    },
  ) as never;
}

/** Tipo de valor que una operación puede devolver SI resuelve (si no, lanza). */
type Shape = 'boolean' | 'array' | 'object' | 'traffic' | 'void' | 'nullableObject' | 'nullableArray';

interface Op {
  name: string;
  shape: Shape;
  /** `true` si NUNCA puede lanzar (solo `healthcheck`). */
  neverThrows?: boolean;
  call: (d: HardwareDriver | IotManager) => Promise<unknown>;
}

interface Subject {
  name: string;
  make: (b: Behavior) => HardwareDriver | IotManager;
  ops: Op[];
}

// ---- Operaciones del contrato HardwareDriver ----

const DRIVER_OPS: Op[] = [
  { name: 'healthcheck', shape: 'boolean', neverThrows: true, call: (x) => (x as HardwareDriver).healthcheck() },
  { name: 'scanArp', shape: 'array', call: (x) => (x as HardwareDriver).scanArp() },
  { name: 'scanMdns', shape: 'array', call: (x) => (x as HardwareDriver).scanMdns() },
  { name: 'getTrafficSample', shape: 'traffic', call: (x) => (x as HardwareDriver).getTrafficSample() },
  { name: 'blockDevice', shape: 'void', call: (x) => (x as HardwareDriver).blockDevice('aa:bb:cc:dd:ee:ff') },
  { name: 'unblockDevice', shape: 'void', call: (x) => (x as HardwareDriver).unblockDevice('aa:bb:cc:dd:ee:ff') },
  { name: 'getWifi', shape: 'object', call: (x) => (x as HardwareDriver).getWifi() },
  { name: 'updateWifi', shape: 'object', call: (x) => (x as HardwareDriver).updateWifi({ ssid: 'k' }) },
  { name: 'getGuestNetwork', shape: 'object', call: (x) => (x as HardwareDriver).getGuestNetwork() },
  { name: 'updateGuestNetwork', shape: 'object', call: (x) => (x as HardwareDriver).updateGuestNetwork({ enabled: true }) },
  { name: 'listAccessPoints', shape: 'array', call: (x) => (x as HardwareDriver).listAccessPoints() },
  { name: 'listWifiNetworks', shape: 'array', call: (x) => (x as HardwareDriver).listWifiNetworks() },
  { name: 'getWifiNetwork', shape: 'nullableObject', call: (x) => (x as HardwareDriver).getWifiNetwork('id') },
  { name: 'updateWifiNetwork', shape: 'nullableObject', call: (x) => (x as HardwareDriver).updateWifiNetwork('id', { ssid: 'k' }) },
  { name: 'listNetworkClients', shape: 'nullableArray', call: (x) => (x as HardwareDriver).listNetworkClients('id') },
];

function driverSubject(name: string, make: (b: Behavior) => HardwareDriver): Subject {
  return { name, make, ops: DRIVER_OPS };
}

// ---- Operaciones del contrato IotManager ----

function iotOps(sampleId: string): Op[] {
  return [
    { name: 'listDevices', shape: 'array', call: (x) => (x as IotManager).listDevices() },
    { name: 'getDevice', shape: 'nullableObject', call: (x) => (x as IotManager).getDevice(sampleId) },
    { name: 'setState', shape: 'object', call: (x) => (x as IotManager).setState(sampleId, { on: true }) },
  ];
}

function iotSubject(name: string, make: (b: Behavior) => IotManager, sampleId: string): Subject {
  return { name, make, ops: iotOps(sampleId) };
}

// ---- Sujetos: los 8 drivers/integraciones reales ----

const SUBJECTS: Subject[] = [
  driverSubject('unifi', (b) => new UnifiDriver({ client: failingTransport(b), host: 'unifi.test' })),
  driverSubject('omada', (b) => new OmadaDriver({ client: failingTransport(b), host: 'omada.test' })),
  driverSubject('asus', (b) => new AsusDriver({ client: failingTransport(b), host: 'asus.test' })),
  driverSubject('mikrotik', (b) => new MikrotikDriver({ transport: failingTransport(b), wanInterface: 'ether1' })),
  iotSubject(
    'kasa',
    (b) => new KasaIotManager({ kasa: failingTransport(b), tapo: failingTransport(b), kasaIps: ['10.0.0.5'], tapoIps: ['10.0.0.6'] }),
    'kasa:10.0.0.5',
  ),
  iotSubject('shelly', (b) => new ShellyIotManager({ transport: failingTransport(b), devices: [{ ip: '10.0.0.7', gen: 1 }] }), 'shelly:10.0.0.7:0'),
  iotSubject('meross', (b) => new MerossIotManager({ transport: failingTransport(b), devices: [{ uuid: 'u1', key: 'k' }] }), 'meross:u1:0'),
  iotSubject('switchbot', (b) => new SwitchBotIotManager({ transport: failingTransport(b) }), 'switchbot:dev1'),
];

const BEHAVIORS: Behavior[] = ['timeout', 'cut', 'garbage'];

/** Asienta `p` con un guardia de cuelgue: marca `hung` si no resuelve en 1 s. */
async function settle(p: Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown } | 'hung'> {
  const HUNG = Symbol('hung');
  const guard = new Promise<typeof HUNG>((resolve) => {
    const t = setTimeout(() => resolve(HUNG), 1000);
    t.unref?.();
  });
  const result = await Promise.race([
    p.then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error })),
    guard,
  ]);
  return result === HUNG ? 'hung' : result;
}

/** ¿Es `value` una forma válida del contrato para `shape`? */
function matchesShape(shape: Shape, value: unknown): boolean {
  const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);
  switch (shape) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'void':
      return value === undefined;
    case 'object':
      return isObject(value);
    case 'nullableObject':
      return value === null || isObject(value);
    case 'nullableArray':
      return value === null || Array.isArray(value);
    case 'traffic':
      // WAN con rx/tx **numéricos finitos** (no NaN/garbage filtrado).
      if (!isObject(value)) return false;
      {
        const wan = (value as { wan?: unknown }).wan;
        if (!isObject(wan)) return false;
        const { rxBytesPerSec, txBytesPerSec } = wan as Record<string, unknown>;
        return (
          typeof rxBytesPerSec === 'number' &&
          Number.isFinite(rxBytesPerSec) &&
          typeof txBytesPerSec === 'number' &&
          Number.isFinite(txBytesPerSec)
        );
      }
  }
}

describe('Conformidad de drivers: contrato de fallo (US-100)', () => {
  for (const subject of SUBJECTS) {
    describe(subject.name, () => {
      for (const behavior of BEHAVIORS) {
        for (const op of subject.ops) {
          it(`${op.name} bajo transporte "${behavior}": se asienta y no filtra basura`, async () => {
            const instance = subject.make(behavior);
            const outcome = await settle(op.call(instance));

            // 1. No cuelga.
            expect(outcome, `${subject.name}.${op.name} colgó bajo "${behavior}"`).not.toBe('hung');
            if (outcome === 'hung') return;

            if (outcome.ok) {
              // 2. Si resuelve, la forma es la del contrato (no basura).
              expect(
                matchesShape(op.shape, outcome.value),
                `${subject.name}.${op.name} bajo "${behavior}" resolvió una forma inválida (${op.shape}): ${JSON.stringify(outcome.value)}`,
              ).toBe(true);
            } else {
              // 3. Si rechaza, es un Error limpio…
              expect(
                outcome.error,
                `${subject.name}.${op.name} bajo "${behavior}" rechazó con un no-Error`,
              ).toBeInstanceOf(Error);
              // …salvo healthcheck, que NUNCA debe lanzar.
              expect(op.neverThrows ?? false, `${subject.name}.${op.name} no debería lanzar nunca`).toBe(false);
              // …y ante basura, el error debe ser DELIBERADO (validó la forma del
              // transporte), no un `TypeError` por desreferenciar lo malformado
              // (`x.split is not a function`, `rows is not iterable`): eso delata
              // una frontera sin validar.
              if (behavior === 'garbage') {
                expect(
                  outcome.error instanceof TypeError,
                  `${subject.name}.${op.name} lanzó un TypeError al tocar basura (frontera sin validar): ${String((outcome.error as Error).message)}`,
                ).toBe(false);
              }
            }
          });
        }
      }
    });
  }
});
