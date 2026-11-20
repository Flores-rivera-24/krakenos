/**
 * `node scripts/release/sign-manifest.mjs <carpeta> <versión> [minFrom]`: lee los tres paquetes de la
 * release (.deb amd64/arm64 y el de Arch), escribe `manifest.json` y `manifest.json.sig` (firma ed25519
 * en base64 de los bytes EXACTOS del manifiesto) con la clave PEM PKCS#8 de `UPDATE_SIGNING_KEY`.
 * Lo demás que haya en la carpeta (SHA256SUMS…) no es un artefacto. `minFrom` por defecto: 0.2.0.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLAVE_PUBLICA = fileURLToPath(
  new URL('../../apps/agent/src/system/update-signing-key.ts', import.meta.url),
);

/** La pública embebida en el agente (la que verifican los equipos); `UPDATE_VERIFY_PUBLIC_KEY` solo para pruebas. */
function publicaEmbebida() {
  if (process.env.UPDATE_VERIFY_PUBLIC_KEY) return process.env.UPDATE_VERIFY_PUBLIC_KEY;
  const m = /-----BEGIN PUBLIC KEY-----[^`]+?-----END PUBLIC KEY-----/.exec(
    readFileSync(CLAVE_PUBLICA, 'utf8'),
  );
  if (!m) throw new Error('no se encontró la clave pública embebida en update-signing-key.ts');
  return m[0];
}

const PLATAFORMAS = {
  'deb-amd64': /^krakenos_.+_amd64\.deb$/,
  'deb-arm64': /^krakenos_.+_arm64\.deb$/,
  'arch-x86_64': /^krakenos-.+-x86_64\.pkg\.tar\.zst$/,
};

function main([dir, version, minFrom = '0.2.0']) {
  if (!dir || !version) throw new Error('uso: sign-manifest.mjs <carpeta> <versión> [minFrom]');
  const pem = process.env.UPDATE_SIGNING_KEY;
  if (!pem) {
    throw new Error(
      'falta UPDATE_SIGNING_KEY (clave PEM PKCS#8): una release sin firma no se podría actualizar',
    );
  }
  const archivos = readdirSync(dir);
  const artifacts = Object.entries(PLATAFORMAS).map(([platform, re]) => {
    const casan = archivos.filter((f) => re.test(f));
    if (casan.length !== 1) {
      throw new Error(`se esperaba un archivo para ${platform} y hay ${casan.length} en ${dir}`);
    }
    const name = casan[0];
    const bytes = readFileSync(join(dir, name));
    return {
      name,
      platform,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
  });
  artifacts.sort((a, b) => a.platform.localeCompare(b.platform));
  // Claves ordenadas y sin espacios variables: JSON.stringify compacto con el orden de las literales.
  const manifest = Buffer.from(
    JSON.stringify({ artifacts, minFrom, schema: 1, version }) + '\n',
    'utf8',
  );
  const privada = createPrivateKey(pem);
  const publica = createPublicKey(publicaEmbebida());
  if (privada.asymmetricKeyType !== 'ed25519' || publica.asymmetricKeyType !== 'ed25519') {
    throw new Error('las claves de firma deben ser ed25519');
  }
  const firma = sign(null, manifest, privada);
  // Autoverificación contra la pública que llevan los equipos: un secreto que no casa daría una release «verde»
  // que nadie puede instalar desde la app.
  if (!verify(null, manifest, publica, firma)) {
    throw new Error(
      'UPDATE_SIGNING_KEY no corresponde a la clave pública embebida (update-signing-key.ts): ningún equipo aceptaría esta release',
    );
  }
  const sig = firma.toString('base64');
  writeFileSync(join(dir, 'manifest.json'), manifest);
  writeFileSync(join(dir, 'manifest.json.sig'), sig + '\n');
  console.log(
    `manifest.json (${artifacts.length} artefactos) y manifest.json.sig escritos en ${dir}`,
  );
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(`sign-manifest: ${e.message}`);
  process.exit(1);
}
