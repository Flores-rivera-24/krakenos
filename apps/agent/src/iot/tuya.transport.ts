import type { TuyaDeviceConfig } from './tuya.store.js';

/**
 * Transporte del protocolo Tuya local. El manager no conoce `tuyapi`: opera
 * contra esta interfaz, lo que permite testear el contrato con un transporte
 * falso (sin focos ni red). La implementación real (`TuyapiTransport`) carga
 * `tuyapi` de forma perezosa, solo necesaria en un despliegue real.
 */

/** Sesión abierta con un dispositivo Tuya concreto. */
export interface TuyaDeviceHandle {
  /** Lee los DPS (data points) actuales del dispositivo. */
  get(): Promise<Record<string, unknown>>;
  /** Escribe un conjunto parcial de DPS. */
  set(dps: Record<string, unknown>): Promise<void>;
  /** Cierra la conexión TCP con el dispositivo. */
  disconnect(): void;
}

export interface TuyaTransport {
  /** Abre una sesión con el dispositivo descrito por `config`. */
  connect(config: TuyaDeviceConfig): Promise<TuyaDeviceHandle>;
}

/**
 * Transporte Tuya en memoria para tests. Mantiene el estado DPS por `deviceId`;
 * `get()` devuelve `{ 20: false, 22: 500 }` por defecto y `set()` lo fusiona.
 * Un `deviceId` marcado en `offline` hace que `connect`/`get`/`set` lancen
 * (simula un dispositivo inalcanzable).
 */
export class MockTuyaTransport implements TuyaTransport {
  /** Estado DPS por deviceId (mutado por `set`). */
  readonly states = new Map<string, Record<string, unknown>>();
  /** deviceIds inalcanzables. */
  readonly offline = new Set<string>();
  /** Registro de `connect` para asertar en tests. */
  readonly connectCalls: string[] = [];
  /** Registro de `set` para asertar en tests. */
  readonly setCalls: { deviceId: string; dps: Record<string, unknown> }[] = [];

  async connect(config: TuyaDeviceConfig): Promise<TuyaDeviceHandle> {
    const { deviceId } = config;
    this.connectCalls.push(deviceId);
    if (this.offline.has(deviceId)) throw new Error(`Tuya offline: ${deviceId}`);
    if (!this.states.has(deviceId)) this.states.set(deviceId, { '20': false, '22': 500 });

    return {
      get: async () => {
        if (this.offline.has(deviceId)) throw new Error(`Tuya offline: ${deviceId}`);
        return { ...this.states.get(deviceId)! };
      },
      set: async (dps) => {
        if (this.offline.has(deviceId)) throw new Error(`Tuya offline: ${deviceId}`);
        this.setCalls.push({ deviceId, dps });
        this.states.set(deviceId, { ...this.states.get(deviceId)!, ...dps });
      },
      disconnect: () => {},
    };
  }
}

/**
 * Transporte Tuya real sobre `tuyapi` (TCP 6668 + AES). La dependencia se carga
 * con import dinámico (especificador no-literal) para no exigirla en
 * `install`/tests/typecheck: solo se instala en el servidor (`pnpm add tuyapi`).
 * No se cubre con unit tests (requiere un foco real); la lógica testeable vive en
 * los parsers puros y en `TuyaIotManager` con un transporte falso.
 */
export class TuyapiTransport implements TuyaTransport {
  async connect(config: TuyaDeviceConfig): Promise<TuyaDeviceHandle> {
    const moduleName = 'tuyapi';
    const mod = (await import(moduleName).catch(() => {
      throw new Error(
        'La integración Tuya requiere el paquete "tuyapi". Instálalo en el servidor (pnpm add tuyapi).',
      );
    })) as { default: new (opts: Record<string, unknown>) => TuyApiDevice };

    const TuyAPI = mod.default;
    const device = new TuyAPI({
      id: config.deviceId,
      key: config.localKey,
      ip: config.ip,
      version: config.version ?? '3.3',
    });
    await device.connect();

    return {
      get: async () => {
        const data = (await device.get({ schema: true })) as { dps?: Record<string, unknown> };
        return data?.dps ?? {};
      },
      set: async (dps) => {
        await device.set({ multiple: true, data: dps });
      },
      disconnect: () => device.disconnect(),
    };
  }
}

/** Forma mínima de un dispositivo `tuyapi` que usamos (evita depender de sus tipos). */
interface TuyApiDevice {
  connect(): Promise<void>;
  get(opts: { schema: boolean }): Promise<unknown>;
  set(opts: { multiple: boolean; data: Record<string, unknown> }): Promise<unknown>;
  disconnect(): void;
}
