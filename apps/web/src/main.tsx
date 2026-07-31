import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { ensureCatalog, initLocale, resolveInitialLocale } from '@/lib/i18n';
import { registrarServiceWorker } from '@/lib/pwa';
import { applyTheme, getTheme } from '@/lib/theme';
import './index.css';

// Aplica las preferencias de tema e idioma persistidas antes del primer render.
applyTheme(getTheme());

// Service worker en el arranque (US-234): antes solo se registraba al activar las
// notificaciones, así que quien no las quería no tenía PWA. Es best-effort — si
// falla, la app sigue funcionando como web normal.
void registrarServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el elemento #root');

/**
 * El catálogo del idioma resuelto se carga ANTES del primer render (US-262).
 * Los catálogos i18n son ~19 kB gzip cada uno y viajaban los dos en el chunk de
 * entrada; ahora solo `es` (la fuente y el fallback) va en el bundle y el resto
 * llega por `import()`. Se espera aquí —y no se renderiza «mientras carga»—
 * porque `t()` es síncrono: pintar antes daría una pasada en español en **cada**
 * pantalla a quien tiene la app en inglés. Para `es` resuelve en el acto.
 */
void ensureCatalog(resolveInitialLocale()).then(() => {
  initLocale();
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
