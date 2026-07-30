import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { initLocale } from '@/lib/i18n';
import { registrarServiceWorker } from '@/lib/pwa';
import { applyTheme, getTheme } from '@/lib/theme';
import './index.css';

// Aplica las preferencias de tema e idioma persistidas antes del primer render.
applyTheme(getTheme());
initLocale();

// Service worker en el arranque (US-234): antes solo se registraba al activar las
// notificaciones, así que quien no las quería no tenía PWA. Es best-effort — si
// falla, la app sigue funcionando como web normal.
void registrarServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el elemento #root');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
