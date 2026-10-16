// Siembra una base SINTÉTICA con el cliente de Prisma 5 y escribe el oráculo.
//
// No se ejecuta a mano: lo lanza `generar.mjs` dentro de un directorio temporal donde
// están instalados `prisma@5.22.0` y `@prisma/client@5.22.0` (de ahí su `import`).
// No contiene ningún dato de la casa de nadie: todo está inventado y con fechas fijas.
//
// El oráculo es lo que LEE Prisma 5 de lo que él mismo escribió: el test de la subida
// comprueba que Prisma 7 lee exactamente lo mismo de ese fichero.
import { createECDH, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const [, , oraculoPath] = process.argv;
if (!oraculoPath) throw new Error('Uso: sembrar.mjs <oraculo.json>');

const prisma = new PrismaClient();

// --- Fechas: fijas y con milisegundos distintos de cero (un redondeo a segundos o un
// formato distinto del adaptador se vería enseguida).
const T0 = Date.UTC(2026, 2, 4, 5, 6, 7, 891);
const at = (offsetMs) => new Date(T0 + offsetMs);

// --- Passkey de prueba. La clave privada NO se guarda en ningún sitio: se deriva de
// esta etiqueta (sha256 → escalar P-256) y el test hace lo mismo para firmar. El
// marcador `no-es-un-secreto` está allowlistado en `.gitleaks.toml`.
export const PASSKEY_SEED = 'no-es-un-secreto: passkey sintetica de la fixture de Prisma 5';
const d = createHash('sha256').update(PASSKEY_SEED).digest();
const ecdh = createECDH('prime256v1');
ecdh.setPrivateKey(d);
const pub = ecdh.getPublicKey(); // 0x04 || X || Y
const x = pub.subarray(1, 33);
const y = pub.subarray(33, 65);
// COSE_Key EC2 / ES256 / P-256, CBOR a mano: {1:2, 3:-7, -1:1, -2:x, -3:y}
const cosePublicKey = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  x,
  Buffer.from([0x22, 0x58, 0x20]),
  y,
]);
// Segunda credencial: bytes arbitrarios con 0x00 y 0xff dentro, para el round-trip de Bytes.
const bytesRaros = Buffer.from([0x00, 0xff, 0x10, 0x00, 0x80, 0x7f, 0xff, 0x00, 0x01, 0xfe, 0x00]);

// --- Datos --------------------------------------------------------------------------
await prisma.user.createMany({
  data: [
    {
      id: 'usr-admin',
      email: 'admin@fixture.invalid',
      displayName: 'Admin de prueba',
      passwordHash: '$2b$10$no-es-un-secreto-hash-de-prueba',
      role: 'admin',
      lastLoginAt: at(3_600_123),
      createdAt: at(0),
      updatedAt: at(1),
    },
    {
      id: 'usr-guest',
      email: 'invitado@fixture.invalid',
      displayName: 'Invitado de prueba',
      passwordHash: '$2b$10$no-es-un-secreto-otro-hash',
      role: 'guest',
      expiresAt: at(7 * 86_400_000 + 999),
      createdAt: at(2),
      updatedAt: at(2),
    },
  ],
});

const CRED_ID = 'ZmljdHVyYS1wYXNza2V5LXNpbnRldGljYQ'; // base64url
await prisma.webAuthnCredential.create({
  data: {
    id: 'cred-1',
    userId: 'usr-admin',
    credentialId: CRED_ID,
    publicKey: cosePublicKey,
    counter: 5,
    deviceType: 'multiDevice',
    backedUp: true,
    name: 'Passkey sintética',
    createdAt: at(10_001),
    lastUsedAt: at(20_002),
  },
});
await prisma.webAuthnCredential.create({
  data: {
    id: 'cred-2',
    userId: 'usr-guest',
    credentialId: 'Ymlub3Jpby1yYXJv',
    publicKey: bytesRaros,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    name: 'Bytes raros',
    createdAt: at(30_003),
  },
});
await prisma.webAuthnChallenge.create({
  data: {
    id: 'chl-1',
    userId: 'usr-admin',
    type: 'authenticate',
    challenge: 'ZGVzYWZpby1jYWR1Y2Fkbw',
    expiresAt: at(300_321),
    createdAt: at(1_000),
  },
});
await prisma.refreshToken.create({
  data: {
    id: 'rt-1',
    userId: 'usr-admin',
    tokenHash: 'a'.repeat(64),
    rotatedAt: at(5_005),
    persistent: false,
    expiresAt: at(30 * 86_400_000 + 7),
    createdAt: at(4_004),
  },
});
await prisma.apiToken.create({
  data: {
    id: 'api-1',
    userId: 'usr-admin',
    name: 'Token de prueba',
    tokenHash: 'b'.repeat(64),
    prefix: 'krt_fx01',
    scopes: '["home.control"]',
    role: 'admin',
    lastUsedAt: at(6_006),
    createdAt: at(5_000),
  },
});
await prisma.backupCode.create({
  data: { id: 'bc-1', userId: 'usr-admin', codeHash: 'c'.repeat(64), usedAt: at(8_008) },
});
await prisma.setting.createMany({
  data: [
    { key: 'homeName', value: 'Casa de prueba', updatedAt: at(100_100) },
    { key: 'fixture.marca', value: 'prisma5', updatedAt: at(100_200) },
  ],
});
await prisma.auditLog.createMany({
  data: [
    { id: 'aud-1', action: 'auth.login', userId: 'usr-admin', ip: 'hash', createdAt: at(11) },
    { id: 'aud-2', action: 'device.block', userId: 'usr-admin', detail: '{}', createdAt: at(12) },
    { id: 'aud-3', action: 'wifi.update', createdAt: at(86_400_000 + 13) },
  ],
});
await prisma.device.createMany({
  data: [
    {
      id: 'dev-1',
      mac: 'aa:bb:cc:00:00:01',
      ip: '192.168.1.10',
      hostname: 'tablet-de-prueba',
      ownerId: 'usr-admin',
      pausedUntil: at(900_450),
      firstSeen: at(200),
      lastSeen: at(900_999),
    },
    {
      id: 'dev-2',
      mac: 'aa:bb:cc:00:00:02',
      ip: '192.168.1.11',
      firstSeen: at(201),
      lastSeen: at(202),
    },
  ],
});
await prisma.presenceEvent.create({
  data: { id: 'pe-1', userId: 'usr-admin', kind: 'arrived', createdAt: at(777) },
});
await prisma.dnsQueryLog.createMany({
  data: [
    {
      id: 'dns-1',
      timestamp: at(500),
      domain: 'ejemplo.invalid',
      client: '192.168.1.10',
      blocked: false,
      mac: 'aa:bb:cc:00:00:01',
    },
    {
      id: 'dns-2',
      timestamp: at(500),
      domain: 'ejemplo.invalid',
      client: '192.168.1.10',
      blocked: true,
      mac: 'aa:bb:cc:00:00:01',
    },
    {
      id: 'dns-3',
      timestamp: at(501),
      domain: 'otro.invalid',
      client: '192.168.1.99',
      blocked: false,
    },
  ],
});
await prisma.knownDestination.create({
  data: {
    id: 'kd-1',
    mac: 'aa:bb:cc:00:00:01',
    domain: 'ejemplo.invalid',
    firstSeenAt: at(500),
    lastSeenAt: at(86_400_501),
  },
});
await prisma.recording.create({
  data: {
    id: 'rec-1',
    cameraId: 'cam-1',
    cameraName: 'Cámara de prueba',
    path: 'cam-1/clip.mp4',
    startedAt: at(40_040),
    durationSec: 12,
    sizeBytes: 1_234_567,
    createdAt: at(52_052),
  },
});

// Series de muestras: 30 filas de tráfico a ~1 min (con jitter en ms), flotantes con
// ruido binario (0.1 + 0.2) y extremos (0, 1e-7, 3.4e9).
const jitter = (i) => (i * 37) % 53;
const floats = [0, 1e-7, 0.1 + 0.2, 1234.5678, 3.4e9, 1500, 7.000000000000001];
const rx = (i) => floats[i % floats.length] + i * 0.1;
const tx = (i) => floats[(i + 3) % floats.length] / 3 + i;

await prisma.trafficSample.createMany({
  data: Array.from({ length: 30 }, (_, i) => ({
    id: `ts-${String(i).padStart(2, '0')}`,
    timestamp: at(i * 60_000 + jitter(i)),
    rxBytesPerSec: rx(i),
    txBytesPerSec: tx(i),
  })),
});
await prisma.deviceTrafficSample.createMany({
  data: Array.from({ length: 30 }, (_, i) => ({
    id: `dts-${String(i).padStart(2, '0')}`,
    mac: i % 2 === 0 ? 'aa:bb:cc:00:00:01' : 'aa:bb:cc:00:00:02',
    timestamp: at(i * 60_000 + jitter(i) + 5),
    rxBytesPerSec: rx(i + 1),
    txBytesPerSec: tx(i + 2),
  })),
});
await prisma.energySample.createMany({
  data: Array.from({ length: 30 }, (_, i) => ({
    id: `es-${String(i).padStart(2, '0')}`,
    deviceId: i % 3 === 0 ? 'hue:enchufe-a' : 'tuya:enchufe-b',
    timestamp: at(i * 60_000 + jitter(i) + 9),
    powerW: floats[i % floats.length] / 100 + (i % 5) * 0.37,
  })),
});

// --- Oráculo ------------------------------------------------------------------------
const ser = (v) => {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array)
    return { $bytes: Buffer.from(v).toString('hex') };
  if (typeof v === 'bigint') return { $bigint: v.toString() };
  return v;
};
const serRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, ser(v)]));

const MODELS = [
  ['user', 'User'],
  ['webAuthnCredential', 'WebAuthnCredential'],
  ['webAuthnChallenge', 'WebAuthnChallenge'],
  ['refreshToken', 'RefreshToken'],
  ['apiToken', 'ApiToken'],
  ['backupCode', 'BackupCode'],
  ['setting', 'Setting'],
  ['auditLog', 'AuditLog'],
  ['device', 'Device'],
  ['presenceEvent', 'PresenceEvent'],
  ['dnsQueryLog', 'DnsQueryLog'],
  ['knownDestination', 'KnownDestination'],
  ['recording', 'Recording'],
  ['trafficSample', 'TrafficSample'],
  ['deviceTrafficSample', 'DeviceTrafficSample'],
  ['energySample', 'EnergySample'],
];

const rows = {};
for (const [delegate, table] of MODELS) {
  const key = table === 'Setting' ? 'key' : 'id';
  const found = await prisma[delegate].findMany({ orderBy: { [key]: 'asc' } });
  rows[table] = found.map(serRow);
}

// Lo que hay REALMENTE en el fichero: `typeof` y valor crudo de cada columna DateTime.
const dateColumns = {};
for (const table of Object.keys(rows)) {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT name FROM pragma_table_info('${table}') WHERE type = 'DATETIME'`,
  );
  dateColumns[table] = cols.map((c) => c.name);
}
const rawDates = {};
for (const [table, cols] of Object.entries(dateColumns)) {
  for (const col of cols) {
    const key = table === 'Setting' ? 'key' : 'id';
    const res = await prisma.$queryRawUnsafe(
      `SELECT ${key} AS k, typeof("${col}") AS t, "${col}" AS v FROM "${table}" ORDER BY ${key}`,
    );
    rawDates[`${table}.${col}`] = res.map((r) => ({
      k: r.k,
      t: r.t,
      v: r.v === null ? null : Number(r.v),
    }));
  }
}
for (const [col, filas] of Object.entries(rawDates)) {
  for (const f of filas) {
    if (f.v !== null && f.t !== 'integer')
      throw new Error(`Prisma 5 no guardó ${col} como integer: ${f.t}`);
  }
}

// Agregados: las MISMAS consultas de traffic/wellbeing/energy.service (bucket aritmético).
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const normaliza = (rs) =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])));
const bucketMs = 300_000;
const sinceMs = T0 + 120_000;
const agregados = {
  params: { bucketMs, sinceMs },
  traffic: normaliza(
    await prisma.$queryRaw`
      SELECT (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             AVG(rxBytesPerSec) AS avgRx,
             AVG(txBytesPerSec) AS avgTx,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM TrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY bucket
      ORDER BY bucket ASC`,
  ),
  deviceTraffic: normaliza(
    await prisma.$queryRaw`
      SELECT mac,
             (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             SUM(rxBytesPerSec) AS sumRx,
             SUM(txBytesPerSec) AS sumTx
      FROM DeviceTrafficSample
      WHERE timestamp >= ${sinceMs}
      GROUP BY mac, bucket
      ORDER BY mac ASC, bucket ASC`,
  ),
  energy: normaliza(
    await prisma.$queryRaw`
      SELECT deviceId,
             (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
             SUM(powerW) AS sumPower,
             COUNT(*) AS samples
      FROM EnergySample
      WHERE timestamp >= ${sinceMs}
      GROUP BY deviceId, bucket
      ORDER BY deviceId ASC, bucket ASC`,
  ),
};
// Control positivo del propio oráculo: si el bucket no agrupara, habría tantas filas
// como muestras (28) y el gate de la subida no distinguiría nada.
if (agregados.traffic.length < 3 || agregados.traffic.length > 8) {
  throw new Error(`Oráculo degenerado: ${agregados.traffic.length} buckets de tráfico`);
}

const migraciones = (
  await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name',
  )
).map((r) => r.migration_name);

writeFileSync(
  oraculoPath,
  JSON.stringify(
    {
      generadoCon: `prisma ${JSON.parse(readFileSync(new URL('./node_modules/@prisma/client/package.json', import.meta.url), 'utf8')).version}`,
      t0Ms: T0,
      migraciones,
      passkey: {
        seed: PASSKEY_SEED,
        credentialId: CRED_ID,
        userId: 'usr-admin',
        email: 'admin@fixture.invalid',
        publicKeyHex: cosePublicKey.toString('hex'),
        counter: 5,
      },
      filas: rows,
      fechasCrudas: rawDates,
      agregados,
    },
    null,
    2,
  ) + '\n',
);

// Deja el fichero en modo `delete` y sin -wal: un solo fichero, pequeño y estable.
await prisma.$queryRawUnsafe('PRAGMA journal_mode = DELETE');
await prisma.$disconnect();
