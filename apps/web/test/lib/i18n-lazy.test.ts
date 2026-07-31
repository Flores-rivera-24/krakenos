import { LOCALES, type Locale } from '@krakenos/types';
import { afterEach, describe, expect, it } from 'vitest';
import { changeLocale, ensureCatalog, getLocale, setLocale, t } from '@/lib/i18n';

// El idioma es estado global de módulo: cada test lo restaura.
afterEach(() => setLocale('es', { persist: false }));

/** ¿La promesa está ya resuelta (el catálogo estaba en memoria)? */
async function resuelveEnElActo(p: Promise<void>): Promise<boolean> {
  let listo = false;
  void p.then(() => {
    listo = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return listo;
}

/**
 * US-262 — los dos catálogos i18n (≈19 kB gzip cada uno) viajaban **enteros en
 * el chunk de entrada**, así que quien usa la app en español descargaba también
 * el inglés. Eso tumbaba el gate de presupuesto de bundle en CI.
 *
 * Ahora solo viaja `es` —fuente del copy y fallback de `t()`— y el resto llega
 * por `import()`. Lo delicado no es cargar: es que **nadie se renderice con el
 * idioma nuevo y el catálogo viejo**, porque `t()` es síncrono.
 */
describe('carga perezosa de catálogos (US-262)', () => {
  it('`changeLocale` deja el catálogo listo ANTES de activar el idioma', async () => {
    await changeLocale('en', { persist: false });
    expect(getLocale()).toBe('en');
    // Si el idioma se activara antes de cargar, aquí saldría el español.
    expect(t('nav.devices')).toBe('Devices');
  });

  it('el idioma fuente no se carga: `es` ya viaja en el bundle', async () => {
    expect(await resuelveEnElActo(ensureCatalog('es'))).toBe(true);
  });

  it('cargar un idioma lo deja en memoria: la segunda llamada ya no espera', async () => {
    await ensureCatalog('en');
    // Observable de que la PRIMERA carga sí pobló el catálogo: si no lo hubiera
    // hecho, esta segunda tendría que volver a importar y no resolvería en el acto.
    expect(await resuelveEnElActo(ensureCatalog('en'))).toBe(true);
  });

  it('hay cargador para todo idioma que no sea el fuente', async () => {
    const noFuente = (LOCALES as readonly Locale[]).filter((l) => l !== 'es');
    // Guard de recolección: sin esto, si `LOCALES` se quedara en un solo idioma
    // el bucle no correría y el test pasaría sin comprobar nada.
    expect(noFuente.length).toBeGreaterThanOrEqual(1);

    for (const locale of noFuente) {
      await ensureCatalog(locale);
      // Quedó cargado de verdad (no fue un no-op silencioso).
      expect(await resuelveEnElActo(ensureCatalog(locale))).toBe(true);
      setLocale(locale, { persist: false });
      expect(t('nav.devices')).not.toBe('nav.devices');
    }
  });

  it('un idioma sin catálogo cae al español, NUNCA a la clave cruda', async () => {
    // Simula el chunk que no llega (red caída, despliegue a medias) con un
    // idioma que no tiene catálogo: lo que se ve es texto real en español, no
    // `nav.devices` en pantalla ni un hueco en blanco.
    const desconocido = 'xx' as Locale;
    await ensureCatalog(desconocido); // no explota aunque no haya cargador
    setLocale(desconocido, { persist: false });
    expect(t('nav.devices')).toBe('Dispositivos');
  });
});
