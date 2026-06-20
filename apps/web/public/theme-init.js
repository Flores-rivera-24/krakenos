// Anti-flash: aplica el tema persistido antes de que React monte (clave: krakenos-theme).
// Externo (no inline) para ser compatible con una CSP estricta (script-src 'self').
(function () {
  try {
    var t = localStorage.getItem('krakenos-theme');
    if (t === 'light') document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  } catch (e) {
    /* localStorage no disponible: queda el `dark` por defecto del <html> */
  }
})();
