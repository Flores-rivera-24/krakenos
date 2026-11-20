/**
 * `node scripts/release/assemble.mjs <carpeta-descargas> <carpeta-release> <versión>`: reúne los cinco
 * archivos de la release (dos .deb, el paquete de Arch y los dos portables de Linux) y escribe
 * SHA256SUMS (`<hex>  <nombre>`, orden alfabético, compatible con `sha256sum -c`). Si falta alguno o
 * hay más de un paquete de Arch sale con 1 SIN dejar SHA256SUMS: no se publica a medias.
 * Del resto de la descarga (manifiesto, firma, sumas previas) no se copia nada.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parte B añadirá aquí el zip de Windows (`krakenos-<v>-win-x64.zip`) cuando sus enlaces se resuelvan. */
export function expectedAssets(version) {
  return {
    deb: [`krakenos_${version}_amd64.deb`, `krakenos_${version}_arm64.deb`],
    arch: /^krakenos-.+\.pkg\.tar\.zst$/,
    portables: [`krakenos-${version}-linux-x64.tar.gz`, `krakenos-${version}-linux-arm64.tar.gz`],
  };
}

function main([dl, out, version]) {
  if (!dl || !out || !version) throw new Error('uso: assemble.mjs <descargas> <release> <versión>');
  const { deb, arch, portables } = expectedAssets(version);
  const hay = readdirSync(dl);
  const archs = hay.filter((n) => arch.test(n));
  if (archs.length > 1) throw new Error(`más de un .pkg.tar.zst: ${archs.join(', ')}`);
  const faltan = [...deb, ...portables].filter((n) => !hay.includes(n));
  if (archs.length === 0) faltan.push('*.pkg.tar.zst');
  if (faltan.length) throw new Error(`faltan archivos de la release: ${faltan.join(', ')}`);

  const nombres = [...deb, ...archs, ...portables].sort();
  mkdirSync(out, { recursive: true });
  const sumas = nombres.map((n) => {
    copyFileSync(join(dl, n), join(out, n));
    return `${createHash('sha256')
      .update(readFileSync(join(out, n)))
      .digest('hex')}  ${n}\n`;
  });
  writeFileSync(join(out, 'SHA256SUMS'), sumas.join(''));
  process.stdout.write(sumas.join(''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
