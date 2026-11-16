#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use krakenos_window::autoarranque::{construir, ARG_AUTOARRANQUE, NOMBRE};
use krakenos_window::config::{
    destino_segunda_ejecucion, resolver_config, ruta_config, url_de_setup, Config, ConfigError,
    Destino as DestinoSegunda,
};
use krakenos_window::estado::{
    aplicar_setup, decidir, destino_actual, estado_desde_sondeo, intervalo_segs, ruta_a_recordar,
    texto_bandeja, url_local, Destino,
};
use krakenos_window::sondeo::{cliente, sondear};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use url::Url;

/// Estado neutro de la página local (solo la marca): lo que se ve antes de medir.
const ESTADO_INICIAL: &str = "inicial";

/// Enlace de `/setup` con su token, a entregar una sola vez con el agente activo.
struct SetupPendiente(Mutex<Option<Url>>);

fn poner_tooltip(app: &AppHandle, texto: &str) {
    if let Some(t) = app.tray_by_id("principal") {
        let _ = t.set_tooltip(Some(texto));
    }
}

/// Corre en su propio hilo; el primer sondeo es inmediato. Ciclo de 2 s (página local) o 5 s (agente),
/// y 1 s tras un primer fallo dentro del agente: mide, actualiza la bandeja y navega si toca.
/// Nada de esto registra URLs: la de `/setup` lleva el token.
fn vigilar(app: AppHandle, origin: Url, base_local: Url, en: bool, estado_inicial: &'static str) {
    let http = cliente(Duration::from_secs(3));
    let mut local = Destino::Local(estado_inicial);
    let mut ultima: Option<Url> = None;
    let mut fallos = 0u32;
    loop {
        let Some(w) = app.get_webview_window("main") else {
            return;
        };
        let url_ahora = w.url().ok();
        let actual = match &url_ahora {
            Some(u) => destino_actual(u, &origin, &local),
            None => local.clone(),
        };
        if let Destino::Agente(u) = &actual {
            ultima = ruta_a_recordar(u, &origin).or(ultima);
        }
        let estado = estado_desde_sondeo(tauri::async_runtime::block_on(sondear(&http, &origin)));
        poner_tooltip(&app, texto_bandeja(Some(&estado), en));

        let setup = aplicar_setup(
            &estado,
            &mut app.state::<SetupPendiente>().0.lock().unwrap(),
        );
        let mut decision = decidir(&actual, ultima.as_ref(), &estado, Some(&origin), fallos);
        fallos = decision.fallos;
        if let Some(u) = setup {
            decision.destino = Some(Destino::Agente(u));
        }
        let mut en_pantalla = actual;
        if let Some(d) = decision.destino {
            match &d {
                Destino::Agente(u) => navegar(&w, u.clone()),
                Destino::Local(e) => {
                    navegar(&w, url_local(&base_local, e, intervalo_segs(&d)));
                    local = d.clone();
                }
            }
            en_pantalla = d;
        }
        let espera = match en_pantalla {
            Destino::Agente(_) => decision.siguiente_en_segs,
            Destino::Local(_) => intervalo_segs(&en_pantalla),
        };
        std::thread::sleep(Duration::from_secs(espera));
    }
}

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
    if std::fs::create_dir_all(&dir).is_err() || std::fs::write(&marca, b"").is_err() {
        eprintln!("no se pudo escribir la marca de primera ejecución: sin autoarranque");
        return;
    }
    let activado = std::env::current_exe()
        .map_err(|e| e.to_string())
        .and_then(|exe| construir(NOMBRE, &exe.display().to_string()).map_err(|e| e.to_string()))
        .and_then(|al| al.enable().map_err(|e| e.to_string()));
    if let Err(e) = activado {
        eprintln!("no se pudo activar el autoarranque: {e}");
        let _ = std::fs::remove_file(&marca);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fichero = std::fs::read_to_string(ruta_config()).ok();
    let config = resolver_config(&args, fichero.as_deref()).unwrap_or_else(|e| {
        // Sin el valor: el origen de --origin puede llevar usuario:clave@.
        let que = match e {
            ConfigError::Ilegible(_) => "fichero ilegible",
            ConfigError::EsquemaNoHttp(_) => "el origen no es http(s)",
            ConfigError::UrlInvalida(_) => "el origen no es una URL válida",
        };
        eprintln!("configuración inválida: {que}");
        Config::default()
    });
    // Hasta el primer sondeo la página local no afirma nada: estado neutro «inicial».
    let estado_inicial = if config.origin.is_some() {
        ESTADO_INICIAL
    } else {
        "sin-configurar"
    };
    // El token del primer arranque se entrega una sola vez, igual que el de una segunda ejecución.
    let setup_inicial = match (&config.origin, &config.setup_token) {
        (Some(o), Some(t)) if !t.is_empty() => Some(url_de_setup(o, t)),
        _ => None,
    };
    let oculta = args.iter().any(|a| a == ARG_AUTOARRANQUE);
    let en = en_ingles();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            mostrar(app);
            let origen = app.state::<Config>().origin.clone();
            // No se navega aquí: con el agente caído enseñaría una página de error.
            if let DestinoSegunda::Setup(url) = destino_segunda_ejecucion(&args, origen.as_ref()) {
                *app.state::<SetupPendiente>().0.lock().unwrap() = Some(url);
            }
        }))
        .manage(SetupPendiente(Mutex::new(setup_inicial)))
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
            // `w.url()` aquí todavía es about:blank: la base de la página local se fija a mano.
            let base_local = Url::parse(if cfg!(windows) {
                "http://tauri.localhost/index.html"
            } else {
                "tauri://localhost/index.html"
            })?;
            let sin_origen = app.state::<Config>().origin.is_none();

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
                .tooltip(if sin_origen {
                    texto_bandeja(None, en)
                } else {
                    "KrakenOS"
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
            // Sin origen no hay nada que medir: se queda la página «sin configurar».
            if let Some(origin) = app.state::<Config>().origin.clone() {
                let app = app.handle().clone();
                std::thread::spawn(move || vigilar(app, origin, base_local, en, estado_inicial));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la ventana de KrakenOS");
}
