import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// US-262: `en` dejó de viajar en el bundle y se carga con `import()`. Quien
// asierta texto en inglés tras un `setLocale('en')` SÍNCRONO tiene que precargar
// el catálogo — hoy solo `test/lib/i18n.test.ts`, que lo hace en su `beforeAll`.
// Se midió ponerlo aquí, en el setup global: costaba **+10 s de setup (+19 %)**
// repartidos entre los 129 ficheros para que pasaran 3 tests de uno. El coste no
// se socializa: se paga donde se usa.

// jsdom no implementa ResizeObserver; Recharts (ResponsiveContainer) lo necesita.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom tampoco implementa matchMedia, y desde US-266 hay componentes que
// consultan `prefers-reduced-motion` para decidir si animan. Responde `false`
// («no lo he pedido»), que es el caso por defecto de un navegador real: así los
// tests ejercitan el camino CON movimiento, que es el que corre en producción.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// Limpia el DOM entre tests de componentes.
afterEach(() => {
  cleanup();
});
