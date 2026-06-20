import type {
  Device,
  DeviceType,
  DiscoverySource,
  HardwareDriver,
  UpdateDeviceRequest,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { inferDeviceType } from './identify.js';
import { lookupVendor } from './oui.js';

interface DbDevice {
  id: string;
  mac: string;
  ip: string;
  hostname: string | null;
  label: string | null;
  vendor: string | null;
  type: string;
  notes: string | null;
  isBlocked: boolean;
  online: boolean;
  vlanTag: number | null;
  sources: string;
  firstSeen: Date;
  lastSeen: Date;
}

function toDevice(row: DbDevice): Device {
  let sources: DiscoverySource[] = [];
  try {
    sources = JSON.parse(row.sources) as DiscoverySource[];
  } catch {
    sources = [];
  }
  return {
    id: row.id,
    mac: row.mac,
    ip: row.ip,
    hostname: row.hostname,
    label: row.label,
    notes: row.notes,
    vendor: row.vendor,
    type: row.type as DeviceType,
    isBlocked: row.isBlocked,
    online: row.online,
    vlanTag: row.vlanTag,
    sources,
    firstSeen: row.firstSeen.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
  };
}

export class InventoryService {
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

  /**
   * (Re)programa el barrido periódico de inventario. Se llama al arrancar con el
   * intervalo persistido (`scanIntervalSec`) y de nuevo cuando cambia el ajuste,
   * de modo que el nuevo intervalo tiene efecto **en caliente** (US-47). Un
   * `ms <= 0` detiene el barrido automático.
   */
  setScanInterval(ms: number): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (ms > 0) {
      this.scanTimer = setInterval(() => void this.scan(), ms);
      // No mantener vivo el proceso solo por este intervalo.
      this.scanTimer.unref();
    }
  }

  /** Detiene el barrido periódico (al cerrar el servidor). */
  stopScan(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async list(): Promise<Device[]> {
    const rows = (await this.app.prisma.device.findMany({
      orderBy: { lastSeen: 'desc' },
    })) as DbDevice[];
    return rows.map(toDevice);
  }

  async updateMetadata(id: string, input: UpdateDeviceRequest): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    const row = (await this.app.prisma.device.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })) as DbDevice;

    const device = toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Bloquea o desbloquea el acceso a la red de un dispositivo (vía driver). */
  async setBlocked(id: string, blocked: boolean): Promise<Device | null> {
    const existing = (await this.app.prisma.device.findUnique({ where: { id } })) as DbDevice | null;
    if (!existing) return null;

    if (blocked) await this.driver.blockDevice(existing.mac);
    else await this.driver.unblockDevice(existing.mac);

    const row = (await this.app.prisma.device.update({
      where: { id },
      data: { isBlocked: blocked },
    })) as DbDevice;

    const device = toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Asigna (o quita, con `null`) la VLAN de un dispositivo y emite el cambio. */
  async setVlan(id: string, vlanTag: number | null): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    const row = (await this.app.prisma.device.update({
      where: { id },
      data: { vlanTag },
    })) as DbDevice;

    const device = toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Ejecuta un barrido (ARP + mDNS), persiste cambios y emite eventos en tiempo real. */
  async scan(): Promise<Device[]> {
    const [arp, mdns] = await Promise.all([this.driver.scanArp(), this.driver.scanMdns()]);

    // Combina ambas fuentes por MAC: une hostname, vendor y orígenes.
    const merged = new Map<string, MergedDevice>();
    for (const d of [...arp, ...mdns]) {
      const mac = d.mac.toLowerCase();
      const cur = merged.get(mac) ?? { mac, ip: d.ip, hostname: null, vendor: null, sources: new Set() };
      cur.ip = d.ip || cur.ip;
      cur.hostname = d.hostname ?? cur.hostname;
      cur.vendor = d.vendor ?? cur.vendor;
      cur.sources.add(d.source);
      merged.set(mac, cur);
    }

    for (const device of merged.values()) {
      await this.upsertDiscovered(device);
    }

    // Marca como offline lo que no apareció en este barrido.
    const stale = (await this.app.prisma.device.findMany({
      where: { online: true, mac: { notIn: [...merged.keys()] } },
    })) as DbDevice[];
    for (const row of stale) {
      await this.app.prisma.device.update({ where: { id: row.id }, data: { online: false } });
      this.app.io.emit('inventory:device-updated', toDevice({ ...row, online: false }));
    }

    return this.list();
  }

  private async upsertDiscovered(found: MergedDevice): Promise<void> {
    const { mac } = found;
    const existing = (await this.app.prisma.device.findUnique({ where: { mac } })) as DbDevice | null;

    const sources = new Set<DiscoverySource>(
      existing ? (JSON.parse(existing.sources) as DiscoverySource[]) : [],
    );
    for (const s of found.sources) sources.add(s);

    const hostname = found.hostname ?? existing?.hostname ?? null;
    // Fabricante: el provisto por el driver tiene prioridad; si no, lookup OUI.
    const vendor = existing?.vendor ?? found.vendor ?? lookupVendor(mac);
    // Tipo: respeta el que haya fijado el usuario; sólo autoinfiere si es 'unknown'.
    const type =
      existing && existing.type !== 'unknown' ? existing.type : inferDeviceType(vendor, hostname);

    const row = (await this.app.prisma.device.upsert({
      where: { mac },
      create: {
        mac,
        ip: found.ip,
        hostname,
        vendor,
        type,
        online: true,
        sources: JSON.stringify([...sources]),
      },
      update: {
        ip: found.ip,
        hostname,
        vendor,
        type,
        online: true,
        lastSeen: new Date(),
        sources: JSON.stringify([...sources]),
      },
    })) as DbDevice;

    this.app.io.emit('inventory:device-updated', toDevice(row));
  }
}

/** Dispositivo descubierto tras fusionar ARP + mDNS por MAC. */
interface MergedDevice {
  mac: string;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  sources: Set<DiscoverySource>;
}
