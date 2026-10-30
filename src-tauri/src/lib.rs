mod commands;
mod error;
mod fs_path;
mod images;
mod recovery;
mod watcher;

use commands::workspace::WorkspaceState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WorkspaceState::default())
        // 工作区作用域的本地图片：只能读取当前工作区内白名单格式的图片。
        .register_uri_scheme_protocol("feiyeimg", |ctx, request| {
            let root = ctx.app_handle().state::<WorkspaceState>().root().ok();
            images::respond(root, &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::open_workspace,
            commands::workspace::current_workspace,
            commands::workspace::close_workspace,
            commands::workspace::list_dir,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::create_file,
            commands::file::create_folder,
            commands::file::reveal_entry,
            commands::file::rename_entry,
            commands::file::delete_entry,
            commands::recovery::save_recovery,
            commands::recovery::list_recoveries,
            commands::recovery::delete_recovery,
            commands::recovery::clear_recovery,
            commands::image_asset::save_image_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
