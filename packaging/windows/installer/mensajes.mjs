/** Mensajes del instalador de Windows (es/en). El idioma lo pasa NSIS con `--lang`. */
export const CATALOGO = {
  es: {
    puertoOcupado: (pref, usado) =>
      `El puerto ${pref} está ocupado en este equipo: KrakenOS usará el ${usado}.`,
    listo: (puerto) => `El servicio de KrakenOS está en marcha en el puerto ${puerto}.`,
    tlsListo: (origen) =>
      `HTTPS listo en ${origen}. Este PC ya confía en la CA local; cada móvil debe instalarla una vez (se descarga en ${origen}/api/system/ca-cert).`,
    caRotada: () =>
      'La carpeta de la CA estaba abierta a otros usuarios: se generó una CA nueva y se quitó la anterior de este PC. Los móviles que confiaban en la anterior deben instalar la nueva.',
    cortafuegosListo: (puerto) =>
      `Cortafuegos: KrakenOS acepta conexiones en el puerto ${puerto} solo en redes privadas.`,
    tituloDialogo: () => 'KrakenOS',
    preguntaRedPrivada: (red) =>
      `La red «${red}» está marcada como pública y Windows bloquea en ella las conexiones entrantes: el móvil no podría abrir KrakenOS. ¿Quieres pasarla a privada? Cambia el perfil de esa red y este equipo será visible para los demás de ella; hazlo solo si es tu red de casa.`,
    redCambiada: (red) => `La red «${red}» ahora es privada.`,
    redRechazada: (red) =>
      `La red «${red}» sigue siendo pública: el móvil no llegará a KrakenOS hasta que la pases a privada (Configuración → Red e Internet → propiedades de la red).`,
    redPublicaSilencio: (red) =>
      `La red «${red}» es pública y la instalación silenciosa no cambia el perfil de red: el móvil no llegará a KrakenOS hasta que la pases a privada (Configuración → Red e Internet → propiedades de la red).`,
    redNoPrivada: () =>
      'La red activa no es privada (es de dominio o no hay conexión): la regla del cortafuegos solo vale en redes privadas, así que el móvil no llegará a KrakenOS desde ella.',
    energia: () =>
      'Si este equipo se suspende, KrakenOS deja de vigilar: horarios, alarma y rutinas no se ejecutan mientras duerme. Puedes cambiarlo en Configuración, en las opciones de energía (busca "suspender").',
    fallo: (detalle) => `La instalación de KrakenOS no terminó: ${detalle}`,
    datosConservados: (dir) =>
      `Tus datos se conservan en ${dir}. Para borrarlos, desinstala marcando «Eliminar los datos de aplicación» o con /PURGEDATA.`,
    datosAjenos: (dir) =>
      `No se borró ${dir}: no figura como carpeta de datos de KrakenOS en este equipo. Revísala y bórrala a mano si quieres.`,
    programaAjeno: (dir) =>
      `No se limpió ${dir}: no es la carpeta estándar de KrakenOS (Program Files\\KrakenOS) y solo se quitó lo que el desinstalador lista. Revísala a mano.`,
    falloDesinstalar: (detalle) => `La desinstalación de KrakenOS dejó restos: ${detalle}`,
  },
  en: {
    puertoOcupado: (pref, usado) =>
      `Port ${pref} is already in use on this PC: KrakenOS will use ${usado}.`,
    listo: (puerto) => `The KrakenOS service is running on port ${puerto}.`,
    tlsListo: (origen) =>
      `HTTPS is ready at ${origen}. This PC already trusts the local CA; each phone must install it once (download it at ${origen}/api/system/ca-cert).`,
    caRotada: () =>
      'The CA folder was open to other users: a new CA was generated and the old one was removed from this PC. Phones that trusted the old one must install the new one.',
    cortafuegosListo: (puerto) =>
      `Firewall: KrakenOS accepts connections on port ${puerto} on private networks only.`,
    tituloDialogo: () => 'KrakenOS',
    preguntaRedPrivada: (red) =>
      `The network "${red}" is set to public, and Windows blocks incoming connections on it: your phone could not open KrakenOS. Do you want to switch it to private? This changes that network's profile and makes this PC visible to the other devices on it; only do it if it is your home network.`,
    redCambiada: (red) => `The network "${red}" is now private.`,
    redRechazada: (red) =>
      `The network "${red}" is still public: your phone will not reach KrakenOS until you switch it to private (Settings → Network & internet → network properties).`,
    redPublicaSilencio: (red) =>
      `The network "${red}" is public and the silent install does not change the network profile: your phone will not reach KrakenOS until you switch it to private (Settings → Network & internet → network properties).`,
    redNoPrivada: () =>
      'The active network is not private (it is a domain network or there is no connection): the firewall rule only applies on private networks, so your phone will not reach KrakenOS from it.',
    energia: () =>
      'If this PC goes to sleep, KrakenOS stops watching: schedules, the alarm and routines do not run while it sleeps. You can change this in Settings, in the power options (search for "sleep").',
    fallo: (detalle) => `The KrakenOS installation did not finish: ${detalle}`,
    datosConservados: (dir) =>
      `Your data is kept in ${dir}. To delete it, uninstall with "Delete the application data" checked or with /PURGEDATA.`,
    datosAjenos: (dir) =>
      `${dir} was not deleted: it is not registered as a KrakenOS data folder on this PC. Check it and delete it by hand if you want.`,
    programaAjeno: (dir) =>
      `${dir} was not cleaned: it is not the standard KrakenOS folder (Program Files\\KrakenOS), so only what the uninstaller lists was removed. Check it by hand.`,
    falloDesinstalar: (detalle) => `The KrakenOS uninstall left some leftovers: ${detalle}`,
  },
};

export function msg(lang, clave, ...args) {
  return (CATALOGO[lang] ?? CATALOGO.es)[clave](...args);
}
