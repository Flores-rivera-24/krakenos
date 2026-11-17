/**
 * ¿Corre dentro de la ventana de escritorio de Windows (Tauri + WebView2)? La ventana no
 * tiene IPC con la web (a propósito): se anuncia con un sufijo propio en el user agent.
 */
export function isDesktopWindow(userAgent: string = navigator.userAgent): boolean {
  return /\bKrakenOSWindow\//.test(userAgent);
}
