import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from '@/components/ui/rich-text';

describe('RichText', () => {
  it('pinta el texto llano tal cual', () => {
    render(
      <p>
        <RichText>Sin marcado ninguno.</RichText>
      </p>,
    );
    expect(screen.getByText('Sin marcado ninguno.')).toBeInTheDocument();
  });

  it('convierte `<b>` en énfasis y `<c>` en monoespaciado, conservando la frase', () => {
    // Ojo: la cadena se pasa **explícita**. Escribirla suelta en el JSX haría
    // que React parseara `<b>` como elemento y `children` no sería un string —
    // en uso real siempre llega `{t('clave')}`, que sí lo es.
    const { container } = render(
      <p>
        <RichText>{'Hay que decir <b>dónde</b>, así que consulta <c>open-meteo.com</c> y ya.'}</RichText>
      </p>,
    );

    // La frase completa sigue leyéndose igual: el marcado no parte el texto.
    expect(container.textContent).toBe('Hay que decir dónde, así que consulta open-meteo.com y ya.');
    expect(container.querySelector('strong')?.textContent).toBe('dónde');
    expect(container.querySelector('code')?.textContent).toBe('open-meteo.com');
  });

  it('admite varias marcas de la misma etiqueta', () => {
    const { container } = render(
      <p>
        <RichText>{'Uno <b>dos</b> tres <b>cuatro</b>.'}</RichText>
      </p>,
    );
    expect(container.querySelectorAll('strong')).toHaveLength(2);
    expect(container.textContent).toBe('Uno dos tres cuatro.');
  });

  /**
   * El subconjunto es cerrado: lo que no sea `<b>`/`<c>` es texto, no marcado.
   * Sin esta propiedad, una cadena con HTML acabaría interpretándose, que es
   * justo lo que esta primitiva evita al no usar `innerHTML`.
   */
  it('no interpreta ninguna otra etiqueta: la pinta como texto', () => {
    const { container } = render(
      <p>
        <RichText>{'Ojo <img src=x onerror=alert(1)> y <em>esto</em> tampoco.'}</RichText>
      </p>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('Ojo <img src=x onerror=alert(1)> y <em>esto</em> tampoco.');
  });
});
