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
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
