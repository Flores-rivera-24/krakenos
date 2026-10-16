import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav';
import { changeLocale, setLocale, t } from '@/lib/i18n';
import { tituloDeRuta } from '@/lib/use-route-announce';
import { SRC, sinComentarios } from './_fuentes';

/**
 * Cada vista a la que se llega navegando tiene que anunciarse por su nombre.
 *
 * `TITULOS` (`use-route-announce.ts`) es una tabla escrita a mano aparte de las
 * rutas: la ruta real era `/vlans` y la tabla decía `/vlan`, y `/people` no estaba,
 * así que el lector de pantalla anunciaba «KrakenOS» en las dos y nadie lo notó
 * (la caída a «KrakenOS» es silenciosa a propósito).
 *
 * Las rutas se derivan de `App.tsx` —lo que de verdad se puede navegar: las que
 * cuelgan de `<AppLayout />`— y se cruzan con los `to` de la navegación, para que ni
 * una página sin enlace ni un enlace sin página se queden sin título. Se prefiere
 * `App.tsx` a `NAV_ITEMS` porque es el superconjunto: una página puede existir sin
 * entrada en la nav (o solo en algunos modos), pero no al revés.
 */
function rutasDelLayout(): string[] {
  const app = sinComentarios(readFileSync(join(SRC, 'App.tsx'), 'utf8'));
  const inicio = app.indexOf('<AppLayout />');
  expect(inicio, 'App.tsx ya no cuelga las páginas de <AppLayout />').toBeGreaterThan(-1);
  // El layout cierra en el primer `</Route>` tras sus hijas (que son todas autocierre).
  const cuerpo = app.slice(inicio, app.indexOf('</Route>', inicio));
  const rutas = [...cuerpo.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map((m) => `/${m[1]}`);
  return cuerpo.includes('<Route index') ? ['/', ...rutas] : rutas;
}

describe('títulos de ruta', () => {
  const rutas = rutasDelLayout();

  it('guard: la recolección no está rota (hoy hay 19 vistas navegables)', () => {
    expect(rutas.length).toBeGreaterThanOrEqual(15);
    expect(rutas).toContain('/');
    expect(rutas).toContain('/vlans');
    expect(rutas).toContain('/people');
  });

  it.each(rutas)('%s se anuncia con su nombre y no con «KrakenOS»', (ruta) => {
    expect(tituloDeRuta(ruta)).not.toBe('KrakenOS');
  });

  it('todo enlace de la navegación apunta a una vista con título', () => {
    expect(NAV_ITEMS.length).toBeGreaterThanOrEqual(15);
    for (const item of NAV_ITEMS) {
      expect(rutas, `${item.to} está en la nav pero no es una ruta de App.tsx`).toContain(item.to);
    }
  });

  it('las dos que faltaban dicen su nombre', () => {
    expect(tituloDeRuta('/vlans')).toBe('VLANs');
    expect(tituloDeRuta('/people')).toBe('Personas');
  });

  it('el título de cada vista de la nav es EL MISMO texto que su entrada del menú', async () => {
    // Antes «Automatizaciones», «WiFi» y «VPN y acceso remoto» se anunciaban mientras el
    // menú decía «Rutinas», «Red WiFi» y «VPN»: quien navega con lector oye un nombre y
    // ve otro. El nombre de la ruta es el del menú, en los dos idiomas.
    expect(NAV_ITEMS.length).toBeGreaterThanOrEqual(15);
    for (const idioma of ['es', 'en'] as const) {
      await changeLocale(idioma, { persist: false });
      for (const item of NAV_ITEMS) {
        expect(tituloDeRuta(item.to), `${idioma} ${item.to}`).toBe(t(item.labelKey));
      }
    }
  });

  afterEach(() => setLocale('es', { persist: false }));
});
