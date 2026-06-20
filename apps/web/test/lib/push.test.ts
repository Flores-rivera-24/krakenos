import { afterEach, describe, expect, it } from 'vitest';
import { isPushSupported } from '@/lib/push';

describe('isPushSupported (US-45)', () => {
  afterEach(() => {
    // Restaura cualquier propiedad añadida durante un test.
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });

  it('devuelve false si serviceWorker no está en navigator', () => {
    // jsdom no expone serviceWorker ni PushManager por defecto.
    expect('serviceWorker' in navigator).toBe(false);
    expect(isPushSupported()).toBe(false);
  });
});
