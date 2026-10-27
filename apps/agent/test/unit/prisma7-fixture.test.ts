import { createECDH, createHash, createPrivateKey, sign } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/db/client.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { asNumber, bucketStart } from '../../src/db/sql-aggregate.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { WebAuthnService } from '../../src/webauthn/webauthn.service.js';
import {
  copiarFixture,
  leerOraculo,
  type FilaOraculo,
  type Oraculo,
} from '../helpers/prisma5-fixture.js';

/**
 * US-276 — Prisma 7 lee lo que escribió Prisma 5.
 *
 * Una instalación real tiene una base escrita por Prisma 5 (el motor nativo). Tras la
 * subida, el MISMO fichero lo abre Prisma 7 con el adaptador de better-sqlite3. Estos
 * tests comparan, contra el oráculo que Prisma 5 leyó de la fixture sintética
 * (`test/fixtures/prisma5`), que no cambia ni un valor: fechas al milisegundo, `Bytes`,
 * `Float` y las agregaciones en SQL de `db/sql-aggregate.ts`. Y lo inverso: lo que
 * escribe Prisma 7 sigue en el formato que esas agregaciones suponen.
 */

const ser = (v: unknown): unknown => {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('hex') };
  if (typeof v === 'bigint') return { $bigint: v.toString() };
  return v;
};

/** Tabla del oráculo → delegate del cliente y columna por la que se ordenó. */
const TABLAS: [string, string, string][] = [
  ['User', 'user', 'id'],
  ['WebAuthnCredential', 'webAuthnCredential', 'id'],
  ['WebAuthnChallenge', 'webAuthnChallenge', 'id'],
  ['RefreshToken', 'refreshToken', 'id'],
  ['ApiToken', 'apiToken', 'id'],
  ['BackupCode', 'backupCode', 'id'],
  ['Setting', 'setting', 'key'],
  ['AuditLog', 'auditLog', 'id'],
  ['Device', 'device', 'id'],
  ['PresenceEvent', 'presenceEvent', 'id'],
  ['DnsQueryLog', 'dnsQueryLog', 'id'],
  ['KnownDestination', 'knownDestination', 'id'],
  ['Recording', 'recording', 'id'],
  ['TrafficSample', 'trafficSample', 'id'],
  ['DeviceTrafficSample', 'deviceTrafficSample', 'id'],
  ['EnergySample', 'energySample', 'id'],
];

type Delegate = { findMany(args: { orderBy: Record<string, 'asc'> }): Promise<object[]> };

const norm = (rows: Record<string, unknown>[]): Record<string, number>[] =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : asNumber(v)]),
    ),
  ) as Record<string, number>[];

describe('Prisma 7 sobre la fixture escrita por Prisma 5 (US-276)', () => {
  let dir: string;
  let prisma: PrismaClient;
  let oraculo: Oraculo;

  beforeAll(() => {
    oraculo = leerOraculo();
    const copia = copiarFixture();
    dir = copia.dir;
    // Lo que hace el arranque real: el aplicador propio sobre la base heredada. No debe
    // haber nada pendiente (la fixture lleva todas las migraciones vigentes).
    const res = migrateDatabase({
      dbFile: copia.dbFile,
      migrationsDir: fileURLToPath(new URL('../../prisma/migrations', import.meta.url)),
      backupDir: `${dir}/var`,
    });
    expect(res.applied).toEqual([]);
    prisma = createPrismaClient({ databaseUrl: `file:${copia.dbFile}` });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lee las mismas filas que Prisma 5 (fechas al milisegundo, Bytes, Float, booleanos)', async () => {
    let filas = 0;
    for (const [tabla, delegate, clave] of TABLAS) {
      const d = (prisma as unknown as Record<string, Delegate>)[delegate];
      if (!d) throw new Error(`sin delegate ${delegate}`);
      const leidas = (await d.findMany({ orderBy: { [clave]: 'asc' } })) as Record<
        string,
        unknown
      >[];
      const obtenido = leidas.map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ser(v)])),
      );
      expect(obtenido, tabla).toEqual(oraculo.filas[tabla]);
      filas += leidas.length;
    }
    // Guard de tamaño: si la recolección se rompe, el bucle compara listas vacías.
    expect(filas).toBeGreaterThan(100);
    expect(Object.keys(oraculo.filas)).toHaveLength(TABLAS.length);
  });

  it('las fechas del oráculo tienen milisegundos (el test distingue un redondeo a segundos)', () => {
    const conMs = Object.values(oraculo.fechasCrudas)
      .flat()
      .filter((f) => f.v !== null && f.v % 1000 !== 0);
    expect(conMs.length).toBeGreaterThan(20);
  });

  it('`Bytes` sale como Uint8Array con los mismos bytes (también 0x00 y 0xff dentro)', async () => {
    const rows = await prisma.webAuthnCredential.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.publicKey).toBeInstanceOf(Uint8Array);
    const raros = rows.find((r) => r.id === 'cred-2');
    expect(Buffer.from(raros!.publicKey).toString('hex')).toBe('00ff1000807fff0001fe00');
  });

  it('el `typeof` y el valor crudo de cada columna DATETIME no cambian al abrirla con Prisma 7', async () => {
    let comprobadas = 0;
    for (const [tablaColumna, esperadas] of Object.entries(oraculo.fechasCrudas)) {
      const [tabla, columna] = tablaColumna.split('.') as [string, string];
      const clave = tabla === 'Setting' ? 'key' : 'id';
      const reales = await prisma.$queryRawUnsafe<
        { k: string; t: string; v: number | bigint | null }[]
      >(
        `SELECT ${clave} AS k, typeof("${columna}") AS t, "${columna}" AS v FROM "${tabla}" ORDER BY ${clave}`,
      );
      expect(
        reales.map((r) => ({ k: r.k, t: r.t, v: r.v === null ? null : Number(r.v) })),
        tablaColumna,
      ).toEqual(esperadas);
      comprobadas += esperadas.length;
    }
    expect(comprobadas).toBeGreaterThan(100);
  });

  it('las agregaciones de sql-aggregate dan los mismos números que con Prisma 5', async () => {
    const { bucketMs, sinceMs } = oraculo.agregados.params;

    // Las MISMAS consultas que traffic/wellbeing/energy.service (bucket aritmético entero).
    const traffic = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${bucketStart(bucketMs)} AS bucket,
             AVG(rxBytesPerSec) AS avgRx,
             AVG(txBytesPerSec) AS avgTx,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM TrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY bucket
      ORDER BY bucket ASC`;
    const deviceTraffic = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT mac,
             ${bucketStart(bucketMs)} AS bucket,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM DeviceTrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY mac, bucket
      ORDER BY mac ASC, bucket ASC`;
    const energy = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT deviceId,
             ${bucketStart(bucketMs)} AS bucket,
             SUM(powerW) AS sumPower,
             COUNT(*) AS samples
      FROM EnergySample
      WHERE timestamp >= ${sinceMs}
      GROUP BY deviceId, bucket
      ORDER BY deviceId ASC, bucket ASC`;

    expect(norm(traffic)).toEqual(oraculo.agregados.traffic);
    expect(norm(deviceTraffic)).toEqual(oraculo.agregados.deviceTraffic);
    expect(norm(energy)).toEqual(oraculo.agregados.energy);
    // Control positivo: el bucket agrupa de verdad (28 muestras → pocos buckets), y el
    // inicio de cada uno es múltiplo exacto del ancho (aritmética entera, no flotante).
    expect(traffic.length).toBeGreaterThanOrEqual(3);
    expect(traffic.length).toBeLessThanOrEqual(8);
    for (const r of norm(traffic)) expect(r.bucket! % bucketMs).toBe(0);
  });
});

describe('login con una passkey que ya estaba en la base (US-276)', () => {
  let dir: string;
  let prisma: PrismaClient;
  const oraculo = leerOraculo();
  const rpID = 'krakenos.test';
  const origin = 'https://krakenos.test';

  beforeAll(() => {
    const copia = copiarFixture();
    dir = copia.dir;
    prisma = createPrismaClient({ databaseUrl: `file:${copia.dbFile}` });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const b64u = (b: Buffer): string => b.toString('base64url');

  /** Firma una aserción WebAuthn (ES256) con la clave derivada de la semilla de la fixture. */
  function asercion(challenge: string, counter: number, d: Buffer) {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey();
    const key = createPrivateKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: b64u(d),
        x: b64u(pub.subarray(1, 33)),
        y: b64u(pub.subarray(33, 65)),
      },
    });
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    );
    const cnt = Buffer.alloc(4);
    cnt.writeUInt32BE(counter);
    const authData = Buffer.concat([
      createHash('sha256').update(rpID).digest(),
      Buffer.from([0x05]), // UP | UV
      cnt,
    ]);
    const firma = sign(
      'sha256',
      Buffer.concat([authData, createHash('sha256').update(clientData).digest()]),
      { key, dsaEncoding: 'der' },
    );
    return {
      id: oraculo.passkey.credentialId,
      rawId: oraculo.passkey.credentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(firma),
      },
      clientExtensionResults: {},
    };
  }

  const semilla = (): Buffer => createHash('sha256').update(oraculo.passkey.seed).digest();
  const usuario = {
    id: oraculo.passkey.userId,
    email: oraculo.passkey.email,
    displayName: 'Admin',
  };
  const servicio = (): WebAuthnService =>
    new WebAuthnService(prisma, { rpName: 'KrakenOS', rpID, origin });

  it('la clave pública guardada por Prisma 5 verifica una firma real y el contador avanza', async () => {
    // La clave derivada de la semilla ES la que hay en la fila (COSE: x en 10..42, y en 45..77).
    const fila = await prisma.webAuthnCredential.findUniqueOrThrow({
      where: { credentialId: oraculo.passkey.credentialId },
    });
    const cose = Buffer.from(fila.publicKey);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(semilla());
    const pub = ecdh.getPublicKey();
    expect(cose.subarray(10, 42).equals(pub.subarray(1, 33))).toBe(true);
    expect(cose.subarray(45, 77).equals(pub.subarray(33, 65))).toBe(true);

    const svc = servicio();
    const opciones = await svc.generateAuthenticationOptions(usuario);
    expect(opciones).not.toBeNull();
    await svc.verifyAuthentication(usuario, asercion(opciones!.challenge, 6, semilla()));

    const despues = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { id: fila.id } });
    expect(despues.counter).toBe(6);
    expect(despues.lastUsedAt).toBeInstanceOf(Date);
  });

  it('una firma hecha con OTRA clave se rechaza (la verificación usa de verdad los bytes guardados)', async () => {
    const svc = servicio();
    const opciones = await svc.generateAuthenticationOptions(usuario);
    const otra = createHash('sha256').update('otra clave, no-es-un-secreto').digest();
    await expect(
      svc.verifyAuthentication(usuario, asercion(opciones!.challenge, 7, otra)),
    ).rejects.toThrow(/verificar/i);
  });
});

describe('lo que escribe Prisma 7 mantiene el formato que sql-aggregate supone (US-276)', () => {
  let dir: string;
  let prisma: PrismaClient;
  let dbFile: string;

  beforeAll(() => {
    const copia = copiarFixture();
    dir = copia.dir;
    dbFile = copia.dbFile;
    prisma = createPrismaClient({ databaseUrl: `file:${copia.dbFile}` });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  async function crudo(tabla: string, columna: string, id: string) {
    const clave = tabla === 'Setting' ? 'key' : 'id';
    const [fila] = await prisma.$queryRawUnsafe<{ t: string; v: number | bigint }[]>(
      `SELECT typeof("${columna}") AS t, "${columna}" AS v FROM "${tabla}" WHERE ${clave} = '${id}'`,
    );
    return { t: fila!.t, v: Number(fila!.v) };
  }

  it('una fecha explícita se guarda como INTEGER con los milisegundos exactos', async () => {
    const ms = Date.UTC(2027, 0, 2, 3, 4, 5, 678);
    await prisma.trafficSample.create({
      data: { id: 'p7-ts', timestamp: new Date(ms), rxBytesPerSec: 1.5, txBytesPerSec: 2.5 },
    });
    expect(await crudo('TrafficSample', 'timestamp', 'p7-ts')).toEqual({ t: 'integer', v: ms });
  });

  it('también las fechas que pone el cliente por su cuenta (@default(now()) y @updatedAt)', async () => {
    const antes = Date.now();
    await prisma.trafficSample.create({
      data: { id: 'p7-now', rxBytesPerSec: 1, txBytesPerSec: 1 },
    });
    await prisma.setting.create({ data: { key: 'p7.clave', value: 'x' } });
    const despues = Date.now();

    for (const [tabla, col, id] of [
      ['TrafficSample', 'timestamp', 'p7-now'],
      ['Setting', 'updatedAt', 'p7.clave'],
    ] as const) {
      const c = await crudo(tabla, col, id);
      expect(c.t, `${tabla}.${col}`).toBe('integer');
      expect(c.v).toBeGreaterThanOrEqual(antes - 5);
      expect(c.v).toBeLessThanOrEqual(despues + 5);
    }
  });

  it('un filtro por fecha y un update de fecha conservan el formato; null sigue siendo null', async () => {
    const ms = Date.UTC(2027, 5, 6, 7, 8, 9, 10);
    await prisma.user.update({ where: { id: 'usr-admin' }, data: { lastLoginAt: new Date(ms) } });
    expect(await crudo('User', 'lastLoginAt', 'usr-admin')).toEqual({ t: 'integer', v: ms });

    const encontrados = await prisma.user.findMany({
      where: { lastLoginAt: { gte: new Date(ms - 1), lte: new Date(ms + 1) } },
    });
    expect(encontrados.map((u) => u.id)).toEqual(['usr-admin']);

    await prisma.user.update({ where: { id: 'usr-admin' }, data: { lastLoginAt: null } });
    const [nulo] = await prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT typeof("lastLoginAt") AS t FROM "User" WHERE id = 'usr-admin'`,
    );
    expect(nulo!.t).toBe('null');
  });

  it('una fila escrita por Prisma 7 entra en el bucket correcto de una agregación junto a las de Prisma 5', async () => {
    const o = leerOraculo();
    const { bucketMs } = o.agregados.params;
    // Mitad exacta de un bucket que ya existe en el oráculo: tiene que sumarse a él.
    const bucket = (o.agregados.traffic[1] as Record<string, number>).bucket!;
    await prisma.trafficSample.create({
      data: {
        id: 'p7-agg',
        timestamp: new Date(bucket + bucketMs / 2),
        rxBytesPerSec: 1000,
        txBytesPerSec: 0,
      },
    });
    const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${bucketStart(bucketMs)} AS bucket, SUM(rxBytesPerSec) AS sumRx
      FROM TrafficSample WHERE timestamp >= ${bucket} AND timestamp < ${bucket + bucketMs}
      GROUP BY bucket`;
    expect(filas).toHaveLength(1);
    const esperadoPrisma5 = (o.agregados.traffic[1] as Record<string, number>).sumRx!;
    expect(asNumber(filas[0]!.bucket)).toBe(bucket);
    expect(asNumber(filas[0]!.sumRx)).toBeCloseTo(esperadoPrisma5 + 1000, 6);
  });

  it('el fichero queda sin texto en ninguna columna DATETIME', async () => {
    // Barrido de todas las columnas DATETIME de toda la base: ninguna fila `text`.
    const cols = await prisma.$queryRawUnsafe<{ tabla: string; col: string }[]>(
      `SELECT m.name AS tabla, p.name AS col FROM sqlite_master m, pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.type = 'DATETIME'`,
    );
    expect(cols.length).toBeGreaterThan(40);
    for (const { tabla, col } of cols) {
      const [r] = await prisma.$queryRawUnsafe<{ n: number | bigint }[]>(
        `SELECT COUNT(*) AS n FROM "${tabla}" WHERE typeof("${col}") NOT IN ('integer', 'null')`,
      );
      expect(Number(r!.n), `${tabla}.${col}`).toBe(0);
    }
    expect(dbFile).toContain('prisma5.db'); // se ha mirado la copia de la fixture
  });
});

export type { FilaOraculo };
