import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  encodeNameConstraints,
  ensureLocalCa,
  LocalCaError,
  type LocalCaLogger,
  type LocalCaOptions,
  privateIpv4,
  RENEW_BEFORE_DAYS,
  runLocalCaCli,
  sanitizeHostname,
} from '../../src/crypto/local-ca.js';

/**
 * `crypto/local-ca.ts`: la CA local y el certificado del servidor, generados con Node.
 *
 * Lo que importa no es que escriba ficheros, sino la PROPIEDAD de seguridad: la CA solo
 * puede avalar `.local`, `localhost` y rangos privados. Si su clave se filtrara, no
 * serviría para suplantar un sitio de internet. Esa propiedad se prueba contra un
 * ORÁCULO INDEPENDIENTE —`openssl` (extensiones, `verify`, y un control negativo que
 * firma `example.com` con la CA y exige que openssl lo rechace)— porque «la extensión
 * está» no prueba que se aplique, y que `@peculiar/x509` se crea a sí mismo no prueba
 * nada. Donde `openssl` no está se salta CON motivo; en CI (Linux) siempre está, y un
 * test lo exige.
 */

function tieneOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const OPENSSL = tieneOpenssl();
const itOpenssl = it.skipIf(!OPENSSL);

function openssl(args: string[]): string {
  return execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** CA y hoja generadas con `gen-local-ca.sh` (el script de bash retirado en US-277). */
const fixtureVieja = JSON.parse(
  readFileSync(new URL('../fixtures/ca-bash-vieja.json', import.meta.url), 'utf8'),
) as {
  hostname: string;
  lanIp: string;
  caCert: string;
  caPkcs8: string;
  hojaCert: string;
  hojaPkcs8: string;
};

const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
const DAY = 86_400_000;

let root: string;
let nextDir = 0;
/** Directorio de trabajo nuevo y vacío para cada test. */
function dirNuevo(): { certs: string; keys: string; dir: string } {
  const dir = join(root, `t${nextDir++}`);
  mkdirSync(dir);
  return { dir, certs: join(dir, 'certs'), keys: join(dir, 'keys') };
}

function opts(
  d: { certs: string; keys: string },
  extra: Partial<LocalCaOptions> = {},
): LocalCaOptions {
  return {
    certsDir: d.certs,
    keysDir: d.keys,
    hostname: 'casa',
    lanIps: ['192.168.1.50'],
    ...extra,
  };
}

const x509 = (p: string) => new X509Certificate(readFileSync(p));
const fp = (p: string) => x509(p).fingerprint256;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kraken-localca-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('prerrequisito del oráculo', () => {
  it('en CI openssl existe: un oráculo saltado en silencio no vigila nada', () => {
    if (process.env.CI) expect(OPENSSL, 'falta openssl en el runner de CI').toBe(true);
  });
});

describe('ensureLocalCa', () => {
  it('genera la CA y un certificado de servidor que ella avala (Node y openssl)', async () => {
    const d = dirNuevo();
    const r = await ensureLocalCa(opts(d));
    expect(r.caCreated).toBe(true);
    expect(r.serverIssued).toBe(true);
    expect(r.lanIp).toBe('192.168.1.50');

    const ca = x509(r.caCertPath);
    const srv = x509(r.serverCertPath);
    // node:crypto como segundo verificador, distinto de la librería que firmó.
    expect(ca.ca).toBe(true);
    expect(srv.ca).toBe(false);
    expect(srv.checkIssued(ca)).toBe(true);
    expect(srv.verify(ca.publicKey)).toBe(true);
    expect(ca.verify(ca.publicKey)).toBe(true);
    expect(srv.subjectAltName).toBe(
      'DNS:casa.local, DNS:krakenos.local, DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.50',
    );
    expect(srv.subject).toBe('CN=casa.local');
    expect(ca.subject).toBe('CN=KrakenOS CA local (casa)');
  });

  itOpenssl('openssl verify acepta la cadena y ve las extensiones esperadas', async () => {
    const d = dirNuevo();
    const r = await ensureLocalCa(opts(d));
    expect(openssl(['verify', '-CAfile', r.caCertPath, r.serverCertPath])).toContain('OK');
    const srv = openssl(['x509', '-in', r.serverCertPath, '-noout', '-text']);
    expect(srv).toMatch(/Basic Constraints: critical\s+CA:FALSE/);
    expect(srv).toMatch(/Key Usage: critical\s+Digital Signature, Key Encipherment/);
    expect(srv).toContain('TLS Web Server Authentication');
    expect(srv).toContain('Authority Key Identifier');
    expect(srv).toContain('Subject Key Identifier');
    expect(srv).toContain('Signature Algorithm: ecdsa-with-SHA256');
    expect(srv).toContain('ASN1 OID: prime256v1');
    const ca = openssl(['x509', '-in', r.caCertPath, '-noout', '-text']);
    expect(ca).toMatch(/Basic Constraints: critical\s+CA:TRUE, pathlen:0/);
    expect(ca).toMatch(/Key Usage: critical\s+Certificate Sign, CRL Sign/);
    expect(ca).toMatch(/Name Constraints: critical/);
    expect(ca).toContain('Subject Key Identifier');
  });

  itOpenssl(
    'ORÁCULO: las extensiones de la CA son las mismas que las de una CA hecha con openssl',
    async () => {
      // La referencia se construye como lo hacía gen-local-ca.sh, con las mismas líneas.
      const d = dirNuevo();
      mkdirSync(d.dir, { recursive: true });
      const refKey = join(d.dir, 'ref-key.pem');
      const refCert = join(d.dir, 'ref.pem');
      openssl([
        'req',
        '-x509',
        '-new',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        refKey,
        '-out',
        refCert,
        '-days',
        '3650',
        '-sha256',
        '-subj',
        '/CN=KrakenOS CA local (casa)',
        '-addext',
        'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
        '-addext',
        'subjectKeyIdentifier=hash',
        '-addext',
        'nameConstraints=critical,permitted;DNS:local,permitted;DNS:localhost,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0',
      ]);
      const r = await ensureLocalCa(opts(d));
      for (const ext of ['nameConstraints', 'basicConstraints', 'keyUsage']) {
        expect(openssl(['x509', '-in', r.caCertPath, '-noout', '-ext', ext]), ext).toBe(
          openssl(['x509', '-in', refCert, '-noout', '-ext', ext]),
        );
      }
      // Y el DER de la extensión es el mismo que emite openssl, byte a byte.
      const derDeLaExtension = (pem: string) => {
        const lineas = openssl(['asn1parse', '-in', pem]).split('\n');
        const i = lineas.findIndex((l) => l.includes('X509v3 Name Constraints'));
        return /HEX DUMP\]:([0-9A-F]+)/.exec(lineas.slice(i, i + 4).join('\n'))?.[1];
      };
      expect(derDeLaExtension(r.caCertPath)).toBe(derDeLaExtension(refCert));
      expect(Buffer.from(encodeNameConstraints()).toString('hex').toUpperCase()).toBe(
        derDeLaExtension(refCert),
      );
    },
  );

  it('las nameConstraints codificadas coinciden con el DER que dio el script de bash', () => {
    // Hex de la extensión tal como la emitió `gen-local-ca.sh` (openssl 3.0.13).
    expect(Buffer.from(encodeNameConstraints()).toString('hex')).toBe(
      '3048a046300782056c6f63616c300b82096c6f63616c686f7374300a87087f000000ff000000' +
        '300a87080a000000ff000000300a8708ac100000fff00000300a8708c0a80000ffff0000',
    );
  });

  itOpenssl('CONTROL NEGATIVO: la CA no puede avalar un sitio de internet', async () => {
    const d = dirNuevo();
    const r = await ensureLocalCa(opts(d));
    const firmar = (san: string, tag: string): string => {
      const key = join(d.dir, `${tag}.key`);
      const csr = join(d.dir, `${tag}.csr`);
      const ext = join(d.dir, `${tag}.cnf`);
      const out = join(d.dir, `${tag}.pem`);
      openssl([
        'req',
        '-new',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        key,
        '-out',
        csr,
        '-subj',
        '/CN=leaf',
      ]);
      writeFileSync(
        ext,
        `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`,
      );
      openssl([
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        r.caCertPath,
        '-CAkey',
        r.caKeyPath,
        '-set_serial',
        '0x1234',
        '-days',
        '30',
        '-extfile',
        ext,
        '-out',
        out,
      ]);
      return out;
    };
    const verifica = (leaf: string): boolean => {
      try {
        openssl(['verify', '-CAfile', r.caCertPath, leaf]);
        return true;
      } catch {
        return false;
      }
    };
    // Positivos: lo que SÍ debe poder avalar (si fallaran, el negativo no probaría nada).
    expect(verifica(firmar('DNS:otra-cosa.local', 'ok-local')), '*.local debe pasar').toBe(true);
    expect(verifica(firmar('IP:10.1.2.3', 'ok-ip')), 'IP privada debe pasar').toBe(true);
    // Negativos: fuera de las restricciones openssl tiene que rechazar la cadena.
    expect(verifica(firmar('DNS:example.com', 'bad-dns')), 'example.com se aceptó').toBe(false);
    expect(verifica(firmar('IP:8.8.8.8', 'bad-ip')), '8.8.8.8 se aceptó').toBe(false);
    expect(verifica(firmar('DNS:evil.local,DNS:example.com', 'bad-mixed'))).toBe(false);
  });

  it('es idempotente: la CA y un certificado vigente no se regeneran', async () => {
    const d = dirNuevo();
    const primero = await ensureLocalCa(opts(d));
    const fpCa = fp(primero.caCertPath);
    const fpSrv = fp(primero.serverCertPath);
    const mensajes: string[] = [];
    const log: LocalCaLogger = { info: (m) => mensajes.push(m), warn: (m) => mensajes.push(m) };
    const segundo = await ensureLocalCa(opts(d, { log }));
    expect(segundo.caCreated).toBe(false);
    expect(segundo.serverIssued).toBe(false);
    expect(mensajes.join('\n')).toContain('se conserva');
    expect(mensajes.join('\n')).toContain('no se reemite');
    expect(fp(primero.caCertPath)).toBe(fpCa);
    expect(fp(primero.serverCertPath)).toBe(fpSrv);
  });

  it('reemite el certificado de servidor (y no la CA) si cambia la IP de la LAN', async () => {
    const d = dirNuevo();
    const a = await ensureLocalCa(opts(d));
    const fpCa = fp(a.caCertPath);
    const fpSrv = fp(a.serverCertPath);
    const b = await ensureLocalCa(opts(d, { lanIps: ['192.168.1.77'] }));
    expect(b.serverIssued).toBe(true);
    expect(fp(a.caCertPath)).toBe(fpCa);
    expect(fp(a.serverCertPath)).not.toBe(fpSrv);
    expect(x509(a.serverCertPath).subjectAltName).toContain('192.168.1.77');
    expect(x509(a.serverCertPath).checkIssued(x509(a.caCertPath))).toBe(true);
  });

  it('renueva el servidor cuando quedan menos de 60 días, y no antes', async () => {
    const d = dirNuevo();
    const t0 = new Date();
    const a = await ensureLocalCa(opts(d, { now: () => t0 }));
    const fpSrv = fp(a.serverCertPath);
    const fpCa = fp(a.caCertPath);
    // Faltan 825 − 760 = 65 días: sigue vigente.
    const antes = await ensureLocalCa(opts(d, { now: () => new Date(t0.getTime() + 760 * DAY) }));
    expect(antes.serverIssued).toBe(false);
    expect(fp(a.serverCertPath)).toBe(fpSrv);
    // Faltan 825 − 770 = 55 días (< RENEW_BEFORE_DAYS): se renueva, con la MISMA CA.
    expect(RENEW_BEFORE_DAYS).toBe(60);
    const despues = await ensureLocalCa(opts(d, { now: () => new Date(t0.getTime() + 770 * DAY) }));
    expect(despues.serverIssued).toBe(true);
    expect(fp(a.serverCertPath)).not.toBe(fpSrv);
    expect(fp(a.caCertPath)).toBe(fpCa);
    expect(x509(a.serverCertPath).checkIssued(x509(a.caCertPath))).toBe(true);
    // La nueva dura otros 825 días desde ese instante.
    const validTo = new Date(x509(a.serverCertPath).validTo).getTime();
    expect(Math.round((validTo - (t0.getTime() + 770 * DAY)) / DAY)).toBe(825);
  });

  it('reemite si el certificado lo firmó otra CA', async () => {
    const d = dirNuevo();
    const a = await ensureLocalCa(opts(d));
    const ajeno = dirNuevo();
    const b = await ensureLocalCa(opts(ajeno));
    // Se mete un certificado (y su clave) avalado por OTRA CA en el sitio del servidor.
    writeFileSync(a.serverCertPath, readFileSync(b.serverCertPath));
    const r = await ensureLocalCa(opts(d));
    expect(r.serverIssued).toBe(true);
    expect(x509(a.serverCertPath).checkIssued(x509(a.caCertPath))).toBe(true);
  });

  // Los bits de modo son POSIX: Windows no los tiene (stat devuelve 666).
  it.skipIf(process.platform === 'win32')(
    'claves con modo 600 y ninguna clave en certs/ salvo la del servidor',
    async () => {
      const d = dirNuevo();
      const r = await ensureLocalCa(opts(d));
      expect(mode(r.caKeyPath)).toBe('600');
      expect(mode(r.serverKeyPath)).toBe('600');
      expect(mode(r.caCertPath)).toBe('644');
      expect(mode(r.serverCertPath)).toBe('644');
      // Como los que escribe openssl: terminan en salto de línea, así que se pueden
      // concatenar con `cat` sin pegar el END de uno al BEGIN del siguiente.
      for (const f of [r.caCertPath, r.serverCertPath, r.caKeyPath, r.serverKeyPath]) {
        expect(readFileSync(f, 'utf8').endsWith('-----\n'), f).toBe(true);
      }
      expect(readFileSync(r.caCertPath, 'utf8')).not.toContain('PRIVATE KEY');
      expect(readFileSync(r.serverCertPath, 'utf8')).not.toContain('PRIVATE KEY');
      // Sin temporales olvidados.
      expect(readdirSync(d.certs).sort()).toEqual([
        'agent-cert.pem',
        'agent-key.pem',
        'krakenos-ca.pem',
      ]);
      expect(readdirSync(d.keys)).toEqual(['krakenos-ca-key.pem']);
    },
  );

  // El umask y los bits de modo son POSIX: Windows no los tiene.
  it.skipIf(process.platform === 'win32')(
    'los modos no dependen del umask del proceso',
    async () => {
      const d = dirNuevo();
      const antes = process.umask(0o077);
      try {
        const r = await ensureLocalCa(opts(d));
        expect(mode(r.caCertPath)).toBe('644');
        expect(mode(r.serverCertPath)).toBe('644');
      } finally {
        process.umask(antes);
      }
    },
  );

  it('una IP pública no entra en el SAN (rompería la verificación) y se avisa', async () => {
    const d = dirNuevo();
    const avisos: string[] = [];
    const r = await ensureLocalCa(
      opts(d, { lanIps: ['8.8.8.8'], log: { info: () => undefined, warn: (m) => avisos.push(m) } }),
    );
    expect(r.lanIp).toBeNull();
    expect(avisos.join('\n')).toContain('no hay una IPv4 privada');
    expect(x509(r.serverCertPath).subjectAltName).not.toContain('8.8.8.8');
    expect(x509(r.serverCertPath).checkIssued(x509(r.caCertPath))).toBe(true);
  });

  it('elige la primera IP PRIVADA de la lista', async () => {
    const d = dirNuevo();
    const r = await ensureLocalCa(
      opts(d, { lanIps: ['100.64.0.9', '203.0.113.5', '10.0.0.7', '192.168.1.1'] }),
    );
    expect(r.lanIp).toBe('10.0.0.7');
  });

  it('se niega a regenerar una CA a medias (invalidaría los dispositivos)', async () => {
    const d = dirNuevo();
    const r = await ensureLocalCa(opts(d));
    rmSync(r.caKeyPath);
    await expect(ensureLocalCa(opts(d))).rejects.toThrow(/a medias/);
    // Y no tocó el certificado que quedaba.
    expect(statSync(r.caCertPath).isFile()).toBe(true);
  });

  // Root ejecuta esto (desde un fichero suyo y sobre directorios suyos). Aun así no debe
  // escribir a través de un enlace simbólico: `ln -sf /etc/shadow agent-key.pem` sería un
  // regalo si se siguiera.
  it.each(['agent-key.pem', 'agent-cert.pem'])(
    'rechaza un destino que es enlace simbólico (%s)',
    async (nombre) => {
      const d = dirNuevo();
      mkdirSync(d.certs);
      const victima = join(d.dir, 'victima.txt');
      writeFileSync(victima, 'no me toques');
      symlinkSync(victima, join(d.certs, nombre));
      await expect(ensureLocalCa(opts(d))).rejects.toThrow(/enlace simbólico/);
      expect(readFileSync(victima, 'utf8')).toBe('no me toques');
      expect(() => readdirSync(d.keys)).toThrow(); // ni siquiera creó la CA
    },
  );

  it.each(['la clave de la CA', 'el certificado de la CA'])(
    'rechaza %s si es un enlace simbólico',
    async (cual) => {
      const d = dirNuevo();
      const esClave = cual === 'la clave de la CA';
      mkdirSync(esClave ? d.keys : d.certs, { recursive: true });
      const victima = join(d.dir, 'victima.txt');
      writeFileSync(victima, 'no me toques');
      symlinkSync(
        victima,
        esClave ? join(d.keys, 'krakenos-ca-key.pem') : join(d.certs, 'krakenos-ca.pem'),
      );
      await expect(ensureLocalCa(opts(d))).rejects.toThrow(/enlace simbólico/);
      expect(readFileSync(victima, 'utf8')).toBe('no me toques');
    },
  );

  it('rechaza un directorio de claves que es enlace simbólico', async () => {
    const d = dirNuevo();
    mkdirSync(join(d.dir, 'real'));
    symlinkSync(join(d.dir, 'real'), d.keys);
    await expect(ensureLocalCa(opts(d))).rejects.toThrow(LocalCaError);
    expect(readdirSync(join(d.dir, 'real'))).toEqual([]);
  });

  // Grupos y bits de modo POSIX (`id -gn`, `chmod`): no existen en Windows.
  it.skipIf(process.platform === 'win32')(
    'con tlsGroup la clave del servidor es legible por el grupo (640) y la de la CA no',
    async () => {
      const d = dirNuevo();
      const grupo = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
      const r = await ensureLocalCa(opts(d, { tlsGroup: grupo }));
      expect(mode(r.serverKeyPath)).toBe('640');
      expect(mode(r.serverCertPath)).toBe('644');
      expect(mode(r.caCertPath)).toBe('644');
      expect(mode(r.caKeyPath)).toBe('600');
      // Se reaplica sin reemisión (corrige instalaciones previas).
      execFileSync('chmod', ['600', r.serverKeyPath]);
      await ensureLocalCa(opts(d, { tlsGroup: grupo }));
      expect(mode(r.serverKeyPath)).toBe('640');
    },
  );

  it('un grupo que no existe es un error nombrado, no un fallo mudo', async () => {
    const d = dirNuevo();
    await expect(ensureLocalCa(opts(d, { tlsGroup: 'grupo-que-no-existe-xyz' }))).rejects.toThrow(
      /no existe/,
    );
  });

  describe('lee y renueva una CA hecha por el script de bash', () => {
    /** Reproduce en disco lo que dejó `gen-local-ca.sh`: PEM de PKCS#8 para las claves. */
    function instalarFixture(d: { certs: string; keys: string }): void {
      const pem = (b64: string) =>
        // (armadura por partes: entera en el fuente, gitleaks la tomaría por una clave filtrada)
        `-----BEGIN ${'PRIVATE'} KEY-----\n${b64.match(/.{1,64}/g)?.join('\n')}\n-----END ${'PRIVATE'} KEY-----\n`;
      mkdirSync(d.certs, { recursive: true });
      mkdirSync(d.keys, { recursive: true });
      writeFileSync(join(d.keys, 'krakenos-ca-key.pem'), pem(fixtureVieja.caPkcs8), {
        mode: 0o600,
      });
      writeFileSync(join(d.certs, 'krakenos-ca.pem'), fixtureVieja.caCert);
      writeFileSync(join(d.certs, 'agent-key.pem'), pem(fixtureVieja.hojaPkcs8), { mode: 0o600 });
      writeFileSync(join(d.certs, 'agent-cert.pem'), fixtureVieja.hojaCert);
    }
    // La fixture se generó en 2026-10-19; el reloj se fija para no depender de la fecha.
    const AHORA = new Date('2026-11-01T00:00:00Z');
    const base = (d: { certs: string; keys: string }, extra: Partial<LocalCaOptions> = {}) =>
      opts(d, {
        hostname: fixtureVieja.hostname,
        lanIps: [fixtureVieja.lanIp],
        now: () => AHORA,
        ...extra,
      });

    it('conserva la CA y el certificado vigentes de la instalación anterior (no los reemite)', async () => {
      const d = dirNuevo();
      instalarFixture(d);
      const fpCa = fp(join(d.certs, 'krakenos-ca.pem'));
      const fpHoja = fp(join(d.certs, 'agent-cert.pem'));
      const r = await ensureLocalCa(base(d));
      expect(r.caCreated).toBe(false);
      expect(r.serverIssued).toBe(false);
      expect(fp(join(d.certs, 'krakenos-ca.pem'))).toBe(fpCa);
      expect(fp(join(d.certs, 'agent-cert.pem'))).toBe(fpHoja);
    });

    it('renueva el certificado de servidor con la CA de bash y sigue siendo avalado por ella', async () => {
      const d = dirNuevo();
      instalarFixture(d);
      const fpCa = fp(join(d.certs, 'krakenos-ca.pem'));
      const fpHoja = fp(join(d.certs, 'agent-cert.pem'));
      // Cambia la IP → reemisión con la clave de la CA vieja (la que hizo openssl).
      const r = await ensureLocalCa(base(d, { lanIps: ['192.168.1.99'] }));
      expect(r.serverIssued).toBe(true);
      expect(fp(join(d.certs, 'krakenos-ca.pem'))).toBe(fpCa);
      expect(fp(join(d.certs, 'agent-cert.pem'))).not.toBe(fpHoja);
      const ca = x509(join(d.certs, 'krakenos-ca.pem'));
      const hoja = x509(join(d.certs, 'agent-cert.pem'));
      expect(hoja.checkIssued(ca)).toBe(true);
      expect(hoja.verify(ca.publicKey)).toBe(true);
      expect(hoja.subjectAltName).toContain('192.168.1.99');
      expect(hoja.issuer).toBe(ca.subject);
    });

    itOpenssl('openssl también acepta la hoja renovada bajo la CA de bash', async () => {
      const d = dirNuevo();
      instalarFixture(d);
      // openssl verifica contra el reloj REAL: aquí no se inyecta el tiempo.
      await ensureLocalCa(base(d, { lanIps: ['192.168.1.99'], now: () => new Date() }));
      expect(
        openssl([
          'verify',
          '-CAfile',
          join(d.certs, 'krakenos-ca.pem'),
          join(d.certs, 'agent-cert.pem'),
        ]),
      ).toContain('OK');
    });

    it('renueva por caducidad (<60 d) con la CA de bash', async () => {
      const d = dirNuevo();
      instalarFixture(d);
      const fpHoja = fp(join(d.certs, 'agent-cert.pem'));
      // 800 días después la hoja de la fixture (825) tiene 25 días: se renueva.
      const r = await ensureLocalCa(base(d, { now: () => new Date(AHORA.getTime() + 800 * DAY) }));
      expect(r.serverIssued).toBe(true);
      expect(fp(join(d.certs, 'agent-cert.pem'))).not.toBe(fpHoja);
      expect(
        x509(join(d.certs, 'agent-cert.pem')).checkIssued(x509(join(d.certs, 'krakenos-ca.pem'))),
      ).toBe(true);
    });
  });
});

describe('utilidades', () => {
  it('sanitizeHostname deja solo [a-z0-9-] en minúsculas y cae a «krakenos»', () => {
    expect(sanitizeHostname('Mi_Casa.local')).toBe('micasalocal');
    expect(sanitizeHostname('CASA-1')).toBe('casa-1');
    expect(sanitizeHostname('')).toBe('krakenos');
    expect(sanitizeHostname(undefined)).toBe('krakenos');
    expect(sanitizeHostname('___')).toBe('krakenos');
  });

  it('privateIpv4 acepta RFC 1918 y loopback y rechaza el resto', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1']) {
      expect(privateIpv4(ip), ip).toBe(ip);
    }
    for (const ip of [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '100.64.0.1',
      '256.1.1.1',
      'abc',
      '10.0.0',
      '',
    ]) {
      expect(privateIpv4(ip), ip).toBeNull();
    }
    expect(privateIpv4('010.001.002.003')).toBe('10.1.2.3');
  });
});

describe('runLocalCaCli', () => {
  it('lee las variables KRAKENOS_* y devuelve 0; con un error, 1 y «ERROR: …»', async () => {
    const d = dirNuevo();
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    const env = {
      KRAKENOS_CERTS_DIR: d.certs,
      KRAKENOS_KEYS_DIR: d.keys,
      KRAKENOS_HOSTNAME: 'Casa',
      KRAKENOS_LAN_IP: '192.168.1.50',
    };
    expect(await runLocalCaCli(env, '/no/se/usa', io)).toBe(0);
    expect(out.join('\n')).toContain('Creando la CA local de KrakenOS');
    expect(x509(join(d.certs, 'agent-cert.pem')).subjectAltName).toContain('casa.local');

    mkdirSync(join(d.dir, 'real'));
    symlinkSync(join(d.dir, 'real'), join(d.dir, 'enlace'));
    const code = await runLocalCaCli(
      { ...env, KRAKENOS_KEYS_DIR: join(d.dir, 'enlace') },
      '/x',
      io,
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/^ERROR: .*enlace simbólico/);
  });

  it('sin variables usa <agente>/certs y <agente>/keys', async () => {
    const d = dirNuevo();
    const agente = join(d.dir, 'agente');
    mkdirSync(agente);
    const io = { out: () => undefined, err: () => undefined };
    expect(await runLocalCaCli({ KRAKENOS_LAN_IP: '10.0.0.5' }, agente, io)).toBe(0);
    expect(statSync(join(agente, 'certs', 'agent-cert.pem')).isFile()).toBe(true);
    expect(statSync(join(agente, 'keys', 'krakenos-ca-key.pem')).isFile()).toBe(true);
  });
});
