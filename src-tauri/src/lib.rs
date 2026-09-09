mod commands;
mod config;
mod tab_manager;

use tab_manager::{TabManager, ConnectionPool};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env once at startup: doing it per publish meant blocking cwd I/O on
    // an async worker, and made the resolved credentials depend on the process
    // working directory.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TabManager::new())
        .manage(ConnectionPool::new())
        .invoke_handler(tauri::generate_handler![
            commands::load_config_cmd,
            commands::open_tab,
            commands::close_tab,
            commands::send_message,
            commands::start_consumer,
            commands::generate_default_folder_path,
            commands::load_folder_messages,
            commands::stop_consumer,
            commands::open_folder,
            commands::read_message_file,
            commands::read_raw_config,
            commands::save_raw_config,
            commands::save_config_struct,
            commands::parse_yaml_config,
            commands::show_config_in_file_manager,
            commands::get_config_path,
            commands::read_picked_file,
            commands::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
