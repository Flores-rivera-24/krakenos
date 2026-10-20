import { RefreshCw } from 'lucide-react';

import { useT } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/panel';

interface WidgetErrorProps {
  /** Frase completa ya traducida («No se pudo cargar el estado del sistema.»). Sin ella, la genérica. */
  message?: string;
  /** Vuelve a intentar la carga. */
  onRetry?: () => void;
}

/**
 * Estado de fallo de un widget del dashboard (US-234 / AUD3-24).
 *
 * Antes los widgets hacían `.catch(() => undefined)` y se quedaban con los datos
 * en `null`, lo que producía **dos fallos distintos y ambos mentirosos**: unos se
 * quedaban con el spinner girando para siempre (`AlarmWidget`, `SystemWidget`) y
 * otros pintaban el error como estado vacío («Sin dispositivos IoT»), que en un
 * panel del hogar se lee como «todo tranquilo» justo cuando no se sabe nada.
 *
 * Es deliberadamente discreto —un widget caído no debe gritar más que una alarma
 * de verdad— pero **inequívoco**: dice que no se pudo cargar y ofrece reintentar.
 *
 * La frase va entera al catálogo (una por consumidor): no se compone con un trozo suelto.
 */
export function WidgetError({ message, onRetry }: WidgetErrorProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-kr-sm text-kr-secondary">{message ?? t('widget.error.generic')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-kr-sm text-kr-link hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ui.retry')}
        </button>
      )}
    </div>
  );
}
