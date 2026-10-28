mod commands;
mod error;
mod fs_path;
mod watcher;

use commands::workspace::WorkspaceState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WorkspaceState::default())
        .invoke_handler(tauri::generate_handler![
            commands::workspace::open_workspace,
            commands::workspace::current_workspace,
            commands::workspace::close_workspace,
            commands::workspace::list_dir,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::create_file,
            commands::file::rename_entry,
            commands::file::delete_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
