import os from 'node:os';

/**
 * Ayuda de arranque (US-105): muestra al primer arranque la URL del asistente de
 * configuración —con el token ya incrustado— y un QR escaneable, para que un
 * usuario no técnico no tenga que rebuscar el token en `journalctl`. No expone nada
 * nuevo: el token ya se imprime en el log (canal out-of-band, US-81).
 */

/** Primera IPv4 no interna (LAN), o `localhost` si no se detecta ninguna. */
export function firstLanIpv4(): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

export interface SetupUrlParts {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  token: string;
}

/** Construye la URL del asistente `/setup` con el token en el query string. */
export function buildSetupUrl(parts: SetupUrlParts): string {
  return `${parts.scheme}://${parts.host}:${parts.port}/setup?token=${encodeURIComponent(parts.token)}`;
}
