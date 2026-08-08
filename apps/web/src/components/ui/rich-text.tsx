import { Fragment, type ReactElement } from 'react';

/**
 * Pinta una frase **ya traducida** que lleva marcado en mitad del texto.
 *
 * ## Por qué existe
 *
 * `t()` devuelve una cadena, así que una frase con un `<strong>` o un `<code>`
 * en medio solo se podía escribir partiéndola en trozos de JSX. Partirla la deja
 * **intraducible**: en otro idioma el énfasis y el dato no caen en el mismo
 * sitio de la oración, que es justo el invariante de «una frase se traduce
 * entera» (ver `lib/automations.ts`). Así que el marcado viaja **dentro** del
 * valor del catálogo y se interpreta aquí.
 *
 * No sustituye a partir en dos claves cuando cada mitad es una **oración
 * completa** —eso ya se hace y está bien—; es para el marcado que cae en mitad
 * de una cláusula.
 *
 * ## El subconjunto es cerrado a propósito
 *
 * Solo `<b>` (énfasis) y `<c>` (fragmento monoespaciado), y solo sobre texto que
 * viene del catálogo. No se interpreta HTML llegado por la red ni de la config
 * del usuario, y no hay `dangerouslySetInnerHTML`: lo que no case con las dos
 * etiquetas se pinta como texto literal. Es el mismo criterio que las plantillas
 * de la ingesta MQTT — interpretar marcado arbitrario sería ejecutar lo que
 * mande otro.
 */

/** Etiqueta del catálogo → elemento real. Subconjunto **cerrado**. */
const ETIQUETAS = { b: 'strong', c: 'code' } as const;

/** `<b>…</b>` o `<c>…</c>`, no anidados y no avariciosos. */
const MARCA = /<([bc])>([\s\S]*?)<\/\1>/g;

interface RichTextProps {
  /**
   * La frase ya traducida — es decir, el resultado de `t('clave', params)`, no
   * la clave. Mantenerlo así deja la interpolación donde ya estaba y evita que
   * esta primitiva tenga que conocer el catálogo.
   */
  children: string;
}

export function RichText({ children }: RichTextProps): ReactElement {
  const trozos: ReactElement[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;

  MARCA.lastIndex = 0;
  while ((m = MARCA.exec(children)) !== null) {
    const [completo, etiqueta, contenido] = m as unknown as [string, keyof typeof ETIQUETAS, string];
    if (m.index > cursor) {
      trozos.push(<Fragment key={trozos.length}>{children.slice(cursor, m.index)}</Fragment>);
    }
    const Etiqueta = ETIQUETAS[etiqueta];
    trozos.push(<Etiqueta key={trozos.length}>{contenido}</Etiqueta>);
    cursor = m.index + completo.length;
  }

  if (cursor < children.length) {
    trozos.push(<Fragment key={trozos.length}>{children.slice(cursor)}</Fragment>);
  }

  return <>{trozos}</>;
}
