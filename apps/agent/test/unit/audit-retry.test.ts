import { describe, expect, it, vi } from 'vitest';
import { persistAuditWithRetry } from '../../src/plugins/audit.js';

// Programador síncrono: ejecuta el reintento al instante (sin timers reales).
const runNow = (fn: () => void): void => fn();

describe('persistAuditWithRetry (US-85, F11)', () => {
  it('escribe al primer intento y llama a onSuccess (sin reintentos)', async () => {
    const create = vi.fn().mockResolvedValue({});
    const onSuccess = vi.fn();
    const onGiveUp = vi.fn();
    persistAuditWithRetry({ create, onSuccess, onGiveUp, schedule: runNow });
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('reintenta ante un fallo transitorio y acaba escribiendo', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB ocupada'))
      .mockResolvedValue({});
    const onSuccess = vi.fn();
    const onGiveUp = vi.fn();
    persistAuditWithRetry({ create, onSuccess, onGiveUp, schedule: runNow }, [10, 20, 30]);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2); // 1 fallo + 1 éxito
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('tras agotar los reintentos llama a onGiveUp y nunca a onSuccess', async () => {
    const create = vi.fn().mockRejectedValue(new Error('DB caída'));
    const onSuccess = vi.fn();
    const onGiveUp = vi.fn();
    persistAuditWithRetry({ create, onSuccess, onGiveUp, schedule: runNow }, [10, 20]);
    await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledTimes(1));
    // 1 intento inicial + 2 reintentos = 3 escrituras intentadas.
    expect(create).toHaveBeenCalledTimes(3);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
