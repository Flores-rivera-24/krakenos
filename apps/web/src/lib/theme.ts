import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'krakenos-theme';

/** Último tema aplicado: respaldo cuando `localStorage` no está disponible. */
let aplicado: Theme | null = null;
const listeners = new Set<() => void>();

/** Lee la preferencia de tema persistida (oscuro por defecto). */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return aplicado ?? 'dark';
  }
}

/** Aplica el tema al `<html>` (clase `dark`), lo persiste en localStorage y avisa a los suscritos. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  aplicado = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // almacenamiento no disponible: el tema queda aplicado solo en memoria
  }
  listeners.forEach((l) => l());
}

/** Alterna entre claro/oscuro, lo aplica y persiste; devuelve el tema resultante. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/** Se suscribe a los cambios de tema; devuelve la función para darse de baja. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tema vigente, reactivo: todos los controles que lo muestran leen de aquí. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
