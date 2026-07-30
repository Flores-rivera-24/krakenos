import { X509Certificate } from 'node:crypto';
import type { TlsDisabledFeature, TlsSource } from '@krakenos/types';

/**
 * Lógica **pura** del certificado TLS (US-241): leer su validez, clasificar su
 * origen y decidir cuándo avisar. Sin E/S ni reloj implícito — el fichero lo lee
 * el servicio, aquí solo entra el PEM ya leído.
 *
 * Por qué existe: hasta ahora el cert se leía **una vez al arrancar**
 * (`config/env.ts`, `readFileSync`) y nadie volvía a mirarlo. Con un certificado
 * de Tailscale, que vive **90 días**, eso significa que la instalación se rompe
 * sola tres meses después de montarla y el usuario se entera cuando el móvil deja
 * de conectar — sin un solo aviso previo.
 */

/** Días de antelación con los que se empieza a avisar. */
export const TLS_WARN_DAYS = 21;

/** Ventana de validez de un certificado. */
export interface CertificateValidity {
  notBefore: Date;
  notAfter: Date;
  /** CN/SAN principal, para clasificar el origen. */
  subject: string;
  /** Emisor, tal cual lo declara el certificado. */
  issuer: string;
}

/**
 * Extrae la validez de un certificado en PEM. Devuelve `null` si no se puede
 * parsear: un cert corrupto **no puede** tumbar el arranque ni el barrido, porque
 * el servidor ya está sirviendo con lo que tenga cargado.
 */
export function readCertificateValidity(pem: string): CertificateValidity | null {
  try {
    const cert = new X509Certificate(pem);
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);
    if (Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) return null;
    return { notBefore, notAfter, subject: cert.subject ?? '', issuer: cert.issuer ?? '' };
  } catch {
    return null;
  }
}

/**
 * Clasifica de dónde viene el certificado.
 *
 * Importa porque las consecuencias son distintas: uno de Tailscale lo acepta
 * cualquier móvil sin tocar nada, y un autofirmado exige instalar la CA en **cada
 * dispositivo** de la casa. Decir «tienes HTTPS» sin distinguirlos sería prometer
 * un flujo que no funciona.
 */
export function classifyCertificateSource(validity: CertificateValidity): TlsSource {
  const haystack = `${validity.subject} ${validity.issuer}`.toLowerCase();
  if (haystack.includes('.ts.net')) return 'tailscale';
  // Autofirmado: emisor y sujeto coinciden (nadie por encima lo avala).
  if (validity.issuer && validity.issuer === validity.subject) return 'self-signed';
  return 'unknown';
}

export interface CertificateHealth {
  daysLeft: number;
  expiring: boolean;
  expired: boolean;
}

/**
 * Días restantes y si toca avisar. Se redondea **hacia abajo**: con 0,8 días por
 * delante, decir «queda 1 día» daría una tranquilidad que no toca.
 */
export function certificateHealth(
  notAfter: Date,
  now: Date,
  warnDays: number = TLS_WARN_DAYS,
): CertificateHealth {
  const msLeft = notAfter.getTime() - now.getTime();
  const daysLeft = Math.floor(msLeft / 86_400_000);
  return {
    daysLeft,
    expired: msLeft <= 0,
    // Un cert caducado también «expira»: la UI necesita el aviso igual, y peor.
    expiring: daysLeft <= warnDays,
  };
}

/**
 * Funciones del navegador que no arrancan sin contexto seguro (US-234, US-45,
 * US-50/51). Se calcula en el servidor **a propósito**: la web ya tenía esta
 * lista repartida por tres sitios y basta con que se olvide uno para volver a
 * prometer algo que no funciona.
 */
export function disabledWithoutTls(secureContext: boolean): TlsDisabledFeature[] {
  return secureContext ? [] : ['pwa', 'push', 'passkeys'];
}
