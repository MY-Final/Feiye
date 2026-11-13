mod commands;
mod error;
mod fs_path;
mod history;
mod images;
mod launch;
mod recovery;
mod watcher;

use commands::workspace::WorkspaceState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 拖到桌面图标 / 「用扉页打开」时系统把路径作为参数传进来：
    // 首个实例自己用，后续实例通过 single-instance 转发给已运行的窗口。
    let cwd = std::env::current_dir().unwrap_or_default();
    let launch_target = launch::target_from_args(std::env::args().skip(1), &cwd);

    tauri::Builder::default()
        // 单实例插件必须最先注册：第二个进程只负责把参数交出去并退出。
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let target = launch::target_from_args(argv.into_iter().skip(1), cwd.as_ref());
            if let Some(target) = target {
                let _ = app.emit("feiye://launch-path", target);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(launch::LaunchState::new(launch_target))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WorkspaceState::default())
        .manage(watcher::WatchState::default())
        // 查询代号：新查询让上一次全量扫描尽快退出。
        .manage(commands::search::SearchState::default())
        // 工作区作用域的本地图片：只能读取当前工作区内白名单格式的图片。
        .register_uri_scheme_protocol("feiyeimg", |ctx, request| {
            let root = ctx.app_handle().state::<WorkspaceState>().root().ok();
            images::respond(root, &request)
        })
        .invoke_handler(tauri::generate_handler![
            launch::take_launch_target,
            commands::workspace::open_workspace,
            commands::workspace::dir_exists,
            commands::workspace::current_workspace,
            commands::workspace::close_workspace,
            commands::workspace::list_dir,
            commands::workspace::list_markdown_files,
            commands::search::next_search_generation,
            commands::search::search_workspace,
            commands::search::replace_in_files,
            watcher::watch_workspace,
            watcher::unwatch_workspace,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::export_html,
            commands::file::next_export_name,
            commands::file::create_file,
            commands::file::create_folder,
            commands::file::reveal_entry,
            commands::file::rename_entry,
            commands::file::move_entry,
            commands::file::delete_entry,
            commands::recovery::save_recovery,
            commands::recovery::list_recoveries,
            commands::recovery::delete_recovery,
            commands::recovery::clear_recovery,
            commands::history::save_history,
            commands::history::list_history,
            commands::history::read_history,
            commands::history::storage_stats,
            commands::history::delete_history,
            commands::history::clear_history,
            commands::history::clear_recoveries,
            commands::image_asset::save_image_asset,
            commands::image_asset::read_image_data_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
