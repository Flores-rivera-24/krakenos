import type { IntegrationDomain } from '@krakenos/types';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Callout } from '@/components/ui/callout';
import { useDomainState } from '@/lib/integration-states';
import { useT, type TranslationKey } from '@/lib/i18n';

/** Guarda la **clave**, no el texto: el idioma se decide al pintar. */
const NOT_CONFIGURED_COPY: Record<IntegrationDomain, TranslationKey> = {
  driver: 'domain.notConfigured.driver',
  vpn: 'domain.notConfigured.vpn',
  iot: 'domain.notConfigured.iot',
  cameras: 'domain.notConfigured.cameras',
  firewall: 'domain.notConfigured.firewall',
  vlan: 'domain.notConfigured.vlan',
  qos: 'domain.notConfigured.qos',
  dns: 'domain.notConfigured.dns',
};

function ConnectLink() {
  const t = useT();
  return (
    <Link to="/connect" className="text-kr-link underline underline-offset-2 hover:text-kr-primary">
      {t('domain.connectLink')}
    </Link>
  );
}

/**
 * «Sin configurar»: el dominio no tiene nada conectado. Va en lugar del estado vacío de la
 * página, que culparía al usuario («no tienes dispositivos») de algo que no depende de él.
 * Es permanente (`standing`) y lleva el camino: el enlace a «Conectar».
 */
export function NotConfiguredNotice({ domain }: { domain: IntegrationDomain }) {
  const t = useT();
  return (
    <Callout variant="info" standing title={t('domain.notConfigured.title')}>
      <p>{t(NOT_CONFIGURED_COPY[domain])}</p>
      <ConnectLink />
    </Callout>
  );
}

/** «Datos de demostración»: lo que se ve es de ejemplo, no de la casa del usuario. */
export function DemoNotice({ body = 'domain.demo.body' }: { body?: TranslationKey }) {
  const t = useT();
  return (
    <Callout variant="warning" standing title={t('domain.demo.title')}>
      <p>{t(body)}</p>
      <ConnectLink />
    </Callout>
  );
}

/**
 * El aviso de demostración de **un** dominio, o nada. Para las páginas que ya tienen su propio
 * aviso de estado (las de puerta de enlace: VPN, cortafuegos, QoS) y no deben enseñar dos a la
 * vez: la página decide cuándo dejarlo salir.
 */
export function DemoNoticeFor({ domain }: { domain: IntegrationDomain }) {
  return useDomainState(domain) === 'demo' ? <DemoNotice /> : null;
}

interface GateProps {
  domain: IntegrationDomain;
  /** Título de la página (`<h1>`): el estado «sin configurar» reemplaza al cuerpo, que es quien lo lleva. */
  title: string;
  /**
   * `false` en las páginas que se pueden usar **antes** de conectar el dominio (habitaciones,
   * escenas…): ahí solo tiene sentido el aviso de demostración, no sustituir la página.
   */
  blockWhenNotConfigured?: boolean;
  children: ReactNode;
}

/**
 * Envuelve una página de un dominio:
 *  - `not-configured` → el título y el aviso, **sin montar el cuerpo** (que no pide datos que
 *    no existen ni pinta un vacío que culpe al usuario);
 *  - `demo` → aviso permanente encima del cuerpo;
 *  - `configured` o aún desconocido → el cuerpo tal cual (ante la duda, la página de siempre).
 *
 * El cuerpo ocupa siempre la misma posición, así que pasar de desconocido a `demo` no lo
 * remonta (no pierde estado ni repite sus peticiones).
 */
export function DomainGate({ domain, title, blockWhenNotConfigured = true, children }: GateProps) {
  const state = useDomainState(domain);

  if (state === 'not-configured' && blockWhenNotConfigured) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <NotConfiguredNotice domain={domain} />
      </div>
    );
  }

  return (
    <>
      {state === 'demo' ? (
        <div className="px-6 pt-6">
          <DemoNotice />
        </div>
      ) : null}
      {children}
    </>
  );
}
