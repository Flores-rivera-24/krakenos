#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use krakenos_window::config::{resolver_config, ruta_config, url_de_setup, Config};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const ARG_AUTOARRANQUE: &str = "--autostarted";

fn en_ingles() -> bool {
    sys_locale::get_locale().is_some_and(|l| l.to_lowercase().starts_with("en"))
}

fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn navegar(w: &WebviewWindow, url: url::Url) {
    if let Err(e) = w.navigate(url) {
        eprintln!("no se pudo navegar: {e}");
    }
}

/// Solo la primera ejecución activa el autoarranque: si el usuario lo quita en
/// «Aplicaciones de inicio» de Windows, no se vuelve a poner.
fn autoarranque_primera_vez(app: &AppHandle) {
    let Ok(dir) = app.path().app_local_data_dir() else {
        return;
    };
    let marca = dir.join("primera-ejecucion");
    if marca.exists() {
        return;
    }
    if let Err(e) = app.autolaunch().enable() {
        eprintln!("no se pudo activar el autoarranque: {e}");
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(marca, b"");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fichero = std::fs::read_to_string(ruta_config()).ok();
    let config = resolver_config(&args, fichero.as_deref()).unwrap_or_else(|e| {
        eprintln!("configuración inválida: {e:?}");
        Config::default()
    });
    // Hasta que el sondeo (siguiente tarea) decida, se enseña la página local.
    let estado_inicial = if config.origin.is_some() {
        "no-responde"
    } else {
        "sin-configurar"
    };
    let oculta = args.iter().any(|a| a == ARG_AUTOARRANQUE);
    let en = en_ingles();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            mostrar(app);
            let Some(cfg) = resolver_config(&args, None).ok() else {
                return;
            };
            let origin = cfg.origin.or_else(|| app.state::<Config>().origin.clone());
            if let (Some(token), Some(origin), Some(w)) =
                (cfg.setup_token, origin, app.get_webview_window("main"))
            {
                navegar(&w, url_de_setup(&origin, &token));
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![ARG_AUTOARRANQUE]),
        ))
        .manage(config)
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .setup(move |app| {
            autoarranque_primera_vez(app.handle());
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App(format!("index.html?estado={estado_inicial}").into()),
            )
            .title("KrakenOS")
            .inner_size(1280.0, 800.0)
            .visible(!oculta)
            .build()?;

            let (abrir, salir) = if en {
                ("Open KrakenOS", "Quit window")
            } else {
                ("Abrir KrakenOS", "Salir de la ventana")
            };
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "abrir", abrir, true, None::<&str>)?,
                    &MenuItem::with_id(app, "salir", salir, true, None::<&str>)?,
                ],
            )?;
            let mut tray = TrayIconBuilder::with_id("principal")
                .tooltip(if en {
                    "KrakenOS: connecting"
                } else {
                    "KrakenOS: conectando"
                })
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "abrir" => mostrar(app),
                    "salir" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        mostrar(tray.app_handle());
                    }
                });
            if let Some(icono) = app.default_window_icon() {
                tray = tray.icon(icono.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la ventana de KrakenOS");
}
