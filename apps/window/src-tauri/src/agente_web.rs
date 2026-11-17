//! Cómo la web sabe que corre dentro de la ventana. La ventana no tiene IPC con el contenido
//! remoto (a propósito), así que se anuncia en `navigator.userAgent`: el de WebView2 intacto
//! (conserva `Edg/` y `Chrome/`) más un sufijo propio. Es un script de inicialización y no
//! `.user_agent(..)` porque este reemplaza el UA entero y el de WebView2 no se conoce de antemano.

/// Sufijo que busca `isDesktopWindow` en `apps/web/src/lib/desktop-window.ts`.
pub fn sufijo_user_agent(version: &str) -> String {
    format!("KrakenOSWindow/{version}")
}

/// Script que se ejecuta antes que los de la página y añade el sufijo al UA que ve el JavaScript.
pub fn script_user_agent(version: &str) -> String {
    format!(
        "(()=>{{const ua=navigator.userAgent+' {}';\
Object.defineProperty(Navigator.prototype,'userAgent',{{get:()=>ua,configurable:true}});}})();",
        sufijo_user_agent(version)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_sufijo_lleva_el_nombre_y_la_version() {
        assert_eq!(sufijo_user_agent("0.1.0"), "KrakenOSWindow/0.1.0");
    }

    #[test]
    fn el_script_conserva_el_ua_original_y_le_suma_el_sufijo() {
        let s = script_user_agent("0.1.0");
        assert!(s.contains("navigator.userAgent+' KrakenOSWindow/0.1.0'"));
        assert!(s.contains("Navigator.prototype,'userAgent'"));
    }
}
