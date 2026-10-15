import { describe, expect, it, vi } from 'vitest';
import { filaAbrible } from '@/lib/a11y';
import { tituloDeRuta } from '@/lib/use-route-announce';

/**
 * US-235 (AUD3-26): las cuatro tablas principales eran `<tr onClick>` sin teclado
 * — no se podía abrir un dispositivo ni editar una regla sin ratón.
 */
describe('filaAbrible', () => {
  const evento = (key: string, mismoNodo = true) => {
    const nodo = {} as unknown as EventTarget;
    return {
      key,
      target: mismoNodo ? nodo : ({} as EventTarget),
      currentTarget: nodo,
      preventDefault: vi.fn(),
    };
  };

  it('hace la fila enfocable y le da nombre accesible', () => {
    const props = filaAbrible(() => {}, 'Ver macbook');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-label']).toBe('Ver macbook');
  });

  it('Enter y Espacio abren la fila', () => {
    for (const key of ['Enter', ' ']) {
      const abrir = vi.fn();
      const props = filaAbrible(abrir, 'x');
      const e = evento(key);
      props.onKeyDown(e as never);
      expect(abrir, key).toHaveBeenCalledTimes(1);
      expect(e.preventDefault, key).toHaveBeenCalled();
    }
  });

  it('otras teclas no abren nada (Tab debe seguir navegando)', () => {
    const abrir = vi.fn();
    filaAbrible(abrir, 'x').onKeyDown(evento('Tab') as never);
    expect(abrir).not.toHaveBeenCalled();
  });

  it('NO se dispara si el foco está en un control interno de la fila', () => {
    // Una fila lleva interruptores y botones de borrar: Enter sobre ellos les
    // pertenece a ellos, no a la fila. Sin esto, activar un switch con teclado
    // abriría además el panel de detalle.
    const abrir = vi.fn();
    filaAbrible(abrir, 'x').onKeyDown(evento('Enter', false) as never);
    expect(abrir).not.toHaveBeenCalled();
  });
});

/**
 * US-235: en una SPA el navegador no cambia el título ni mueve el foco al
 * navegar, así que un lector de pantalla no anuncia nada al cambiar de vista.
 */
describe('tituloDeRuta', () => {
  it('da un nombre legible a las rutas conocidas', () => {
    expect(tituloDeRuta('/')).toBe('Dashboard');
    expect(tituloDeRuta('/cameras')).toBe('Cámaras');
    expect(tituloDeRuta('/settings')).toBe('Ajustes');
  });

  it('resuelve subrutas por su primer segmento', () => {
    expect(tituloDeRuta('/coverage/plan-1')).toBe('Cobertura WiFi');
  });

  it('cae a la marca en una ruta desconocida en vez de quedarse vacío', () => {
    expect(tituloDeRuta('/ruta-que-no-existe')).toBe('KrakenOS');
  });
});
