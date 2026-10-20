import { registrarFragmento } from '../../registro';

/**
 * Fragmento «gateway» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/gateway';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esGateway = {
  // --- Bienestar digital (US-184) ---
  // Puerta de enlace por equipo: VPN, cortafuegos y QoS necesitan un helper de Linux.
  'gateway.unsupported.title': 'Este equipo no puede hacer de puerta de enlace',
  'gateway.unsupported.vpn':
    'En Windows, KrakenOS no hace de puerta de enlace: no puede ser el servidor WireGuard. Usa la VPN de tu router, o Tailscale más abajo.',
  'gateway.unsupported.firewall':
    'En Windows, KrakenOS no hace de puerta de enlace: no aplica reglas de cortafuegos. Usa el cortafuegos de tu router.',
  'gateway.unsupported.qos':
    'En Windows, KrakenOS no hace de puerta de enlace: no limita ni prioriza el tráfico. Usa el QoS de tu router.',
  'gateway.setup.title': 'Falta instalar el helper de puerta de enlace',
  'gateway.setup.vpn':
    'Sin el helper privilegiado, KrakenOS no puede crear ni quitar dispositivos de WireGuard. Instálalo con «install.sh --with-helper» en este equipo.',
  'gateway.setup.firewall':
    'Sin el helper privilegiado, KrakenOS no puede aplicar reglas de cortafuegos. Instálalo con «install.sh --with-helper» en este equipo.',
  'gateway.setup.qos':
    'Sin el helper privilegiado, KrakenOS no puede limitar ni priorizar el tráfico. Instálalo con «install.sh --with-helper» en este equipo.',
} as const;

registrarFragmento(esGateway);
