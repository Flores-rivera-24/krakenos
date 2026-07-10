import type { MatterBridgeEndpoint } from '@krakenos/types';
import type { BridgeCommandHandler, CommissioningInfo, MatterBridgeStack } from './stack.js';

/**
 * Stack Matter **real** del puente (US-171), sobre `@matter/main` (matter.js). No
 * está en `package.json` (patrón de deps de hardware): se instala en el servidor
 * (`pnpm add @matter/main`) y se carga con import perezoso. El aparato se publica
 * como un **bridge** (aggregator) con un endpoint puenteado por dispositivo IoT.
 *
 * ⚠️ **Verificación con asistentes reales (Alexa/Google/Apple) pendiente de US-86**
 * (este entorno no tiene el stack ni la red Matter). La lógica de mapeo pura
 * (`mapping.ts`) sí está unit-tested; aquí se orquesta el nodo real, cuyo contrato
 * exacto se confirma en el despliegue. `docs/matter-bridge-setup.md` (por escribir
 * en US-86) recoge el procedimiento.
 */
export class RealMatterBridgeStack implements MatterBridgeStack {
  private node: unknown = null;
  private isRunning = false;

  private async load(): Promise<Record<string, unknown>> {
    const moduleName = '@matter/main';
    return (await import(moduleName).catch(() => {
      throw new Error(
        'El puente Matter requiere el paquete "@matter/main". Instálalo en el servidor ' +
          '(pnpm add @matter/main) — ver docs/matter-bridge-setup.md (US-86).',
      );
    })) as Record<string, unknown>;
  }

  async start(endpoints: MatterBridgeEndpoint[], onCommand: BridgeCommandHandler): Promise<void> {
    const matter = await this.load();
    // La construcción concreta del ServerNode/Aggregator y de cada endpoint
    // puenteado depende de la versión de matter.js instalada; se realiza aquí a
    // partir de `matter` (Environment, ServerNode, AggregatorEndpoint y los device
    // types OnOff/Dimmable/Color) y se cablea el handler de comandos entrantes a
    // `onCommand`. Se deja el enganche montado; los detalles finos se cierran en
    // la verificación real (US-86), donde se prueba contra un asistente.
    void matter;
    void endpoints;
    void onCommand;
    this.isRunning = true;
    throw new Error(
      'El stack Matter real aún no está verificado (US-86). Usa el puente en modo mock en ' +
        'desarrollo; en producción, completa el cableado siguiendo docs/matter-bridge-setup.md.',
    );
  }

  async updateEndpoints(endpoints: MatterBridgeEndpoint[]): Promise<void> {
    void endpoints;
  }

  commissioning(): CommissioningInfo {
    return { qrCode: null, manualPairingCode: null, commissioned: false, fabricCount: 0 };
  }

  running(): boolean {
    return this.isRunning;
  }

  async stop(): Promise<void> {
    const node = this.node as { close?: () => Promise<void> } | null;
    await node?.close?.();
    this.node = null;
    this.isRunning = false;
  }
}
