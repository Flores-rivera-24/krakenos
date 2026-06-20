export type Theme = 'dark' | 'light';

const KEY = 'krakenos-theme';

/** Lee la preferencia de tema persistida (oscuro por defecto). */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Aplica el tema al `<html>` (clase `dark`) y lo persiste en localStorage. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // almacenamiento no disponible: el tema queda aplicado solo en memoria
  }
}

/** Alterna entre claro/oscuro, lo aplica y persiste; devuelve el tema resultante. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
