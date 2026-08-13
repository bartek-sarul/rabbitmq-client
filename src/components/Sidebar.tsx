import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppConfig, ConnectionDef, TargetType, TabMode, AckMode } from "../types";
import { useAppStore } from "../store/useAppStore";
import { v4 as uuidv4 } from "uuid";
import { ConfigEditorModal } from "./ConfigEditorModal";
import { open } from "@tauri-apps/plugin-dialog";

interface OpenTabOptions {
  conn: ConnectionDef;
  targetName: string;
  targetType: TargetType;
  mode: TabMode;
  ackMode: AckMode;
  folderPath?: string;
}

// Fuzzy subsequence match: every character of `query` must appear in `target`,
// in order, but not necessarily contiguously (case-insensitive).
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function Sidebar() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ conn: ConnectionDef; targetName: string; targetType: TargetType } | null>(null);
  const [modeChoice, setModeChoice] = useState<TabMode>("read");
  const [ackChoice, setAckChoice] = useState<AckMode>("ack");
  const [opening, setOpening] = useState(false);
  const [folderPath, setFolderPath] = useState<string>("");
  const [useLastFolder, setUseLastFolder] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const addTab = useAppStore((s) => s.addTab);

  const [showConfigEditor, setShowConfigEditor] = useState(false);

  const tabs = useAppStore((s) => s.tabs);
  const updateTab = useAppStore((s) => s.updateTab);

  const fetchConfig = () => {
    invoke<AppConfig>("load_config_cmd")
      .then(setConfig)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (config) {
      tabs.forEach(tab => {
        if (tab.targetType === "exchange") {
          const conn = config.connections.find(c => c.name === tab.connName);
          if (conn) {
            const ex = conn.exchanges.find(e => e.name === tab.targetName);
            if (ex && ex.routing_keys) {
              if (JSON.stringify(ex.routing_keys) !== JSON.stringify(tab.predefinedRoutingKeys)) {
                updateTab(tab.id, { predefinedRoutingKeys: ex.routing_keys });
              }
            } else if (tab.predefinedRoutingKeys && tab.predefinedRoutingKeys.length > 0) {
                updateTab(tab.id, { predefinedRoutingKeys: [] });
            }
          }
        }
      });
    }
  }, [config]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && pending !== null && !showConfigEditor) {
        setPending(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pending, showConfigEditor]);

  useEffect(() => {
    async function initFolder() {
      if (!pending || modeChoice !== "read") return;
      const stored = localStorage.getItem(`last_folder_${pending.conn.name}_${pending.targetName}`);
      if (stored) {
        setUseLastFolder(true);
        setFolderPath(stored);
      } else {
        setUseLastFolder(false);
        try {
          const defaultPath = await invoke<string>("generate_default_folder_path", {
            connName: pending.conn.name,
            targetName: pending.targetName
          });
          setFolderPath(defaultPath);
        } catch (e) {
          console.error(e);
        }
      }
    }
    initFolder();
  }, [pending?.conn.name, pending?.targetName, modeChoice]);

  async function handleCheckboxChange(checked: boolean) {
    setUseLastFolder(checked);
    if (!pending) return;
    if (checked) {
      const stored = localStorage.getItem(`last_folder_${pending.conn.name}_${pending.targetName}`);
      if (stored) setFolderPath(stored);
    } else {
      try {
        const defaultPath = await invoke<string>("generate_default_folder_path", {
          connName: pending.conn.name,
          targetName: pending.targetName
        });
        setFolderPath(defaultPath);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function handlePickFolder() {
    try {
      const selected = await open({ directory: true });
      if (selected && typeof selected === "string") {
        setFolderPath(selected);
        setUseLastFolder(false);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleNewLocation() {
    if (!pending) return;
    try {
      const defaultPath = await invoke<string>("generate_default_folder_path", {
        connName: pending.conn.name,
        targetName: pending.targetName
      });
      setFolderPath(defaultPath);
      setUseLastFolder(false);
    } catch (e) {
      console.error(e);
    }
  }

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
    
    let predefinedRoutingKeys: string[] | undefined = undefined;
    if (opts.targetType === "exchange") {
      const ex = opts.conn.exchanges.find(e => e.name === opts.targetName);
      if (ex && ex.routing_keys) {
        predefinedRoutingKeys = ex.routing_keys;
      }
    }

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
        predefinedRoutingKeys,
        folderPath: opts.folderPath,
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

      {config && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <svg style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              type="text"
              placeholder="Search connections…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "6px 28px", fontSize: "13px", height: "30px", boxSizing: "border-box" }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Clear search"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {!config ? (
        <div className="sidebar-loading">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
          </svg>
          Loading…
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {(() => {
            const query = searchQuery.trim();
            const isSearching = query.length > 0;

            const visibleConnections = config.connections
              .map((conn) => {
                const connNameMatches = fuzzyMatch(query, conn.name);
                const queues = !isSearching || connNameMatches
                  ? conn.queues
                  : conn.queues.filter((q) => fuzzyMatch(query, q.name));
                const exchanges = !isSearching || connNameMatches
                  ? conn.exchanges
                  : conn.exchanges.filter((e) => fuzzyMatch(query, e.name));
                const hasMatch = connNameMatches || queues.length > 0 || exchanges.length > 0;
                return { conn, queues, exchanges, hasMatch };
              })
              .filter((item) => !isSearching || item.hasMatch);

            if (isSearching && visibleConnections.length === 0) {
              return (
                <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  No connections match "{query}"
                </div>
              );
            }

            return visibleConnections.map(({ conn, queues, exchanges }) => {
              const isExpanded = isSearching ? true : expanded.has(conn.name);
              return (
                <div key={conn.name} className="conn-item">
                  <button className="conn-name" onClick={() => toggleConn(conn.name)}>
                    <span className="arrow" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
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

                  {isExpanded && (
                    <div className="conn-children">
                      {queues.length > 0 && (
                        <div className="target-group">
                          <span className="target-group-label">Queues</span>
                          {queues.map((q) => (
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
                      {exchanges.length > 0 && (
                        <div className="target-group">
                          <span className="target-group-label">Exchanges</span>
                          {exchanges.map((ex) => (
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
              );
            });
          })()}
        </div>
      )}

      {/* Queue mode picker modal */}
      {pending && (
        <div className="mode-picker-overlay">
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
              <div 
                className="mode-card" 
                style={pending.targetType === "exchange" ? { opacity: 0.5, cursor: "not-allowed", flexDirection: "column" } : { flexDirection: "column" }}
                onClick={() => {
                  if (pending.targetType !== "exchange") setModeChoice("read");
                }}
              >
                <div style={{ display: "flex", gap: "14px", width: "100%" }}>
                  <input
                    type="radio"
                    name="mode"
                    value="read"
                    checked={modeChoice === "read"}
                    readOnly
                    style={{ pointerEvents: "none" }}
                  />
                  <div className="option-details">
                    <div className="option-title">Consumer (read mode)</div>
                    <div className="option-desc">
                      {pending.targetType === "exchange" 
                        ? "Cannot consume directly from an exchange." 
                        : "Subscribe and stream messages from this queue in real-time."}
                    </div>
                  </div>
                </div>

                {/* Always render folder picker, but disabled if not in read mode */}
                <div 
                  style={{ 
                    marginTop: "16px", 
                    marginLeft: "28px", 
                    opacity: modeChoice === "read" ? 1 : 0.4, 
                    pointerEvents: modeChoice === "read" ? "auto" : "none",
                    width: "calc(100% - 28px)"
                  }}
                  onClick={(e) => e.stopPropagation()} // Prevent clicking folder inputs from triggering the mode-card click
                >
                  <strong style={{ fontSize: "12px", display: "block", marginBottom: "8px" }}>Message Storage Folder</strong>
                  <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", marginBottom: "8px" }}>
                    <input type="checkbox" checked={useLastFolder} onChange={(e) => handleCheckboxChange(e.target.checked)} />
                    Use last folder for this queue
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input type="text" value={folderPath} readOnly disabled={useLastFolder} className="input" style={{ flex: 1, fontSize: "12px", padding: "4px 8px", opacity: useLastFolder ? 0.6 : 1 }} />
                    <button type="button" className="btn-secondary" onClick={handleNewLocation} disabled={useLastFolder} style={{ padding: "4px 12px", fontSize: "12px", opacity: useLastFolder ? 0.6 : 1 }}>
                      New location
                    </button>
                    <button type="button" className="btn-secondary" onClick={handlePickFolder} disabled={useLastFolder} style={{ padding: "4px 12px", fontSize: "12px", opacity: useLastFolder ? 0.6 : 1 }}>
                      Pick folder
                    </button>
                  </div>
                </div>
              </div>

              <div className="mode-card" onClick={() => setModeChoice("write")}>
                <div style={{ display: "flex", gap: "14px", width: "100%" }}>
                  <input
                    type="radio"
                    name="mode"
                    value="write"
                    checked={modeChoice === "write"}
                    readOnly
                    style={{ pointerEvents: "none" }}
                  />
                  <div className="option-details">
                    <div className="option-title">Publisher (write mode)</div>
                    <div className="option-desc">
                      {pending.targetType === "exchange"
                        ? "Publish messages directly to this exchange."
                        : "Publish new messages directly into this queue."}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mode-picker-actions">
              <button className="btn-secondary" onClick={() => setPending(null)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={opening}
                onClick={() => {
                  if (modeChoice === "read" && folderPath) {
                    localStorage.setItem(`last_folder_${pending.conn.name}_${pending.targetName}`, folderPath);
                  }
                  openTab({
                    conn: pending.conn,
                    targetName: pending.targetName,
                    targetType: pending.targetType,
                    mode: modeChoice,
                    ackMode: ackChoice,
                    folderPath: modeChoice === "read" ? folderPath : undefined
                  });
                }}
              >
                {opening ? "Connecting…" : "OK"}
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
