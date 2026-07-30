import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Título legible por ruta. Se mantiene aquí (y no en cada página) porque el
 * anuncio tiene que ocurrir **en el momento de la navegación**, no cuando la
 * página perezosa termina de cargar.
 */
const TITULOS: Record<string, string> = {
  '/': 'Dashboard',
  '/connect': 'Conectar',
  '/inventory': 'Dispositivos',
  '/wifi': 'WiFi',
  '/vpn': 'VPN y acceso remoto',
  '/iot': 'IoT',
  '/cameras': 'Cámaras',
  '/traffic': 'Tráfico',
  '/energy': 'Energía',
  '/rooms': 'Habitaciones',
  '/scenes': 'Escenas',
  '/automations': 'Automatizaciones',
  '/coverage': 'Cobertura WiFi',
  '/firewall': 'Firewall',
  '/vlan': 'VLANs',
  '/qos': 'QoS',
  '/dns': 'DNS',
  '/settings': 'Ajustes',
};

/** Nombre de la vista actual, con caída razonable para rutas no listadas. */
export function tituloDeRuta(pathname: string): string {
  return TITULOS[pathname] ?? TITULOS[`/${pathname.split('/')[1] ?? ''}`] ?? 'KrakenOS';
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
 * No se salta el primer render: al entrar directamente por URL el foco ya está
 * donde debe y robarlo sería peor.
 */
export function useRouteAnnounce(mainRef: React.RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const primeraVez = useRef(true);

  useEffect(() => {
    const titulo = tituloDeRuta(pathname);
    document.title = `${titulo} · KrakenOS`;

    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname, mainRef]);
}
