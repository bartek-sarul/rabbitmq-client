import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppConfig, ConnectionDef, TargetType, TabMode, AckMode } from "../types";
import { useAppStore } from "../store/useAppStore";
import { v4 as uuidv4 } from "uuid";
import { ConfigEditorModal } from "./ConfigEditorModal";

interface OpenTabOptions {
  conn: ConnectionDef;
  targetName: string;
  targetType: TargetType;
  mode: TabMode;
  ackMode: AckMode;
}

export function Sidebar() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ conn: ConnectionDef; targetName: string; targetType: TargetType } | null>(null);
  const [modeChoice, setModeChoice] = useState<TabMode>("read");
  const [ackChoice, setAckChoice] = useState<AckMode>("ack");
  const [opening, setOpening] = useState(false);

  const addTab = useAppStore((s) => s.addTab);

  const [showConfigEditor, setShowConfigEditor] = useState(false);

  const fetchConfig = () => {
    invoke<AppConfig>("load_config_cmd")
      .then(setConfig)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  function toggleConn(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function selectTarget(conn: ConnectionDef, targetName: string, targetType: TargetType) {
    setPending({ conn, targetName, targetType });
    if (targetType === "exchange") {
      setModeChoice("write");
    } else {
      setModeChoice("read");
    }
    setAckChoice("ack");
  }

  async function openTab(opts: OpenTabOptions) {
    setOpening(true);
    const tabId = uuidv4();
    const label = `${opts.conn.name} / ${opts.targetName} [${opts.mode === "read" ? "R" : "W"}]`;
    try {
      await invoke("open_tab", {
        tabId,
        connUrl: opts.conn.url,
        connName: opts.conn.name,
        targetName: opts.targetName,
        targetType: opts.targetType,
        mode: opts.mode,
        ackMode: opts.ackMode,
      });
      addTab({
        id: tabId,
        connName: opts.conn.name,
        connUrl: opts.conn.url,
        targetName: opts.targetName,
        targetType: opts.targetType,
        mode: opts.mode,
        ackMode: opts.ackMode,
        label,
      });
      setPending(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setOpening(false);
    }
  }

  if (error) {
    return (
      <div className="sidebar">
        <div className="sidebar-error">
          <strong>Config error</strong>
          <p>{error}</p>
          <small style={{ display: "block", marginBottom: "12px" }}>Ensure ~/.rabbit-client.yaml exists and is valid.</small>
          <button
            className="btn-edit-config"
            onClick={() => setShowConfigEditor(true)}
            style={{
              padding: "6px 12px",
              background: "var(--danger-color)",
              border: "none",
              color: "#fff",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600
            }}
          >
            Edit Config File
          </button>
        </div>
        {showConfigEditor && (
          <ConfigEditorModal
            initialConfig={config}
            onClose={() => setShowConfigEditor(false)}
            onSaveSuccess={fetchConfig}
          />
        )}
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-color)" }}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          Connections
        </span>
        <button
          className="btn-edit-config"
          onClick={() => setShowConfigEditor(true)}
          title="Edit Configuration"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            padding: "4px",
            borderRadius: "4px",
            transition: "all 0.2s"
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" />
          </svg>
        </button>
      </div>

      {!config ? (
        <div className="sidebar-loading">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
          </svg>
          Loading…
        </div>
      ) : (
        config.connections.map((conn) => (
          <div key={conn.name} className="conn-item">
            <button className="conn-name" onClick={() => toggleConn(conn.name)}>
              <span className="arrow" style={{ transform: expanded.has(conn.name) ? "rotate(90deg)" : "rotate(0deg)" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-color)" }}>
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              {conn.name}
            </button>

            {expanded.has(conn.name) && (
              <div className="conn-children">
                {conn.queues.length > 0 && (
                  <div className="target-group">
                    <span className="target-group-label">Queues</span>
                    {conn.queues.map((q) => (
                      <button
                        key={q.name}
                        className="target-item"
                        onClick={() => selectTarget(conn, q.name, "queue")}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--success-color)" }}>
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                            <line x1="3" y1="6" x2="3" y2="18" />
                            <line x1="21" y1="6" x2="21" y2="18" />
                          </svg>
                          {q.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {conn.exchanges.length > 0 && (
                  <div className="target-group">
                    <span className="target-group-label">Exchanges</span>
                    {conn.exchanges.map((ex) => (
                      <button
                        key={ex.name}
                        className="target-item exchange"
                        onClick={() => selectTarget(conn, ex.name, "exchange")}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-color)" }}>
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                          </svg>
                          {ex.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {/* Queue mode picker modal */}
      {pending && (
        <div className="mode-picker-overlay" onClick={() => setPending(null)}>
          <div className="mode-picker" onClick={(e) => e.stopPropagation()}>
            <div className="mode-picker-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {pending.targetType === "exchange" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-color)" }}>
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--success-color)" }}>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3" y2="18" />
                  <line x1="21" y1="6" x2="21" y2="18" />
                </svg>
              )}
              <strong>{pending.targetName}</strong>
            </div>

            <div className="mode-picker-row">
              <label style={pending.targetType === "exchange" ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
                <input
                  type="radio"
                  name="mode"
                  value="read"
                  checked={modeChoice === "read"}
                  onChange={() => setModeChoice("read")}
                  disabled={pending.targetType === "exchange"}
                />
                <div className="option-details">
                  <div className="option-title">Consumer (read mode)</div>
                  <div className="option-desc">
                    {pending.targetType === "exchange" 
                      ? "Cannot consume directly from an exchange." 
                      : "Subscribe and stream messages from this queue in real-time."}
                  </div>
                </div>
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  value="write"
                  checked={modeChoice === "write"}
                  onChange={() => setModeChoice("write")}
                />
                <div className="option-details">
                  <div className="option-title">Publisher (write mode)</div>
                  <div className="option-desc">
                    {pending.targetType === "exchange"
                      ? "Publish messages directly to this exchange."
                      : "Publish new messages directly into this queue."}
                  </div>
                </div>
              </label>
            </div>

            <div className="mode-picker-actions">
              <button className="btn-secondary" onClick={() => setPending(null)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={opening}
                onClick={() =>
                  openTab({
                    conn: pending.conn,
                    targetName: pending.targetName,
                    targetType: pending.targetType,
                    mode: modeChoice,
                    ackMode: ackChoice,
                  })
                }
              >
                {opening ? "Connecting…" : "ok"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showConfigEditor && (
        <ConfigEditorModal
          initialConfig={config}
          onClose={() => setShowConfigEditor(false)}
          onSaveSuccess={fetchConfig}
        />
      )}
    </div>
  );
}
