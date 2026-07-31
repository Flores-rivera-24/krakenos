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

// Limpia el DOM entre tests de componentes.
afterEach(() => {
  cleanup();
});
