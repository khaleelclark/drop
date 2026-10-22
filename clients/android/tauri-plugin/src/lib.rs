use serde_json::{json, Value};
use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

#[cfg(target_os = "android")]
struct Mobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn dispatch<R: Runtime>(app: tauri::AppHandle<R>, command: String, args_json: String) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<Mobile<R>>().0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            handle.run_mobile_plugin("dispatch", json!({"command": command, "argsJson": args_json}))
                .map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (app, command, args_json); Err("Household mobile plugin requires Android".into()) }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("household")
        .invoke_handler(tauri::generate_handler![dispatch])
        .js_init_script(include_str!("init.js"))
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Mobile(api.register_android_plugin("household.share.android", "HouseholdPlugin")?));
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        }).build()
}
