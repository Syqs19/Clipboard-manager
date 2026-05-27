//! System tray + gestione della finestra principale (mostra/nascondi/toggle).

use crate::settings::RuntimeState;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// Mostra e mette a fuoco la finestra principale.
pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Mostra/nascondi la finestra (usata da hotkey e click sul tray).
pub fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Crea l'icona nel tray con menu: Apri / Pausa cattura / Impostazioni / Esci.
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Apri", true, None::<&str>)?;
    let pause_i = MenuItem::with_id(app, "pause", "Pausa cattura", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Impostazioni", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &pause_i, &settings_i, &quit_i])?;

    // copia da spostare nella closure, per aggiornare l'etichetta Pausa/Riprendi
    let pause_item = pause_i.clone();

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "pause" => {
                let state = app.state::<RuntimeState>();
                let now_paused = !state.paused.load(Ordering::Relaxed);
                state.paused.store(now_paused, Ordering::Relaxed);
                let _ = pause_item.set_text(if now_paused {
                    "Riprendi cattura"
                } else {
                    "Pausa cattura"
                });
            }
            "settings" => {
                show_main_window(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
