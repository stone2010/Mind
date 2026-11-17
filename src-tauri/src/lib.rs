mod chat;
mod commands;
mod compression;
mod connectors;
mod credentials;
mod data;
mod db;
mod github;
mod memory;
mod models;
mod providers;

use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: db::Db,
    pub streams: chat::StreamRegistry,
    pub connectors: Arc<connectors::ConnectorManager>,
    pub approvals: connectors::ApprovalRegistry,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
            std::fs::create_dir_all(&data_dir)?;
            let database = db::Db::open(&data_dir.join("mind.db"))?;
            app.manage(AppState {
                db: database,
                streams: Arc::new(Mutex::new(Default::default())),
                connectors: Arc::new(connectors::ConnectorManager::default()),
                approvals: Arc::new(Mutex::new(std::collections::HashMap::new())),
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Mind");
            }

            // The window stays hidden until the frontend signals app_ready.
            // Fall back to showing it if the frontend never gets there.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(false) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get_all,
            commands::settings_set,
            commands::providers_get,
            commands::providers_save,
            commands::provider_remove,
            commands::credential_status,
            commands::credential_save,
            commands::credential_delete,
            commands::provider_test,
            commands::onboarding_connect,
            commands::db_list_conversations,
            commands::db_get_conversation,
            commands::db_set_conversation_summary,
            commands::db_create_conversation,
            commands::db_rename_conversation,
            commands::db_set_conversation_pinned,
            commands::db_set_conversation_archived,
            commands::db_set_conversation_project,
            commands::db_set_conversation_model,
            commands::db_touch_conversation,
            commands::db_delete_conversation,
            commands::db_get_messages,
            commands::db_insert_message,
            commands::db_finish_message,
            commands::db_update_message_content,
            commands::db_set_message_feedback,
            commands::db_delete_message,
            commands::db_delete_messages_from,
            commands::db_search,
            commands::db_list_projects,
            commands::db_create_project,
            commands::db_update_project,
            commands::db_delete_project,
            commands::db_project_conversations,
            commands::db_list_memories,
            commands::db_create_memory,
            commands::db_update_memory,
            commands::db_delete_memory,
            memory::memory_auto_extract,
            compression::context_compress,
            commands::db_log_usage,
            commands::db_list_usage,
            commands::db_conversation_usage,
            commands::db_clear_usage,
            data::data_export,
            data::data_import,
            connectors::connectors_get,
            connectors::connector_save,
            connectors::connector_delete,
            connectors::connector_set_enabled,
            connectors::connector_test,
            connectors::connectors_connect_all,
            connectors::connector_approve,
            connectors::runtime_check,
            github::github_get,
            github::github_connect,
            github::github_test,
            github::github_disconnect,
            github::github_set_enabled,
            commands::app_info,
            commands::app_ready,
            commands::open_external,
            commands::open_data_dir,
            chat::chat_stream,
            chat::chat_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mind");
}
