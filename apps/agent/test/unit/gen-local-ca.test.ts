import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `gen-local-ca.sh` ejecutado de verdad (bash + openssl reales) en un tmpdir.
 *
 * Lo que importa aquí no es que genere ficheros, sino la PROPIEDAD de seguridad:
 * la CA solo puede avalar `.local`, `localhost` y rangos privados. Si su clave se
 * filtrara, no serviría para suplantar un sitio de internet. Esa propiedad se
 * prueba con un **control negativo** (firmar `example.com` con esa CA y exigir que
 * openssl lo rechace), porque «tiene la extensión» no prueba que se aplique.
 */
const SCRIPT = fileURLToPath(new URL('../../scripts/gen-local-ca.sh', import.meta.url));

let root: string;
let certs: string;
let keys: string;

function gen(extraEnv: Record<string, string> = {}): string {
  return execFileSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KRAKENOS_CERTS_DIR: certs,
      KRAKENOS_KEYS_DIR: keys,
      KRAKENOS_HOSTNAME: 'casa',
      KRAKENOS_LAN_IP: '192.168.1.50',
      ...extraEnv,
    },
  });
}

function openssl(args: string[]): string {
  return execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const fingerprint = (pem: string) =>
  openssl(['x509', '-in', pem, '-noout', '-fingerprint', '-sha256']);
const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

/** Firma con la CA un certificado de hoja con el SAN dado (openssl directo). */
function signLeaf(san: string, tag: string): string {
  const key = join(root, `${tag}.key`);
  const csr = join(root, `${tag}.csr`);
  const ext = join(root, `${tag}.cnf`);
  const out = join(root, `${tag}.pem`);
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
    join(certs, 'krakenos-ca.pem'),
    '-CAkey',
    join(keys, 'krakenos-ca-key.pem'),
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
}

function verifies(leaf: string): boolean {
  try {
    openssl(['verify', '-CAfile', join(certs, 'krakenos-ca.pem'), leaf]);
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kraken-ca-'));
  certs = join(root, 'certs');
  keys = join(root, 'keys');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('gen-local-ca.sh', () => {
  it('genera la CA y un certificado de servidor que ella avala', () => {
    gen();
    const ca = join(certs, 'krakenos-ca.pem');
    const srv = join(certs, 'agent-cert.pem');
    expect(openssl(['verify', '-CAfile', ca, srv])).toContain('OK');
    const san = openssl(['x509', '-in', srv, '-noout', '-ext', 'subjectAltName']);
    for (const s of ['casa.local', 'krakenos.local', 'localhost', '127.0.0.1', '192.168.1.50']) {
      expect(san, `SAN sin ${s}`).toContain(s);
    }
    const text = openssl(['x509', '-in', srv, '-noout', '-text']);
    expect(text).toContain('CA:FALSE');
    expect(text).toContain('TLS Web Server Authentication');
  });

  it('la CA es CA:TRUE con pathlen 0 y Name Constraints CRÍTICAS', () => {
    const text = openssl(['x509', '-in', join(certs, 'krakenos-ca.pem'), '-noout', '-text']);
    expect(text).toMatch(/Basic Constraints: critical\s+CA:TRUE, pathlen:0/);
    expect(text).toMatch(/Name Constraints: critical/);
    expect(text).toContain('DNS:local');
    expect(text).toContain('IP:192.168.0.0/255.255.0.0');
  });

  it('CONTROL NEGATIVO: la CA no puede avalar un sitio de internet', () => {
    // Positivos: lo que SÍ debe poder avalar (si fallaran, el negativo no prueba nada).
    expect(verifies(signLeaf('DNS:otra-cosa.local', 'ok-local')), '*.local debe pasar').toBe(true);
    expect(verifies(signLeaf('IP:10.1.2.3', 'ok-ip')), 'IP privada debe pasar').toBe(true);
    // Negativos: fuera de las restricciones openssl tiene que rechazar la cadena.
    expect(verifies(signLeaf('DNS:example.com', 'bad-dns')), 'example.com se aceptó').toBe(false);
    expect(verifies(signLeaf('IP:8.8.8.8', 'bad-ip')), '8.8.8.8 se aceptó').toBe(false);
    expect(
      verifies(signLeaf('DNS:evil.local,DNS:example.com', 'bad-mixed')),
      'SAN mixto se aceptó',
    ).toBe(false);
  });

  it('es idempotente: la CA y un certificado vigente no se regeneran', () => {
    const ca = join(certs, 'krakenos-ca.pem');
    const srv = join(certs, 'agent-cert.pem');
    const fpCa = fingerprint(ca);
    const fpSrv = fingerprint(srv);
    const out = gen();
    expect(out).toContain('se conserva');
    expect(out).toContain('no se reemite');
    expect(fingerprint(ca)).toBe(fpCa);
    expect(fingerprint(srv)).toBe(fpSrv);
  });

  it('reemite el certificado de servidor (y no la CA) si cambia la IP de la LAN', () => {
    const ca = join(certs, 'krakenos-ca.pem');
    const srv = join(certs, 'agent-cert.pem');
    const fpCa = fingerprint(ca);
    const fpSrv = fingerprint(srv);
    gen({ KRAKENOS_LAN_IP: '192.168.1.77' });
    expect(fingerprint(ca)).toBe(fpCa);
    expect(fingerprint(srv)).not.toBe(fpSrv);
    expect(openssl(['x509', '-in', srv, '-noout', '-ext', 'subjectAltName'])).toContain(
      '192.168.1.77',
    );
    expect(openssl(['verify', '-CAfile', ca, srv])).toContain('OK');
  });

  it('claves privadas con modo 600 y ninguna clave en certs/ salvo la del servidor', () => {
    expect(mode(join(keys, 'krakenos-ca-key.pem'))).toBe('600');
    expect(mode(join(certs, 'agent-key.pem'))).toBe('600');
    // El certificado público de la CA es lo único que se reparte.
    expect(readFileSync(join(certs, 'krakenos-ca.pem'), 'utf8')).not.toContain('PRIVATE KEY');
  });

  it('una IP pública no entra en el SAN (rompería la verificación) y se avisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-ca-pub-'));
    try {
      const out = execFileSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: {
          ...process.env,
          KRAKENOS_CERTS_DIR: join(dir, 'c'),
          KRAKENOS_KEYS_DIR: join(dir, 'k'),
          KRAKENOS_HOSTNAME: 'casa',
          KRAKENOS_LAN_IP: '8.8.8.8',
        },
      });
      expect(out).not.toContain('8.8.8.8');
      const srv = join(dir, 'c', 'agent-cert.pem');
      expect(openssl(['x509', '-in', srv, '-noout', '-ext', 'subjectAltName'])).not.toContain(
        '8.8.8.8',
      );
      expect(openssl(['verify', '-CAfile', join(dir, 'c', 'krakenos-ca.pem'), srv])).toContain(
        'OK',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('se niega a regenerar una CA a medias (invalidaría los dispositivos)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-ca-half-'));
    try {
      const env = {
        ...process.env,
        KRAKENOS_CERTS_DIR: join(dir, 'c'),
        KRAKENOS_KEYS_DIR: join(dir, 'k'),
        KRAKENOS_HOSTNAME: 'casa',
        KRAKENOS_LAN_IP: '192.168.1.50',
      };
      execFileSync('bash', [SCRIPT], { env });
      rmSync(join(dir, 'k', 'krakenos-ca-key.pem'));
      expect(() => execFileSync('bash', [SCRIPT], { env, stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Root ejecuta este script (desde una copia suya y sobre directorios de root). Aun
  // así no debe escribir a través de un enlace simbólico: openssl, chmod y chgrp
  // los siguen, y ahí `ln -sf /etc/shadow agent-key.pem` sería un regalo.
  it.each(['agent-key.pem', 'agent-cert.pem'])(
    'rechaza un destino que es enlace simbólico (%s)',
    (nombre) => {
      const dir = mkdtempSync(join(tmpdir(), 'kraken-ca-ln-'));
      try {
        const certsDir = join(dir, 'c');
        mkdirSync(certsDir);
        const victima = join(dir, 'victima.txt');
        writeFileSync(victima, 'no me toques');
        symlinkSync(victima, join(certsDir, nombre));
        const env = {
          ...process.env,
          KRAKENOS_CERTS_DIR: certsDir,
          KRAKENOS_KEYS_DIR: join(dir, 'k'),
          KRAKENOS_HOSTNAME: 'casa',
          KRAKENOS_LAN_IP: '192.168.1.50',
        };
        let stderr = '';
        try {
          execFileSync('bash', [SCRIPT], { env, stdio: 'pipe' });
        } catch (e) {
          stderr = String((e as { stderr?: Buffer }).stderr ?? '');
        }
        expect(stderr).toContain('enlace simbólico');
        expect(readFileSync(victima, 'utf8')).toBe('no me toques');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('rechaza un directorio de claves que es enlace simbólico', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-ca-lnd-'));
    try {
      mkdirSync(join(dir, 'real'));
      symlinkSync(join(dir, 'real'), join(dir, 'k'));
      expect(() =>
        execFileSync('bash', [SCRIPT], {
          env: {
            ...process.env,
            KRAKENOS_CERTS_DIR: join(dir, 'c'),
            KRAKENOS_KEYS_DIR: join(dir, 'k'),
            KRAKENOS_HOSTNAME: 'casa',
            KRAKENOS_LAN_IP: '192.168.1.50',
          },
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('con KRAKENOS_TLS_GROUP la clave del servidor es legible por el grupo (640) y la de la CA no', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-ca-grp-'));
    try {
      const grupo = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
      execFileSync('bash', [SCRIPT], {
        env: {
          ...process.env,
          KRAKENOS_CERTS_DIR: join(dir, 'c'),
          KRAKENOS_KEYS_DIR: join(dir, 'k'),
          KRAKENOS_HOSTNAME: 'casa',
          KRAKENOS_LAN_IP: '192.168.1.50',
          KRAKENOS_TLS_GROUP: grupo,
        },
        stdio: 'pipe',
      });
      expect(mode(join(dir, 'c', 'agent-key.pem'))).toBe('640');
      expect(mode(join(dir, 'c', 'agent-cert.pem'))).toBe('644');
      expect(mode(join(dir, 'k', 'krakenos-ca-key.pem'))).toBe('600');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
