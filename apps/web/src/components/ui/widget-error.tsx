import { RefreshCw } from 'lucide-react';

interface WidgetErrorProps {
  /** Qué no se pudo cargar, en minúscula: «el estado del sistema». */
  what?: string;
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
 * **Idioma:** español a pelo, sin `t()`, y es intencionado. Sus únicos consumidores
 * son los widgets del dashboard, que siguen siendo español-only en el código
 * actual (US-177 migró los 17 cuerpos de página, no los widgets). Meter un `t()`
 * suelto aquí dejaría una tarjeta mitad en inglés dentro de un widget en español.
 * Se migra con el resto en US-239.
 */
export function WidgetError({ what, onRetry }: WidgetErrorProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-kr-sm text-kr-secondary">
        {what ? `No se pudo cargar ${what}.` : 'No se pudo cargar.'}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-kr-sm text-kr-link hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Reintentar
        </button>
      )}
    </div>
  );
}
