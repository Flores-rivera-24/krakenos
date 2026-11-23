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
