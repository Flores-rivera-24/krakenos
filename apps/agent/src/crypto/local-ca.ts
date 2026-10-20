import 'reflect-metadata';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import * as x509 from '@peculiar/x509';
import {
  applyModeAndGroup,
  assertNotSymlink,
  commitTempFile,
  existsNoFollow,
  removeQuietly,
  resolveGroupId,
  UnsafePathError,
  writeTempFile,
} from './secure-fs.js';

/**
 * CA local de KrakenOS y certificado TLS del agente para la red local, en Node y sin
 * `openssl` (US-277). Sustituye a `gen-local-ca.sh` con el MISMO resultado:
 *
 *   · CA (solo si no existe): EC P-256, 10 años, `basicConstraints` crítica
 *     `CA:TRUE, pathlen:0`, `keyUsage` crítica, SKI/AKI y `nameConstraints` CRÍTICAS:
 *     solo puede avalar `*.local`, `localhost` y rangos privados. Si su clave se filtrara,
 *     NO sirve para suplantar ningún sitio de internet.
 *   · Servidor (si falta, caduca en <60 días, ya no lo avala la CA o cambió el SAN):
 *     EC P-256, 825 días (el máximo que Apple admite), SAN, EKU `serverAuth`, AKI.
 *
 * Lee y renueva una CA creada por el script anterior (misma ruta, mismos formatos): la
 * CA instalada en los dispositivos NO cambia al actualizar KrakenOS.
 *
 * Root nunca ejecuta ni escribe nada que el servicio pueda modificar: el timer de
 * renovación corre como root, así que (a) este módulo se despliega empaquetado en un
 * único fichero en `/usr/local/lib/krakenos/` (`tsup.root.config.ts`), (b) rechaza
 * cualquier destino que sea un enlace simbólico y (c) cambia modo y grupo por descriptor
 * sin seguir enlaces (`secure-fs.ts`).
 */

export const CA_DAYS = 3650;
export const SERVER_DAYS = 825;
export const RENEW_BEFORE_DAYS = 60;
/** Prefijo del CN de la CA (en minúsculas lo reconoce `system/tls.ts`). */
export const CA_COMMON_NAME_PREFIX = 'KrakenOS CA local';

const DAY_MS = 86_400_000;

/** Algo no cuadra y no se debe continuar (equivale al `die` del script). */
export class LocalCaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalCaError';
  }
}

// ------------------------------------------------------------------ nameConstraints

/** Un subárbol permitido de las restricciones de nombre. */
type Subtree = { dns: string } | { ip: string; mask: string };

/**
 * Todo lo que esta CA puede avalar. `local` cubre `*.local`; las IP van como
 * dirección+máscara. Es el seguro de la CA: no se amplía sin una decisión expresa.
 */
export const PERMITTED_SUBTREES: readonly Subtree[] = [
  { dns: 'local' },
  { dns: 'localhost' },
  { ip: '127.0.0.0', mask: '255.0.0.0' },
  { ip: '10.0.0.0', mask: '255.0.0.0' },
  { ip: '172.16.0.0', mask: '255.240.0.0' },
  { ip: '192.168.0.0', mask: '255.255.0.0' },
];

const NAME_CONSTRAINTS_OID = '2.5.29.30';

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n <= 0xff) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}

function der(tag: number, body: readonly number[]): number[] {
  return [tag, ...derLength(body.length), ...body];
}

/**
 * DER de la extensión NameConstraints con solo `permittedSubtrees` (RFC 5280 §4.2.1.10).
 *
 * `@peculiar/x509` no tiene ninguna clase para esta extensión (comprobado en la 2.1.0),
 * pero acepta una extensión genérica con su DER ya hecho. El DER de un tipo tan pequeño y
 * fijo se construye aquí a mano, y el test lo compara byte a byte con el que produce
 * `openssl` para las mismas restricciones.
 */
export function encodeNameConstraints(
  subtrees: readonly Subtree[] = PERMITTED_SUBTREES,
): Uint8Array {
  const generalSubtrees = subtrees.flatMap((s) => {
    // GeneralSubtree ::= SEQUENCE { base GeneralName }  (minimum 0 y maximum ausente por defecto)
    if ('dns' in s) return der(0x30, der(0x82, [...Buffer.from(s.dns, 'ascii')]));
    const octets = [...s.ip.split('.'), ...s.mask.split('.')].map(Number);
    return der(0x30, der(0x87, octets));
  });
  // NameConstraints ::= SEQUENCE { permittedSubtrees [0] IMPLICIT GeneralSubtrees }
  return Uint8Array.from(der(0x30, der(0xa0, generalSubtrees)));
}

// ------------------------------------------------------------------ red y nombres

/** Nombre corto del equipo, saneado para usarlo en un nombre DNS. */
export function sanitizeHostname(raw: string | undefined): string {
  const clean = (raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return clean || 'krakenos';
}

/** Nombre corto del equipo (`hostname -s`). */
export function shortHostname(): string {
  return osHostname().split('.')[0] ?? '';
}

/**
 * IPv4 privada (RFC 1918) o de loopback. Fuera de esos rangos la IP quedaría fuera de las
 * nameConstraints y rompería la verificación. Devuelve la forma canónica o `null`.
 */
export function privateIpv4(ip: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number) as [number, number, number, number];
  if (o.some((n) => n > 255)) return null;
  const [a, b] = o;
  const priv =
    a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return priv ? o.join('.') : null;
}

/** Equivalente a `hostname -I`: las IPv4 de las interfaces que no son de loopback. */
export function localIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ------------------------------------------------------------------ claves

const EC_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;

interface EcKey {
  privatePem: string;
  signing: webcrypto.CryptoKey;
  publicKey: webcrypto.CryptoKey;
}

async function importEcKey(privatePem: string): Promise<EcKey> {
  const priv = createPrivateKey(privatePem);
  if (priv.asymmetricKeyType !== 'ec') {
    throw new LocalCaError('la clave de la CA no es EC (P-256): no se puede usar');
  }
  const pub = createPublicKey(priv);
  return {
    privatePem,
    signing: await webcrypto.subtle.importKey(
      'pkcs8',
      priv.export({ type: 'pkcs8', format: 'der' }),
      EC_ALG,
      false,
      ['sign'],
    ),
    publicKey: await webcrypto.subtle.importKey(
      'spki',
      pub.export({ type: 'spki', format: 'der' }),
      EC_ALG,
      true,
      ['verify'],
    ),
  };
}

async function generateEcKey(): Promise<EcKey> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return importEcKey(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
}

/** Serie aleatoria de 128 bits, siempre positiva y sin cero a la izquierda. */
function randomSerial(): string {
  const b = randomBytes(16);
  b[0] = ((b[0] ?? 0) & 0x7f) | 0x40;
  return b.toString('hex');
}

// ------------------------------------------------------------------ certificados

/**
 * PEM de un certificado, como fichero: la librería lo devuelve SIN salto de línea final y
 * `openssl` siempre lo pone. Sin él, `cat ca.pem otra.pem` pega `-----END CERTIFICATE-----`
 * con el `-----BEGIN` siguiente y el segundo bloque deja de leerse.
 */
function toPemFile(cert: x509.X509Certificate): string {
  return `${cert.toString('pem').trimEnd()}\n`;
}

async function issueCa(key: EcKey, host: string, now: Date): Promise<x509.X509Certificate> {
  const ski = await x509.SubjectKeyIdentifierExtension.create(key.publicKey);
  return x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: `CN=${CA_COMMON_NAME_PREFIX} (${host})`,
    notBefore: now,
    notAfter: new Date(now.getTime() + CA_DAYS * DAY_MS),
    signingAlgorithm: SIGN_ALG,
    keys: { privateKey: key.signing, publicKey: key.publicKey },
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      ski,
      new x509.AuthorityKeyIdentifierExtension(ski.keyId),
      new x509.Extension(NAME_CONSTRAINTS_OID, true, encodeNameConstraints()),
    ],
  });
}

async function issueServerCert(
  caCert: x509.X509Certificate,
  caKey: EcKey,
  serverKey: EcKey,
  host: string,
  sanNames: readonly { type: 'dns' | 'ip'; value: string }[],
  now: Date,
): Promise<x509.X509Certificate> {
  const caSki =
    caCert.getExtension(x509.SubjectKeyIdentifierExtension)?.keyId ??
    (await x509.SubjectKeyIdentifierExtension.create(caCert.publicKey)).keyId;
  return x509.X509CertificateGenerator.create({
    serialNumber: randomSerial(),
    subject: `CN=${host}.local`,
    // Se reutiliza el nombre del emisor tal como está en la CA (también si la hizo bash):
    // la cadena se construye comparando estos bytes.
    issuer: caCert.subjectName,
    notBefore: now,
    notAfter: new Date(now.getTime() + SERVER_DAYS * DAY_MS),
    signingAlgorithm: SIGN_ALG,
    publicKey: serverKey.publicKey,
    signingKey: caKey.signing,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      await x509.SubjectKeyIdentifierExtension.create(serverKey.publicKey),
      new x509.AuthorityKeyIdentifierExtension(caSki),
      new x509.SubjectAlternativeNameExtension([...sanNames]),
    ],
  });
}

/** SAN en la forma que imprime OpenSSL, sin espacios y con `IP:` en vez de `IP Address:`. */
function normalizeSan(san: string | undefined): string {
  return (san ?? '').replace(/\s+/g, '').replaceAll('IPAddress:', 'IP:');
}

// ------------------------------------------------------------------ orquestación

export interface LocalCaLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface LocalCaOptions {
  certsDir: string;
  keysDir: string;
  /** Nombre del equipo (sin sanear). Por defecto, `hostname -s`. */
  hostname?: string;
  /** IP candidatas de la LAN; gana la primera PRIVADA. Por defecto, las del equipo. */
  lanIps?: readonly string[];
  /** Grupo (el del servicio) que debe poder LEER el certificado y la clave del servidor. */
  tlsGroup?: string;
  now?: () => Date;
  log?: LocalCaLogger;
}

export interface LocalCaResult {
  caCreated: boolean;
  serverIssued: boolean;
  lanIp: string | null;
  caCertPath: string;
  caKeyPath: string;
  serverCertPath: string;
  serverKeyPath: string;
}

const SILENT: LocalCaLogger = { info: () => undefined, warn: () => undefined };

/** Crea la CA (si no existe) y emite o renueva el certificado del servidor. Idempotente. */
export async function ensureLocalCa(opts: LocalCaOptions): Promise<LocalCaResult> {
  const log = opts.log ?? SILENT;
  const now = (opts.now ?? (() => new Date()))();
  const certsDir = resolve(opts.certsDir);
  const keysDir = resolve(opts.keysDir);
  const caKeyPath = join(keysDir, 'krakenos-ca-key.pem');
  const caCertPath = join(certsDir, 'krakenos-ca.pem');
  const serverKeyPath = join(certsDir, 'agent-key.pem');
  const serverCertPath = join(certsDir, 'agent-cert.pem');

  const host = sanitizeHostname(opts.hostname ?? shortHostname());

  let lanIp: string | null = null;
  for (const candidate of opts.lanIps ?? localIpv4Addresses()) {
    const ip = privateIpv4(candidate);
    if (ip) {
      lanIp = ip;
      break;
    }
  }
  if (!lanIp) {
    log.warn(
      `no hay una IPv4 privada de LAN: el certificado NO incluirá IP (se entra por ${host}.local)`,
    );
  }

  // Ni los directorios ni los ficheros destino pueden ser enlaces simbólicos.
  try {
    for (const target of [
      certsDir,
      keysDir,
      caKeyPath,
      caCertPath,
      serverKeyPath,
      serverCertPath,
    ]) {
      assertNotSymlink(target);
    }
  } catch (err) {
    throw err instanceof UnsafePathError ? new LocalCaError(err.message) : err;
  }

  mkdirSync(certsDir, { recursive: true, mode: 0o700 });
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });

  // --- CA ----------------------------------------------------------------
  let caCreated = false;
  let caKey: EcKey;
  let caCert: x509.X509Certificate;
  const haveKey = existsNoFollow(caKeyPath);
  const haveCert = existsNoFollow(caCertPath);
  if (haveKey && haveCert) {
    log.info(`CA ya existente: se conserva (${caCertPath})`);
    caKey = await importEcKey(readFileSync(caKeyPath, 'utf8'));
    caCert = new x509.X509Certificate(readFileSync(caCertPath, 'utf8'));
  } else if (haveKey || haveCert) {
    // Una mitad sola: regenerar la otra invalidaría los certificados ya instalados en los
    // dispositivos sin avisar.
    throw new LocalCaError(
      `la CA está a medias (¿falta ${caKeyPath} o ${caCertPath}?): restaura el par o bórralos ambos a conciencia`,
    );
  } else {
    log.info('Creando la CA local de KrakenOS…');
    caKey = await generateEcKey();
    caCert = await issueCa(caKey, host, now);
    const keyTmp = writeTempFile(caKeyPath, caKey.privatePem, 0o600);
    let certTmp: string;
    try {
      certTmp = writeTempFile(caCertPath, toPemFile(caCert), 0o644);
    } catch (err) {
      removeQuietly(keyTmp);
      throw err;
    }
    commitTempFile(keyTmp, caKeyPath);
    commitTempFile(certTmp, caCertPath);
    caCreated = true;
  }

  // --- Certificado de servidor -------------------------------------------
  const sanNames: { type: 'dns' | 'ip'; value: string }[] = [
    { type: 'dns', value: `${host}.local` },
    { type: 'dns', value: 'krakenos.local' },
    { type: 'dns', value: 'localhost' },
    { type: 'ip', value: '127.0.0.1' },
  ];
  if (lanIp) sanNames.push({ type: 'ip', value: lanIp });
  const expectedSan = sanNames
    .map((n) => `${n.type === 'dns' ? 'DNS' : 'IP'}:${n.value}`)
    .join(',');

  let serverIssued = false;
  if (
    serverNeedsIssue({
      serverKeyPath,
      serverCertPath,
      caCertPem: caCert.toString('pem'),
      expectedSan,
      now,
    })
  ) {
    log.info(`Emitiendo el certificado del servidor (SAN: ${expectedSan})…`);
    const serverKey = await generateEcKey();
    const cert = await issueServerCert(caCert, caKey, serverKey, host, sanNames, now);
    // Todo se escribe a temporales y se publica al final: nunca queda un par a medias si
    // algo falla antes.
    const keyTmp = writeTempFile(serverKeyPath, serverKey.privatePem, 0o600);
    let certTmp: string;
    try {
      certTmp = writeTempFile(serverCertPath, toPemFile(cert), 0o644);
    } catch (err) {
      removeQuietly(keyTmp);
      throw err;
    }
    commitTempFile(keyTmp, serverKeyPath);
    commitTempFile(certTmp, serverCertPath);
    serverIssued = true;
    log.info(`Certificado emitido: ${serverCertPath}`);
  } else {
    log.info('El certificado del servidor sigue vigente: no se reemite');
  }

  // Permisos del par servido: el servicio lee por GRUPO, no es dueño. Se reaplican siempre
  // (también si no hubo reemisión) para corregir instalaciones previas.
  if (opts.tlsGroup) {
    let gid: number;
    try {
      gid = resolveGroupId(opts.tlsGroup);
    } catch (err) {
      throw new LocalCaError(err instanceof Error ? err.message : String(err));
    }
    applyModeAndGroup(serverKeyPath, 0o640, gid);
    applyModeAndGroup(serverCertPath, 0o644, gid);
    applyModeAndGroup(caCertPath, 0o644, gid);
  }

  log.info(`Certificado de la CA (el que cada dispositivo debe instalar): ${caCertPath}`);
  return { caCreated, serverIssued, lanIp, caCertPath, caKeyPath, serverCertPath, serverKeyPath };
}

/**
 * ¿Hay que (re)emitir? Falta, caduca pronto, ya no lo avala esta CA o su SAN dejó de
 * coincidir con lo que hoy se sirve (cambió la IP o el nombre del equipo).
 */
function serverNeedsIssue(a: {
  serverKeyPath: string;
  serverCertPath: string;
  caCertPem: string;
  expectedSan: string;
  now: Date;
}): boolean {
  if (!existsNoFollow(a.serverKeyPath) || !existsNoFollow(a.serverCertPath)) return true;
  let cert: X509Certificate;
  let ca: X509Certificate;
  try {
    cert = new X509Certificate(readFileSync(a.serverCertPath));
    ca = new X509Certificate(a.caCertPem);
  } catch {
    return true; // ilegible: se reemite
  }
  const t = a.now.getTime();
  if (new Date(cert.validTo).getTime() - t < RENEW_BEFORE_DAYS * DAY_MS) return true;
  if (new Date(cert.validFrom).getTime() > t) return true;
  // Equivalente a `openssl verify -CAfile ca cert`: emisor, firma y vigencia de la CA.
  if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return true;
  if (new Date(ca.validFrom).getTime() > t || new Date(ca.validTo).getTime() < t) return true;
  return normalizeSan(cert.subjectAltName) !== a.expectedSan;
}

// ------------------------------------------------------------------ CLI

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * `node local-ca.js`. Variables (instalador y tests): `KRAKENOS_CERTS_DIR` ·
 * `KRAKENOS_KEYS_DIR` · `KRAKENOS_HOSTNAME` · `KRAKENOS_LAN_IP` · `KRAKENOS_TLS_GROUP`.
 * Devuelve el código de salida.
 */
export async function runLocalCaCli(
  env: NodeJS.ProcessEnv,
  agentDir: string,
  io: CliIo,
): Promise<number> {
  try {
    await ensureLocalCa({
      certsDir: env.KRAKENOS_CERTS_DIR || join(agentDir, 'certs'),
      keysDir: env.KRAKENOS_KEYS_DIR || join(agentDir, 'keys'),
      hostname: env.KRAKENOS_HOSTNAME || undefined,
      lanIps: env.KRAKENOS_LAN_IP ? env.KRAKENOS_LAN_IP.split(/\s+/).filter(Boolean) : undefined,
      tlsGroup: env.KRAKENOS_TLS_GROUP || undefined,
      log: { info: (m) => io.out(m), warn: (m) => io.err(`AVISO: ${m}`) },
    });
    return 0;
  } catch (err) {
    io.err(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
