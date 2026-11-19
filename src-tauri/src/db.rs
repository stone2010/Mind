use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 1;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("无法打开本地数据库: {e}"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("设置数据库等待超时失败: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| format!("数据库初始化失败: {e}"))?;
        let db = Db {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        db.ensure_fts()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "数据库连接状态异常，无法执行迁移。".to_string())?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| format!("无法读取数据库版本: {e}"))?;
        if version > SCHEMA_VERSION {
            return Err(format!(
                "数据库版本 {version} 高于当前 Mind 支持的版本 {SCHEMA_VERSION}。\
                 请升级 Mind 再打开这份数据，避免降级损坏聊天记录和记忆。"
            ));
        }
        if version == SCHEMA_VERSION {
            return Ok(());
        }

        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("数据库迁移无法开始事务: {e}"))?;
        if version < 1 {
            migrate_v1(&tx)
                .map_err(|e| format!("数据库升级到版本 1 失败，已回滚，原有数据未修改: {e}"))?;
        }
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("写入数据库版本失败: {e}"))?;
        tx.commit()
            .map_err(|e| format!("提交数据库迁移失败，已回滚: {e}"))?;
        Ok(())
    }

    fn ensure_fts(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "数据库连接状态异常，无法初始化全文索引。".to_string())?;
        ensure_fts(&conn)
    }
}

fn migrate_v1(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            model_id TEXT,
            project_id TEXT,
            pinned INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            summary TEXT,
            summary_upto INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            reasoning TEXT,
            attachments TEXT,
            status TEXT NOT NULL DEFAULT 'complete',
            feedback INTEGER,
            model_id TEXT,
            sources TEXT,
            server_tool_calls TEXT,
            connector_calls TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            source_conversation_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_logs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            message_id TEXT,
            provider_id TEXT,
            model_id TEXT,
            kind TEXT NOT NULL DEFAULT 'chat',
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
            prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS memory_versions (
            id TEXT PRIMARY KEY,
            memory_id TEXT NOT NULL,
            content TEXT NOT NULL,
            memory_type TEXT NOT NULL,
            subject TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence REAL NOT NULL,
            importance REAL NOT NULL,
            changed_at INTEGER NOT NULL,
            reason TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memory_versions_memory
            ON memory_versions(memory_id, changed_at DESC);

        CREATE TABLE IF NOT EXISTS memory_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id TEXT NOT NULL,
            conversation_id TEXT,
            message_id TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memory_sources_memory
            ON memory_sources(memory_id);
        "#,
    )
    .map_err(|e| e.to_string())?;

    // Columns added after earlier releases. Checking pragma_table_info first
    // keeps this idempotent without discarding real ALTER TABLE failures.
    ensure_column(tx, "messages", "sources", "TEXT")?;
    ensure_column(tx, "messages", "server_tool_calls", "TEXT")?;
    ensure_column(tx, "messages", "connector_calls", "TEXT")?;
    ensure_column(tx, "conversations", "summary", "TEXT")?;
    ensure_column(
        tx,
        "conversations",
        "summary_upto",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        tx,
        "usage_logs",
        "prompt_cache_hit_tokens",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        tx,
        "usage_logs",
        "prompt_cache_miss_tokens",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(tx, "memories", "source", "TEXT NOT NULL DEFAULT 'manual'")?;
    ensure_column(tx, "memories", "source_conversation_id", "TEXT")?;
    ensure_column(
        tx,
        "memories",
        "memory_type",
        "TEXT NOT NULL DEFAULT 'profile'",
    )?;
    ensure_column(tx, "memories", "subject", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(tx, "memories", "source_message_id", "TEXT")?;
    ensure_column(
        tx,
        "memories",
        "confidence",
        "REAL NOT NULL DEFAULT 0.8",
    )?;
    ensure_column(
        tx,
        "memories",
        "importance",
        "REAL NOT NULL DEFAULT 0.5",
    )?;
    ensure_column(tx, "memories", "status", "TEXT NOT NULL DEFAULT 'active'")?;
    ensure_column(tx, "memories", "valid_from", "INTEGER")?;
    ensure_column(tx, "memories", "valid_until", "INTEGER")?;
    ensure_column(tx, "memories", "last_accessed_at", "INTEGER")?;
    ensure_column(tx, "memories", "metadata", "TEXT")?;

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
            [column],
            |row| row.get(0),
        )
        .map_err(|e| format!("无法检查 {table}.{column} 列: {e}"))?;
    Ok(count > 0)
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if table_has_column(conn, table, column)? {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map_err(|e| format!("升级列 {table}.{column} 失败: {e}"))?;
    Ok(())
}

fn ensure_fts(conn: &Connection) -> Result<(), String> {
    let existed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("无法检查全文索引: {e}"))?;

    // FTS5 is optional at runtime: if this SQLite build lacks it, search falls
    // back to LIKE. Other failures are real migration errors and must surface.
    if let Err(error) = conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            memory_id UNINDEXED,
            content,
            subject,
            tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(memory_id, content, subject)
            VALUES (new.id, new.content, new.subject);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
            DELETE FROM memories_fts WHERE memory_id = old.id;
            INSERT INTO memories_fts(memory_id, content, subject)
            SELECT new.id, new.content, new.subject WHERE new.status = 'active';
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
            DELETE FROM memories_fts WHERE memory_id = old.id;
        END;
        "#,
    ) {
        let message = error.to_string().to_lowercase();
        if message.contains("no such module: fts5") || message.contains("no such module") {
            eprintln!("[db] FTS5 不可用，记忆搜索将回退到 LIKE: {error}");
            return Ok(());
        }
        return Err(format!("全文索引初始化失败: {error}"));
    }

    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE status = 'active'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("无法统计有效记忆: {e}"))?;
    let indexed: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories_fts", [], |row| row.get(0))
        .map_err(|e| format!("无法统计全文索引: {e}"))?;

    if existed == 0 || active != indexed {
        conn.execute_batch(
            r#"
            DELETE FROM memories_fts;
            INSERT INTO memories_fts(memory_id, content, subject)
                SELECT id, content, subject FROM memories WHERE status = 'active';
            "#,
        )
        .map_err(|e| format!("重建记忆全文索引失败: {e}"))?;
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "mind-db-{name}-{}.db",
            uuid::Uuid::new_v4()
        ))
    }

    fn remove_db(path: &std::path::Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn opens_and_migrates_memory_engine_schema() {
        let path = temp_path("memory-schema");
        let db = Db::open(&path).expect("database opens and migrates");
        {
            let conn = db.conn.lock().unwrap();
            let columns: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('memories')
                     WHERE name IN ('memory_type','subject','confidence','importance',
                                    'status','valid_from','valid_until','metadata',
                                    'source_message_id')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(columns, 9);
            let tables: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE name IN ('memory_versions','memory_sources')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(tables, 2);
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(version, SCHEMA_VERSION);
            // FTS5 is optional; if present it must be queryable.
            let has_fts: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'memories_fts'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            if has_fts > 0 {
                conn.execute(
                    "INSERT INTO memories_fts(memory_id, content, subject)
                     VALUES ('test', '用户喜欢简洁回答', 'response_style')",
                    [],
                )
                .expect("FTS insert works");
            }
        }
        drop(db);
        remove_db(&path);
    }

    #[test]
    fn migrates_legacy_database_without_data_loss() {
        let path = temp_path("legacy");
        {
            let conn = Connection::open(&path).expect("create legacy db");
            conn.execute_batch(
                r#"
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    model_id TEXT,
                    project_id TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    reasoning TEXT,
                    attachments TEXT,
                    status TEXT NOT NULL DEFAULT 'complete',
                    feedback INTEGER,
                    model_id TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE usage_logs (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT,
                    message_id TEXT,
                    provider_id TEXT,
                    model_id TEXT,
                    kind TEXT NOT NULL DEFAULT 'chat',
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO conversations
                    (id, title, model_id, project_id, pinned, archived, created_at, updated_at)
                    VALUES ('conv-old', '旧对话', 'deepseek-flash', NULL, 0, 0, 1, 2);
                INSERT INTO messages
                    (id, conversation_id, role, content, status, created_at)
                    VALUES ('msg-old', 'conv-old', 'user', '不能丢失的消息', 'complete', 3);
                INSERT INTO memories (id, content, created_at, updated_at)
                    VALUES ('mem-old', '用户偏好简洁回答', 4, 5);
                INSERT INTO app_settings (key, value) VALUES ('app.settings', '{"theme":"dark"}');
                "#,
            )
            .expect("seed legacy db");
        }

        let db = Db::open(&path).expect("legacy database upgrades");
        {
            let conn = db.conn.lock().unwrap();
            let title: String = conn
                .query_row(
                    "SELECT title FROM conversations WHERE id = 'conv-old'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let content: String = conn
                .query_row(
                    "SELECT content FROM messages WHERE id = 'msg-old'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let memory: String = conn
                .query_row(
                    "SELECT content FROM memories WHERE id = 'mem-old'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let memory_type: String = conn
                .query_row(
                    "SELECT memory_type FROM memories WHERE id = 'mem-old'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let setting: String = conn
                .query_row(
                    "SELECT value FROM app_settings WHERE key = 'app.settings'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(title, "旧对话");
            assert_eq!(content, "不能丢失的消息");
            assert_eq!(memory, "用户偏好简洁回答");
            assert_eq!(memory_type, "profile");
            assert_eq!(setting, "{\"theme\":\"dark\"}");
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(version, SCHEMA_VERSION);
            for column in ["summary", "summary_upto"] {
                assert!(
                    table_has_column(&conn, "conversations", column).unwrap(),
                    "missing conversations.{column}"
                );
            }
            for column in ["sources", "server_tool_calls", "connector_calls"] {
                assert!(
                    table_has_column(&conn, "messages", column).unwrap(),
                    "missing messages.{column}"
                );
            }
        }
        drop(db);

        // Opening the same file again must be a no-op, not a structural conflict.
        let db = Db::open(&path).expect("second open is idempotent");
        drop(db);
        remove_db(&path);
    }

    #[test]
    fn rejects_database_from_newer_schema() {
        let path = temp_path("future");
        {
            let conn = Connection::open(&path).expect("create db");
            conn.execute_batch("PRAGMA user_version = 999;")
                .expect("set future version");
        }
        let error = match Db::open(&path) {
            Ok(_) => panic!("future schema must be rejected"),
            Err(error) => error,
        };
        assert!(error.contains("高于当前 Mind 支持的版本"), "{error}");
        remove_db(&path);
    }
}
