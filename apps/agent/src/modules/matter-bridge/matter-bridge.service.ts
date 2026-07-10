import type {
  IotManager,
  MatterBridgeCandidate,
  MatterBridgeEndpoint,
  MatterBridgeState,
  UpdateMatterBridgeRequest,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { withActionTimeout } from '../../iot/action-timeout.js';
import { matterCommandToState, toBridgeEndpoint, type MatterIncomingCommand } from '../../iot/matter-bridge/mapping.js';
import type { MatterBridgeStack } from '../../iot/matter-bridge/stack.js';

/** Clave del ajuste que persiste la config del puente. */
const SETTING_KEY = 'matter.bridge';

interface BridgeConfig {
  enabled: boolean;
  exposedDeviceIds: string[];
}

const DEFAULT_CONFIG: BridgeConfig = { enabled: false, exposedDeviceIds: [] };

/**
 * Puente Matter (US-171). Orquesta el stack Matter (mock en dev, `@matter/main`
 * real en producción) a partir de la config del hogar y el snapshot del
 * `IotManager`: publica como endpoints Matter los dispositivos **elegidos** (opt-in),
 * traduce los comandos entrantes de Alexa/Google/Apple a `setState` del IoT y los
 * **audita** con `matter.command` (procedencia acotada). Desactivado por defecto.
 */
export class MatterBridgeService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly stack: MatterBridgeStack,
  ) {}

  /** Lee la config del puente (JSON defensivo, patrón US-63/US-199). */
  private async loadConfig(): Promise<BridgeConfig> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(row.value) as Partial<BridgeConfig>;
      return {
        enabled: parsed.enabled === true,
        exposedDeviceIds: Array.isArray(parsed.exposedDeviceIds)
          ? parsed.exposedDeviceIds.filter((x): x is string => typeof x === 'string')
          : [],
      };
    } catch {
      this.app.log.warn('[matter-bridge] ajuste matter.bridge corrupto; se asume desactivado');
      return { ...DEFAULT_CONFIG };
    }
  }

  private async saveConfig(config: BridgeConfig): Promise<void> {
    const value = JSON.stringify(config);
    await this.app.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value },
      update: { value },
    });
  }

  /** Endpoints a publicar: intersección de expuestos y mapeables (orden estable). */
  private async computeEndpoints(config: BridgeConfig): Promise<MatterBridgeEndpoint[]> {
    const exposed = new Set(config.exposedDeviceIds);
    const devices = await this.iot.listDevices();
    return devices
      .filter((d) => exposed.has(d.id))
      .map(toBridgeEndpoint)
      .filter((e): e is MatterBridgeEndpoint => e !== null);
  }

  /** Arranca/actualiza/detiene el stack según la config (idempotente). */
  async reconcile(): Promise<void> {
    const config = await this.loadConfig();
    if (!config.enabled) {
      if (this.stack.running()) await this.stack.stop();
      return;
    }
    const endpoints = await this.computeEndpoints(config);
    if (this.stack.running()) {
      await this.stack.updateEndpoints(endpoints);
    } else {
      await this.stack.start(endpoints, (deviceId, command) => {
        void this.handleCommand(deviceId, command);
      });
    }
  }

  /**
   * Comando Matter entrante → `setState` del IoT, acotado a los dispositivos
   * expuestos y con timeout (US-203). Auditado como `matter.command` (origen
   * matter); nunca lanza (el stack no debe caerse por un fallo de driver).
   */
  async handleCommand(deviceId: string, command: MatterIncomingCommand): Promise<void> {
    try {
      const config = await this.loadConfig();
      // Superficie acotada: solo se aceptan comandos para lo expuesto (defensa en
      // profundidad aunque el stack solo publique esos endpoints).
      if (!config.enabled || !config.exposedDeviceIds.includes(deviceId)) return;
      const state = matterCommandToState(command);
      if (!state) return;
      await withActionTimeout(() => this.iot.setState(deviceId, state));
      this.app.audit({ action: 'matter.command', detail: `${deviceId} origen:matter` });
    } catch (err) {
      this.app.log.warn({ err }, `[matter-bridge] comando entrante falló para ${deviceId}`);
    }
  }

  /** Estado del puente para la UI, con QR renderizado a PNG data URL. */
  async getState(): Promise<MatterBridgeState> {
    const config = await this.loadConfig();
    const exposed = new Set(config.exposedDeviceIds);
    const devices = await this.iot.listDevices();

    const candidates: MatterBridgeCandidate[] = [];
    for (const d of devices) {
      const ep = toBridgeEndpoint(d);
      if (ep) candidates.push({ deviceId: ep.deviceId, name: ep.name, type: ep.type, exposed: exposed.has(ep.deviceId) });
    }
    const endpoints = candidates
      .filter((c) => c.exposed)
      .map((c) => ({ deviceId: c.deviceId, name: c.name, type: c.type }));

    const commissioning = this.stack.commissioning();
    const qrDataUrl = commissioning.qrCode
      ? await QRCode.toDataURL(commissioning.qrCode).catch(() => null)
      : null;

    return {
      enabled: config.enabled,
      running: this.stack.running(),
      commissioned: commissioning.commissioned,
      fabricCount: commissioning.fabricCount,
      qrCode: commissioning.qrCode,
      qrDataUrl,
      manualPairingCode: commissioning.manualPairingCode,
      endpoints,
      candidates,
    };
  }

  /** Aplica cambios de config (activar/desactivar, elegir dispositivos) y reconcilia. */
  async update(req: UpdateMatterBridgeRequest): Promise<MatterBridgeState> {
    const config = await this.loadConfig();
    if (req.enabled !== undefined) config.enabled = req.enabled;
    if (req.exposedDeviceIds !== undefined) {
      // Dedup + solo strings (el schema ya acota longitud/tamaño).
      config.exposedDeviceIds = [...new Set(req.exposedDeviceIds)];
    }
    await this.saveConfig(config);
    await this.reconcile();
    return this.getState();
  }

  /** Detiene el puente al cerrar el servidor. */
  async stop(): Promise<void> {
    if (this.stack.running()) await this.stack.stop();
  }
}
