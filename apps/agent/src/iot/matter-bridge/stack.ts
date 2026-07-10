import type { MatterBridgeEndpoint } from '@krakenos/types';
import type { MatterIncomingCommand } from './mapping.js';

/**
 * Abstracción del stack Matter del puente (US-171). El servicio opera contra esta
 * interfaz, de modo que el contrato (comisionado, endpoints, comandos entrantes)
 * se testea con un stack falso y la implementación real (`@matter/main`) se carga
 * de forma perezosa solo en un despliegue real (verificación en US-86).
 */

/** Handler de un comando Matter entrante para un endpoint (deviceId). */
export type BridgeCommandHandler = (deviceId: string, command: MatterIncomingCommand) => void;

/** Datos de comisionado que el stack expone para emparejar el puente. */
export interface CommissioningInfo {
  qrCode: string | null;
  manualPairingCode: string | null;
  commissioned: boolean;
  fabricCount: number;
}

export interface MatterBridgeStack {
  /** Arranca el puente con los endpoints iniciales y registra el handler de comandos. */
  start(endpoints: MatterBridgeEndpoint[], onCommand: BridgeCommandHandler): Promise<void>;
  /** Reemplaza el conjunto de endpoints publicados (alta/baja en caliente). */
  updateEndpoints(endpoints: MatterBridgeEndpoint[]): Promise<void>;
  /** Estado de comisionado actual. */
  commissioning(): CommissioningInfo;
  /** ¿Está corriendo el stack? */
  running(): boolean;
  /** Detiene el puente y libera recursos. */
  stop(): Promise<void>;
}

/**
 * Stack en memoria para desarrollo y tests. No abre ningún socket Matter: genera
 * un payload de QR y un código manual **deterministas** (a partir de un discriminador
 * fijo) para que la UI tenga algo que mostrar, y permite simular el comisionado y
 * la recepción de comandos en las pruebas.
 */
export class MockMatterBridgeStack implements MatterBridgeStack {
  private endpoints: MatterBridgeEndpoint[] = [];
  private handler: BridgeCommandHandler | null = null;
  private isRunning = false;
  private fabrics = 0;

  /** Discriminador fijo del mock (no secreto: es un stack falso). */
  private static readonly DISCRIMINATOR = 3840;

  async start(endpoints: MatterBridgeEndpoint[], onCommand: BridgeCommandHandler): Promise<void> {
    this.endpoints = endpoints;
    this.handler = onCommand;
    this.isRunning = true;
  }

  async updateEndpoints(endpoints: MatterBridgeEndpoint[]): Promise<void> {
    this.endpoints = endpoints;
  }

  commissioning(): CommissioningInfo {
    if (!this.isRunning) {
      return { qrCode: null, manualPairingCode: null, commissioned: false, fabricCount: 0 };
    }
    return {
      // Payload de ejemplo con el formato `MT:` (no válido para un fabric real:
      // el mock no comisiona de verdad, solo alimenta la UI).
      qrCode: `MT:MOCK-${MockMatterBridgeStack.DISCRIMINATOR}-${this.endpoints.length}`,
      manualPairingCode: '3497-011-2332',
      commissioned: this.fabrics > 0,
      fabricCount: this.fabrics,
    };
  }

  running(): boolean {
    return this.isRunning;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.handler = null;
  }

  // --- Ayudas de test (no forman parte de la interfaz) ---

  /** Simula que un asistente empareja el puente. */
  simulateCommission(): void {
    this.fabrics += 1;
  }

  /** Simula un comando Matter entrante hacia un endpoint. */
  emit(deviceId: string, command: MatterIncomingCommand): void {
    this.handler?.(deviceId, command);
  }

  /** Endpoints actualmente publicados (para aserciones). */
  publishedEndpoints(): MatterBridgeEndpoint[] {
    return this.endpoints;
  }
}

/**
 * Crea el stack Matter del puente. `mock` (por defecto en dev) usa el stack en
 * memoria; `matter` carga el stack real de `@matter/main` de forma perezosa (no
 * está en `package.json`; se instala en el servidor, patrón de deps de hardware).
 */
export async function createMatterBridgeStack(
  kind: 'mock' | 'matter',
): Promise<MatterBridgeStack> {
  if (kind === 'mock') return new MockMatterBridgeStack();
  const { RealMatterBridgeStack } = await import('./real-stack.js');
  return new RealMatterBridgeStack();
}
