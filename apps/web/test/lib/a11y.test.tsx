import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filaAbrible } from '@/lib/a11y';
import { changeLocale, setLocale } from '@/lib/i18n';
import { tituloDeRuta, useRouteAnnounce } from '@/lib/use-route-announce';

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

describe('tituloDeRuta en inglés', () => {
  afterEach(() => setLocale('es', { persist: false }));

  it('se resuelve con el idioma ACTIVO en el momento de la llamada, no al importar', async () => {
    expect(tituloDeRuta('/automations')).toBe('Rutinas');
    await changeLocale('en', { persist: false });
    expect(tituloDeRuta('/')).toBe('Dashboard');
    expect(tituloDeRuta('/cameras')).toBe('Cameras');
    expect(tituloDeRuta('/automations')).toBe('Routines');
    expect(tituloDeRuta('/vpn')).toBe('VPN');
    expect(tituloDeRuta('/coverage/plan-1')).toBe('WiFi coverage');
  });
});

describe('useRouteAnnounce: el título sigue al idioma', () => {
  afterEach(() => setLocale('es', { persist: false }));

  function Pantalla({ foco }: { foco: React.RefObject<HTMLElement | null> }) {
    useRouteAnnounce(foco);
    return <main ref={foco} tabIndex={-1} />;
  }

  it('al cambiar de idioma reescribe document.title SIN mover el foco', async () => {
    const foco = createRef<HTMLElement>();
    render(
      <MemoryRouter initialEntries={['/cameras']}>
        <Pantalla foco={foco} />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Cámaras · KrakenOS');
    expect(document.activeElement).not.toBe(foco.current);

    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    expect(document.title).toBe('Cameras · KrakenOS');
    // Cambiar de idioma no es navegar: robar el foco al <main> sería un salto sin motivo.
    expect(document.activeElement).not.toBe(foco.current);
  });
});

describe('useRouteAnnounce: el scroll', () => {
  afterEach(() => vi.restoreAllMocks());

  function Pantalla({ foco }: { foco: React.RefObject<HTMLElement | null> }) {
    useRouteAnnounce(foco);
    const navegar = useNavigate();
    return (
      <main ref={foco} tabIndex={-1}>
        <button onClick={() => navegar('/inventory')}>ir</button>
        <button onClick={() => navegar('/iot', { replace: true })}>reemplazar</button>
        <button onClick={() => navegar(-1)}>atrás</button>
      </main>
    );
  }

  function montar() {
    const foco = createRef<HTMLElement>();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/connect']}>
        <Pantalla foco={foco} />
      </MemoryRouter>,
    );
    return { scrollTo, foco };
  }

  it('una navegación nueva (PUSH) abre la página arriba y el foco no desplaza', async () => {
    const { scrollTo, foco } = montar();
    const enfocar = vi.spyOn(foco.current as HTMLElement, 'focus');
    // El montaje inicial no toca el scroll.
    expect(scrollTo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'ir' }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(enfocar).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('un reemplazo (REPLACE) también vuelve arriba', async () => {
    const { scrollTo } = montar();
    await userEvent.click(screen.getByRole('button', { name: 'reemplazar' }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('atrás (POP) NO toca el scroll: el navegador lo restaura', async () => {
    const { scrollTo } = montar();
    await userEvent.click(screen.getByRole('button', { name: 'ir' }));
    scrollTo.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'atrás' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
