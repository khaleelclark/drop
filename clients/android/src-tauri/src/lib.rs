#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_household::init())
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("Household Share")
                .on_navigation(|url| url.scheme() == "tauri" ||
                    (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost")))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Android application runtime failed");
}
