; Hooks del instalador NSIS de Tauri (los pone `bundle.windows.nsis.installerHooks`).
; Vacíos a propósito: las tareas siguientes los rellenan con lo que mida el spike.
!macro NSIS_HOOK_PREINSTALL
!macroend

; El bundler copia ficheros pero no junctions: se rehacen con el Node empaquetado y el manifiesto.
; Si falla, el instalador aborta (exit != 0): un agente sin enlaces no arranca.
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\node\node.exe" "$INSTDIR\app\links.mjs" "$INSTDIR\app\agent\node_modules" "$INSTDIR\app\links.json"' $0
  ${If} $0 <> 0
    Abort "No se pudieron rehacer los enlaces de node_modules (código $0)."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
