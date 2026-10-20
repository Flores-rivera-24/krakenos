import { DOMAIN_NOT_CONFIGURED_CODE, type IntegrationDomain } from '@krakenos/types';

/** Copy del agente para el 409 (la web lo traduce por `code`). */
export const DOMAIN_NOT_CONFIGURED_MESSAGE =
  'Este apartado todavía no está conectado. Conéctalo en «Conectar» para poder hacer cambios.';

/**
 * Escritura (o lectura sin forma vacía) contra un dominio sin configurar.
 *
 * Es el **punto central** del 409: las implementaciones `none` de los ocho dominios lanzan
 * esto en cualquier escritura, y el manejador global de errores (`plugins/error-handler.ts`)
 * lo sirve como un 4xx con su `code`. Así una ruta nueva de escritura no tiene que
 * acordarse de comprobar nada: contra un dominio `none` no puede tener éxito.
 *
 * Lleva `statusCode`/`code` propios, igual que `DriverUnavailableError`. El mensaje es copy
 * nuestro (sin detalles internos); la web lo traduce por `code`.
 */
export class DomainNotConfiguredError extends Error {
  readonly statusCode = 409;
  readonly code = DOMAIN_NOT_CONFIGURED_CODE;

  constructor(readonly domain: IntegrationDomain) {
    super(DOMAIN_NOT_CONFIGURED_MESSAGE);
    this.name = 'DomainNotConfiguredError';
  }
}

/** ¿Es este manager la implementación «sin configurar» de su dominio? */
export function isNotConfigured(
  manager: { readonly notConfigured?: true } | null | undefined,
): boolean {
  return manager?.notConfigured === true;
}

/**
 * `preHandler` para módulos que, además de hablar con su manager, **escriben en un almacén
 * propio** (el alta de cámaras guarda en un fichero): contra un dominio `none` esa escritura
 * «tendría éxito» sin que nada la use. Las lecturas pasan. Es el complemento del 409 de los
 * managers `none`, para las escrituras que no llegan hasta ellos.
 */
export function requireDomainConfigured(
  domain: IntegrationDomain,
  manager: { readonly notConfigured?: true },
) {
  return async function domainConfiguredGuard(req: { method: string }): Promise<void> {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    if (isNotConfigured(manager)) throw new DomainNotConfiguredError(domain);
  };
}
