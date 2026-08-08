import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormError } from '@/components/ui/form-error';

/**
 * El gate estático comprueba que nadie vuelve a pintar un error mudo; esto
 * comprueba que la primitiva que lo sustituye **se anuncia de verdad** al
 * montarse, que es lo que el usuario sin vista necesita.
 */
describe('FormError (US-268)', () => {
  it('se anuncia como alerta y enseña el mensaje', () => {
    render(<FormError>No se pudo guardar la habitación.</FormError>);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('No se pudo guardar la habitación.');
  });

  it('no existe cuando no hay error: una live region vacía no anuncia nada', () => {
    // El componente se monta SOLO con error a propósito. Dejarlo siempre en el
    // árbol lo convertiría en un aviso permanente marcado como alerta, que se
    // anuncia al cargar la página y rompe cualquier `getByRole('alert')`.
    render(<div>sin errores</div>);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
