import type { IntegrationKindSchema } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureCatalog, setLocale } from '@/lib/i18n';

// El asistente delega la persistencia/prueba en el cliente de integraciones;
// lo stubbeamos para observar las llamadas y controlar sus resultados.
const integrationsMock = vi.hoisted(() => ({
  saveIntegration: vi.fn(),
  testIntegration: vi.fn(),
}));
vi.mock('@/lib/integrations', () => integrationsMock);

import { IntegrationWizard } from '@/components/connect/IntegrationWizard';
import { useToastStore } from '@/store/toast.store';

// Esquema real del backend para el kind `hue` (bridgeUrl obligatorio + appKey secreto).
const HUE_SCHEMA: IntegrationKindSchema = {
  domain: 'iot',
  kind: 'hue',
  label: 'Philips Hue',
  fields: [
    { key: 'bridgeUrl', type: 'url', required: true },
    { key: 'appKey', type: 'password', required: true, secret: true },
  ],
};

function renderHue(onDone = vi.fn(), initialValues?: Record<string, string>) {
  render(
    <IntegrationWizard
      domain="iot"
      kind="hue"
      kindSchema={HUE_SCHEMA}
      current={null}
      initialValues={initialValues}
      onDone={onDone}
    />,
  );
  return { onDone };
}

/** Avanza del paso "Prepara" al formulario "Conecta". */
async function gotoConnect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
}

describe('IntegrationWizard', () => {
  beforeEach(() => {
    integrationsMock.saveIntegration.mockReset().mockResolvedValue({});
    integrationsMock.testIntegration.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('renderiza el paso "Prepara" con la introducción de la guía', () => {
    renderHue();
    expect(screen.getAllByText(/Paso 1 de 3/).length).toBeGreaterThan(0);
    // Intro de la guía de Hue (copia humana).
    expect(screen.getByText(/uno de los sistemas de iluminación inteligente/i)).toBeInTheDocument();
    expect(screen.getByText('Qué necesitas')).toBeInTheDocument();
  });

  // --- Nivel de soporte (US-238) ---

  it('avisa de «sin garantía» ANTES de los pasos en un backend community', () => {
    render(
      <IntegrationWizard
        domain="iot"
        kind="tuya"
        kindSchema={{ ...HUE_SCHEMA, kind: 'tuya', label: 'Tuya / Smart Life' }}
        current={null}
        onDone={vi.fn()}
      />,
    );
    const aviso = screen.getByText('Soporte de la comunidad, sin garantía');
    expect(aviso).toBeInTheDocument();
    // Va ANTES del contenido de la guía en el orden del documento: enterarse
    // después de haber seguido diez pasos es enterarse tarde.
    const intro = screen.getByText('Qué necesitas');
    expect(aviso.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('un backend core NO lleva el aviso (Hue empareja en local)', () => {
    renderHue();
    expect(screen.queryByText('Soporte de la comunidad, sin garantía')).not.toBeInTheDocument();
  });

  // --- Dependencia de la app del fabricante (US-258) ---

  it('un backend `core` con dependencia SÍ avisa de la app (Kasa/Tapo)', () => {
    render(
      <IntegrationWizard
        domain="iot"
        kind="kasa"
        kindSchema={{ ...HUE_SCHEMA, kind: 'kasa', label: 'TP-Link Kasa / Tapo' }}
        current={null}
        onDone={vi.fn()}
      />,
    );
    // El caso que se perdía: al colgar el aviso del sello `community`, un backend
    // mantenido que necesita la cuenta del fabricante no lo decía en ningún sitio.
    const aviso = screen.getByText('Vas a necesitar la app del fabricante');
    expect(aviso).toBeInTheDocument();
    expect(screen.getByText(/hace falta la cuenta del fabricante/)).toBeInTheDocument();
    // Y acota la gama: quien tiene enchufes Kasa clásicos no necesita ninguna cuenta.
    expect(screen.getByText(/Solo afecta a los Tapo/)).toBeInTheDocument();
    // Sigue sin ser community: el sello de garantía no aparece.
    expect(screen.queryByText('Soporte de la comunidad, sin garantía')).not.toBeInTheDocument();
    // Y va antes de los pasos, por lo mismo que el otro aviso.
    const intro = screen.getByText('Qué necesitas');
    expect(aviso.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Hue no depende de ninguna app y no lo insinúa', () => {
    renderHue();
    expect(screen.queryByText('Vas a necesitar la app del fabricante')).not.toBeInTheDocument();
  });

  it('gatea "Siguiente" hasta rellenar los campos obligatorios', async () => {
    const user = userEvent.setup();
    renderHue();
    await gotoConnect(user);

    const next = screen.getByRole('button', { name: 'Siguiente' });
    expect(next).toBeDisabled(); // faltan bridgeUrl y appKey

    await user.type(screen.getByLabelText(/Dirección del bridge/), 'https://192.168.1.50');
    expect(next).toBeDisabled(); // aún falta el secreto obligatorio

    await user.type(screen.getByLabelText(/Clave de aplicación/), 'secret-app-key');
    expect(next).toBeEnabled();
  });

  it('precarga los valores del auto-descubrimiento (US-175), nunca los secretos', async () => {
    const user = userEvent.setup();
    renderHue(vi.fn(), { bridgeUrl: 'http://192.168.1.2', appKey: 'no-debe-precargarse' });
    await gotoConnect(user);

    expect(screen.getByLabelText(/Dirección del bridge/)).toHaveValue('http://192.168.1.2');
    expect(screen.getByLabelText(/Clave de aplicación/)).toHaveValue('');
  });

  it('tras una prueba correcta, guardar hace PUT namespaced y avisa con un toast', async () => {
    const user = userEvent.setup();
    integrationsMock.testIntegration.mockResolvedValue({
      ok: true,
      message: 'Conectado. 3 dispositivo(s) detectado(s).',
      details: { dispositivos: 3 },
    });
    const { onDone } = renderHue();

    await gotoConnect(user);
    await user.type(screen.getByLabelText(/Dirección del bridge/), 'https://192.168.1.50');
    await user.type(screen.getByLabelText(/Clave de aplicación/), 'secret-app-key');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    // Paso "Prueba y guarda": el botón de guardar está gateado hasta probar.
    const finish = screen.getByRole('button', { name: 'Guardar y conectar' });
    expect(finish).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Probar conexión' }));
    await waitFor(() => expect(screen.getByText('Conexión correcta')).toBeInTheDocument());
    expect(finish).toBeEnabled();

    await user.click(finish);
    await waitFor(() => expect(integrationsMock.saveIntegration).toHaveBeenCalled());

    // Config namespaced por backend (`hue.` prefijo), tal como la guarda el backend.
    expect(integrationsMock.saveIntegration).toHaveBeenCalledWith('iot', {
      kind: 'hue',
      enabled: true,
      config: { 'hue.bridgeUrl': 'https://192.168.1.50', 'hue.appKey': 'secret-app-key' },
    });
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'success', message: '¡Philips Hue conectado!' }),
    ]);
    expect(onDone).toHaveBeenCalled();
  });

  it('una prueba fallida muestra un callout de peligro y no habilita guardar', async () => {
    const user = userEvent.setup();
    integrationsMock.testIntegration.mockResolvedValue({
      ok: false,
      message: 'No se pudo conectar: el equipo no respondió a tiempo (timeout)',
    });
    renderHue();

    await gotoConnect(user);
    await user.type(screen.getByLabelText(/Dirección del bridge/), 'https://192.168.1.50');
    await user.type(screen.getByLabelText(/Clave de aplicación/), 'secret-app-key');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar/);
    expect(screen.getByRole('button', { name: 'Guardar y conectar' })).toBeDisabled();
    expect(integrationsMock.saveIntegration).not.toHaveBeenCalled();
  });
});

/**
 * El chrome del asistente en inglés (US-262).
 *
 * Era la última pantalla del producto que se quedaba en español con la app en
 * inglés: los pasos, los botones y los avisos estaban escritos a pelo en el
 * componente. El **cuerpo de las guías** no entra aquí — ésas se traducen por
 * superposición según `guide.id`, que es otro mecanismo a propósito (US-177).
 */
describe('IntegrationWizard en inglés', () => {
  // El catálogo `en` ya no viaja en el bundle (US-262), y `setLocale` es
  // SÍNCRONO: sin precargarlo, la pantalla se queda en español hasta que llegue
  // el chunk y el test compite con un `import()`.
  beforeAll(() => ensureCatalog('en'));
  afterEach(() => setLocale('es', { persist: false }));

  it('los pasos y el progreso salen traducidos', async () => {
    const user = userEvent.setup();
    setLocale('en', { persist: false });
    renderHue();

    // El `Stepper` solo pinta el título del paso **activo**, no los tres.
    expect(await screen.findByText('Prepare')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Prepara')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('el aviso de «necesitas la app del fabricante» se traduce', async () => {
    setLocale('en', { persist: false });
    // Con Hue NO sale: se empareja con el botón físico del bridge y su entrada en
    // `MANUFACTURER_APP` es `null`, que es lo correcto. El aviso es de los
    // backends que sí dependen de la app — Govee enciende «LAN Control» aparato a
    // aparato desde la suya.
    render(
      <IntegrationWizard
        domain="iot"
        kind="govee"
        kindSchema={{
          domain: 'iot',
          kind: 'govee',
          label: 'Govee',
          fields: [{ key: 'listenPort', type: 'number', required: true }],
        }}
        current={null}
        onDone={vi.fn()}
      />,
    );

    expect(await screen.findByText("You'll need the manufacturer's app")).toBeInTheDocument();
    expect(
      screen.getByText(/turn on local control on each device/),
    ).toBeInTheDocument();
  });

  it('el botón de probar y el de guardar sin probar se traducen', async () => {
    const user = userEvent.setup();
    setLocale('en', { persist: false });
    renderHue();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/bridge/i), 'https://192.168.1.50');
    await user.type(screen.getByLabelText(/key/i), 'secret-app-key');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save without testing' })).toBeInTheDocument();
  });
});
