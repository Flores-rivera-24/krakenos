import type {
  Device,
  DeviceType,
  DiscoverySource,
  HardwareDriver,
  HomeEvent,
  UpdateDeviceRequest,
} from '@krakenos/types';
// Tipo de fila derivado del schema Prisma: si el modelo `Device` cambia, el
// mapeo `toDevice` deja de compilar (detecta derivas de schema, US-63) en vez de
// confiar en un `as DbDevice` ciego.
import type { Device as DbDevice } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { inferDeviceType } from './identify.js';
import { normalizeDiscovered } from './normalize.js';
import { lookupVendor } from './oui.js';

/** Error de dominio de inventario con código estable (→ 400 en la ruta). */
export class InventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class InventoryService {
  private scanTimer: NodeJS.Timeout | null = null;
  /** Coalescing: evita barridos solapados (US-47/hardening). */
  private isScanning = false;
  /** ¿Hay un horario de acceso activo ahora para esta MAC? (US-108, inyectado). */
  private scheduleGuard?: (mac: string) => Promise<boolean>;
  /** Sumidero de eventos del hogar (US-167, inyectado): dispositivo nuevo/online/offline. */
  private eventSink?: (event: HomeEvent) => void;

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

  /** Inyecta la comprobación de horarios de acceso, para no desbloquear a mano un
   *  dispositivo que un horario de control parental mantiene bloqueado (US-108). */
  setScheduleGuard(fn: (mac: string) => Promise<boolean>): void {
    this.scheduleGuard = fn;
  }

  /** Inyecta el bus de eventos del hogar para las automatizaciones (US-167). */
  setEventSink(sink: (event: HomeEvent) => void): void {
    this.eventSink = sink;
  }

  /** Mapea una fila Prisma al DTO `Device` del contrato compartido. */
  private toDevice(row: DbDevice): Device {
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
      pausedUntil: row.pausedUntil ? row.pausedUntil.toISOString() : null,
      online: row.online,
      vlanTag: row.vlanTag,
      roomId: row.roomId,
      ownerId: row.ownerId,
      sources: this.parseSources(row.sources, row.mac),
      firstSeen: row.firstSeen.toISOString(),
      lastSeen: row.lastSeen.toISOString(),
    };
  }

  /**
   * Parsea el JSON de `sources`. Si está corrupto **avisa por el log** (no lo
   * silencia, US-63) y devuelve `[]` para no tumbar el barrido: el dispositivo
   * sigue siendo usable y un re-descubrimiento reescribe el campo.
   */
  private parseSources(raw: string, mac: string): DiscoverySource[] {
    try {
      return JSON.parse(raw) as DiscoverySource[];
    } catch (err) {
      this.app.log.warn(
        { mac, err, raw },
        '[inventory] sources con JSON corrupto; se trata como vacío',
      );
      return [];
    }
  }

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
      this.scanTimer = setInterval(() => void this.scanCycle(), ms);
      // No mantener vivo el proceso solo por este intervalo.
      this.scanTimer.unref();
    }
  }

  /**
   * Ejecuta un ciclo de barrido **sin propagar errores**: pensado para los
   * disparos fire-and-forget (timer periódico y socket `inventory:rescan`). Si el
   * driver falla (caído, timeout, respuesta malformada) lo registra y degrada —
   * el agente sigue vivo y reintenta en el próximo ciclo. La ruta HTTP
   * `POST /rescan` usa `scan()` directamente porque ahí sí queremos propagar el
   * fallo como 500 al cliente que lo pidió.
   */
  async scanCycle(): Promise<void> {
    // Coalescing: si ya hay un barrido en curso, se omite. Cierra la amplificación
    // del socket `inventory:rescan` (sin rate limit): una avalancha de eventos ya
    // no dispara N `scanArp`/`scanMdns` concurrentes contra el router/switch — a lo
    // sumo se encadena uno más al terminar el actual.
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      await this.scan();
    } catch (err) {
      this.app.log.error(
        { err },
        '[inventory] el barrido falló; se omite este ciclo y se reintentará en el próximo',
      );
    } finally {
      this.isScanning = false;
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
    const rows = await this.app.prisma.device.findMany({
      orderBy: { lastSeen: 'desc' },
    });
    return rows.map((row) => this.toDevice(row));
  }

  async updateMetadata(id: string, input: UpdateDeviceRequest): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    // El dueño debe existir (US-179): valida antes para responder 400 tipado en
    // vez de reventar con la FK (misma clase de fallo que AUD-18).
    if (input.ownerId != null) {
      const owner = await this.app.prisma.user.findUnique({
        where: { id: input.ownerId },
        select: { id: true },
      });
      if (!owner) throw new InventoryError('OWNER_NOT_FOUND', 'El usuario dueño no existe');
    }

    const row = await this.app.prisma.device.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      },
    });

    const device = this.toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Bloquea o desbloquea el acceso a la red de un dispositivo (vía driver). */
  async setBlocked(id: string, blocked: boolean): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    if (blocked) {
      await this.driver.blockDevice(existing.mac);
    } else {
      // No desbloquees si un horario de control parental está activo ahora (US-108):
      // el bloqueo por horario prevalece sobre el desbloqueo manual.
      const keepBlocked = this.scheduleGuard ? await this.scheduleGuard(existing.mac) : false;
      if (keepBlocked) await this.driver.blockDevice(existing.mac);
      else await this.driver.unblockDevice(existing.mac);
    }

    const row = await this.app.prisma.device.update({
      where: { id },
      data: { isBlocked: blocked },
    });

    const device = this.toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Asigna (o quita, con `null`) la VLAN de un dispositivo y emite el cambio. */
  async setVlan(id: string, vlanTag: number | null): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    const row = await this.app.prisma.device.update({
      where: { id },
      data: { vlanTag },
    });

    const device = this.toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /**
   * Asigna (o quita, con `null`) la habitación de un dispositivo de red (US-165)
   * y emite el cambio. Reusa el mapeo/emisión de inventario para que la vista se
   * actualice sola. `RoomService` valida antes que la habitación exista.
   */
  async setRoom(id: string, roomId: string | null): Promise<Device | null> {
    const existing = await this.app.prisma.device.findUnique({ where: { id } });
    if (!existing) return null;

    const row = await this.app.prisma.device.update({
      where: { id },
      data: { roomId },
    });

    const device = this.toDevice(row);
    this.app.io.emit('inventory:device-updated', device);
    return device;
  }

  /** Ejecuta un barrido (ARP + mDNS), persiste cambios y emite eventos en tiempo real. */
  async scan(): Promise<Device[]> {
    const [arpRaw, mdnsRaw] = await Promise.all([this.driver.scanArp(), this.driver.scanMdns()]);

    // Frontera del driver: descarta entradas malformadas antes de tocarlas (US-98).
    const arp = normalizeDiscovered(arpRaw);
    const mdns = normalizeDiscovered(mdnsRaw);
    const dropped = arp.dropped + mdns.dropped;
    if (dropped > 0) {
      this.app.log.warn(
        { dropped },
        '[inventory] el driver devolvió entradas de descubrimiento malformadas; descartadas',
      );
    }

    // Combina ambas fuentes por MAC: une hostname, vendor y orígenes.
    const merged = new Map<string, MergedDevice>();
    for (const d of [...arp.devices, ...mdns.devices]) {
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

    // Anti-flapping (US-98): un barrido que no descubre **nada** casi siempre es
    // un fallo transitorio del driver, no una red realmente vacía (el gateway
    // siempre aparece en ARP). Marcar todo offline en ese caso haría parpadear el
    // inventario entero; mejor omitir el barrido de stale y dejar que el próximo
    // ciclo con datos reconcilie. (Coste asumido: una red de verdad vacía no
    // marca offline hasta el siguiente barrido con al menos un dispositivo.)
    if (merged.size === 0) {
      this.app.log.warn(
        '[inventory] barrido sin dispositivos; se omite el marcado offline (posible fallo transitorio del driver)',
      );
      return this.list();
    }

    // Marca como offline lo que no apareció en este barrido. Una sola escritura
    // (`updateMany`) en vez de un `update` por dispositivo (evita el N+1, US-54);
    // se leen primero las filas afectadas para poder emitir el evento de cada una.
    const onlineMacs = [...merged.keys()];
    const staleWhere = { online: true, mac: { notIn: onlineMacs } } as const;
    const stale = await this.app.prisma.device.findMany({ where: staleWhere });
    if (stale.length > 0) {
      await this.app.prisma.device.updateMany({ where: staleWhere, data: { online: false } });
      for (const row of stale) {
        this.app.io.emit('inventory:device-updated', this.toDevice({ ...row, online: false }));
        this.eventSink?.({ type: 'device-offline', mac: row.mac });
      }
    }

    return this.list();
  }

  private async upsertDiscovered(found: MergedDevice): Promise<void> {
    const { mac } = found;
    const existing = await this.app.prisma.device.findUnique({ where: { mac } });

    const sources = new Set<DiscoverySource>(
      existing ? this.parseSources(existing.sources, mac) : [],
    );
    for (const s of found.sources) sources.add(s);

    const hostname = found.hostname ?? existing?.hostname ?? null;
    // Fabricante: el provisto por el driver tiene prioridad; si no, lookup OUI.
    const vendor = existing?.vendor ?? found.vendor ?? lookupVendor(mac);
    // Tipo: respeta el que haya fijado el usuario; sólo autoinfiere si es 'unknown'.
    const type =
      existing && existing.type !== 'unknown' ? existing.type : inferDeviceType(vendor, hostname);

    const row = await this.app.prisma.device.upsert({
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
    });

    // Dispositivo nuevo (MAC nunca vista): evento de seguridad (auditoría + push, US-45).
    if (!existing) {
      this.app.audit({ action: 'inventory.unknown_device', detail: mac });
      this.eventSink?.({ type: 'device-new', mac });
    } else if (!existing.online) {
      // Transición offline→online (US-167: base de "al llegar a casa").
      this.eventSink?.({ type: 'device-online', mac });
    }

    this.app.io.emit('inventory:device-updated', this.toDevice(row));
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
