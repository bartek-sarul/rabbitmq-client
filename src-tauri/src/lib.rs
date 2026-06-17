mod commands;
mod config;
mod tab_manager;

use tab_manager::TabManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TabManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::load_config_cmd,
            commands::open_tab,
            commands::close_tab,
            commands::send_message,
            commands::start_consumer,
            commands::stop_consumer,
            commands::open_folder,
            commands::read_message_file,
            commands::read_raw_config,
            commands::save_raw_config,
            commands::save_config_struct,
            commands::parse_yaml_config,
            commands::show_config_in_file_manager,
            commands::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
