import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { t, useLocale, type TranslationKey } from '@/lib/i18n';

/**
 * Título legible por ruta. Se mantiene aquí (y no en cada página) porque el
 * anuncio tiene que ocurrir **en el momento de la navegación**, no cuando la
 * página perezosa termina de cargar.
 */
const TITULOS: Record<string, TranslationKey> = {
  '/': 'nav.dashboard',
  '/connect': 'nav.connect',
  '/inventory': 'nav.devices',
  '/wifi': 'nav.wifi',
  '/vpn': 'nav.vpn',
  '/iot': 'nav.iot',
  '/cameras': 'nav.cameras',
  '/traffic': 'nav.traffic',
  '/people': 'nav.people',
  '/energy': 'nav.energy',
  '/rooms': 'nav.rooms',
  '/scenes': 'nav.scenes',
  '/automations': 'nav.automations',
  '/coverage': 'nav.coverage',
  '/firewall': 'nav.firewall',
  '/vlans': 'nav.vlans',
  '/qos': 'nav.qos',
  '/dns': 'nav.dns',
  '/settings': 'nav.settings',
};

/** Nombre de la vista actual, con caída razonable para rutas no listadas. */
export function tituloDeRuta(pathname: string): string {
  const clave = TITULOS[pathname] ?? TITULOS[`/${pathname.split('/')[1] ?? ''}`];
  return clave ? t(clave) : 'KrakenOS';
}

/**
 * Anuncia el cambio de vista y mueve el foco al contenido principal (US-235).
 *
 * En una SPA la navegación **no recarga la página**, así que el navegador no
 * hace nada de lo que hace normalmente: no cambia el título, no reinicia el
 * foco y no anuncia nada. Para alguien con lector de pantalla, pulsar «Cámaras»
 * en la nav no producía ninguna señal audible — el foco se quedaba en el enlace
 * y el contenido cambiaba en silencio detrás. Para alguien navegando con
 * teclado, el siguiente Tab volvía al principio de la navegación en vez de
 * entrar en el contenido nuevo.
 *
 * Se hace lo que haría el navegador: actualizar `document.title` y llevar el
 * foco al `<main>` (que es `tabIndex={-1}`: enfocable por código, no por Tab).
 *
 * También lo que hace el navegador con el scroll: una navegación nueva (PUSH/REPLACE)
 * abre la página arriba, y atrás/adelante (POP) **no se toca** (se queda donde esté).
 * Sin esto, pulsar «Dispositivos» desde Conectar a 1500 px abría la página a medias y
 * con el título fuera de pantalla. El foco va con `preventScroll` para que no sea él
 * quien mueva la página (8 px de salto en escritorio).
 *
 * No se salta el primer render: al entrar directamente por URL el foco ya está
 * donde debe y robarlo sería peor.
 */
export function useRouteAnnounce(mainRef: React.RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const locale = useLocale();
  const tipo = useNavigationType();
  const primeraVez = useRef(true);
  const tipoRef = useRef(tipo);
  tipoRef.current = tipo;

  // El título depende del idioma: un cambio de idioma lo reescribe, pero NO mueve el foco.
  useEffect(() => {
    document.title = `${tituloDeRuta(pathname)} · KrakenOS`;
  }, [pathname, locale]);

  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    if (tipoRef.current !== 'POP') window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
    // `tipo` va por ref: llega en el mismo render que `pathname` y no debe disparar el efecto solo.
  }, [pathname, mainRef]);
}
