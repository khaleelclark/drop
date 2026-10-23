#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use household_native::{
    ApiResponse, ArrivalSettings, ArrivalTarget, Config, ConnectionView, Queue, TransferView,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use zing_desktop_notifications::ArrivalNotifier;

type NativeState = Arc<Queue>;
#[tauri::command(rename_all = "camelCase")]
fn native_configure(
    state: State<NativeState>,
    base_url: String,
    token: String,
    source_device: String,
) -> Result<(), String> {
    state.configure(Config {
        base_url,
        token,
        source_device,
    })
}
#[tauri::command]
async fn native_disconnect(state: State<'_, NativeState>) -> Result<(), String> {
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || q.disconnect())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn native_get_config(state: State<NativeState>) -> Result<ConnectionView, String> {
    state.connection()
}
#[tauri::command(rename_all = "camelCase")]
fn native_cancel_api(state: State<NativeState>, request_id: String) -> Result<(), String> {
    state.cancel_api(&request_id)
}
#[tauri::command]
fn native_list_transfers(state: State<NativeState>) -> Result<Vec<TransferView>, String> {
    state.list()
}
#[tauri::command(rename_all = "camelCase")]
fn native_enqueue_upload(
    state: State<NativeState>,
    path: String,
    kind: Option<String>,
    target_device_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let context = state.prepare_send(None, target_device_ids)?;
    state.enqueue_prepared(
        &PathBuf::from(path),
        kind.as_deref().unwrap_or("file"),
        &context,
    )
}
#[tauri::command(rename_all = "camelCase")]
async fn native_pick_uploads(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
    kind: Option<String>,
    source_device: Option<String>,
    target_device_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = q.prepare_send(source_device, target_device_ids)?;
        if let Some(files) = app
            .dialog()
            .file()
            .set_title("Send with Zing")
            .blocking_pick_files()
        {
            for file in files {
                let path = file.into_path().map_err(|e| e.to_string())?;
                q.enqueue_prepared(&path, kind.as_deref().unwrap_or("file"), &context)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command(rename_all = "camelCase")]
async fn native_download(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
    item_id: String,
    name: String,
) -> Result<Option<String>, String> {
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Server-provided name is a suggestion, never a path.
        let safe = PathBuf::from(&name)
            .file_name()
            .map(|p| p.to_string_lossy().replace(['\\', '/'], "_"))
            .unwrap_or_else(|| "download".into());
        match app
            .dialog()
            .file()
            .set_title("Save from Zing")
            .set_file_name(safe)
            .blocking_save_file()
        {
            Some(file) => q
                .download(item_id, name, file.into_path().map_err(|e| e.to_string())?)
                .map(Some),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn native_control(state: State<NativeState>, id: String, action: String) -> Result<(), String> {
    state.control(&id, &action)
}
#[tauri::command]
fn native_copy_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.len() > 8 * 1024 * 1024 {
        return Err("Text exceeds clipboard preparation budget; use Download".into());
    }
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}
#[tauri::command(rename_all = "camelCase")]
async fn native_api(
    state: State<'_, NativeState>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    request_id: Option<String>,
) -> Result<ApiResponse, String> {
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || q.api_with_id(&method, &path, body, request_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn native_get_arrival_settings(state: State<NativeState>) -> Result<ArrivalSettings, String> {
    state.arrival_settings()
}
#[tauri::command(rename_all = "camelCase")]
async fn native_set_arrival_enabled(
    state: State<'_, NativeState>,
    notifier: State<'_, Arc<ArrivalNotifier>>,
    enabled: bool,
) -> Result<ArrivalSettings, String> {
    let q = state.inner().clone();
    let notifier = notifier.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Only this explicit Enable command may ask; acceptance never proves OS presentation.
        if enabled {
            notifier.request_permission()?;
        }
        q.set_arrival_enabled(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn native_take_arrival_target(state: State<NativeState>) -> Result<Option<ArrivalTarget>, String> {
    state.take_arrival_target()
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == "--background") {
                show(app);
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            native_configure,
            native_disconnect,
            native_get_config,
            native_cancel_api,
            native_list_transfers,
            native_enqueue_upload,
            native_pick_uploads,
            native_download,
            native_control,
            native_copy_text,
            native_api,
            native_get_arrival_settings,
            native_set_arrival_enabled,
            native_take_arrival_target
        ])
        .setup(|app| {
            let queue =
                Queue::open(household_native::data_dir()?).map_err(std::io::Error::other)?;
            app.manage(queue.clone());
            queue.start();
            let click_queue = queue.clone();
            let click_app = app.handle().clone();
            // Listener precedes any send. Persist before scheduling window work on the UI thread.
            let notifier = Arc::new(
                ArrivalNotifier::new(move |target| {
                    if click_queue.record_arrival_click(target).is_ok() {
                        let app = click_app.clone();
                        let _ = click_app.run_on_main_thread(move || show(&app));
                    }
                })
                .map_err(std::io::Error::other)?,
            );
            app.manage(notifier.clone());
            queue.start_arrivals(move |banner| notifier.post(banner));
            let show_item = MenuItem::with_id(app, "show", "Open Zing", true, None::<&str>)?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                "Pause transfers and Quit Zing",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show_item, &quit])?;
            let mut pixels = vec![0u8; 32 * 32 * 4];
            for y in 4..28 {
                for x in 4..28 {
                    let i = (y * 32 + x) * 4;
                    pixels[i] = 40;
                    pixels[i + 1] = 153;
                    pixels[i + 2] = 129;
                    pixels[i + 3] = 255;
                }
            }
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(pixels, 32, 32))
                .tooltip("Zing")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "quit" => {
                        if let Some(q) = app.try_state::<NativeState>() {
                            let _ = q.shutdown();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            // A global shortcut opens the composer; registration failure does not disable transfers.
            if let Err(e) = app.global_shortcut().register("CommandOrControl+Shift+H") {
                eprintln!("Shortcut unavailable: {e}");
            }
            if std::env::args().any(|a| a == "--background") {
                if let Some(w) = app.get_webview_window("main") {
                    w.hide()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize Zing")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(q) = app.try_state::<NativeState>() {
                    let _ = q.shutdown();
                }
            }
        });
}
