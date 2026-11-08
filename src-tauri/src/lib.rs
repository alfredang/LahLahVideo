// LahLah Video desktop shell. The editor is the React app in ../src; this file wires up the
// plugins it needs (files, dialogs, the bundled FFmpeg sidecar, web downloads, opening links and
// folders, lahlahvideo:// deep links) and the local control API in control.rs.

mod control;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch (e.g. a lahlahvideo:// link on Windows) hands its URL to the running app.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            control::control_reply,
            control::api_info,
            control::api_set_enabled,
            control::api_regenerate_key
        ])
        .setup(|app| {
            // macOS registers the scheme from Info.plist; Windows and Linux register at runtime.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            let handle = control::start(app.handle());
            app.manage(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building LahLah Video");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(ctl) = handle.try_state::<control::ControlHandle>() {
                ctl.shutdown();
            }
        }
    });
}
