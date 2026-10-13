import { describe, expect, it, vi } from 'vitest';
import {
  correComoApp,
  esContextoSeguro,
  esIos,
  estadoDeInstalacion,
  iniciarCapturaDeInstalacion,
  type BeforeInstallPromptEvent,
  type VentanaInstalable,
} from '@/lib/install';
import { useInstallStore } from '@/store/install.store';

/** Un `window` mínimo e inyectable: lo que decide cada función, y nada más. */
function ventana(
  over: Partial<VentanaInstalable> & { standalone?: boolean; ua?: string; touch?: number } = {},
) {
  const { standalone, ua, touch, ...resto } = over;
  const oyentes = new Map<string, Set<(e: Event) => void>>();
  const win: VentanaInstalable & { emitir: (tipo: string, e?: Event) => void } = {
    isSecureContext: true,
    matchMedia: (q: string) => ({
      matches: q === '(display-mode: standalone)' && standalone === true,
    }),
    navigator: {
      userAgent: ua ?? 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
      maxTouchPoints: touch ?? 0,
    },
    addEventListener: (t, l) => {
      if (!oyentes.has(t)) oyentes.set(t, new Set());
      oyentes.get(t)?.add(l);
    },
    removeEventListener: (t, l) => void oyentes.get(t)?.delete(l),
    emitir: (t, e = new Event(t, { cancelable: true })) => oyentes.get(t)?.forEach((l) => l(e)),
    ...resto,
  };
  return win;
}

function eventoDeInstalacion(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const evento = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  }) as BeforeInstallPromptEvent;
  return { evento, prompt };
}

describe('detección del entorno', () => {
  it('standalone: lo detecta por display-mode y por navigator.standalone de iOS', () => {
    expect(correComoApp(ventana({ standalone: true }))).toBe(true);
    expect(correComoApp(ventana({ standalone: false }))).toBe(false);
    const ios = ventana();
    ios.navigator = { ...ios.navigator, standalone: true };
    expect(correComoApp(ios)).toBe(true);
  });

  it('iOS: iPhone, iPad clásico e iPadOS (Macintosh con pantalla táctil), pero no un Mac', () => {
    expect(esIos(ventana({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }))).toBe(
      true,
    );
    expect(esIos(ventana({ ua: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)' }))).toBe(true);
    expect(
      esIos(ventana({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', touch: 5 })),
    ).toBe(true);
    expect(
      esIos(ventana({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', touch: 0 })),
    ).toBe(false);
    expect(esIos(ventana())).toBe(false);
  });

  it('contexto seguro', () => {
    expect(esContextoSeguro(ventana())).toBe(true);
    expect(esContextoSeguro(ventana({ isSecureContext: false }))).toBe(false);
  });
});

describe('estadoDeInstalacion', () => {
  it('prioriza: corriendo como app > instalada > evento > iOS > sin HTTPS > no soportado', () => {
    const base = { instalada: false, hayEvento: false };
    expect(
      estadoDeInstalacion({
        ...base,
        instalada: true,
        hayEvento: true,
        win: ventana({ standalone: true }),
      }),
    ).toBe('running');
    expect(estadoDeInstalacion({ ...base, instalada: true, hayEvento: true, win: ventana() })).toBe(
      'installed',
    );
    expect(estadoDeInstalacion({ ...base, hayEvento: true, win: ventana() })).toBe('installable');
    expect(
      estadoDeInstalacion({ ...base, win: ventana({ ua: 'iPhone', isSecureContext: false }) }),
    ).toBe('ios');
    expect(estadoDeInstalacion({ ...base, win: ventana({ isSecureContext: false }) })).toBe(
      'insecure',
    );
    expect(estadoDeInstalacion({ ...base, win: ventana() })).toBe('unsupported');
  });
});

describe('captura de la instalación', () => {
  it('beforeinstallprompt: hace preventDefault y entrega el evento; appinstalled avisa', () => {
    const win = ventana();
    const onEvento = vi.fn();
    const onInstalada = vi.fn();
    const parar = iniciarCapturaDeInstalacion({ onEvento, onInstalada }, win);

    const { evento } = eventoDeInstalacion('accepted');
    win.emitir('beforeinstallprompt', evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(onEvento).toHaveBeenCalledWith(evento);
    expect(onInstalada).not.toHaveBeenCalled();

    win.emitir('appinstalled');
    expect(onInstalada).toHaveBeenCalledTimes(1);

    parar();
    win.emitir('appinstalled');
    expect(onInstalada).toHaveBeenCalledTimes(1);
  });
});

describe('store de instalación', () => {
  const reset = () => useInstallStore.setState({ evento: null, instalada: false });

  it('instalar() llama a prompt(), lee userChoice y consume el evento (aceptado)', async () => {
    reset();
    const { evento, prompt } = eventoDeInstalacion('accepted');
    useInstallStore.getState().setEvento(evento);

    await expect(useInstallStore.getState().instalar()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(useInstallStore.getState().instalada).toBe(true);
    expect(useInstallStore.getState().evento).toBeNull();
  });

  it('cancelar no marca la app como instalada, pero el evento ya no vale', async () => {
    reset();
    const { evento, prompt } = eventoDeInstalacion('dismissed');
    useInstallStore.getState().setEvento(evento);

    await expect(useInstallStore.getState().instalar()).resolves.toBe('dismissed');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(useInstallStore.getState().instalada).toBe(false);
    expect(useInstallStore.getState().evento).toBeNull();
  });

  it('sin evento guardado no hay nada que lanzar; y si prompt() lanza, no propaga', async () => {
    reset();
    await expect(useInstallStore.getState().instalar()).resolves.toBe('unavailable');

    const { evento } = eventoDeInstalacion('accepted');
    evento.prompt = vi.fn().mockRejectedValue(new Error('x'));
    useInstallStore.getState().setEvento(evento);
    await expect(useInstallStore.getState().instalar()).resolves.toBe('unavailable');
  });

  it('appinstalled limpia el evento y marca instalada', () => {
    reset();
    useInstallStore.getState().setEvento(eventoDeInstalacion('accepted').evento);
    useInstallStore.getState().marcarInstalada();
    expect(useInstallStore.getState().instalada).toBe(true);
    expect(useInstallStore.getState().evento).toBeNull();
  });
});
