use lapin::options::{BasicAckOptions, BasicConsumeOptions, BasicPublishOptions};
use lapin::types::{AMQPValue, ShortString, FieldTable};
use lapin::{BasicProperties, Connection, ConnectionProperties};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::{load_config, AppConfig};
use crate::tab_manager::{ActiveTab, AckMode, TabManager, TabMode, TargetType, ConnectionPool};

/// Expands `${VAR}` placeholders in an AMQP URL from the environment.
///
/// Scanning resumes *after* the substituted value rather than restarting at 0,
/// so an environment variable whose value itself contains `${...}` cannot send
/// this into an infinite loop.
fn resolve_amqp_url(url: &str) -> Result<String, String> {
    let mut resolved_url = url.to_string();

    let mut start = 0;
    while let Some(open) = resolved_url[start..].find("${") {
        let actual_open = start + open;
        let Some(close) = resolved_url[actual_open..].find('}') else {
            break;
        };
        let actual_close = actual_open + close;
        let var_name = &resolved_url[actual_open + 2..actual_close];

        let val = std::env::var(var_name)
            .map_err(|_| format!("Missing environment variable: {}", var_name))?;

        resolved_url.replace_range(actual_open..=actual_close, &val);
        start = actual_open + val.len();
    }

    Ok(resolved_url)
}

/// Looks up a connection by name in the config file and returns its resolved
/// AMQP URL. Credentials therefore stay in the backend: the frontend only ever
/// names a connection, it never holds or passes the URL.
fn url_for_connection(conn_name: &str) -> Result<String, String> {
    let config = load_config()?;
    let conn = config
        .connections
        .iter()
        .find(|c| c.name == conn_name)
        .ok_or_else(|| format!("Connection '{conn_name}' is no longer defined in the configuration"))?;
    resolve_amqp_url(&conn.url)
}

/// The configured message store folder, canonicalized.
fn message_root() -> Result<std::path::PathBuf, String> {
    let config = load_config()?;
    let base = config
        .save_path
        .ok_or_else(|| "save_path is not configured in ~/.rabbit-client.yaml".to_string())?;
    let base = std::path::PathBuf::from(base);
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create message store folder: {e}"))?;
    base.canonicalize()
        .map_err(|e| format!("Failed to resolve message store folder: {e}"))
}

/// Rejects any path that does not live inside the message store folder.
///
/// Every path the webview hands to a filesystem command goes through here, so a
/// scripting bug in the UI cannot turn these commands into an arbitrary-file
/// read or an arbitrary-path launcher.
fn ensure_within_message_root(path: &str) -> Result<std::path::PathBuf, String> {
    let root = message_root()?;
    let candidate = std::path::PathBuf::from(path);

    // Canonicalize what exists so `..` segments and symlinks cannot escape; for
    // a not-yet-created folder, canonicalize the nearest existing ancestor.
    let resolved = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = candidate
                .parent()
                .ok_or_else(|| "Invalid path".to_string())?
                .canonicalize()
                .map_err(|e| format!("Invalid path: {e}"))?;
            match candidate.file_name() {
                Some(name) => parent.join(name),
                None => parent,
            }
        }
    };

    if resolved == root || resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(format!(
            "Refusing to access '{}': it is outside the configured message store folder",
            resolved.display()
        ))
    }
}

/// Reveals a path in the platform file manager, optionally selecting the item
/// itself rather than opening its container.
fn reveal_in_file_manager(path: &std::path::Path, select: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        if select {
            cmd.arg("/select,");
        }
        cmd.arg(path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if select {
            cmd.arg("-R");
        }
        cmd.arg(path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // xdg-open has no "select" mode, so fall back to the containing folder.
        let target = if select {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Writes the config file atomically: a failed or partial write must never
/// truncate the user's existing connection list.
fn write_config_file(content: &str) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");
    let tmp_path = home.join(".rabbit-client.yaml.tmp");

    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write config file: {e}"))?;
    std::fs::rename(&tmp_path, &config_path)
        .map_err(|e| format!("Failed to replace config file: {e}"))?;

    Ok(())
}

/// The AMQP property subset the UI shows, built once and reused for both the
/// on-disk payload and the event sent to the frontend.
fn delivery_properties_json(props: &BasicProperties) -> serde_json::Value {
    serde_json::json!({
        "content_type": props.content_type().as_ref().map(|s| s.as_str().to_string()),
        "delivery_mode": props.delivery_mode(),
        "correlation_id": props.correlation_id().as_ref().map(|s| s.as_str().to_string()),
        "message_id": props.message_id().as_ref().map(|s| s.as_str().to_string()),
    })
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

    write_config_file(&content)
}

#[tauri::command]
pub fn save_config_struct(config: AppConfig) -> Result<(), String> {
    config.validate()?;
    
    let content = serde_yaml::to_string(&config)
        .map_err(|e| format!("Failed to serialize config to YAML: {e}"))?;

    write_config_file(&content)
}

#[tauri::command]
pub async fn open_tab(
    tab_id: String,
    conn_name: String,
    target_name: String,
    target_type: TargetType,
    mode: TabMode,
    ack_mode: Option<AckMode>,
    state: State<'_, TabManager>,
) -> Result<(), String> {
    // Fail fast if the named connection is gone or its ${VAR} placeholders
    // cannot be resolved, rather than at first publish/consume.
    url_for_connection(&conn_name)?;

    let tab = ActiveTab {
        cancel: CancellationToken::new(),
        mode,
        ack_mode,
        target_name,
        target_type,
        conn_name,
        consuming: false,
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
    let (conn_name, target_name, target_type) = state.inner().get_publisher_info(&tab_id)?;
    let conn_url = url_for_connection(&conn_name)?;

    // Look for a live pooled connection under the lock, then release it before
    // connecting. Holding the pool mutex across the handshake would serialize
    // every publish in the app behind one slow or unreachable broker.
    let pooled = {
        let pool_guard = pool.0.lock().await;
        pool_guard
            .get(&conn_url)
            .filter(|conn| conn.status().connected())
            .cloned()
    };

    let connection = match pooled {
        Some(conn) => conn,
        None => {
            let new_conn = Connection::connect(&conn_url, ConnectionProperties::default())
                .await
                .map_err(|e| format!("Connection failed: {e}"))?;
            let arc_conn = Arc::new(new_conn);

            let mut pool_guard = pool.0.lock().await;
            // Another publish may have raced us here; prefer whichever live
            // connection is already pooled and let ours drop.
            match pool_guard.get(&conn_url).filter(|c| c.status().connected()) {
                Some(existing) => existing.clone(),
                None => {
                    pool_guard.insert(conn_url.clone(), arc_conn.clone());
                    arc_conn
                }
            }
        }
    };

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

    let channel = connection
        .create_channel()
        .await
        .map_err(|e| format!("Channel creation failed: {e}"))?;

    let result = async {
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

        Ok::<(), String>(())
    }
    .await;

    // The connection is pooled and deliberately left open, but the channel is
    // per-publish: close it on the failure path too, or every failed send
    // leaks a channel on a connection that lives until the app exits.
    let _ = channel.close(200, "OK").await;

    result
}

#[tauri::command]
pub fn generate_default_folder_path(conn_name: String, target_name: String) -> Result<String, String> {
    let config = load_config().map_err(|e| format!("Failed to load config: {e}"))?;
    let base_path = config.save_path.ok_or_else(|| {
        "save_path is not configured in ~/.rabbit-client.yaml".to_string()
    })?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    // The timestamp only has second resolution, so two tabs opened on the same
    // target within the same second would otherwise share a folder.
    let suffix = &Uuid::new_v4().to_string()[..8];
    let folder_name = format!("{}_{}_{}_{}", timestamp, conn_name, target_name, suffix);

    let clean_folder_name: String = folder_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();

    let path = std::path::PathBuf::from(base_path).join(&clean_folder_name);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn load_folder_messages(folder_path: String) -> Result<Vec<serde_json::Value>, String> {
    let path = ensure_within_message_root(&folder_path)?;
    if !path.exists() || !path.is_dir() {
        return Ok(vec![]);
    }

    let mut entries = tokio::fs::read_dir(path).await.map_err(|e| e.to_string())?;
    let mut msgs = vec![];

    // `while let Ok(Some(..))` would treat an I/O error as end-of-directory and
    // silently return a partial list, so errors are logged and skipped instead.
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(e) => {
                eprintln!("Failed to read directory entry: {e}");
                continue;
            }
        };
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json") {
            match tokio::fs::read_to_string(&p).await {
                Ok(content) => {
                    match serde_json::from_str::<serde_json::Value>(&content) {
                        Ok(mut parsed) => {
                            if let Some(obj) = parsed.as_object_mut() {
                                obj.insert("filePath".to_string(), serde_json::Value::String(p.to_string_lossy().to_string()));
                                let headers_str = obj.get("headers").and_then(|h| h.as_str()).unwrap_or_default().to_string();
                                obj.insert("headersStr".to_string(), serde_json::Value::String(headers_str));
                            }
                            msgs.push(parsed);
                        }
                        Err(e) => eprintln!("Failed to parse JSON for {:?}: {}", p, e),
                    }
                }
                Err(e) => eprintln!("Failed to read file {:?}: {}", p, e),
            }
        }
    }

    // Sort by timestamp desc
    msgs.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let ts_b = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        ts_b.cmp(ts_a)
    });

    msgs.truncate(500);

    Ok(msgs)
}

#[tauri::command]
pub async fn start_consumer(
    tab_id: String,
    ack_mode: AckMode,
    folder_path: String,
    state: State<'_, TabManager>,
    app_handle: AppHandle,
) -> Result<ConsumerSessionInfo, String> {
    let (conn_name, target_name, cancel) =
        state.inner().start_consumer_session(&tab_id, ack_mode.clone())?;

    // From here on the tab is marked as consuming, so every early return has to
    // release it again or the tab can never be started a second time.
    let setup = async {
        let conn_url = url_for_connection(&conn_name)?;
        let path = ensure_within_message_root(&folder_path)?;
        tokio::fs::create_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to create save directory: {e}"))?;
        Ok::<(std::string::String, std::path::PathBuf), String>((conn_url, path))
    }
    .await;

    let (conn_url, path) = match setup {
        Ok(v) => v,
        Err(e) => {
            let _ = state.inner().stop_consumer_session(&tab_id);
            return Err(e);
        }
    };

    let save_dir = path.clone();
    let folder_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let folder_path_str = path.to_string_lossy().to_string();

    let event_name = format!("msg-{tab_id}");
    let status_event_name = format!("status-{tab_id}");
    let error_event_name = format!("consumer-error-{tab_id}");

    tauri::async_runtime::spawn(async move {
        use futures_lite::StreamExt;

        // Surfaces a failure in the UI instead of only on stderr, so a bad
        // password or a missing queue does not just look like "connecting".
        let report = |msg: String| {
            eprintln!("[consumer {tab_id}] {msg}");
            let _ = app_handle.emit(&error_event_name, msg);
        };

        loop {
            if cancel.is_cancelled() {
                break;
            }

            let _ = app_handle.emit(&status_event_name, "connecting");

            // Racing the connect against cancellation keeps Disconnect
            // responsive instead of waiting out the whole connect timeout.
            let connection = tokio::select! {
                _ = cancel.cancelled() => break,
                res = Connection::connect(&conn_url, ConnectionProperties::default()) => match res {
                    Ok(conn) => conn,
                    Err(e) => {
                        report(format!("Connection failed: {e}"));
                        tokio::select! {
                            _ = cancel.cancelled() => break,
                            _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => continue,
                        }
                    }
                }
            };

            // Every path out of this iteration must close the connection;
            // otherwise a broker that accepts TCP but rejects the consumer
            // (permissions, missing queue) leaks one connection per second.
            let channel = match connection.create_channel().await {
                Ok(ch) => ch,
                Err(e) => {
                    report(format!("Channel creation failed: {e}"));
                    let _ = connection.close(200, "reconnect").await;
                    tokio::select! {
                        _ = cancel.cancelled() => break,
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => continue,
                    }
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
                    report(format!("Failed to consume from '{target_name}': {e}"));
                    let _ = connection.close(200, "reconnect").await;
                    tokio::select! {
                        _ = cancel.cancelled() => break,
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => continue,
                    }
                }
            };

            let _ = app_handle.emit(&status_event_name, "consuming");

            let mut consumer = consumer;
            let mut disconnected = false;

            while !disconnected {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        // Closing the connection also requeues everything left
                        // unacked by Peek mode.
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
                                let properties = delivery_properties_json(&delivery.properties);

                                let payload = serde_json::json!({
                                    "id": msg_id,
                                    "timestamp": timestamp,
                                    "headers": headers_str,
                                    "properties": properties,
                                    "body": body,
                                });

                                let epoch_millis = chrono::Utc::now().timestamp_millis();
                                let filename = format!("{}_{}.json", epoch_millis, msg_id);
                                let file_path = save_dir.join(filename);
                                if let Err(e) = tokio::fs::write(
                                    &file_path,
                                    serde_json::to_string_pretty(&payload).unwrap_or_default(),
                                )
                                .await
                                {
                                    report(format!("Failed to save message to disk: {e}"));
                                }

                                let preview_payload = serde_json::json!({
                                    "id": msg_id,
                                    "timestamp": timestamp,
                                    "filePath": file_path.to_string_lossy().to_string(),
                                    "body": body,
                                    "headersStr": headers_str,
                                    "properties": properties,
                                });

                                let _ = app_handle.emit(&event_name, preview_payload);

                                match ack_mode {
                                    AckMode::Ack => {
                                        let _ = delivery.ack(BasicAckOptions::default()).await;
                                    }
                                    // Peek: leave the delivery unacknowledged.
                                    // Nacking with requeue here used to hand the
                                    // same message straight back to us, spinning
                                    // at broker speed and writing a fresh file per
                                    // redelivery. Unacked messages are invisible
                                    // to other consumers and are requeued by the
                                    // broker as soon as this connection closes,
                                    // which is exactly what "peek" should mean.
                                    AckMode::Nack => {}
                                }
                            }
                            Some(Err(e)) => {
                                report(format!("Delivery stream error: {e}"));
                                disconnected = true;
                            }
                            None => {
                                report("Delivery stream ended; reconnecting".to_string());
                                disconnected = true;
                            }
                        }
                    }
                }
            }

            let _ = connection.close(200, "reconnect").await;

            if cancel.is_cancelled() {
                break;
            }

            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {}
            }
        }

        let _ = app_handle.emit(&status_event_name, "disconnected");
    });

    Ok(ConsumerSessionInfo {
        folder_path: folder_path_str,
        folder_name,
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
    let path = ensure_within_message_root(&path)?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read message file: {e}"))
}

/// Reads a file the user picked in the native file dialog (bulk send), which by
/// definition lives outside the message store. Kept separate from
/// `read_message_file` so the path-confined command stays confined.
#[tauri::command]
pub async fn read_picked_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let path = ensure_within_message_root(&path)?;
    reveal_in_file_manager(&path, false)
}

#[tauri::command]
pub fn get_config_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".rabbit-client.yaml").to_string_lossy().to_string())
}

#[tauri::command]
pub fn show_config_in_file_manager() -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    reveal_in_file_manager(&home.join(".rabbit-client.yaml"), true)
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


#[cfg(test)]
mod url_tests {
    use super::*;

    #[test]
    fn test_resolve_amqp_url_without_placeholders() {
        let url = "amqp://guest:guest@localhost:5672";
        assert_eq!(resolve_amqp_url(url).unwrap(), url);
    }

    #[test]
    fn test_resolve_amqp_url_substitutes_variables() {
        std::env::set_var("RC_TEST_USER", "alice");
        std::env::set_var("RC_TEST_HOST", "broker.internal");
        assert_eq!(
            resolve_amqp_url("amqp://${RC_TEST_USER}:pw@${RC_TEST_HOST}:5672").unwrap(),
            "amqp://alice:pw@broker.internal:5672"
        );
    }

    #[test]
    fn test_resolve_amqp_url_errors_on_missing_variable() {
        std::env::remove_var("RC_TEST_ABSENT");
        assert!(resolve_amqp_url("amqp://${RC_TEST_ABSENT}@host").is_err());
    }

    #[test]
    fn test_resolve_amqp_url_terminates_when_value_contains_a_placeholder() {
        // Restarting the scan at 0 after each substitution used to make this
        // hang forever, taking the whole command with it.
        std::env::set_var("RC_TEST_RECURSIVE", "${RC_TEST_RECURSIVE}");
        let resolved = resolve_amqp_url("amqp://${RC_TEST_RECURSIVE}@host").unwrap();
        assert_eq!(resolved, "amqp://${RC_TEST_RECURSIVE}@host");
    }

    #[test]
    fn test_resolve_amqp_url_ignores_unterminated_placeholder() {
        assert_eq!(
            resolve_amqp_url("amqp://${UNCLOSED@host").unwrap(),
            "amqp://${UNCLOSED@host"
        );
    }
}
