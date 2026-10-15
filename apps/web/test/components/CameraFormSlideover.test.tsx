import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraFormSlideover } from '@/components/cameras/CameraFormSlideover';
import { changeLocale, setLocale } from '@/lib/i18n';

function montar() {
  return render(<CameraFormSlideover onClose={() => {}} onSaved={() => {}} />);
}

describe('CameraFormSlideover: ejemplo de URL RTSP', () => {
  afterEach(() => setLocale('es', { persist: false }));

  it('en español conserva el ejemplo carácter a carácter', () => {
    montar();
    expect(screen.getByLabelText('URL RTSP')).toHaveAttribute(
      'placeholder',
      'rtsp://usuario:contraseña@192.168.1.50:554/stream1',
    );
  });

  it('en inglés el ejemplo usa «user:password», no palabras en español', async () => {
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    montar();
    expect(screen.getByLabelText('URL RTSP')).toHaveAttribute(
      'placeholder',
      'rtsp://user:password@192.168.1.50:554/stream1',
    );
  });
});
