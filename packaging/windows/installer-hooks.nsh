; Hooks del instalador NSIS de Tauri (los pone `bundle.windows.nsis.installerHooks`).

; El hook de POSTINSTALL ejecuta con privilegios `$INSTDIR\node\node.exe`: la carpeta de instalación
; tiene que ser una que el usuario de servicio no pueda modificar, o sea, bajo Program Files. Tauri deja
; elegirla en la página de directorio y con `/D=`, y no permite quitar esa página: se valida aquí.
; Se compara con el separador final (no vale `C:\Program Files Evil\…`), sin distinguir mayúsculas
; (`StrCmp`) y sin aceptar `..`.
; `${StrLoc}` (StrFunc.nsh) lo declara la plantilla de Tauri, no este fichero: el job de CI comprueba
; en el installer.nsi generado que sigue haciéndolo.
!macro NSIS_HOOK_PREINSTALL
  Push $1
  Push $2
  StrCpy $1 "$PROGRAMFILES64\"
  StrLen $2 $1
  StrCpy $2 $INSTDIR $2
  ${StrLoc} $R9 $INSTDIR ".." ">"
  ${If} $2 != $1
  ${OrIf} $R9 != ""
    DetailPrint "KrakenOS solo se instala bajo $PROGRAMFILES64: se pidió $INSTDIR"
    Abort "KrakenOS solo se puede instalar bajo $PROGRAMFILES64 (se pidió $INSTDIR). Se cancela la instalación."
  ${EndIf}
  Pop $2
  Pop $1

  ; Actualizar encima: se para el servicio de la versión anterior (con SU node y SU script) antes de
  ; copiar, o los ficheros en uso no se pisan. `stop` no hace nada si el servicio no existe.
  ; $LANGUAGE: 1034 es español; el resto, inglés.
  ${If} $LANGUAGE == 1034
    StrCpy $R8 "es"
  ${Else}
    StrCpy $R8 "en"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\installer\post-install.mjs"
  ${AndIf} ${FileExists} "$INSTDIR\node\node.exe"
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\installer\post-install.mjs" stop --lang $R8'
    Pop $0
    ${If} $0 != 0
      DetailPrint "No se pudo parar el servicio de KrakenOS (resultado: $0)"
      Abort "No se pudo parar el servicio de KrakenOS (resultado: $0). Se cancela la instalación."
    ${EndIf}
  ${EndIf}
!macroend

; El bundler copia ficheros pero no junctions: se rehacen con el Node empaquetado y el manifiesto.
; Cualquier resultado que no sea un 0 numérico aborta: si `node.exe` no llega a lanzarse, `$0` queda
; en «error» y `<>` (comparación numérica) lo leería como 0. Por eso `${Errors}` y `!=` (texto).
!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ExecWait '"$INSTDIR\node\node.exe" "$INSTDIR\app\links.mjs" "$INSTDIR\app\agent\node_modules" "$INSTDIR\app\links.json"' $0
  ${If} ${Errors}
  ${OrIf} $0 != 0
    DetailPrint "No se pudieron rehacer los enlaces de node_modules (resultado: $0)"
    Abort "No se pudieron rehacer los enlaces de node_modules (resultado: $0)."
  ${EndIf}

  ; Datos con ACL, primer arranque y servicio. Sale con código distinto de 0 ante cualquier fallo; en
  ; ese caso se aborta (no queda una instalación a medias sin avisar). Nunca se imprime el token de setup.
  ; $LANGUAGE: 1034 es español; el resto, inglés.
  ${If} $LANGUAGE == 1034
    StrCpy $R8 "es"
  ${Else}
    StrCpy $R8 "en"
  ${EndIf}
  ; Con instalación interactiva el servicio pregunta por la red Pública y avisa de la energía; con `/S`
  ; no hay diálogos y el perfil de red no se toca (sin `--interactive`).
  ${If} ${Silent}
    StrCpy $R7 ""
  ${Else}
    StrCpy $R7 " --interactive"
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\installer\post-install.mjs" install --lang $R8$R7'
  Pop $0
  ${If} $0 != 0
    DetailPrint "El servicio de KrakenOS no quedó en marcha (resultado: $0)"
    Abort "El servicio de KrakenOS no quedó en marcha (resultado: $0). Mira los mensajes anteriores y %ProgramData%\KrakenOS\logs."
  ${EndIf}

  ; La ventana se abre SIN elevar (RunAsUser, el mismo plugin de la plantilla de Tauri) con el token de
  ; setup, que solo el instalador elevado puede leer (el fichero sigue cerrado a Users). Va en $1 hasta
  ; RunAsUser: nunca a DetailPrint, MessageBox ni log, y se borra después. En silencio no hay sesión que abrir.
  ; Sin token (actualización, fichero raro, fallo del subcomando) la ventana se abre sin argumentos.
  ${IfNot} ${Silent}
    nsExec::ExecToStack '"$INSTDIR\node\node.exe" "$INSTDIR\installer\post-install.mjs" setup-token'
    Pop $0
    Pop $1
    ${If} $0 == 0
    ${AndIf} $1 != ""
      nsis_tauri_utils::RunAsUser "$INSTDIR\krakenos-window.exe" "--setup-token $1"
    ${Else}
      nsis_tauri_utils::RunAsUser "$INSTDIR\krakenos-window.exe" ""
    ${EndIf}
    Pop $0
    StrCpy $1 ""
  ${EndIf}
!macroend

; Desinstalar: ANTES de que NSIS borre nada se quita lo que el instalador creó fuera de los ficheros (servicio,
; reglas del cortafuegos, CA de Root, tarea de renovación, claves de HKLM, enlaces), con el Node empaquetado: un
; node.exe vivo bloquearía `Program Files\KrakenOS\node`. Al actualizar encima (`/UPDATE`) solo se para el
; servicio. Los datos solo se borran con `/PURGEDATA` (silencioso) o con la casilla «borrar los datos» de Tauri,
; que viene desmarcada. Un fallo se dice, pero no impide que la desinstalación termine.
; (`/PURGEDATA` empieza por `/P`, así que Tauri lo toma también como `/P`: modo pasivo, sin pregunta; es lo que
; se quiere con ese interruptor.)
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $LANGUAGE == 1034
    StrCpy $R8 "es"
  ${Else}
    StrCpy $R8 "en"
  ${EndIf}
  StrCpy $R7 ""
  ${If} $UpdateMode = 1
    StrCpy $R7 " --update"
  ${Else}
    ClearErrors
    ${GetOptions} $CMDLINE "/PURGEDATA" $R0
    ${IfNot} ${Errors}
      StrCpy $R7 " --purge-data"
    ${ElseIf} $DeleteAppDataCheckboxState = 1
      StrCpy $R7 " --purge-data"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\installer\post-install.mjs"
  ${AndIf} ${FileExists} "$INSTDIR\node\node.exe"
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\installer\post-install.mjs" uninstall --lang $R8$R7'
    Pop $0
    ${If} $0 != 0
      DetailPrint "La desinstalación de KrakenOS dejó restos (resultado: $0)"
    ${EndIf}
  ${EndIf}
!macroend

; Lo que NSIS no lista (el log del instalador, restos) se borra aquí, y solo bajo Program Files y fuera de una
; actualización. Los enlaces de `node_modules` ya se quitaron antes sin seguirlos, así que ningún `RMDir /r`
; tiene un enlace que seguir.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    StrCpy $R0 "$PROGRAMFILES64\"
    StrLen $R1 $R0
    StrCpy $R2 $INSTDIR $R1
    ${If} $R2 == $R0
      RMDir /r "$INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend
