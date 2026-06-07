import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppConfig, ConnectionDef } from "../types";

interface Props {
  onClose: () => void;
  onSaveSuccess: () => void;
  initialConfig: AppConfig | null;
}

export function ConfigEditorModal({ onClose, onSaveSuccess, initialConfig }: Props) {
  const [savePath, setSavePath] = useState(initialConfig?.save_path || "");
  const [connections, setConnections] = useState<ConnectionDef[]>(initialConfig?.connections || []);
  const [selectedConnIndex, setSelectedConnIndex] = useState<number | null>(
    initialConfig?.connections && initialConfig.connections.length > 0 ? 0 : null
  );

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Form helpers for adding queues & exchanges
  const [newQueueName, setNewQueueName] = useState("");
  const [newExName, setNewExName] = useState("");
  const [newConnName, setNewConnName] = useState("");

  const [connToDeleteIndex, setConnToDeleteIndex] = useState<number | null>(null);

  const isMac = navigator.userAgent.includes("Macintosh");
  const isWindows = navigator.userAgent.includes("Windows");
  const showFolderLabel = isMac ? "Show in Finder" : isWindows ? "Show in Explorer" : "Show in File Manager";

  // Visual editing mutations
  function handleAddConnection() {
    if (!newConnName.trim()) {
      setError("Connection name cannot be empty.");
      return;
    }
    setError(null);
    if (connections.some((c) => c.name.trim() === newConnName.trim())) {
      setError("Connection name already exists.");
      return;
    }
    const newConn: ConnectionDef = {
      name: newConnName.trim(),
      url: "amqp://guest:guest@localhost:5672",
      queues: [],
      exchanges: [],
    };
    const nextConns = [...connections, newConn];
    setConnections(nextConns);
    setSelectedConnIndex(nextConns.length - 1);
    setNewConnName("");
  }

  function handleDeleteConnection(index: number) {
    setError(null);
    const nextConns = connections.filter((_, i) => i !== index);
    setConnections(nextConns);
    if (nextConns.length === 0) {
      setSelectedConnIndex(null);
    } else {
      setSelectedConnIndex(Math.max(0, index - 1));
    }
  }

  function handleUpdateConnectionField(field: keyof ConnectionDef, value: string) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    nextConns[selectedConnIndex] = {
      ...nextConns[selectedConnIndex],
      [field]: value,
    };
    setConnections(nextConns);
  }

  function handleAddQueue() {
    if (selectedConnIndex === null || !newQueueName.trim()) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    if (conn.queues.some((q) => q.name === newQueueName.trim())) {
      setError("Queue already exists.");
      return;
    }
    setError(null);
    conn.queues = [...conn.queues, { name: newQueueName.trim() }];
    setConnections(nextConns);
    setNewQueueName("");
  }

  function handleDeleteQueue(qIndex: number) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    conn.queues = conn.queues.filter((_, i) => i !== qIndex);
    setConnections(nextConns);
  }

  // Exchanges list editing
  function handleAddExchange() {
    if (selectedConnIndex === null || !newExName.trim()) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    if (conn.exchanges.some((ex) => ex.name === newExName.trim())) {
      setError("Exchange already exists.");
      return;
    }
    setError(null);
    conn.exchanges = [
      ...conn.exchanges,
      { name: newExName.trim() },
    ];
    setConnections(nextConns);
    setNewExName("");
  }

  function handleDeleteExchange(exIndex: number) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    conn.exchanges = conn.exchanges.filter((_, i) => i !== exIndex);
    setConnections(nextConns);
  }

  // Open config file folder on desktop
  async function handleShowConfigInFolder() {
    try {
      setError(null);
      await invoke("show_config_in_file_manager");
    } catch (err) {
      setError(String(err));
    }
  }

  // Save config
  async function handleSave() {
    setError(null);
    if (!savePath.trim()) {
      setError("Save path is mandatory.");
      return;
    }
    if (connections.length === 0) {
      setError("At least one connection is required.");
      return;
    }
    setLoading(true);
    try {
      const configStruct: AppConfig = {
        save_path: savePath.trim(),
        connections,
      };
      await invoke("save_config_struct", { config: configStruct });
      onSaveSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const selectedConn = selectedConnIndex !== null ? connections[selectedConnIndex] : null;

  return (
    <div className="mode-picker-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <div className="config-editor-modal" style={{
        background: "var(--bg-primary)",
        border: "1px solid var(--border-color)",
        borderRadius: "12px",
        width: "850px",
        height: "600px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
        overflow: "hidden",
        position: "relative"
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid var(--border-color)"
        }}>
          <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Configuration Editor</span>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.1)",
            borderBottom: "1px solid rgba(239, 68, 68, 0.2)",
            color: "var(--danger-color)",
            padding: "10px 24px",
            fontSize: "13px"
          }}>
            {error}
          </div>
        )}

        {/* Content Pane */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Left sidebar */}
          <div style={{
            width: "250px",
            borderRight: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-sidebar)",
            overflowY: "auto",
            padding: "16px"
          }}>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Save Path</label>
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="/path/to/folder"
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  borderRadius: "6px",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Connections</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, overflowY: "auto", marginBottom: "16px" }}>
                {connections.map((c, i) => (
                  <div
                    key={i}
                    className={`config-conn-item ${selectedConnIndex === i ? "selected" : ""}`}
                  >
                    <button
                      onClick={() => setSelectedConnIndex(i)}
                      style={{
                        background: "none",
                        border: "none",
                        color: selectedConnIndex === i ? "var(--text-primary)" : "var(--text-secondary)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "13px",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        flex: 1,
                        padding: "4px 0"
                      }}
                    >
                      {c.name || `Unnamed (${i + 1})`}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnToDeleteIndex(i);
                      }}
                      className="config-conn-delete-btn"
                      title="Delete connection"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {connections.length === 0 && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "8px" }}>No connections added.</div>
                )}
              </div>

              <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px", display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="Add connection..."
                  value={newConnName}
                  onChange={(e) => setNewConnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddConnection();
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                    borderRadius: "6px",
                    fontSize: "12px"
                  }}
                />
                <button
                  onClick={handleAddConnection}
                  style={{
                    background: "var(--bg-active)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-color)",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ flex: 1, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {selectedConn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", flex: 1 }}>
                <div style={{ display: "flex", gap: "16px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Name</label>
                    <input
                      type="text"
                      value={selectedConn.name}
                      onChange={(e) => handleUpdateConnectionField("name", e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "var(--bg-sidebar)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        borderRadius: "6px",
                        fontSize: "13px"
                      }}
                    />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>AMQP URL</label>
                    <input
                      type="text"
                      value={selectedConn.url}
                      onChange={(e) => handleUpdateConnectionField("url", e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "var(--bg-sidebar)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        borderRadius: "6px",
                        fontSize: "13px"
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "24px" }}>
                  {/* Queues list */}
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Queues</label>
                    <div style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      height: "180px",
                      overflowY: "auto",
                      padding: "8px",
                      background: "var(--bg-sidebar)",
                      marginBottom: "8px"
                    }}>
                      {selectedConn.queues.map((q, qi) => (
                        <div key={qi} style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          color: "var(--text-primary)",
                          background: "var(--bg-primary)",
                          marginBottom: "4px",
                          border: "1px solid var(--border-color)"
                        }}>
                          <span>{q.name}</span>
                          <button
                            onClick={() => handleDeleteQueue(qi)}
                            className="config-item-delete-btn"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {selectedConn.queues.length === 0 && (
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", marginTop: "50px" }}>No queues.</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        placeholder="Add queue..."
                        value={newQueueName}
                        onChange={(e) => setNewQueueName(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          color: "var(--text-primary)",
                          borderRadius: "6px",
                          fontSize: "12px"
                        }}
                      />
                      <button
                        onClick={handleAddQueue}
                        style={{
                          background: "var(--bg-active)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-color)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "12px"
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Exchanges list */}
                  <div style={{ flex: 1.2 }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Exchanges</label>
                    <div style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      height: "180px",
                      overflowY: "auto",
                      padding: "8px",
                      background: "var(--bg-sidebar)",
                      marginBottom: "8px"
                    }}>
                      {selectedConn.exchanges.map((ex, exi) => (
                        <div key={exi} style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          color: "var(--text-primary)",
                          background: "var(--bg-primary)",
                          marginBottom: "4px",
                          border: "1px solid var(--border-color)"
                        }}>
                          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <strong>{ex.name}</strong>
                          </span>
                          <button
                            onClick={() => handleDeleteExchange(exi)}
                            className="config-item-delete-btn"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {selectedConn.exchanges.length === 0 && (
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", marginTop: "50px" }}>No exchanges.</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        placeholder="Add exchange..."
                        value={newExName}
                        onChange={(e) => setNewExName(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          color: "var(--text-primary)",
                          borderRadius: "6px",
                          fontSize: "12px"
                        }}
                      />
                      <button
                        onClick={handleAddExchange}
                        style={{
                          background: "var(--bg-active)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-color)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "12px"
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontStyle: "italic", fontSize: "14px" }}>
                Select a connection to edit or add a new one.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderTop: "1px solid var(--border-color)",
          background: "var(--bg-sidebar)"
        }}>
          <div>
            <button
              onClick={handleShowConfigInFolder}
              className="btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderColor: "var(--border-color)"
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {showFolderLabel}
            </button>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: "8px 16px" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="btn-primary"
              style={{ padding: "8px 16px" }}
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
        {connToDeleteIndex !== null && (
          <div className="mode-picker-overlay" style={{ zIndex: 1200 }} onClick={() => setConnToDeleteIndex(null)}>
            <div className="mode-picker" onClick={(e) => e.stopPropagation()}>
              <div className="mode-picker-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--danger-color)" }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <strong>Delete Connection?</strong>
              </div>

              <div style={{ fontSize: "14px", color: "var(--text-secondary)", margin: "16px 0", lineHeight: "1.5" }}>
                Are you sure you want to delete connection "{connections[connToDeleteIndex]?.name || `Unnamed (${connToDeleteIndex + 1})`}"?
              </div>

              <div className="mode-picker-actions">
                <button className="btn-secondary" onClick={() => setConnToDeleteIndex(null)}>Cancel</button>
                <button
                  className="btn-primary"
                  style={{ backgroundColor: "var(--danger-color)", borderColor: "var(--danger-color)" }}
                  onClick={() => {
                    handleDeleteConnection(connToDeleteIndex);
                    setConnToDeleteIndex(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
