# Instalar KrakenOS en Windows

> **Esta guía no se ha probado en un Windows real.** Lo que sí se verifica en cada cambio: que el
> instalador se construye y que pasa una prueba de instalación en el servidor de Windows de la
> integración continua (`windows-latest`), que no es un equipo de casa.

El instalador de Windows (`KrakenOS-Setup-<versión>-x64.exe`) instala el servicio de KrakenOS, con su
propio Node.js, y la ventana de escritorio. No hace falta instalar Node, pnpm ni clonar el repositorio.

- Arquitectura: **x64** (64 bits). El archivo se llama `KrakenOS-Setup-<versión>-x64.exe`.
- Pide permisos de **administrador**: instala para todo el equipo, no para un solo usuario.
- **No está firmado**: Windows mostrará un aviso de SmartScreen (ver [más abajo](#el-aviso-de-smartscreen)).
- **No hay actualización automática en Windows todavía**: se actualiza a mano (ver [Actualizar](#actualizar)).

## Qué no hay en Windows

En Windows KrakenOS es el **cerebro** de la red, no su puerta de enlace. No incluye **servidor VPN,
cortafuegos ni QoS propios**: esas funciones solo existen en Linux, y en Windows se declaran no
disponibles. El resto (inventario, parental, IoT, cámaras, automatizaciones, alertas) funciona igual.

Además, **un equipo que se suspende no vigila**: con el equipo dormido el servicio está parado, así que
los horarios, la alarma y las rutinas no se ejecutan, y los históricos tienen huecos. Para vigilancia
continua, el equipo tiene que estar encendido y sin suspender (Configuración → Sistema → Energía). El
instalador solo avisa de esto; **no cambia tu plan de energía**.

## Descargar y verificar

Cada versión publicada en la página de versiones (_Releases_) del repositorio trae el instalador
junto con `SHA256SUMS`. Descarga los dos a la misma carpeta y comprueba la suma en PowerShell:

```powershell
Get-FileHash .\KrakenOS-Setup-<versión>-x64.exe -Algorithm SHA256
```

Compara el resultado con la línea de ese archivo en `SHA256SUMS`. Es una comprobación de que la
descarga no se dañó; **no es una firma** y no prueba quién publicó el archivo.

## El aviso de SmartScreen

Al abrir el instalador, Windows puede mostrar «Windows protegió su PC». Sale porque el instalador **no
está firmado con un certificado de código**: es una decisión del proyecto por ahora, no una señal de
que el archivo esté dañado. Si lo descargaste de la página de versiones del repositorio y la suma
coincide, puedes continuar: pulsa **Más información** y luego **Ejecutar de todas formas**.

## Instalar

1. Abre el instalador y acepta la petición de permisos de administrador.
2. KrakenOS solo se instala bajo `C:\Program Files`; si eliges otra carpeta, el instalador se cancela.
3. Al terminar, el instalador:
   - crea la carpeta de datos, con acceso solo para el servicio y los administradores;
   - configura **HTTPS** con una CA propia de KrakenOS, que importa en el almacén de confianza de este
     equipo (este PC ya confía en ella);
   - registra y arranca el servicio **KrakenOS**, de inicio automático (con retraso), que se reinicia
     solo si falla;
   - crea las reglas del **Cortafuegos de Windows** que dejan entrar al puerto del servicio (TCP, por
     defecto el 3001) y a mDNS (UDP 5353), **solo en redes privadas**;
   - si la red activa está marcada como **pública**, pregunta si quieres pasarla a privada (Windows
     bloquea ahí las conexiones entrantes y el móvil no podría abrir KrakenOS); no la cambia sin tu
     respuesta. Hazlo solo si es tu red de casa;
   - avisa de la energía (ver arriba) y abre la ventana de KrakenOS.

Si el puerto 3001 está ocupado, el instalador usa el siguiente libre y lo dice. En una instalación
silenciosa (`/S`) no hay diálogos y no se toca el perfil de red.

## Abrir `/setup` y crear el administrador

La primera vez, la ventana se abre sola con el token de configuración de un solo uso ya puesto: solo tienes
que crear el administrador. El enlace no se imprime en el instalador. Más adelante, KrakenOS se abre
desde el navegador en `https://<nombre-del-equipo>:<puerto>` (el instalador lo muestra al terminar),
o con la ventana de escritorio.

Los **móviles y otros dispositivos** deben instalar una vez el certificado de la CA: se descarga en
`https://<nombre-del-equipo>:<puerto>/api/system/ca-cert` (ver
[la guía de la app de escritorio](app-escritorio.md)).

## Dónde vive cada cosa

| Qué                                                         | Dónde                                         |
| ----------------------------------------------------------- | --------------------------------------------- |
| Programa, Node.js incluido y ventana                        | `C:\Program Files\KrakenOS\`                  |
| Datos: configuración (`.env`), base de datos, claves, HTTPS | `C:\ProgramData\KrakenOS\`                    |
| Registros del servicio                                      | `C:\ProgramData\KrakenOS\logs\`               |
| Servicio de Windows                                         | `KrakenOS`                                    |
| Renovación semanal del certificado                          | tarea programada `\KrakenOS\RenovarTLS`       |
| Registro de errores de la instalación                       | `C:\Program Files\KrakenOS\install-error.log` |

Los ajustes (`HOST`, `PORT`…) están en el `.env` de la carpeta de datos. Tras cambiarlos, reinicia el
servicio **KrakenOS** desde `services.msc`. Si cambias `PORT`, la regla del cortafuegos y el origen de
HTTPS siguen apuntando al puerto anterior: la forma segura es volver a ejecutar el instalador.

## Actualizar

**Sin actualización automática en Windows todavía:** la tarjeta de **Ajustes → Sistema →
Actualizaciones** no ofrece el botón. Para actualizar, descarga y verifica el instalador de la versión
nueva y ejecútalo **encima** de la instalación actual. El instalador para el servicio de la versión
anterior, copia los archivos y lo vuelve a registrar; **tus datos, claves y certificado se
conservan**, y el `.env` no se toca (salvo el puerto, si el que tenías está ocupado).

Antes de actualizar, conviene exportar una copia cifrada desde **Ajustes → Sistema → Copia de
seguridad** (ver [Recuperación](recovery.md)).

## Desinstalar

Como cualquier programa de Windows (Configuración → Aplicaciones, busca KrakenOS). El
desinstalador quita el servicio, las reglas del cortafuegos, la CA del almacén de confianza de este
equipo, la tarea de renovación y los programas.

- **Los datos se conservan** en `C:\ProgramData\KrakenOS`. Para borrarlos, marca «Eliminar los datos de
  aplicación» al desinstalar (viene desmarcada), o usa `/PURGEDATA` en una desinstalación silenciosa.
  Borrarlos **no se puede deshacer**: exporta antes una copia cifrada (ver [Recuperación](recovery.md)).
- Si algo no se pudo quitar, la desinstalación se detiene sin borrar nada y se puede repetir.

## Qué no se ha probado

- La instalación y la desinstalación en un equipo Windows real, con una red doméstica y un móvil.
- Los diálogos interactivos (pasar la red a privada, el aviso de energía) en un equipo de escritorio.
- Que la ventana, las passkeys y el certificado funcionen en cada versión de Windows: la guía no
  promete versiones concretas.
