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
    pub conn_url: String,
    pub conn_name: String,
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

    pub fn open_tab(&self, tab_id: String, tab: ActiveTab) {
        self.0.lock().unwrap().insert(tab_id, tab);
    }

    pub fn close_tab_session(&self, tab_id: &str) {
        if let Some(tab) = self.0.lock().unwrap().remove(tab_id) {
            tab.cancel.cancel();
        }
    }

    pub fn get_publisher_info(&self, tab_id: &str) -> Result<(String, String, TargetType), String> {
        let tabs = self.0.lock().unwrap();
        let tab = tabs.get(tab_id).ok_or_else(|| "Tab not found".to_string())?;
        Ok((
            tab.conn_url.clone(),
            tab.target_name.clone(),
            tab.target_type.clone(),
        ))
    }

    pub fn start_consumer_session(
        &self,
        tab_id: &str,
        ack_mode: AckMode,
    ) -> Result<(String, String, String, CancellationToken), String> {
        let mut tabs = self.0.lock().unwrap();
        let tab = tabs.get_mut(tab_id).ok_or_else(|| "Tab not found".to_string())?;
        if tab.mode != TabMode::Read {
            return Err("Tab is not a read tab".to_string());
        }
        tab.ack_mode = Some(ack_mode);
        Ok((
            tab.conn_url.clone(),
            tab.conn_name.clone(),
            tab.target_name.clone(),
            tab.cancel.clone(),
        ))
    }

    pub fn stop_consumer_session(&self, tab_id: &str) -> Result<(), String> {
        let mut tabs = self.0.lock().unwrap();
        if let Some(tab) = tabs.get_mut(tab_id) {
            tab.cancel.cancel();
            tab.cancel = CancellationToken::new();
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
            conn_url: "amqp://localhost".to_string(),
            conn_name: "local".to_string(),
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
            assert_eq!(retrieved.conn_url, "amqp://localhost");
            assert_eq!(retrieved.conn_name, "local");
            assert!(!retrieved.cancel.is_cancelled());
        }

        // Cancel via stop_consumer_session
        manager.stop_consumer_session("tab-1").unwrap();
        assert!(cancel_token.is_cancelled());
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
