import type { GatewayCapability } from '@krakenos/types';
import { NotConfiguredNotice } from '@/components/integrations/DomainNotice';
import { Callout } from '@/components/ui/callout';
import { useT, type TranslationKey } from '@/lib/i18n';

/** Las tres funciones de puerta de enlace que dependen del equipo. */
export type GatewayFeature = 'vpn' | 'firewall' | 'qos';

/** Guarda la **clave**, no el texto: el idioma se decide al pintar. */
const COPY: Record<GatewayFeature, { unsupported: TranslationKey; setup: TranslationKey }> = {
  vpn: { unsupported: 'gateway.unsupported.vpn', setup: 'gateway.setup.vpn' },
  firewall: { unsupported: 'gateway.unsupported.firewall', setup: 'gateway.setup.firewall' },
  qos: { unsupported: 'gateway.unsupported.qos', setup: 'gateway.setup.qos' },
};

interface Props {
  capability: GatewayCapability;
  feature: GatewayFeature;
}

/**
 * Explica por qué VPN, cortafuegos o QoS no pueden funcionar **en este equipo**, en vez de
 * ofrecer un formulario que acabaría en error. Mismo patrón que `PerDeviceTrafficNotice`:
 *
 * - `unsupported`: Windows. No hay nada que instalar, así que se dice qué usar en su lugar
 *   (`warning`: la función no existe aquí).
 * - `requires-setup`: falta el helper. Es el único que se arregla, así que lleva el paso
 *   concreto, y va `info`: es un paso pendiente, no un problema.
 * - `not-configured`: el dominio está sin conectar (instalación nueva). Es el MISMO aviso que
 *   el de «sin configurar» de las demás páginas, no uno propio: así nunca hay dos a la vez.
 *
 * Devuelve `null` si el equipo puede: entonces la pantalla es la de siempre.
 */
export function GatewayCapabilityNotice({ capability, feature }: Props) {
  const t = useT();

  if (capability.status === 'not-configured') {
    return <NotConfiguredNotice domain={feature} />;
  }

  if (capability.status === 'requires-setup') {
    return (
      <Callout variant="info" standing title={t('gateway.setup.title')}>
        {t(COPY[feature].setup)}
      </Callout>
    );
  }

  if (capability.status === 'unsupported') {
    return (
      <Callout variant="warning" standing title={t('gateway.unsupported.title')}>
        {t(COPY[feature].unsupported)}
      </Callout>
    );
  }

  return null;
}
