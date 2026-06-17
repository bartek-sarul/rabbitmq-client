use lapin::options::{BasicAckOptions, BasicConsumeOptions, BasicNackOptions, BasicPublishOptions};
use lapin::types::{AMQPValue, ShortString, FieldTable};
use lapin::{BasicProperties, Connection, ConnectionProperties};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::{load_config, AppConfig};
use crate::tab_manager::{ActiveTab, AckMode, TabManager, TabMode, TargetType, ConnectionPool};

fn resolve_amqp_url(url: &str) -> Result<String, String> {
    // Attempt to load .env, but ignore error if it doesn't exist
    let _ = dotenvy::dotenv();

    let mut resolved_url = url.to_string();
    
    let mut start = 0;
    while let Some(open) = resolved_url[start..].find("${") {
        let actual_open = start + open;
        if let Some(close) = resolved_url[actual_open..].find('}') {
            let actual_close = actual_open + close;
            let var_name = &resolved_url[actual_open + 2..actual_close];
            
            let val = std::env::var(var_name)
                .map_err(|_| format!("Missing environment variable: {}", var_name))?;
                
            resolved_url.replace_range(actual_open..=actual_close, &val);
            start = 0;
        } else {
            break;
        }
    }
    
    Ok(resolved_url)
}

#[derive(serde::Deserialize)]
pub struct SendProperties {
    pub content_type: Option<String>,
    pub delivery_mode: Option<u8>,
    pub correlation_id: Option<String>,
    pub message_id: Option<String>,
}

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(serde::Serialize)]
pub struct ConsumerSessionInfo {
    pub folder_path: String,
    pub folder_name: String,
}

#[tauri::command]
pub fn load_config_cmd() -> Result<AppConfig, String> {
    load_config()
}

#[tauri::command]
pub fn read_raw_config() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");
    
    if !config_path.exists() {
        return Err("Configuration file does not exist. Please load configuration first to initialize.".to_string());
    }

    std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {e}"))
}

#[tauri::command]
pub fn save_raw_config(content: String) -> Result<(), String> {
    let config: AppConfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("YAML Parse Error: {e}"))?;
    
    config.validate()?;

    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");

    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn save_config_struct(config: AppConfig) -> Result<(), String> {
    config.validate()?;
    
    let content = serde_yaml::to_string(&config)
        .map_err(|e| format!("Failed to serialize config to YAML: {e}"))?;
        
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");

    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn open_tab(
    tab_id: String,
    conn_url: String,
    conn_name: String,
    target_name: String,
    target_type: TargetType,
    mode: TabMode,
    ack_mode: Option<AckMode>,
    state: State<'_, TabManager>,
) -> Result<(), String> {
    let tab = ActiveTab {
        cancel: CancellationToken::new(),
        mode,
        ack_mode,
        target_name,
        target_type,
        conn_url,
        conn_name,
    };

    state.inner().open_tab(tab_id, tab);
    Ok(())
}

#[tauri::command]
pub async fn close_tab(tab_id: String, state: State<'_, TabManager>) -> Result<(), String> {
    state.inner().close_tab_session(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn send_message(
    tab_id: String,
    body: String,
    routing_key: Option<String>,
    headers: Option<String>,
    properties: Option<SendProperties>,
    state: State<'_, TabManager>,
    pool: State<'_, ConnectionPool>,
) -> Result<(), String> {
    let (conn_url, target_name, target_type) = state.inner().get_publisher_info(&tab_id)?;
    let conn_url = resolve_amqp_url(&conn_url)?;

    let connection = {
        let mut pool_guard = pool.0.lock().await;
        if let Some(conn) = pool_guard.get(&conn_url) {
            if conn.status().connected() {
                conn.clone()
            } else {
                pool_guard.remove(&conn_url);
                let new_conn = Connection::connect(&conn_url, ConnectionProperties::default())
                    .await
                    .map_err(|e| format!("Connection failed: {e}"))?;
                let arc_conn = Arc::new(new_conn);
                pool_guard.insert(conn_url.clone(), arc_conn.clone());
                arc_conn
            }
        } else {
            let new_conn = Connection::connect(&conn_url, ConnectionProperties::default())
                .await
                .map_err(|e| format!("Connection failed: {e}"))?;
            let arc_conn = Arc::new(new_conn);
            pool_guard.insert(conn_url.clone(), arc_conn.clone());
            arc_conn
        }
    };

    let channel = connection
        .create_channel()
        .await
        .map_err(|e| format!("Channel creation failed: {e}"))?;

    let (exchange, rk) = if target_type == TargetType::Exchange {
        (target_name, routing_key.unwrap_or_default())
    } else {
        (String::new(), target_name)
    };

    let mut props = BasicProperties::default();
    if let Some(p) = properties {
        if let Some(ct) = p.content_type {
            if !ct.trim().is_empty() {
                props = props.with_content_type(ct.into());
            }
        }
        if let Some(dm) = p.delivery_mode {
            props = props.with_delivery_mode(dm);
        }
        if let Some(cid) = p.correlation_id {
            if !cid.trim().is_empty() {
                props = props.with_correlation_id(cid.into());
            }
        }
        if let Some(mid) = p.message_id {
            if !mid.trim().is_empty() {
                props = props.with_message_id(mid.into());
            }
        }
    }

    if let Some(h_str) = headers {
        if !h_str.trim().is_empty() {
            let table = json_to_field_table(&h_str)?;
            props = props.with_headers(table);
        }
    }

    channel
        .confirm_select(lapin::options::ConfirmSelectOptions::default())
        .await
        .map_err(|e| format!("Failed to enable publisher confirms: {e}"))?;

    let confirm = channel
        .basic_publish(
            &exchange,
            &rk,
            BasicPublishOptions::default(),
            body.as_bytes(),
            props,
        )
        .await
        .map_err(|e| format!("Publish failed: {e}"))?;

    confirm
        .await
        .map_err(|e| format!("Publish confirmation failed: {e}"))?;

    // We do NOT close the connection anymore as it is pooled
    // It will live until the app exits or connection drops natively
    let _ = channel.close(200, "OK").await;

    Ok(())
}

#[tauri::command]
pub async fn start_consumer(
    tab_id: String,
    ack_mode: AckMode,
    state: State<'_, TabManager>,
    app_handle: AppHandle,
) -> Result<ConsumerSessionInfo, String> {
    let (conn_url, conn_name, target_name, cancel) = state.inner().start_consumer_session(&tab_id, ack_mode.clone())?;
    let conn_url = resolve_amqp_url(&conn_url)?;

    let config = load_config().map_err(|e| format!("Failed to load config: {e}"))?;
    let base_path = config.save_path.ok_or_else(|| {
        "save_path is not configured in ~/.rabbit-client.yaml".to_string()
    })?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let folder_name = format!("{}_{}_{}", timestamp, conn_name, target_name);
    
    let clean_folder_name: String = folder_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();

    let path = std::path::PathBuf::from(base_path).join(&clean_folder_name);
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create save directory: {e}"))?;

    let save_dir = path.clone();
    let folder_path_str = path.to_string_lossy().to_string();

    let event_name = format!("msg-{tab_id}");
    let status_event_name = format!("status-{tab_id}");

    tauri::async_runtime::spawn(async move {
        use futures_lite::StreamExt;

        loop {
            if cancel.is_cancelled() {
                break;
            }

            let _ = app_handle.emit(&status_event_name, "connecting");

            let connection = match Connection::connect(&conn_url, ConnectionProperties::default()).await {
                Ok(conn) => conn,
                Err(e) => {
                    eprintln!("Consumer reconnect connection failed: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            };

            let channel = match connection.create_channel().await {
                Ok(ch) => ch,
                Err(e) => {
                    eprintln!("Consumer reconnect channel failed: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            };

            let consumer = match channel
                .basic_consume(
                    &target_name,
                    &format!("rabbit-client-{tab_id}"),
                    BasicConsumeOptions::default(),
                    FieldTable::default(),
                )
                .await
            {
                Ok(cons) => cons,
                Err(e) => {
                    eprintln!("Consumer reconnect consume failed: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            };

            let _ = app_handle.emit(&status_event_name, "consuming");

            let mut consumer = consumer;
            let mut disconnected = false;

            while !disconnected {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        let _ = connection.close(200, "OK").await;
                        let _ = app_handle.emit(&status_event_name, "disconnected");
                        return;
                    }
                    next = consumer.next() => {
                        match next {
                            Some(Ok(delivery)) => {
                                let body = String::from_utf8_lossy(&delivery.data).to_string();
                                
                                let headers_str = delivery
                                    .properties
                                    .headers()
                                    .as_ref()
                                    .map(|h| {
                                        let json_val = field_table_to_json(h);
                                        serde_json::to_string_pretty(&json_val).unwrap_or_default()
                                    })
                                    .unwrap_or_default();

                                let msg_id = Uuid::new_v4().to_string();
                                let timestamp = chrono::Utc::now().to_rfc3339();

                                let payload = serde_json::json!({
                                    "id": msg_id,
                                    "timestamp": timestamp,
                                    "headers": headers_str,
                                    "properties": {
                                        "content_type": delivery.properties.content_type()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                        "delivery_mode": delivery.properties.delivery_mode(),
                                        "correlation_id": delivery.properties.correlation_id()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                        "message_id": delivery.properties.message_id()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                    },
                                    "body": body,
                                });

                                let epoch_millis = chrono::Utc::now().timestamp_millis();
                                let filename = format!("{}_{}.json", epoch_millis, msg_id);
                                let file_path = save_dir.join(filename);
                                if let Err(e) = std::fs::write(&file_path, serde_json::to_string_pretty(&payload).unwrap_or_default()) {
                                    eprintln!("Failed to save message to disk: {e}");
                                }

                                let body_preview = if body.len() > 120 {
                                    format!("{}...", &body[..120])
                                } else {
                                    body.clone()
                                };

                                let preview_payload = serde_json::json!({
                                    "id": msg_id,
                                    "timestamp": timestamp,
                                    "filePath": file_path.to_string_lossy().to_string(),
                                    "bodyPreview": body_preview,
                                    "properties": {
                                        "content_type": delivery.properties.content_type()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                        "delivery_mode": delivery.properties.delivery_mode(),
                                        "correlation_id": delivery.properties.correlation_id()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                        "message_id": delivery.properties.message_id()
                                            .as_ref().map(|s| s.as_str().to_string()),
                                    },
                                });

                                let _ = app_handle.emit(&event_name, preview_payload);

                                match ack_mode {
                                    AckMode::Ack => {
                                        let _ = delivery.ack(BasicAckOptions::default()).await;
                                    }
                                    _ => {
                                        let _ = delivery
                                            .nack(BasicNackOptions {
                                                requeue: true,
                                                multiple: false,
                                            })
                                            .await;
                                    }
                                }
                            }
                            Some(Err(e)) => {
                                eprintln!("Delivery stream error: {e}");
                                disconnected = true;
                            }
                            None => {
                                eprintln!("Delivery stream ended");
                                disconnected = true;
                            }
                        }
                    }
                }
            }

            if cancel.is_cancelled() {
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }

        let _ = app_handle.emit(&status_event_name, "disconnected");
    });

    Ok(ConsumerSessionInfo {
        folder_path: folder_path_str,
        folder_name: clean_folder_name,
    })
}

#[tauri::command]
pub async fn stop_consumer(tab_id: String, state: State<'_, TabManager>) -> Result<(), String> {
    state.inner().stop_consumer_session(&tab_id)
}

#[tauri::command]
pub fn parse_yaml_config(content: String) -> Result<AppConfig, String> {
    let config: AppConfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("YAML Parse Error: {e}"))?;
    config.validate()?;
    Ok(config)
}

#[tauri::command]
pub async fn read_message_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read message file: {e}"))
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_config_in_file_manager() -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&config_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&config_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&home)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn json_to_field_table(json_str: &str) -> Result<FieldTable, String> {
    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("Invalid headers JSON: {e}"))?;
    
    let map = value.as_object().ok_or_else(|| "Headers must be a JSON object".to_string())?;
    let mut table = FieldTable::default();
    
    for (k, v) in map {
        let key = ShortString::from(k.as_str());
        let val = match v {
            serde_json::Value::Null => continue,
            serde_json::Value::Bool(b) => AMQPValue::Boolean(*b),
            serde_json::Value::Number(num) => {
                if let Some(i) = num.as_i64() {
                    AMQPValue::LongLongInt(i)
                } else if let Some(f) = num.as_f64() {
                    AMQPValue::Double(f)
                } else {
                    continue;
                }
            }
            serde_json::Value::String(s) => AMQPValue::LongString(s.clone().into()),
            serde_json::Value::Array(_) => continue,
            serde_json::Value::Object(_) => continue,
        };
        table.insert(key, val);
    }
    Ok(table)
}

fn field_table_to_json(table: &FieldTable) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (k, v) in table.inner() {
        let key = k.as_str().to_string();
        let val = amqp_value_to_json(v);
        map.insert(key, val);
    }
    serde_json::Value::Object(map)
}

fn amqp_value_to_json(val: &AMQPValue) -> serde_json::Value {
    match val {
        AMQPValue::Boolean(b) => serde_json::Value::Bool(*b),
        AMQPValue::ShortShortInt(i) => serde_json::Value::Number((*i).into()),
        AMQPValue::ShortShortUInt(u) => serde_json::Value::Number((*u).into()),
        AMQPValue::ShortInt(i) => serde_json::Value::Number((*i).into()),
        AMQPValue::ShortUInt(u) => serde_json::Value::Number((*u).into()),
        AMQPValue::LongInt(i) => serde_json::Value::Number((*i).into()),
        AMQPValue::LongUInt(u) => serde_json::Value::Number((*u).into()),
        AMQPValue::LongLongInt(i) => serde_json::Value::Number((*i).into()),
        AMQPValue::Float(f) => serde_json::Number::from_f64(*f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        AMQPValue::Double(d) => serde_json::Number::from_f64(*d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        AMQPValue::DecimalValue(dec) => {
            serde_json::Value::String(format!("Decimal(scale: {}, value: {})", dec.scale, dec.value))
        }
        AMQPValue::ShortString(s) => serde_json::Value::String(s.as_str().to_string()),
        AMQPValue::LongString(s) => {
            let bytes = s.as_bytes();
            if let Ok(utf8_str) = std::str::from_utf8(bytes) {
                serde_json::Value::String(utf8_str.to_string())
            } else {
                serde_json::Value::String(format!("{:?}", bytes))
            }
        }
        AMQPValue::FieldArray(arr) => {
            let vec: Vec<serde_json::Value> = arr.as_slice().iter().map(amqp_value_to_json).collect();
            serde_json::Value::Array(vec)
        }
        AMQPValue::Timestamp(t) => serde_json::Value::Number((*t).into()),
        AMQPValue::FieldTable(t) => field_table_to_json(t),
        AMQPValue::ByteArray(arr) => {
            serde_json::Value::String(format!("ByteArray({:?})", arr.as_slice()))
        }
        AMQPValue::Void => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lapin::types::{AMQPValue, FieldTable};

    #[test]
    fn test_json_to_field_table_conversions() {
        let json_str = r#"{
            "bool_key": true,
            "int_key": 42,
            "float_key": 3.14,
            "str_key": "hello",
            "null_key": null
        }"#;

        let table = json_to_field_table(json_str).unwrap();

        assert_eq!(
            table.inner().get("bool_key").unwrap(),
            &AMQPValue::Boolean(true)
        );
        assert_eq!(
            table.inner().get("int_key").unwrap(),
            &AMQPValue::LongLongInt(42)
        );
        if let AMQPValue::Double(d) = table.inner().get("float_key").unwrap() {
            assert!((d - 3.14).abs() < 1e-6);
        } else {
            panic!("float_key is not a Double");
        }
        assert_eq!(
            table.inner().get("str_key").unwrap(),
            &AMQPValue::LongString("hello".to_string().into())
        );
        assert!(table.inner().get("null_key").is_none());
    }

    #[test]
    fn test_field_table_to_json_conversions() {
        let mut table = FieldTable::default();
        table.insert("bool".into(), AMQPValue::Boolean(false));
        table.insert("int".into(), AMQPValue::LongInt(100));
        table.insert("str".into(), AMQPValue::LongString("test".into()));
        table.insert("void".into(), AMQPValue::Void);

        let json_val = field_table_to_json(&table);
        let obj = json_val.as_object().unwrap();

        assert_eq!(obj.get("bool").unwrap().as_bool().unwrap(), false);
        assert_eq!(obj.get("int").unwrap().as_i64().unwrap(), 100);
        assert_eq!(obj.get("str").unwrap().as_str().unwrap(), "test");
        assert!(obj.get("void").unwrap().is_null());
    }

    #[test]
    fn test_invalid_headers_json() {
        let bad_json = r#"{"invalid_key": [1, 2, 3]}"#;
        let table = json_to_field_table(bad_json).unwrap();
        assert!(table.inner().is_empty());

        let invalid_syntax = "not a json";
        assert!(json_to_field_table(invalid_syntax).is_err());
    }
}
