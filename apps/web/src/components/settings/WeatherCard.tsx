import { useEffect, useState } from 'react';
import type { WeatherPrecision, WeatherStatus } from '@krakenos/types';
import { WEATHER_UNITS } from '@krakenos/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { WEATHER_METRIC_KEYS } from '@/lib/automations';
import { useT } from '@/lib/i18n';

/**
 * Tiempo exterior (US-254) — la tarjeta del **consentimiento**.
 *
 * Es la primera vez que la app manda un dato del hogar a un tercero, así que no
 * pregunta «¿activar el tiempo?»: dice **a quién** se pregunta, **qué** se envía
 * y enseña la coordenada exacta que sale. Un permiso que no deja comprobar su
 * efecto no es un permiso informado.
 */
export function WeatherCard() {
  const t = useT();
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setStatus(await api.get<WeatherStatus>('/api/weather'));
      setError(null);
    } catch (err) {
      setError(describeError(err, 'No se pudo cargar el tiempo exterior.'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(patch: { enabled?: boolean; precision?: WeatherPrecision }) {
    setSaving(true);
    try {
      setStatus(await api.put<WeatherStatus>('/api/weather', patch));
      setError(null);
    } catch (err) {
      setError(describeError(err, 'No se pudo guardar el ajuste.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tiempo exterior</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-fg-muted">
          Permite que tus rutinas reaccionen al tiempo: «si la temperatura baja de 5 °C, enciende la
          calefacción».
        </p>

        {error ? <ErrorBanner>{error}</ErrorBanner> : null}

        {status ? (
          <>
            {/* El aviso va ANTES del interruptor: enterarse después de activarlo
                es enterarse tarde. */}
            <Callout variant="warning" standing title="Esto envía la ubicación de tu casa">
              Para saber el tiempo hay que decir <strong>dónde</strong>. Con esto activado, KrakenOS
              consulta <code>{status.provider}</code>, un servicio externo. Es la única función que
              manda un dato del hogar fuera; todo lo demás se queda aquí.
            </Callout>

            {!status.locationConfigured ? (
              <Callout variant="info" standing>
                Todavía no has indicado dónde está la casa. Configúrala en Ajustes → Sistema para
                poder usar el tiempo en tus rutinas.
              </Callout>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-kr-sm text-kr-fg">Usar el tiempo en las rutinas</p>
                <p className="text-kr-xs text-kr-fg-muted">
                  {status.enabled
                    ? 'Activado. Se consulta una vez por hora.'
                    : 'Desactivado. No se hace ninguna petición.'}
                </p>
              </div>
              <Button
                variant={status.enabled ? 'outline' : 'default'}
                disabled={saving}
                onClick={() => void save({ enabled: !status.enabled })}
              >
                {status.enabled ? 'Desactivar' : 'Activar'}
              </Button>
            </div>

            {status.enabled ? (
              <>
                <fieldset className="border-t border-kr pt-3">
                  <legend className="text-kr-sm text-kr-fg">Precisión de la ubicación</legend>
                  <div className="mt-2 flex flex-col gap-2">
                    {(
                      [
                        {
                          value: 'rounded',
                          label: 'Aproximada (recomendado)',
                          hint: 'Redondea a unos 11 km. El tiempo es el mismo y no señala tu casa.',
                        },
                        {
                          value: 'exact',
                          label: 'Exacta',
                          hint: 'Envía las coordenadas tal cual las tienes guardadas.',
                        },
                      ] satisfies Array<{ value: WeatherPrecision; label: string; hint: string }>
                    ).map((opt) => (
                      <label key={opt.value} className="flex items-start gap-2 text-kr-sm">
                        <input
                          type="radio"
                          name="weather-precision"
                          className="mt-1"
                          checked={status.precision === opt.value}
                          disabled={saving}
                          onChange={() => void save({ precision: opt.value })}
                        />
                        <span>
                          <span className="text-kr-fg">{opt.label}</span>
                          <span className="block text-kr-xs text-kr-fg-muted">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* El efecto del ajuste, hecho visible: sin esto, «aproximada» es
                    una promesa que el usuario no puede comprobar. */}
                {status.sentLatitude !== null && status.sentLongitude !== null ? (
                  <p className="text-kr-xs text-kr-fg-muted">
                    Se envía exactamente:{' '}
                    <code>
                      {status.sentLatitude}, {status.sentLongitude}
                    </code>
                  </p>
                ) : null}

                {status.lastError ? (
                  <Callout variant="warning" standing>
                    {status.lastError}
                  </Callout>
                ) : null}

                {status.readings.length > 0 ? (
                  <ul className="flex flex-wrap gap-3 text-kr-sm">
                    {status.readings.map((r) => (
                      <li key={r.metric} className="text-kr-fg-muted">
                        {t(WEATHER_METRIC_KEYS[r.metric])}:{' '}
                        <span className="text-kr-fg">
                          {r.value} {WEATHER_UNITS[r.metric]}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
