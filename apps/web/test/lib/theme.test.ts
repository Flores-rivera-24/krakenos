import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getTheme, subscribeTheme, toggleTheme, useTheme } from '@/lib/theme';

describe('tema', () => {
  beforeEach(() => {
    localStorage.clear();
    applyTheme('dark');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applyTheme notifica a los suscritos y deja de hacerlo al desuscribir', () => {
    const listener = vi.fn();
    const off = subscribeTheme(listener);
    applyTheme('light');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    applyTheme('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('useTheme se actualiza al llamar a toggleTheme fuera del componente', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('dark');
    act(() => {
      toggleTheme();
    });
    expect(result.current).toBe('light');
  });

  it('con localStorage que lanza, useTheme devuelve el tema aplicado en memoria', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const { result } = renderHook(() => useTheme());
    act(() => {
      applyTheme('light');
    });
    expect(getTheme()).toBe('light');
    expect(result.current).toBe('light');
  });
});
