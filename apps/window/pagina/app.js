// Página local de la ventana: explica por qué no se ve el agente. Solo textContent.
/* global URLSearchParams, location, navigator, document */
const T = {
  es: {
    'no-responde': [
      'KrakenOS no responde',
      'No se llega al servicio de KrakenOS en este ordenador.',
    ],
    'no-listo': ['KrakenOS no está listo', 'El servicio responde, pero todavía no está listo.'],
    certificado: [
      'El certificado no es de confianza',
      'El certificado del servicio no es válido para esta dirección. Revisa la dirección configurada.',
    ],
    'sin-configurar': [
      'KrakenOS no está configurado',
      'Falta la dirección del servicio o no se puede leer. Revísala en %ProgramData%\\KrakenOS\\window.json.',
    ],
    reintento: (s) => `Reintenta sola cada ${s} s.`,
  },
  en: {
    'no-responde': [
      'KrakenOS is not responding',
      'The KrakenOS service cannot be reached on this computer.',
    ],
    'no-listo': ['KrakenOS is not ready', 'The service is responding, but it is not ready yet.'],
    certificado: [
      'The certificate is not trusted',
      'The service certificate is not valid for this address. Check the configured address.',
    ],
    'sin-configurar': [
      'KrakenOS is not set up',
      'The service address is missing or unreadable. Check it in %ProgramData%\\KrakenOS\\window.json.',
    ],
    reintento: (s) => `Retrying automatically every ${s} s.`,
  },
};
const params = new URLSearchParams(location.search);
const idioma = navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es';
const t = T[idioma];
const ESTADOS = ['no-responde', 'no-listo', 'sin-configurar', 'certificado'];
const pedido = params.get('estado');
const estado = ESTADOS.includes(pedido) ? pedido : 'no-responde';
const [titulo, detalle] = t[estado];
const segundos = Number.parseInt(params.get('reintento') ?? '', 10);
document.documentElement.lang = idioma;
document.getElementById('titulo').textContent = titulo;
document.getElementById('detalle').textContent = detalle;
if (estado !== 'sin-configurar' && segundos > 0) {
  document.getElementById('reintento').textContent = t.reintento(segundos);
}
