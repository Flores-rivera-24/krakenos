//! Autoarranque en Windows: valor `Run` del usuario actual, con la ruta del exe entre comillas.
//!
//! No se usa `tauri-plugin-autostart`: su modo `Dynamic` prueba `HKLM` primero (con el proceso
//! elevado, autoarranca para TODOS los usuarios) y escribe la ruta sin comillas (una ruta con
//! espacios, como `C:\Program Files\…`, no arranca o arranca otra cosa).

use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};

pub const NOMBRE: &str = "KrakenOS";
/// Lo que distingue un arranque de Windows de uno a mano: la ventana nace oculta.
pub const ARG_AUTOARRANQUE: &str = "--autostarted";

/// Solo el usuario actual (`HKCU`): ni toca `HKLM` ni exige elevación.
pub fn modo() -> WindowsEnableMode {
    WindowsEnableMode::CurrentUser
}

/// `auto-launch` escribe `"{ruta} {args}"` tal cual: las comillas las ponemos nosotros.
pub fn ruta_entrecomillada(ruta: &str) -> String {
    format!("\"{ruta}\"")
}

pub fn construir(nombre: &str, ruta_exe: &str) -> auto_launch::Result<AutoLaunch> {
    AutoLaunchBuilder::new()
        .set_app_name(nombre)
        .set_app_path(&ruta_entrecomillada(ruta_exe))
        .set_args(&[ARG_AUTOARRANQUE])
        .set_windows_enable_mode(modo())
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_ruta_con_espacios_va_entre_comillas() {
        assert_eq!(
            ruta_entrecomillada(r"C:\Program Files\KrakenOS\krakenos-window.exe"),
            r#""C:\Program Files\KrakenOS\krakenos-window.exe""#
        );
    }

    #[test]
    fn el_modo_es_el_usuario_actual() {
        assert!(matches!(modo(), WindowsEnableMode::CurrentUser));
    }

    #[test]
    fn el_argumento_es_el_de_la_ventana_oculta() {
        assert_eq!(ARG_AUTOARRANQUE, "--autostarted");
    }

    // Con el registro de verdad, bajo un nombre de prueba que se borra al acabar:
    // enable → is_enabled → disable sigue funcionando con la ruta entrecomillada.
    #[cfg(windows)]
    #[test]
    fn enable_y_disable_funcionan_con_la_ruta_entrecomillada() {
        let al = construir(
            "KrakenOS-test-autoarranque",
            r"C:\Program Files\KrakenOS\krakenos-window.exe",
        )
        .unwrap();
        al.enable().unwrap();
        let activo = al.is_enabled().unwrap();
        al.disable().unwrap();
        assert!(activo);
        assert!(!al.is_enabled().unwrap());
    }
}
