use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

use std::sync::Arc;
use lapin::Connection;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabMode {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AckMode {
    Ack,
    Nack,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetType {
    Queue,
    Exchange,
}

#[allow(dead_code)]
pub struct ActiveTab {
    pub cancel: CancellationToken,
    pub mode: TabMode,
    pub ack_mode: Option<AckMode>,
    pub target_name: String,
    pub target_type: TargetType,
    /// Only the connection *name* is kept here; the AMQP URL (which carries
    /// credentials) is resolved from the config file at connect time and never
    /// travels through the frontend.
    pub conn_name: String,
    /// True while a consumer task owns this tab, so a second `start_consumer`
    /// cannot spawn a duplicate task against the same consumer tag.
    pub consuming: bool,
}

pub struct TabManager(pub Mutex<HashMap<String, ActiveTab>>);

pub struct ConnectionPool(pub tokio::sync::Mutex<HashMap<String, Arc<Connection>>>);

impl ConnectionPool {
    pub fn new() -> Self {
        ConnectionPool(tokio::sync::Mutex::new(HashMap::new()))
    }
}

impl TabManager {
    pub fn new() -> Self {
        TabManager(Mutex::new(HashMap::new()))
    }

    /// A panic while the registry lock is held must not brick every later tab
    /// command, so poisoning is recovered from rather than propagated.
    fn tabs(&self) -> std::sync::MutexGuard<'_, HashMap<String, ActiveTab>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn open_tab(&self, tab_id: String, tab: ActiveTab) {
        self.tabs().insert(tab_id, tab);
    }

    pub fn close_tab_session(&self, tab_id: &str) {
        if let Some(tab) = self.tabs().remove(tab_id) {
            tab.cancel.cancel();
        }
    }

    pub fn get_publisher_info(&self, tab_id: &str) -> Result<(String, String, TargetType), String> {
        let tabs = self.tabs();
        let tab = tabs.get(tab_id).ok_or_else(|| "Tab not found".to_string())?;
        Ok((
            tab.conn_name.clone(),
            tab.target_name.clone(),
            tab.target_type.clone(),
        ))
    }

    pub fn start_consumer_session(
        &self,
        tab_id: &str,
        ack_mode: AckMode,
    ) -> Result<(String, String, CancellationToken), String> {
        let mut tabs = self.tabs();
        let tab = tabs.get_mut(tab_id).ok_or_else(|| "Tab not found".to_string())?;
        if tab.mode != TabMode::Read {
            return Err("Tab is not a read tab".to_string());
        }
        if tab.consuming {
            return Err("This tab is already consuming".to_string());
        }
        tab.ack_mode = Some(ack_mode);
        tab.consuming = true;
        Ok((
            tab.conn_name.clone(),
            tab.target_name.clone(),
            tab.cancel.clone(),
        ))
    }

    pub fn stop_consumer_session(&self, tab_id: &str) -> Result<(), String> {
        let mut tabs = self.tabs();
        if let Some(tab) = tabs.get_mut(tab_id) {
            tab.cancel.cancel();
            tab.cancel = CancellationToken::new();
            tab.consuming = false;
            Ok(())
        } else {
            Err("Tab not found".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tab_manager_creation() {
        let manager = TabManager::new();
        let map = manager.0.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn test_active_tab_insertion_and_state() {
        let manager = TabManager::new();
        let cancel_token = CancellationToken::new();
        
        let tab = ActiveTab {
            cancel: cancel_token.clone(),
            mode: TabMode::Read,
            ack_mode: Some(AckMode::Ack),
            target_name: "queue-1".to_string(),
            target_type: TargetType::Queue,
            conn_name: "local".to_string(),
            consuming: false,
        };

        manager.open_tab("tab-1".to_string(), tab);

        // Verify state
        {
            let map = manager.0.lock().unwrap();
            let retrieved = map.get("tab-1").unwrap();
            assert_eq!(retrieved.mode, TabMode::Read);
            assert_eq!(retrieved.ack_mode, Some(AckMode::Ack));
            assert_eq!(retrieved.target_name, "queue-1");
            assert_eq!(retrieved.target_type, TargetType::Queue);
            assert_eq!(retrieved.conn_name, "local");
            assert!(!retrieved.cancel.is_cancelled());
        }

        // Cancel via stop_consumer_session
        manager.stop_consumer_session("tab-1").unwrap();
        assert!(cancel_token.is_cancelled());
    }

    fn read_tab(name: &str) -> ActiveTab {
        ActiveTab {
            cancel: CancellationToken::new(),
            mode: TabMode::Read,
            ack_mode: None,
            target_name: name.to_string(),
            target_type: TargetType::Queue,
            conn_name: "local".to_string(),
            consuming: false,
        }
    }

    #[test]
    fn test_start_consumer_session_rejects_a_second_consumer() {
        let manager = TabManager::new();
        manager.open_tab("tab-1".to_string(), read_tab("q1"));

        assert!(manager.start_consumer_session("tab-1", AckMode::Ack).is_ok());
        assert!(manager.start_consumer_session("tab-1", AckMode::Ack).is_err());

        // Stopping releases the slot so the tab can be restarted.
        manager.stop_consumer_session("tab-1").unwrap();
        assert!(manager.start_consumer_session("tab-1", AckMode::Ack).is_ok());
    }

    #[test]
    fn test_start_consumer_session_rejects_write_tabs() {
        let manager = TabManager::new();
        let mut tab = read_tab("q1");
        tab.mode = TabMode::Write;
        manager.open_tab("tab-1".to_string(), tab);

        assert!(manager.start_consumer_session("tab-1", AckMode::Ack).is_err());
    }

    #[test]
    fn test_lock_survives_poisoning() {
        let manager = Arc::new(TabManager::new());
        let poisoner = Arc::clone(&manager);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.0.lock().unwrap();
            panic!("poison the registry lock");
        })
        .join();

        // Would panic if the guard propagated poisoning.
        manager.open_tab("tab-1".to_string(), read_tab("q1"));
        assert!(manager.get_publisher_info("tab-1").is_ok());
    }

    #[test]
    fn test_enum_serialization_deserialization() {
        let mode: TabMode = serde_json::from_str("\"read\"").unwrap();
        assert_eq!(mode, TabMode::Read);
        assert_eq!(serde_json::to_string(&TabMode::Write).unwrap(), "\"write\"");

        let ack: AckMode = serde_json::from_str("\"ack\"").unwrap();
        assert_eq!(ack, AckMode::Ack);
        assert_eq!(serde_json::to_string(&AckMode::Nack).unwrap(), "\"nack\"");

        let target: TargetType = serde_json::from_str("\"queue\"").unwrap();
        assert_eq!(target, TargetType::Queue);
        assert_eq!(serde_json::to_string(&TargetType::Exchange).unwrap(), "\"exchange\"");
    }
}
