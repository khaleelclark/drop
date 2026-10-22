fn main() {
    tauri_plugin::Builder::new(&["dispatch"])
        .android_path("android")
        .build();
}
