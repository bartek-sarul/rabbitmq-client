use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub save_path: Option<String>,
    pub connections: Vec<ConnectionDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionDef {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub queues: Vec<QueueDef>,
    #[serde(default)]
    pub exchanges: Vec<ExchangeDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueDef {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeDef {
    pub name: String,
}


impl AppConfig {
    pub fn validate(&self) -> Result<(), String> {
        let path = self.save_path.as_ref().ok_or("save_path must be configured in ~/.rabbit-client.yaml")?;
        if path.trim().is_empty() {
            return Err("save_path cannot be empty".to_string());
        }

        if self.connections.is_empty() {
            return Err("At least one connection must be defined in the configuration".to_string());
        }

        for (i, conn) in self.connections.iter().enumerate() {
            if conn.name.trim().is_empty() {
                return Err(format!("Connection at index {} is missing a name", i));
            }
            if conn.url.trim().is_empty() {
                return Err(format!("Connection '{}' is missing a URL", conn.name));
            }
            if !conn.url.starts_with("amqp://") && !conn.url.starts_with("amqps://") {
                return Err(format!(
                    "Connection '{}' has an invalid URL. It must start with 'amqp://' or 'amqps://'",
                    conn.name
                ));
            }

            for q in &conn.queues {
                if q.name.trim().is_empty() {
                    return Err(format!("Connection '{}' has a queue with an empty name", conn.name));
                }
            }

            for ex in &conn.exchanges {
                if ex.name.trim().is_empty() {
                    return Err(format!("Connection '{}' has an exchange with an empty name", conn.name));
                }
            }
        }

        Ok(())
    }
}

#[allow(dead_code)]
const SAMPLE_CONFIG: &str = r#"save_path: "/tmp/rabbit-client-messages"
connections:
  - name: "local"
    url: "amqp://guest:guest@localhost:5672"
    queues:
      - name: "my-queue"
    exchanges:
      - name: "my-exchange"
        type: "direct"
"#;

pub fn load_config() -> Result<AppConfig, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let config_path = home.join(".rabbit-client.yaml");

    if !config_path.exists() {
        let default_save_path = home.join("rabbit-client-messages").to_string_lossy().to_string();
        let sample_config = format!(
            "save_path: \"{}\"\nconnections:\n  - name: \"local\"\n    url: \"amqp://guest:guest@localhost:5672\"\n    queues:\n      - name: \"my-queue\"\n    exchanges:\n      - name: \"my-exchange\"\n        type: \"direct\"\n",
            default_save_path
        );
        std::fs::write(&config_path, sample_config)
            .map_err(|e| format!("Failed to write sample config: {e}"))?;
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {e}"))?;

    let config: AppConfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    config.validate()?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sample_config_parsing() {
        let parsed: Result<AppConfig, _> = serde_yaml::from_str(SAMPLE_CONFIG);
        assert!(parsed.is_ok(), "Sample config should be parseable: {:?}", parsed.err());
        
        let config = parsed.unwrap();
        assert!(config.validate().is_ok());
        assert_eq!(config.connections.len(), 1);
        assert_eq!(config.connections[0].name, "local");
        assert_eq!(config.connections[0].url, "amqp://guest:guest@localhost:5672");
        assert_eq!(config.connections[0].queues.len(), 1);
        assert_eq!(config.connections[0].queues[0].name, "my-queue");
        assert_eq!(config.connections[0].exchanges.len(), 1);
        assert_eq!(config.connections[0].exchanges[0].name, "my-exchange");
    }

    #[test]
    fn test_custom_config_parsing() {
        let yaml = r#"
            save_path: "/tmp/save"
            connections:
              - name: "prod"
                url: "amqps://user:pass@host:5671"
                queues: []
                exchanges:
                  - name: "ex.fanout"
                    type: "fanout"
        "#;
        let config: AppConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(config.validate().is_ok());
        assert_eq!(config.save_path, Some("/tmp/save".to_string()));
        assert_eq!(config.connections.len(), 1);
        assert_eq!(config.connections[0].name, "prod");
        assert_eq!(config.connections[0].url, "amqps://user:pass@host:5671");
        assert_eq!(config.connections[0].queues.len(), 0);
        assert_eq!(config.connections[0].exchanges.len(), 1);
        assert_eq!(config.connections[0].exchanges[0].name, "ex.fanout");
    }

    #[test]
    fn test_invalid_config_validation() {
        let empty_save_path = AppConfig {
            save_path: None,
            connections: vec![],
        };
        assert!(empty_save_path.validate().is_err());

        let invalid_url = AppConfig {
            save_path: Some("/tmp/save".to_string()),
            connections: vec![ConnectionDef {
                name: "test".to_string(),
                url: "http://localhost".to_string(),
                queues: vec![],
                exchanges: vec![],
            }],
        };
        assert!(invalid_url.validate().is_err());

        let empty_name = AppConfig {
            save_path: Some("/tmp/save".to_string()),
            connections: vec![ConnectionDef {
                name: "".to_string(),
                url: "amqp://localhost".to_string(),
                queues: vec![],
                exchanges: vec![],
            }],
        };
        assert!(empty_name.validate().is_err());
    }
}
