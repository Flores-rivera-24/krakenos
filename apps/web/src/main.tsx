import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { initLocale } from '@/lib/i18n';
import { applyTheme, getTheme } from '@/lib/theme';
import './index.css';

// Aplica las preferencias de tema e idioma persistidas antes del primer render.
applyTheme(getTheme());
initLocale();

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el elemento #root');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
