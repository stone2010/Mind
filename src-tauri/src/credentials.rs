//! Credential storage.
//!
//! - Windows: Windows Credential Manager (`keyring`).
//! - Android: a process-memory cache backed by an AES-256-GCM vault whose key
//!   lives in the Android Keystore; ciphertext is kept in the app-private
//!   SharedPreferences by the `CredentialStorePlugin` Kotlin plugin.
//! - Other platforms (dev builds): process memory only.
//!
//! On every platform secrets never enter SQLite, the settings table, logs or the
//! backup export.

#[cfg(windows)]
mod platform {
    const SERVICE: &str = "com.mind.desktop";

    fn entry(provider_id: &str) -> Result<keyring::Entry, String> {
        if provider_id.trim().is_empty() {
            return Err("无效的模型提供商".into());
        }
        keyring::Entry::new(SERVICE, &format!("provider:{provider_id}"))
            .map_err(|e| format!("无法访问 Windows 凭据存储: {e}"))
    }

    pub fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
        entry(provider_id)?
            .set_password(api_key.trim())
            .map_err(|e| format!("无法将 API Key 保存到 Windows 凭据存储: {e}"))
    }

    pub fn get_api_key(provider_id: &str) -> Option<String> {
        entry(provider_id)
            .ok()
            .and_then(|e| e.get_password().ok())
            .filter(|k| !k.trim().is_empty())
    }

    pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
        match entry(provider_id) {
            Ok(e) => match e.delete_credential() {
                Ok(()) => Ok(()),
                // Deleting a credential that does not exist is not an error for us.
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("无法从 Windows 凭据存储中删除 API Key: {e}")),
            },
            Err(e) => Err(e),
        }
    }

    pub fn has_api_key(provider_id: &str) -> bool {
        get_api_key(provider_id).is_some()
    }

    fn github_entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, "github:main")
            .map_err(|e| format!("无法访问 Windows 凭据存储: {e}"))
    }

    pub fn save_github_token(token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub Token 不能为空".into());
        }
        github_entry()?
            .set_password(token)
            .map_err(|e| format!("无法将 GitHub Token 保存到 Windows 凭据存储: {e}"))
    }

    pub fn get_github_token() -> Option<String> {
        github_entry()
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .filter(|token| !token.trim().is_empty())
    }

    pub fn delete_github_token() -> Result<(), String> {
        match github_entry() {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("无法从 Windows 凭据存储中删除 GitHub Token: {e}")),
            },
            Err(e) => Err(e),
        }
    }

    pub fn has_github_token() -> bool {
        get_github_token().is_some()
    }
}

#[cfg(target_os = "android")]
mod platform {
    //! Android keeps secrets in memory for fast synchronous reads and mirrors
    //! them to an encrypted vault. The vault encryption key is generated once
    //! inside the Android Keystore and never leaves it, so the ciphertext in
    //! SharedPreferences is useless without the device. This is what lets the
    //! app keep API Keys and the GitHub token across restarts without writing
    //! plaintext anywhere.

    use serde::{Deserialize, Serialize};
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::Wry;

    static HANDLE: OnceLock<PluginHandle<Wry>> = OnceLock::new();
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

    #[derive(Deserialize)]
    struct VaultResponse {
        value: Option<String>,
    }

    #[derive(Deserialize)]
    struct SaveResponse {
        #[allow(dead_code)]
        ok: bool,
    }

    #[derive(Serialize)]
    struct SavePayload<'a> {
        value: &'a str,
    }

    fn cache() -> &'static Mutex<HashMap<String, String>> {
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Registers the Kotlin credential plugin and loads the persisted vault.
    pub fn android_plugin() -> TauriPlugin<Wry> {
        Builder::new("mind-credentials")
            .setup(|_app, api| {
                let handle =
                    api.register_android_plugin("com.mind.desktop", "CredentialStorePlugin")?;
                if HANDLE.set(handle).is_ok() {
                    // The vault read goes through the Android main thread, so it
                    // must not block the app setup thread.
                    std::thread::spawn(load_vault);
                }
                Ok(())
            })
            .build()
    }

    fn load_vault() {
        let Some(handle) = HANDLE.get() else {
            return;
        };
        match handle.run_mobile_plugin::<VaultResponse>("loadVault", serde_json::json!({})) {
            Ok(VaultResponse { value: Some(raw) }) => {
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                    if let Ok(mut cache) = cache().lock() {
                        *cache = map;
                    }
                }
            }
            Ok(VaultResponse { value: None }) => {}
            Err(err) => {
                eprintln!("mind: Android credential vault is unavailable: {err}");
            }
        }
    }

    fn persist() {
        let Some(handle) = HANDLE.get() else {
            return;
        };
        let raw = match cache().lock() {
            Ok(cache) => serde_json::to_string(&*cache).ok(),
            Err(_) => None,
        };
        if let Some(raw) = raw {
            let _ = handle
                .run_mobile_plugin::<SaveResponse>("saveVault", SavePayload { value: &raw });
        }
    }

    fn slot(provider_id: &str) -> String {
        format!("provider:{provider_id}")
    }

    fn remember(slot: String, value: Option<String>) {
        if let Ok(mut cache) = cache().lock() {
            match value {
                Some(value) => {
                    cache.insert(slot, value);
                }
                None => {
                    cache.remove(&slot);
                }
            }
        }
        std::thread::spawn(persist);
    }

    pub fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
        let key = api_key.trim();
        if key.is_empty() {
            return Err("API Key 不能为空".into());
        }
        remember(slot(provider_id), Some(key.to_string()));
        Ok(())
    }

    pub fn get_api_key(provider_id: &str) -> Option<String> {
        cache()
            .lock()
            .ok()
            .and_then(|cache| cache.get(&slot(provider_id)).cloned())
            .filter(|key| !key.trim().is_empty())
    }

    pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
        remember(slot(provider_id), None);
        Ok(())
    }

    pub fn has_api_key(provider_id: &str) -> bool {
        get_api_key(provider_id).is_some()
    }

    pub fn save_github_token(token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub Token 不能为空".into());
        }
        remember("github:main".into(), Some(token.to_string()));
        Ok(())
    }

    pub fn get_github_token() -> Option<String> {
        cache()
            .lock()
            .ok()
            .and_then(|cache| cache.get("github:main").cloned())
            .filter(|token| !token.trim().is_empty())
    }

    pub fn delete_github_token() -> Result<(), String> {
        remember("github:main".into(), None);
        Ok(())
    }

    pub fn has_github_token() -> bool {
        get_github_token().is_some()
    }
}

#[cfg(all(not(windows), not(target_os = "android")))]
mod platform {
    //! Development builds on non-Windows desktop platforms keep secrets in
    //! process memory only.

    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn memory() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn api_key_slot(provider_id: &str) -> String {
        format!("provider:{provider_id}")
    }

    pub fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
        let key = api_key.trim();
        if key.is_empty() {
            return Err("API Key 不能为空".into());
        }
        memory()
            .lock()
            .map_err(|_| "凭据存储不可用".to_string())?
            .insert(api_key_slot(provider_id), key.to_string());
        Ok(())
    }

    pub fn get_api_key(provider_id: &str) -> Option<String> {
        memory()
            .lock()
            .ok()
            .and_then(|map| map.get(&api_key_slot(provider_id)).cloned())
            .filter(|key| !key.trim().is_empty())
    }

    pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
        if let Ok(mut map) = memory().lock() {
            map.remove(&api_key_slot(provider_id));
        }
        Ok(())
    }

    pub fn has_api_key(provider_id: &str) -> bool {
        get_api_key(provider_id).is_some()
    }

    pub fn save_github_token(token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub Token 不能为空".into());
        }
        memory()
            .lock()
            .map_err(|_| "凭据存储不可用".to_string())?
            .insert("github:main".into(), token.to_string());
        Ok(())
    }

    pub fn get_github_token() -> Option<String> {
        memory()
            .lock()
            .ok()
            .and_then(|map| map.get("github:main").cloned())
            .filter(|token| !token.trim().is_empty())
    }

    pub fn delete_github_token() -> Result<(), String> {
        if let Ok(mut map) = memory().lock() {
            map.remove("github:main");
        }
        Ok(())
    }

    pub fn has_github_token() -> bool {
        get_github_token().is_some()
    }
}

pub use platform::*;

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn credential_manager_roundtrip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let secret = "sk-roundtrip-test-value";
        save_api_key(&id, secret).expect("save to Windows Credential Manager");
        assert_eq!(get_api_key(&id).as_deref(), Some(secret));
        delete_api_key(&id).expect("delete credential");
        assert!(get_api_key(&id).is_none());
    }
}
