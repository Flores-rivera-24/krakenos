// Anti-flash de idioma (US-177): fija <html lang> antes de que React monte, según
// la preferencia persistida (clave: krakenos-locale) o el idioma del navegador.
// Externo (no inline) para ser compatible con una CSP estricta (script-src 'self').
(function () {
  try {
    var stored = localStorage.getItem('krakenos-locale');
    var lang = stored === 'en' || stored === 'es' ? stored : null;
    if (!lang) {
      var nav = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language;
      lang = typeof nav === 'string' && nav.toLowerCase().indexOf('en') === 0 ? 'en' : 'es';
    }
    document.documentElement.lang = lang;
  } catch (e) {
    /* localStorage/navigator no disponible: queda el `lang="es"` por defecto del <html> */
  }
})();
