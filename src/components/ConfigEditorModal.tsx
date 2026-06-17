import { useState, useEffect } from "react";
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

  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueName, setEditingQueueName] = useState("");

  const [editingExIndex, setEditingExIndex] = useState<number | null>(null);
  const [editingExName, setEditingExName] = useState("");

  const isMac = navigator.userAgent.includes("Macintosh");
  const isWindows = navigator.userAgent.includes("Windows");
  const showFolderLabel = isMac ? "Show in Finder" : isWindows ? "Show in Explorer" : "Show in File Manager";

  useEffect(() => {
    setEditingQueueIndex(null);
    setEditingExIndex(null);
  }, [selectedConnIndex]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editingQueueIndex === null && editingExIndex === null && connToDeleteIndex === null) {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingQueueIndex, editingExIndex, connToDeleteIndex]);

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

  function handleSaveQueueEdit(qIndex: number) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    const trimmed = editingQueueName.trim();
    if (trimmed && !conn.queues.some((q, i) => i !== qIndex && q.name === trimmed)) {
      conn.queues[qIndex].name = trimmed;
      setConnections(nextConns);
    }
    setEditingQueueIndex(null);
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

  function handleAddRoutingKey(exIndex: number, key: string) {
    if (selectedConnIndex === null || !key.trim()) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    if (!conn.exchanges[exIndex].routing_keys) {
      conn.exchanges[exIndex].routing_keys = [];
    }
    if (!conn.exchanges[exIndex].routing_keys!.includes(key.trim())) {
      conn.exchanges[exIndex].routing_keys!.push(key.trim());
      setConnections(nextConns);
    }
  }

  function handleDeleteRoutingKey(exIndex: number, keyIndex: number) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    if (conn.exchanges[exIndex].routing_keys) {
      conn.exchanges[exIndex].routing_keys = conn.exchanges[exIndex].routing_keys!.filter((_, i) => i !== keyIndex);
      setConnections(nextConns);
    }
  }

  function handleSaveExEdit(exIndex: number) {
    if (selectedConnIndex === null) return;
    const nextConns = [...connections];
    const conn = nextConns[selectedConnIndex];
    const trimmed = editingExName.trim();
    if (trimmed && !conn.exchanges.some((ex, i) => i !== exIndex && ex.name === trimmed)) {
      conn.exchanges[exIndex].name = trimmed;
      setConnections(nextConns);
    }
    setEditingExIndex(null);
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
            overflow: "hidden",
            padding: "16px"
          }}>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>Configuration file path</label>
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

            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
          <div style={{ flex: 1, padding: "24px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {selectedConn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", flex: 1, minHeight: 0 }}>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                      <label style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>AMQP URL</label>
                      <div className="tooltip-container" style={{ position: "relative", display: "inline-flex", cursor: "help" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                          <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        <div className="tooltip-text" style={{
                          position: "absolute",
                          bottom: "100%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          marginBottom: "8px",
                          width: "260px",
                          background: "var(--bg-active)",
                          border: "1px solid var(--border-color)",
                          color: "var(--text-primary)",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          lineHeight: 1.4,
                          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                          pointerEvents: "none",
                          opacity: 0,
                          transition: "opacity 0.2s",
                          zIndex: 100
                        }}>
                          You can use environment variables in the format <code style={{color: "var(--accent-color)"}}>${"{VAR_NAME}"}</code>. Define them in a <code style={{color: "var(--accent-color)"}}>.env</code> file next to the app, or export them in your terminal profile.
                        </div>
                      </div>
                    </div>
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

                <div style={{ display: "flex", gap: "24px", flex: 1, minHeight: 0 }}>
                  {/* Queues list */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Queues</label>
                    <div style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      padding: "8px",
                      background: "var(--bg-sidebar)",
                      marginBottom: "8px"
                    }}>
                      {selectedConn.queues.map((q, qi) => (
                        <div 
                          key={qi} 
                          onDoubleClick={() => {
                            setEditingQueueIndex(qi);
                            setEditingQueueName(q.name);
                          }}
                          style={{
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
                          }}
                        >
                          {editingQueueIndex === qi ? (
                            <input
                              autoFocus
                              type="text"
                              value={editingQueueName}
                              onChange={(e) => setEditingQueueName(e.target.value)}
                              onBlur={() => handleSaveQueueEdit(qi)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveQueueEdit(qi);
                                if (e.key === 'Escape') setEditingQueueIndex(null);
                              }}
                              style={{ 
                                flex: 1, 
                                padding: "2px 6px", 
                                fontSize: "12px", 
                                background: "var(--bg-sidebar)",
                                border: "1px solid var(--primary-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                outline: "none",
                                marginRight: "8px"
                              }}
                            />
                          ) : (
                            <span style={{ flex: 1, userSelect: "none" }} title="Double click to rename">{q.name}</span>
                          )}
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
                  <div style={{ flex: 1.2, display: "flex", flexDirection: "column" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Exchanges</label>
                    <div style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      padding: "8px",
                      background: "var(--bg-sidebar)",
                      marginBottom: "8px"
                    }}>
                      {selectedConn.exchanges.map((ex, exi) => (
                        <div 
                          key={exi} 
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            background: "var(--bg-primary)",
                            marginBottom: "4px",
                            border: "1px solid var(--border-color)"
                          }}
                        >
                          <div 
                            onDoubleClick={() => {
                              setEditingExIndex(exi);
                              setEditingExName(ex.name);
                            }}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                          >
                            {editingExIndex === exi ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingExName}
                                onChange={(e) => setEditingExName(e.target.value)}
                                onBlur={() => handleSaveExEdit(exi)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveExEdit(exi);
                                  if (e.key === 'Escape') setEditingExIndex(null);
                                }}
                                style={{ 
                                  flex: 1, 
                                  padding: "2px 6px", 
                                  fontSize: "12px", 
                                  background: "var(--bg-sidebar)",
                                  border: "1px solid var(--primary-color)",
                                  borderRadius: "4px",
                                  color: "var(--text-primary)",
                                  outline: "none",
                                  marginRight: "8px"
                                }}
                              />
                            ) : (
                              <span style={{ display: "flex", gap: "6px", alignItems: "center", flex: 1, userSelect: "none" }} title="Double click to rename">
                                {ex.name}
                              </span>
                            )}
                            <button
                              onClick={() => handleDeleteExchange(exi)}
                              className="config-item-delete-btn"
                            >
                              ✕
                            </button>
                          </div>

                          <div style={{ marginTop: "4px", paddingTop: "4px", borderTop: "1px dashed var(--border-color)", display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 500 }}>Predefined Routing Keys:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {ex.routing_keys?.map((rk, rki) => (
                                <div key={rki} style={{ background: "var(--bg-sidebar)", padding: "2px 6px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "4px", border: "1px solid var(--border-color)", fontSize: "10px" }}>
                                  {rk}
                                  <button onClick={() => handleDeleteRoutingKey(exi, rki)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "10px", padding: 0, display: "flex" }}>✕</button>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                              <input 
                                id={`rk-input-${exi}`}
                                type="text"
                                placeholder="Add key..."
                                style={{ flex: 1, padding: "2px 6px", fontSize: "10px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleAddRoutingKey(exi, e.currentTarget.value);
                                    e.currentTarget.value = "";
                                  }
                                }}
                              />
                              <button
                                onClick={() => {
                                  const input = document.getElementById(`rk-input-${exi}`) as HTMLInputElement;
                                  if (input) {
                                    handleAddRoutingKey(exi, input.value);
                                    input.value = "";
                                  }
                                }}
                                style={{
                                  background: "var(--bg-active)",
                                  color: "var(--text-primary)",
                                  border: "1px solid var(--border-color)",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}
                                title="Add routing key"
                              >
                                +
                              </button>
                            </div>
                          </div>
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
