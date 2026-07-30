import type { PerDeviceTrafficCapability } from '@krakenos/types';
import { Callout } from '@/components/ui/callout';
import { useT } from '@/lib/i18n';

interface Props {
  capability: PerDeviceTrafficCapability;
  /** Copy propio de cada pantalla para el caso «tu router no puede». */
  unsupportedTitle: string;
  unsupportedDesc: string;
}

/**
 * Explica **por qué** no hay desglose por dispositivo (US-263 · US-251).
 *
 * Los dos casos se ven igual —una lista vacía— y no tienen nada que ver:
 *
 * - `unsupported`: el router no reparte el tráfico por aparato. No hay nada que
 *   el usuario pueda hacer, así que no se le pide que haga nada; se le dice.
 * - `requires-setup`: el router **sí** puede, solo le falta un paquete. Es el
 *   único de los dos que se arregla, así que aquí sí va una instrucción concreta
 *   —y va `info`, no `warning`: no es un problema, es un paso pendiente.
 *
 * Devuelve `null` cuando la capacidad está disponible: entonces el vacío significa
 * «aún no ha pasado nada», que es lo que la pantalla ya sabe decir.
 */
export function PerDeviceTrafficNotice({ capability, unsupportedTitle, unsupportedDesc }: Props) {
  const t = useT();

  if (capability.status === 'requires-setup') {
    return (
      <Callout variant="info" standing title={t('perDeviceTraffic.setup.title')}>
        {capability.setup === 'nlbwmon' ? t('perDeviceTraffic.setup.nlbwmon') : null}
      </Callout>
    );
  }

  if (capability.status === 'unsupported') {
    return (
      <Callout variant="warning" standing title={unsupportedTitle}>
        {unsupportedDesc}
      </Callout>
    );
  }

  return null;
}
