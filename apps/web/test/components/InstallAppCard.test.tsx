import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallAppCard } from '@/components/settings/InstallAppCard';
import { changeLocale, setLocale } from '@/lib/i18n';
import type { BeforeInstallPromptEvent, VentanaInstalable } from '@/lib/install';
import { useInstallStore } from '@/store/install.store';
import { useToastStore } from '@/store/toast.store';

function ventana(
  over: { standalone?: boolean; ua?: string; seguro?: boolean } = {},
): VentanaInstalable {
  return {
    isSecureContext: over.seguro ?? true,
    matchMedia: () => ({ matches: over.standalone === true }),
    navigator: { userAgent: over.ua ?? 'Mozilla/5.0 Chrome/130', maxTouchPoints: 0 },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function evento(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const e = Object.assign(new Event('beforeinstallprompt'), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  }) as BeforeInstallPromptEvent;
  return { e, prompt };
}

describe('InstallAppCard', () => {
  beforeEach(() => {
    useInstallStore.setState({ evento: null, instalada: false });
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('instalable: explica qué hace, ofrece el botón y avisa del consejo de Edge', () => {
    useInstallStore.setState({ evento: evento('accepted').e });
    render(<InstallAppCard win={ventana()} />);
    expect(screen.getByText('Instalar como app')).toBeInTheDocument();
    expect(
      screen.getByText(/en su propia ventana\. El monitoreo sigue aunque la cierres\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar app' })).toBeInTheDocument();
    expect(screen.getByText(/edge:\/\/apps/)).toBeInTheDocument();
  });

  it('al aceptar: llama a prompt una vez, saca un toast y pasa a «ya instalada» sin botón', async () => {
    const { e, prompt } = evento('accepted');
    useInstallStore.setState({ evento: e });
    render(<InstallAppCard win={ventana()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Instalar app' }));

    await waitFor(() =>
      expect(
        screen.getByText('KrakenOS ya está instalada como app en este dispositivo.'),
      ).toBeInTheDocument(),
    );
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Instalar app' })).toBeNull();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'success', message: 'KrakenOS instalada como app' });
  });

  it('al cancelar: ningún toast ni error, y el estado queda coherente (sin botón: el evento se gastó)', async () => {
    const { e, prompt } = evento('dismissed');
    useInstallStore.setState({ evento: e });
    render(<InstallAppCard win={ventana()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Instalar app' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Instalar app' })).toBeNull());
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('corriendo como app: lo dice, sin botón', () => {
    render(<InstallAppCard win={ventana({ standalone: true })} />);
    expect(
      screen.getByText('Estás usando KrakenOS como app, en su propia ventana.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('iOS: da la instrucción manual, sin botón', () => {
    render(
      <InstallAppCard
        win={ventana({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', seguro: false })}
      />,
    );
    expect(screen.getByText(/«Compartir» → «Añadir a pantalla de inicio»/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sin contexto seguro: exige HTTPS y remite a la tarjeta de TLS por su título', () => {
    render(<InstallAppCard win={ventana({ seguro: false })} />);
    expect(
      screen.getByText(
        /solo permite instalar la app sobre HTTPS\. Mira la tarjeta «Conexión segura \(HTTPS\)» de esta misma página/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/edge:\/\/apps/)).toBeNull();
  });

  it('navegador sin soporte: lo dice sin culpar al usuario', () => {
    render(<InstallAppCard win={ventana()} />);
    expect(
      screen.getByText(/Este navegador no ofrece la instalación desde aquí/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('en inglés: título, botón y mensaje de HTTPS traducidos', async () => {
    useInstallStore.setState({ evento: evento('accepted').e });
    const { unmount } = render(<InstallAppCard win={ventana()} />);
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Install as an app')).toBeInTheDocument();
    unmount();
    useInstallStore.setState({ evento: null });

    render(<InstallAppCard win={ventana({ seguro: false })} />);
    expect(
      screen.getByText(
        /only allows installing the app over HTTPS\. See the «Secure connection \(HTTPS\)» card/,
      ),
    ).toBeInTheDocument();
  });
});
