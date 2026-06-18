import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Sirve el frontend ya compilado (`apps/web/dist`) desde el propio agente, de
 * modo que API y UI viven en un único puerto. Las rutas de API/WebSocket se
 * dejan pasar (404 si no existen); cualquier otra ruta GET devuelve el fichero
 * estático correspondiente o, si no existe, `index.html` (enrutado SPA).
 *
 * No usa dependencias extra: lee del disco con `node:fs`. Se registra el último,
 * tras las rutas de API, para que estas tengan prioridad.
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

/** Prefijos que gestiona el backend (no se sirven como estáticos). */
function isBackendPath(url: string): boolean {
  return url.startsWith('/api') || url === '/health' || url.startsWith('/socket.io');
}

export function registerWebStatic(app: FastifyInstance, distPath: string): void {
  const root = resolve(distPath);
  const indexHtml = resolve(root, 'index.html');

  app.get('/*', async (req, reply) => {
    if (isBackendPath(req.url)) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Ruta no encontrada' });
    }

    const urlPath = decodeURIComponent((req.url.split('?')[0] || '/').replace(/\/+$/, '') || '/');
    const candidate = resolve(root, `.${urlPath}`);

    // Sirve el fichero si está dentro de `root` y existe; si no, cae a index.html (SPA).
    if (candidate === root || candidate.startsWith(root + sep)) {
      try {
        if ((await stat(candidate)).isFile()) {
          reply.type(MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream');
          return reply.send(createReadStream(candidate));
        }
      } catch {
        // No existe → enrutado SPA.
      }
    }
    reply.type('text/html; charset=utf-8');
    return reply.send(createReadStream(indexHtml));
  });
}
