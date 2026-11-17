//! Local data export/import. API keys and GitHub tokens are intentionally
//! excluded: they live only in Windows Credential Manager.

use crate::db::now_millis;
use crate::models::*;
use crate::AppState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const FORMAT: &str = "mind-backup";
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    version: u32,
    exported_at: i64,
    conversations: Vec<Conversation>,
    messages: Vec<Message>,
    projects: Vec<Project>,
    memories: Vec<Memory>,
    usage: Vec<UsageLog>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub conversations: usize,
    pub messages: usize,
    pub projects: usize,
    pub memories: usize,
    pub usage: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub conversations: usize,
    pub messages: usize,
    pub projects: usize,
    pub memories: usize,
    pub usage: usize,
    pub replaced: bool,
}

fn conversation_rows(conn: &rusqlite::Connection) -> Result<Vec<Conversation>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, model_id, project_id, pinned, archived,
                    summary, summary_upto, created_at, updated_at
             FROM conversations ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Conversation {
                id: r.get(0)?,
                title: r.get(1)?,
                model_id: r.get(2)?,
                project_id: r.get(3)?,
                pinned: r.get::<_, i64>(4)? != 0,
                archived: r.get::<_, i64>(5)? != 0,
                summary: r.get(6)?,
                summary_upto: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn message_rows(conn: &rusqlite::Connection) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, reasoning, attachments,
                    status, feedback, model_id, sources, server_tool_calls,
                    connector_calls, created_at
             FROM messages ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Message {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                reasoning: r.get(4)?,
                attachments: r.get(5)?,
                status: r.get(6)?,
                feedback: r.get(7)?,
                model_id: r.get(8)?,
                sources: r.get(9)?,
                server_tool_calls: r.get(10)?,
                connector_calls: r.get(11)?,
                created_at: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn project_rows(conn: &rusqlite::Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id)
             FROM projects p ORDER BY p.created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                conversation_count: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn memory_rows(conn: &rusqlite::Connection) -> Result<Vec<Memory>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, content, source, source_conversation_id, created_at, updated_at
             FROM memories ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Memory {
                id: r.get(0)?,
                content: r.get(1)?,
                source: r.get(2)?,
                source_conversation_id: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn usage_rows(conn: &rusqlite::Connection) -> Result<Vec<UsageLog>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, message_id, provider_id, model_id, kind,
                    prompt_tokens, completion_tokens, total_tokens,
                    prompt_cache_hit_tokens, prompt_cache_miss_tokens, created_at
             FROM usage_logs ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(UsageLog {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                message_id: r.get(2)?,
                provider_id: r.get(3)?,
                model_id: r.get(4)?,
                kind: r.get(5)?,
                prompt_tokens: r.get(6)?,
                completion_tokens: r.get(7)?,
                total_tokens: r.get(8)?,
                prompt_cache_hit_tokens: r.get(9)?,
                prompt_cache_miss_tokens: r.get(10)?,
                created_at: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn data_export(state: State<'_, AppState>, path: String) -> Result<ExportResult, String> {
    let conn = state.db.conn.lock().unwrap();
    let backup = Backup {
        format: FORMAT.into(),
        version: VERSION,
        exported_at: now_millis(),
        conversations: conversation_rows(&conn)?,
        messages: message_rows(&conn)?,
        projects: project_rows(&conn)?,
        memories: memory_rows(&conn)?,
        usage: usage_rows(&conn)?,
    };
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("无法写入备份文件: {e}"))?;
    Ok(ExportResult {
        path,
        conversations: backup.conversations.len(),
        messages: backup.messages.len(),
        projects: backup.projects.len(),
        memories: backup.memories.len(),
        usage: backup.usage.len(),
    })
}

fn insert_project(tx: &rusqlite::Transaction, item: &Project) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO projects (id, name, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item.id, item.name, item.description, item.created_at, item.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_conversation(tx: &rusqlite::Transaction, item: &Conversation) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO conversations
         (id, title, model_id, project_id, pinned, archived, summary, summary_upto, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            item.id,
            item.title,
            item.model_id,
            item.project_id,
            if item.pinned { 1 } else { 0 },
            if item.archived { 1 } else { 0 },
            item.summary,
            item.summary_upto,
            item.created_at,
            item.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_message(tx: &rusqlite::Transaction, item: &Message) -> Result<(), String> {
    let conversation_exists: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM conversations WHERE id = ?1",
            [&item.conversation_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if conversation_exists.is_none() {
        return Err(format!(
            "备份中的消息引用了不存在的会话: {}",
            item.conversation_id
        ));
    }
    tx.execute(
        "INSERT OR REPLACE INTO messages
         (id, conversation_id, role, content, reasoning, attachments, status, feedback,
          model_id, sources, server_tool_calls, connector_calls, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            item.id,
            item.conversation_id,
            item.role,
            item.content,
            item.reasoning,
            item.attachments,
            item.status,
            item.feedback,
            item.model_id,
            item.sources,
            item.server_tool_calls,
            item.connector_calls,
            item.created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_memory(tx: &rusqlite::Transaction, item: &Memory) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO memories
         (id, content, source, source_conversation_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            item.id,
            item.content,
            item.source,
            item.source_conversation_id,
            item.created_at,
            item.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_usage(tx: &rusqlite::Transaction, item: &UsageLog) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO usage_logs
         (id, conversation_id, message_id, provider_id, model_id, kind,
          prompt_tokens, completion_tokens, total_tokens,
          prompt_cache_hit_tokens, prompt_cache_miss_tokens, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            item.id,
            item.conversation_id,
            item.message_id,
            item.provider_id,
            item.model_id,
            item.kind,
            item.prompt_tokens,
            item.completion_tokens,
            item.total_tokens,
            item.prompt_cache_hit_tokens,
            item.prompt_cache_miss_tokens,
            item.created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn data_import(
    state: State<'_, AppState>,
    path: String,
    replace: bool,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("无法读取备份文件: {e}"))?;
    let backup: Backup =
        serde_json::from_str(&content).map_err(|e| format!("备份格式无效: {e}"))?;
    if backup.format != FORMAT {
        return Err("这不是 Mind 备份文件".into());
    }
    if backup.version > VERSION {
        return Err("备份版本高于当前 Mind 支持的版本".into());
    }

    let mut conn = state.db.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if replace {
        tx.execute("DELETE FROM messages", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM usage_logs", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM memories", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM conversations", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM projects", []).map_err(|e| e.to_string())?;
    }

    for item in &backup.projects {
        insert_project(&tx, item)?;
    }
    for item in &backup.conversations {
        insert_conversation(&tx, item)?;
    }
    for item in &backup.messages {
        insert_message(&tx, item)?;
    }
    for item in &backup.memories {
        insert_memory(&tx, item)?;
    }
    for item in &backup.usage {
        insert_usage(&tx, item)?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(ImportResult {
        conversations: backup.conversations.len(),
        messages: backup.messages.len(),
        projects: backup.projects.len(),
        memories: backup.memories.len(),
        usage: backup.usage.len(),
        replaced: replace,
    })
}
