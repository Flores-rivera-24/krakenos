import { AppWindow, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT, type TranslationKey } from '@/lib/i18n';
import {
  estadoDeInstalacion,
  type EstadoDeInstalacion,
  type VentanaInstalable,
} from '@/lib/install';
import { useInstallStore } from '@/store/install.store';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/ajustes';

/** Texto de los estados que solo informan (sin botón). */
const TEXTO: Partial<Record<EstadoDeInstalacion, TranslationKey>> = {
  running: 'settings.install.running',
  installed: 'settings.install.installed',
  ios: 'settings.install.ios',
  unsupported: 'settings.install.unsupported',
};

/**
 * Instalar KrakenOS como app (icono + ventana propia) desde Ajustes.
 *
 * Visible para **cualquier rol**, como `AboutCard`: instalar es una decisión de
 * este dispositivo, no del hogar, y no toca nada del servidor. El estado sale del
 * navegador (`lib/install.ts`), no de ninguna petición.
 *
 * Cada estado se dice, ninguno se oculta: si la tarjeta desapareciera sin
 * `beforeinstallprompt`, quien está en HTTP concluiría que la función no existe.
 * El de «sin HTTPS» **remite** a `TlsCard` en vez de duplicar su lógica.
 */
interface InstallAppCardProps {
  /** Solo para los tests: el `window` contra el que se decide el estado. */
  win?: VentanaInstalable;
}

export function InstallAppCard({ win }: InstallAppCardProps) {
  const t = useT();
  const evento = useInstallStore((s) => s.evento);
  const instalada = useInstallStore((s) => s.instalada);
  const instalar = useInstallStore((s) => s.instalar);

  const estado = estadoDeInstalacion({ instalada, hayEvento: evento !== null, win });

  const alPulsar = async () => {
    const resultado = await instalar();
    // Cancelar no es un error: no se avisa de nada.
    if (resultado === 'accepted') toast.success(t('settings.install.toast'));
  };

  const textoKey = TEXTO[estado];
  const consejoDeEdge = estado === 'installable' || estado === 'installed' || estado === 'running';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AppWindow className="h-5 w-5 text-kr-accent" aria-hidden />
          {t('settings.install.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {estado === 'installable' && (
          <>
            <p className="text-kr-sm text-kr-secondary">{t('settings.install.desc')}</p>
            <Button type="button" onClick={() => void alPulsar()}>
              <Download className="h-4 w-4" aria-hidden />
              {t('settings.install.button')}
            </Button>
          </>
        )}

        {textoKey && <p className="text-kr-sm text-kr-secondary">{t(textoKey)}</p>}

        {estado === 'insecure' && (
          <Callout variant="warning" standing>
            {t('settings.install.insecure', { tls: t('settings.tls.title') })}
          </Callout>
        )}

        {consejoDeEdge && (
          <p className="text-kr-xs text-kr-muted">{t('settings.install.edgeTip')}</p>
        )}
      </CardContent>
    </Card>
  );
}
