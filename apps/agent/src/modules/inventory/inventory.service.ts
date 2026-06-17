import type {
  Device,
  DeviceType,
  DiscoveredDevice,
  DiscoverySource,
  HardwareDriver,
  UpdateDeviceRequest,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';

interface DbDevice {
  id: string;
  mac: string;
  ip: string;
  hostname: string | null;
  label: string | null;
  vendor: string | null;
  type: string;
  online: boolean;
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
    vendor: row.vendor,
    type: row.type as DeviceType,
    online: row.online,
    sources,
    firstSeen: row.firstSeen.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
  };
}

export class InventoryService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

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
      },
    })) as DbDevice;

    const device = toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Ejecuta un barrido, persiste cambios y emite eventos en tiempo real. */
  async scan(): Promise<Device[]> {
    const discovered = await this.driver.scanArp();
    const seenMacs = new Set(discovered.map((d) => d.mac.toLowerCase()));

    for (const found of discovered) {
      await this.upsertDiscovered(found);
    }

    // Marca como offline lo que no apareció en este barrido.
    const stale = (await this.app.prisma.device.findMany({
      where: { online: true, mac: { notIn: [...seenMacs] } },
    })) as DbDevice[];
    for (const row of stale) {
      await this.app.prisma.device.update({ where: { id: row.id }, data: { online: false } });
      this.app.io.emit('inventory:device-updated', toDevice({ ...row, online: false }));
    }

    return this.list();
  }

  private async upsertDiscovered(found: DiscoveredDevice): Promise<void> {
    const mac = found.mac.toLowerCase();
    const existing = (await this.app.prisma.device.findUnique({ where: { mac } })) as DbDevice | null;

    const sources = new Set<DiscoverySource>(
      existing ? (JSON.parse(existing.sources) as DiscoverySource[]) : [],
    );
    sources.add(found.source);

    const row = (await this.app.prisma.device.upsert({
      where: { mac },
      create: {
        mac,
        ip: found.ip,
        hostname: found.hostname ?? null,
        vendor: found.vendor ?? null,
        online: true,
        sources: JSON.stringify([...sources]),
      },
      update: {
        ip: found.ip,
        hostname: found.hostname ?? existing?.hostname ?? null,
        vendor: found.vendor ?? existing?.vendor ?? null,
        online: true,
        lastSeen: new Date(),
        sources: JSON.stringify([...sources]),
      },
    })) as DbDevice;

    this.app.io.emit('inventory:device-updated', toDevice(row));
  }
}
