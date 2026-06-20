import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Política de seguridad de contenido por defecto. Estricta pero compatible con
 * la SPA que sirve el agente:
 * - `script-src 'self'`: no se admite JS inline (el anti-flash de tema se sirve
 *   como `/theme-init.js`, externo).
 * - `style-src 'unsafe-inline'`: React/Recharts aplican estilos inline.
 * - `img-src data:`: snapshots de cámara y QR de VPN viajan como data URLs.
 * - `connect-src ws:/wss:`: WebSocket de Socket.io en el mismo origen.
 */
export const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join('; ');

export interface SecurityHeadersOptions {
  /** Cadena CSP a servir. Por defecto `DEFAULT_CSP`. */
  csp?: string;
  /**
   * Si `true`, añade `Strict-Transport-Security`. Solo tiene sentido cuando el
   * agente (o el proxy delante) sirve HTTPS, así que por defecto va ligado a TLS.
   */
  hsts?: boolean;
}

/**
 * Añade cabeceras de seguridad a **todas** las respuestas (API, estáticos y
 * errores) sin dependencias extra. Defensa en profundidad frente a clickjacking,
 * MIME-sniffing y fugas por `Referer`, además de la CSP de la SPA.
 */
export const securityHeadersPlugin = fp(
  async (app: FastifyInstance, opts: SecurityHeadersOptions) => {
    const csp = opts.csp ?? DEFAULT_CSP;
    const hsts = opts.hsts ?? false;

    app.addHook('onRequest', async (_req, reply) => {
      reply.headers({
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
        // Fastify expone la versión en `Server`/`X-Powered-By`; no hace falta filtrarla.
        ...(hsts ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
      });
    });
  },
  { name: 'security-headers' },
);
