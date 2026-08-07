import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb } from '../helpers/app.js';
import { NewDestinationService, GRACIA_MS } from '../../src/modules/dns/new-destination.service.js';
import {
  pruneKnownDestinations,
  KNOWN_DESTINATION_RETENTION_DAYS,
} from '../../src/config/retention.js';
import { esperarAuditoria } from '../helpers/audit.js';

/** Aviso de destino nuevo (US-253) — servicio y retención. */

let app: FastifyInstance;
const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.now();

async function conocido(mac: string, domain: string, firstSeenAt: Date, lastSeenAt = firstSeenAt) {
  await app.prisma.knownDestination.create({ data: { mac, domain, firstSeenAt, lastSeenAt } });
}

beforeEach(async () => {
  app = app ?? (await buildTestApp());
  await resetDb(app);
});

afterAll(async () => {
  await app?.close();
});

describe('NewDestinationService', () => {
  it('avisa de un destino nuevo en un aparato ya observado', async () => {
    await app.prisma.device.create({
      data: { mac: 'aa:bb', ip: '192.168.1.50', label: 'Tele del salón' },
    });
    await conocido('aa:bb', 'ya-visto.com', new Date(AHORA - 10 * DIA));
    const service = new NewDestinationService(app, () => AHORA);

    const avisos = await service.procesar([
      { mac: 'aa:bb', domain: 'telemetria.fabricante.com', at: AHORA },
    ]);

    expect(avisos).toBe(1);
    // El aviso nombra al aparato por su etiqueta, no por su MAC.
    const filas = await esperarAuditoria(app, { action: 'dns.new_destination' });
    expect(filas[0]?.detail).toContain('Tele del salón');
    expect(filas[0]?.detail).toContain('fabricante.com');
    // Y queda registrado el dominio REGISTRABLE, no el FQDN completo.
    const guardado = await app.prisma.knownDestination.findFirst({
      where: { mac: 'aa:bb', domain: 'fabricante.com' },
    });
    expect(guardado).not.toBeNull();
    const fqdn = await app.prisma.knownDestination.findFirst({
      where: { domain: 'telemetria.fabricante.com' },
    });
    expect(fqdn).toBeNull();
  });

  it('durante el aprendizaje registra pero NO avisa', async () => {
    await conocido('cc:dd', 'uno.com', new Date(AHORA - 2 * 60 * 60 * 1000));
    const service = new NewDestinationService(app, () => AHORA);

    const avisos = await service.procesar([{ mac: 'cc:dd', domain: 'dos.com', at: AHORA }]);

    expect(avisos).toBe(0);
    expect(await app.prisma.knownDestination.count({ where: { mac: 'cc:dd' } })).toBe(2);
  });

  it('no avisa dos veces del mismo destino', async () => {
    await conocido('ee:ff', 'viejo.com', new Date(AHORA - 10 * DIA));
    const service = new NewDestinationService(app, () => AHORA);
    const consultas = [{ mac: 'ee:ff', domain: 'nuevo.com', at: AHORA }];

    expect(await service.procesar(consultas)).toBe(1);
    // Segundo barrido con la misma consulta: ya consta, no vuelve a avisar. Sin
    // registrar antes de avisar, esto avisaría en bucle en cada barrido.
    expect(await service.procesar(consultas)).toBe(0);
  });

  it('un aparato desconocido no rompe el aviso (cae a la MAC)', async () => {
    await conocido('99:99', 'x.com', new Date(AHORA - 10 * DIA));
    const service = new NewDestinationService(app, () => AHORA);

    expect(await service.procesar([{ mac: '99:99', domain: 'y.com', at: AHORA }])).toBe(1);
    const filas = await esperarAuditoria(app, { action: 'dns.new_destination' });
    expect(filas[0]?.detail).toContain('99:99');
  });
});

describe('retención de destinos conocidos', () => {
  it('olvida lo que no se visita hace meses y CONSERVA lo reciente', async () => {
    // Asimétrico a propósito (1 viejo, 2 recientes): con dos y dos, invertir la
    // condición daría el mismo número.
    await conocido('aa', 'viejo.com', new Date(AHORA - 200 * DIA), new Date(AHORA - 200 * DIA));
    await conocido('aa', 'reciente.com', new Date(AHORA - 200 * DIA), new Date(AHORA - 1 * DIA));
    await conocido('bb', 'otro.com', new Date(AHORA - 2 * DIA), new Date(AHORA - 2 * DIA));

    const borrados = await pruneKnownDestinations(app.prisma, KNOWN_DESTINATION_RETENTION_DAYS);

    expect(borrados).toBe(1);
    const quedan = await app.prisma.knownDestination.findMany({ select: { domain: true } });
    expect(quedan.map((d) => d.domain).sort()).toEqual(['otro.com', 'reciente.com']);
  });

  it('la poda mide desde la ÚLTIMA visita, no desde la primera', async () => {
    // `reciente.com` se vio por primera vez hace 200 días y se sigue visitando.
    // Midiendo desde `firstSeenAt` caducaría y volvería a avisar como si fuera
    // nuevo — el destino más habitual de la casa sería el que más ruido haría.
    await conocido('aa', 'reciente.com', new Date(AHORA - 200 * DIA), new Date(AHORA - 1 * DIA));

    expect(await pruneKnownDestinations(app.prisma, KNOWN_DESTINATION_RETENTION_DAYS)).toBe(0);
  });
});

describe('la gracia es una constante declarada', () => {
  it('vale 24 h', () => {
    expect(GRACIA_MS).toBe(24 * 60 * 60 * 1000);
  });
});
