use crate::NativeState;
use std::{collections::HashSet, path::PathBuf};
use tauri::{Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

fn supported() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err("Quick sharing is available only in the Mac app".into())
    }
}
#[tauri::command]
pub async fn native_quick_context(
    state: State<'_, NativeState>,
) -> Result<serde_json::Value, String> {
    supported()?;
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || q.quick_context())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn native_quick_paste(app: tauri::AppHandle) -> Result<String, String> {
    supported()?;
    tauri::async_runtime::spawn_blocking(move || {
        let text = app.clipboard().read_text().map_err(|_| "Clipboard text is unavailable. Copy plain text, then try Paste again")?;
        if text.is_empty() { return Err("The clipboard has no text. Copy text or use Send Files".into()); }
        if text.len() > 8 * 1024 * 1024 { return Err("Clipboard text exceeds 8 MiB. Save it as a text file and use Send Files; nothing was truncated".into()); }
        Ok(text)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command(rename_all = "camelCase")]
pub async fn native_quick_send_text(
    state: State<'_, NativeState>,
    base_url: String,
    source_device_id: String,
    target_device_ids: Vec<String>,
    text: String,
) -> Result<serde_json::Value, String> {
    supported()?;
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        q.quick_send_text(&base_url, &source_device_id, target_device_ids, text)
            .map(|item_id| serde_json::json!({"itemId": item_id}))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn enqueue(
    q: &household_native::Queue,
    context: &household_native::SendContext,
    paths: Vec<PathBuf>,
) -> Result<serde_json::Value, String> {
    let mut queued = 0;
    let mut seen = HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        if let Err(error) = q.enqueue_prepared(&path, "file", context) {
            return Err(format!("{queued} earlier selections were queued. {error}. This selection could not be confirmed and may already be queued. Open Drop → Transfers before adding it again"));
        }
        queued += 1;
    }
    Ok(serde_json::json!({"queued":queued,"cancelled":false}))
}
#[tauri::command(rename_all = "camelCase")]
pub async fn native_quick_drop(
    state: State<'_, NativeState>,
    base_url: String,
    source_device_id: String,
    target_device_ids: Vec<String>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    supported()?;
    if paths.is_empty()
        || paths.len() > 100
        || paths.iter().any(|p| {
            p.is_empty() || p.len() > 8192 || p.contains('\0') || !PathBuf::from(p).is_absolute()
        })
    {
        return Err("Drop up to 100 existing files or folders with valid paths".into());
    }
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = q.quick_prepare(&base_url, &source_device_id, target_device_ids)?;
        enqueue(&q, &context, paths.into_iter().map(PathBuf::from).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command(rename_all = "camelCase")]
pub async fn native_quick_pick(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
    base_url: String,
    source_device_id: String,
    target_device_ids: Vec<String>,
    kind: String,
) -> Result<serde_json::Value, String> {
    supported()?;
    if !matches!(kind.as_str(), "file" | "folder") {
        return Err("Choose files or a folder".into());
    }
    let q = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = q.quick_prepare(&base_url, &source_device_id, target_device_ids)?;
        #[cfg(target_os = "macos")]
        let _picker = lifecycle::PickerGuard::new(&app)?;
        let dialog = app.dialog().file().set_title("Send with Drop");
        let files = if kind == "folder" {
            dialog.blocking_pick_folder().map(|p| vec![p])
        } else {
            dialog.blocking_pick_files()
        };
        let Some(files) = files else {
            return Ok(serde_json::json!({"queued":0,"cancelled":true}));
        };
        if files.len() > 100 {
            return Err("Select up to 100 files at once".into());
        }
        let paths = files
            .into_iter()
            .map(|p| p.into_path().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        enqueue(&q, &context, paths)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn native_quick_hide(app: tauri::AppHandle) -> Result<(), String> {
    supported()?;
    if let Some(w) = app.get_webview_window("quick-share") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn native_quick_open(app: tauri::AppHandle) -> Result<(), String> {
    native_quick_hide(app.clone())?;
    crate::show(&app);
    Ok(())
}
#[tauri::command]
pub fn native_quick_quit(app: tauri::AppHandle, state: State<NativeState>) -> Result<(), String> {
    supported()?;
    state.shutdown()?;
    app.exit(0);
    Ok(())
}
#[tauri::command]
pub fn native_quick_resize(app: tauri::AppHandle, detail: bool) -> Result<(), String> {
    supported()?;
    #[cfg(target_os = "macos")]
    return lifecycle::resize(&app, detail);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, detail);
        Err("Quick sharing is available only in the Mac app".into())
    }
}

#[cfg(target_os = "macos")]
pub mod lifecycle {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };
    use tauri::{
        tray::{MouseButton, MouseButtonState, TrayIconEvent},
        WebviewUrl, WebviewWindowBuilder,
    };
    struct Anchor {
        point: tauri::PhysicalPosition<f64>,
        rect: tauri::Rect,
    }
    struct Panel {
        anchor: Mutex<Option<Anchor>>,
        detail: AtomicBool,
        picking: AtomicBool,
    }
    pub fn setup(app: &tauri::App) -> tauri::Result<()> {
        app.manage(Panel {
            anchor: Mutex::new(None),
            detail: AtomicBool::new(false),
            picking: AtomicBool::new(false),
        });
        WebviewWindowBuilder::new(
            app,
            "quick-share",
            WebviewUrl::App("index.html?quick-share=1".into()),
        )
        .title("Drop quick share")
        .inner_size(360.0, 520.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
        Ok(())
    }
    pub fn resize(app: &tauri::AppHandle, detail: bool) -> Result<(), String> {
        let panel = app.state::<Panel>();
        panel.detail.store(detail, Ordering::SeqCst);
        let anchor = panel.anchor.lock().map_err(|e| e.to_string())?;
        let Some(anchor) = anchor.as_ref() else {
            return Ok(());
        };
        let w = app
            .get_webview_window("quick-share")
            .ok_or("Quick-share panel unavailable; use Open Drop")?;
        let monitor = w
            .available_monitors()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| {
                let p = m.position();
                let s = m.size();
                anchor.point.x >= p.x as f64
                    && anchor.point.y >= p.y as f64
                    && anchor.point.x < (p.x as f64 + s.width as f64)
                    && anchor.point.y < (p.y as f64 + s.height as f64)
            })
            .ok_or("The menu-bar display is unavailable; use Open Drop")?;
        let scale = monitor.scale_factor();
        let pos = anchor.rect.position.to_physical::<f64>(scale);
        let size = anchor.rect.size.to_physical::<f64>(scale);
        let area = monitor.work_area();
        let (x, y, width, height) = crate::panel_position::layout(
            (pos.x, pos.y, size.width, size.height),
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
            scale,
            detail,
        );
        w.set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        w.set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())
    }
    pub fn tray_event(app: &tauri::AppHandle, event: TrayIconEvent) {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            position,
            rect,
            ..
        } = event
        {
            if let Some(w) = app.get_webview_window("quick-share") {
                if w.is_visible().unwrap_or(false) {
                    let _ = w.hide();
                    return;
                }
                let panel = app.state::<Panel>();
                if let Ok(mut anchor) = panel.anchor.lock() {
                    *anchor = Some(Anchor {
                        point: position,
                        rect,
                    });
                }
                if let Err(error) = resize(app, panel.detail.load(Ordering::SeqCst)) {
                    eprintln!("{error}");
                    crate::show(app);
                    return;
                }
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
    pub fn blur(window: &tauri::Window) {
        if !window.state::<Panel>().picking.load(Ordering::SeqCst) {
            let _ = window.hide();
        }
    }
    pub struct PickerGuard(tauri::AppHandle);
    impl PickerGuard {
        pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
            if app.state::<Panel>().picking.swap(true, Ordering::SeqCst) {
                return Err("A picker is already open".into());
            }
            Ok(Self(app.clone()))
        }
    }
    impl Drop for PickerGuard {
        fn drop(&mut self) {
            self.0
                .state::<Panel>()
                .picking
                .store(false, Ordering::SeqCst);
            if let Some(w) = self.0.get_webview_window("quick-share") {
                if w.is_visible().unwrap_or(false) {
                    let _ = w.set_focus();
                }
            }
        }
    }
}
