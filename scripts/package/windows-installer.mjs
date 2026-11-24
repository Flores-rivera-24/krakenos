import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Partes puras del instalador de Windows (NSIS por el bundler de Tauri). */

/** Nombre del instalador: mismo patrón que los `.deb` (`krakenos_<v>_<arch>.deb`). */
export const installerFileName = (version) => `KrakenOS-Setup-${version}-x64.exe`;

/**
 * Override de `tauri build --config`: el `tauri.conf.json` base sigue con `bundle.active: false`
 * (y sin `tauri.*.conf.json` al lado: lo prohíbe `ventana-sin-ipc.test.ts`). Sin firma, a propósito.
 * Las rutas llevan `/` aunque sean de Windows: Tauri las acepta y el JSON no necesita escapes.
 */
export function buildTauriConfig({ version, payloadDir, hooksPath }) {
  return {
    version,
    bundle: {
      active: true,
      targets: ['nsis'],
      resources: { [`${payloadDir}/`]: './' },
      windows: {
        nsis: {
          installMode: 'perMachine',
          installerHooks: hooksPath,
          languages: ['Spanish', 'English'],
          displayLanguageSelector: false,
        },
      },
    },
  };
}

/** El aviso de las crates de Rust lo genera el job antes de empaquetar: sin él, el instalador saldría sin licencias. */
export function exigirAvisoRust(dir) {
  const fichero = join(dir, 'licenses', 'THIRD-PARTY-RUST.txt');
  if (!existsSync(fichero))
    throw new Error(
      `falta ${fichero}: genéralo antes con «node scripts/package/rust-licenses.mjs apps/window/src-tauri ${join(dir, 'licenses', 'THIRD-PARTY-RUST.txt')}» (necesita cargo)`,
    );
}
