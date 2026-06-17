import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/useAppStore";
import { sanitizeQuotes } from "../utils/sanitize";
import { open } from "@tauri-apps/plugin-dialog";

interface BulkFile {
  path: string;
  name: string;
  status: 'pending' | 'sending' | 'sent' | 'error';
  errorMsg?: string;
}

interface Props {
  tab: Tab;
}

export function WriteTab({ tab }: Props) {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [bulkFiles, setBulkFiles] = useState<BulkFile[]>([]);
  const [bulkSending, setBulkSending] = useState(false);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  const updateTab = useAppStore((s) => s.updateTab);

  // Read fields from the store or default them
  const body = tab.body ?? "";
  const routingKey = tab.routingKey ?? "";
  const contentType = tab.contentType ?? "application/json";
  const deliveryMode = tab.deliveryMode ?? 1;
  const correlationId = tab.correlationId ?? "";
  const autoCorrelationId = tab.autoCorrelationId ?? false;
  const messageId = tab.messageId ?? "";
  const autoMessageId = tab.autoMessageId ?? false;
  const headers = tab.headers ?? "";

  // Initialize fields on first render if tab.body is undefined
  useEffect(() => {
    if (tab.body === undefined) {
      updateTab(tab.id, {
        messageId: "", // starts empty
        autoMessageId: false,
        contentType: "application/json",
        deliveryMode: 1,
        body: "",
        routingKey: "",
        correlationId: "",
        autoCorrelationId: false,
        headers: "",
      });
    }
  }, [tab.id, tab.body, updateTab]);

  // Validate headers whenever they change in the store
  useEffect(() => {
    const val = tab.headers ?? "";
    if (!val.trim()) {
      setHeadersError(null);
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setHeadersError("Headers must be a valid JSON object");
      } else {
        setHeadersError(null);
      }
    } catch (e) {
      setHeadersError("Invalid JSON format");
    }
  }, [tab.headers]);

  function handleTextChange(field: string, val: string) {
    updateTab(tab.id, { [field]: sanitizeQuotes(val) });
  }

  async function handleSend() {
    if (!body.trim() || headersError) return;
    setSending(true);
    setStatus(null);
    try {
      const finalCorrelationId = correlationId.trim() || null;
      const finalMessageId = messageId.trim() || null;
      await invoke("send_message", {
        tabId: tab.id,
        body,
        routingKey: routingKey.trim() || null,
        headers: headers.trim() || null,
        properties: {
          content_type: contentType.trim() || null,
          delivery_mode: deliveryMode,
          correlation_id: finalCorrelationId,
          message_id: finalMessageId,
        },
      });
      setStatus({ ok: true, msg: "Message sent." });
      
      const updates: any = { body: "" };
      if (autoCorrelationId) updates.correlationId = uuidv4();
      if (autoMessageId) updates.messageId = uuidv4();
      updateTab(tab.id, updates);
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    setShowResetConfirm(true);
  }

  async function handleBulkSelect() {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      
      const newFiles: BulkFile[] = paths.map(p => {
        const name = p.split(/[/\\]/).pop() || p;
        return {
          path: p,
          name,
          status: 'pending'
        };
      });

      setBulkFiles(newFiles);
    } catch (e) {
      console.error("Failed to select files:", e);
    }
  }

  async function handleBulkSend() {
    setBulkSending(true);
    
    let currentFiles = [...bulkFiles];
    
    let currentCorrId = correlationId;
    let currentMsgId = messageId;
    
    for (let i = 0; i < currentFiles.length; i++) {
      const f = currentFiles[i];
      if (f.status === 'sent') continue;

      currentFiles[i] = { ...f, status: 'sending', errorMsg: undefined };
      setBulkFiles([...currentFiles]);

      try {
        const content = await invoke<string>("read_message_file", { path: f.path });
        
        const finalCorrelationId = currentCorrId.trim() || null;
        const finalMessageId = currentMsgId.trim() || null;

        await invoke("send_message", {
          tabId: tab.id,
          body: content,
          routingKey: routingKey.trim() || null,
          headers: headers.trim() || null,
          properties: {
            content_type: contentType.trim() || null,
            delivery_mode: deliveryMode,
            correlation_id: finalCorrelationId,
            message_id: finalMessageId,
          },
        });

        currentFiles[i] = { ...f, status: 'sent' };
        
        if (autoCorrelationId) currentCorrId = uuidv4();
        if (autoMessageId) currentMsgId = uuidv4();
      } catch (e) {
        currentFiles[i] = { ...f, status: 'error', errorMsg: String(e) };
      }
      setBulkFiles([...currentFiles]);
    }

    const updates: any = {};
    if (autoCorrelationId) updates.correlationId = currentCorrId;
    if (autoMessageId) updates.messageId = currentMsgId;
    if (Object.keys(updates).length > 0) {
      updateTab(tab.id, updates);
    }

    setBulkSending(false);
  }

  return (
    <div className="write-tab" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ flexGrow: 1, overflowY: "auto", padding: "32px 40px 16px 40px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div className="write-tab-info" style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid var(--border-color)", paddingBottom: "18px" }}>
          <span className="badge write">Publisher</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="target-name">
              {tab.targetName}
              <span className="type-tag">{tab.targetType}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              Connection: <strong>{tab.connName}</strong>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label className="field-label">
          Routing key <span className="optional">(optional)</span>
        </label>
        <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%", maxWidth: "450px" }}>
          <input
            className="routing-key-input"
            type="text"
            value={tab.targetType === "queue" ? "" : routingKey}
            onChange={(e) => handleTextChange("routingKey", e.target.value)}
            placeholder={tab.targetType === "queue" ? "Not applicable for queues" : "Enter routing key (defaults to empty)"}
            disabled={tab.targetType === "queue"}
            title={tab.targetType === "queue" ? "Routing keys are not used when publishing directly to a queue" : ""}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            style={{ 
              paddingRight: "30px", 
              width: "100%", 
              maxWidth: "450px",
              opacity: tab.targetType === "queue" ? 0.6 : 1,
              backgroundColor: tab.targetType === "queue" ? "var(--bg-secondary)" : undefined
            }}
          />
          {routingKey && tab.targetType !== "queue" && (
            <button
              type="button"
              onClick={() => handleTextChange("routingKey", "")}
              style={{
                position: "absolute",
                right: "12px",
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                lineHeight: 1
              }}
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Headers & Properties Panel */}
      <div className="write-options-panel">
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Content Type</label>
          <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
            <input
              type="text"
              value={contentType}
              onChange={(e) => handleTextChange("contentType", e.target.value)}
              placeholder="e.g. application/json"
              style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%" }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
            />
            {contentType && (
              <button
                type="button"
                onClick={() => handleTextChange("contentType", "")}
                style={{
                  position: "absolute",
                  right: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  lineHeight: 1
                }}
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Delivery Mode</label>
          <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
            <select
              value={deliveryMode}
              onChange={(e) => updateTab(tab.id, { deliveryMode: Number(e.target.value) })}
              style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%" }}
            >
              <option value={1}>1 - Transient</option>
              <option value={2}>2 - Persistent</option>
            </select>
            {deliveryMode !== 1 && (
              <button
                type="button"
                onClick={() => updateTab(tab.id, { deliveryMode: 1 })}
                style={{
                  position: "absolute",
                  right: "24px", // offset to not overlap dropdown arrow
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  lineHeight: 1
                }}
                title="Reset to default"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Correlation ID</label>
          <div style={{ display: "flex", gap: "6px", width: "100%", alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", flexGrow: 1 }}>
              <input
                type="text"
                value={correlationId}
                onChange={(e) => handleTextChange("correlationId", e.target.value)}
                placeholder="e.g. corr-123"
                readOnly={autoCorrelationId}
                style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%", opacity: autoCorrelationId ? 0.6 : 1, backgroundColor: autoCorrelationId ? "var(--bg-secondary)" : undefined }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
              {correlationId && !autoCorrelationId && (
                <button
                  type="button"
                  onClick={() => handleTextChange("correlationId", "")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    lineHeight: 1
                  }}
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "4px" }}>
              <input
                type="checkbox"
                checked={autoCorrelationId}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const updates: any = { autoCorrelationId: checked };
                  if (checked) updates.correlationId = uuidv4();
                  updateTab(tab.id, updates);
                }}
                id={`auto-corr-${tab.id}`}
              />
              <label htmlFor={`auto-corr-${tab.id}`} style={{ fontSize: "11px", color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>Auto-generate</label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Message ID</label>
          <div style={{ display: "flex", gap: "6px", width: "100%", alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", flexGrow: 1 }}>
              <input
                type="text"
                value={messageId}
                onChange={(e) => handleTextChange("messageId", e.target.value)}
                placeholder="e.g. msg-123"
                readOnly={autoMessageId}
                style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%", opacity: autoMessageId ? 0.6 : 1, backgroundColor: autoMessageId ? "var(--bg-secondary)" : undefined }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
              {messageId && !autoMessageId && (
                <button
                  type="button"
                  onClick={() => handleTextChange("messageId", "")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    lineHeight: 1
                  }}
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "4px" }}>
              <input
                type="checkbox"
                checked={autoMessageId}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const updates: any = { autoMessageId: checked };
                  if (checked) updates.messageId = uuidv4();
                  updateTab(tab.id, updates);
                }}
                id={`auto-msg-${tab.id}`}
              />
              <label htmlFor={`auto-msg-${tab.id}`} style={{ fontSize: "11px", color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>Auto-generate</label>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>
            Headers <span className="optional">(JSON object)</span>
            {headersError && <span style={{ color: "var(--danger-color)", marginLeft: "auto", fontSize: "11px" }}>{headersError}</span>}
          </label>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%" }}>
            <textarea
              value={headers}
              onChange={(e) => handleTextChange("headers", e.target.value)}
              placeholder='{"x-delay": 1000, "custom-header": "value"}'
              rows={3}
              style={{ padding: "8px 30px 8px 12px", fontSize: "13px", fontFamily: "var(--font-mono)", resize: "vertical", minHeight: "60px", width: "100%", boxSizing: "border-box" }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
            />
            {headers && (
              <button
                type="button"
                onClick={() => handleTextChange("headers", "")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  lineHeight: 1
                }}
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexGrow: 1 }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>
          <button
            type="button"
            className={`tab-btn ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
            style={{ 
              background: "none", border: "none", cursor: "pointer", 
              padding: "4px 8px", fontSize: "14px", fontWeight: mode === 'single' ? 600 : 400,
              color: mode === 'single' ? "var(--primary-color)" : "var(--text-secondary)",
              borderBottom: mode === 'single' ? "2px solid var(--primary-color)" : "2px solid transparent",
              marginBottom: "-9px"
            }}
          >
            Message body
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'bulk' ? 'active' : ''}`}
            onClick={() => setMode('bulk')}
            style={{ 
              background: "none", border: "none", cursor: "pointer", 
              padding: "4px 8px", fontSize: "14px", fontWeight: mode === 'bulk' ? 600 : 400,
              color: mode === 'bulk' ? "var(--primary-color)" : "var(--text-secondary)",
              borderBottom: mode === 'bulk' ? "2px solid var(--primary-color)" : "2px solid transparent",
              marginBottom: "-9px"
            }}
          >
            Bulk Send
          </button>
        </div>

        {mode === 'single' ? (
          <textarea
            className="message-body"
            value={body}
            onChange={(e) => handleTextChange("body", e.target.value)}
            placeholder='{"message": "Type your payload here..."}'
            rows={14}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            style={{ marginTop: "8px" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginTop: "8px", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "12px", backgroundColor: "var(--bg-secondary)" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <button type="button" className="btn-primary" onClick={handleBulkSelect} disabled={bulkSending} style={{ padding: "4px 12px", fontSize: "12px", height: "auto" }}>
                Select files
              </button>
              <button type="button" className="btn-secondary" onClick={() => setBulkFiles([])} disabled={bulkSending || bulkFiles.length === 0} style={{ padding: "4px 12px", fontSize: "12px", height: "auto" }}>
                Clear
              </button>
            </div>
            
            <div style={{ overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "8px", display: "flex", flexDirection: "column", gap: "8px", backgroundColor: "var(--bg-primary)", height: "300px" }}>
              {bulkFiles.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", marginTop: "24px" }}>No files selected. Click "Select files" to add JSON payloads.</div>
              ) : (
                bulkFiles.map((file, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", backgroundColor: "var(--bg-secondary)", borderRadius: "4px" }}>
                    <div style={{ display: "flex", flexDirection: "column", maxWidth: "70%" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
                      {file.errorMsg && <span style={{ fontSize: "11px", color: "var(--danger-color)", marginTop: "2px" }}>{file.errorMsg}</span>}
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {file.status === 'pending' && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Pending</span>}
                      {file.status === 'sending' && (
                        <span style={{ fontSize: "12px", color: "var(--primary-color)", display: "flex", alignItems: "center", gap: "4px" }}>
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
                            <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
                          </svg>
                          Sending...
                        </span>
                      )}
                      {file.status === 'sent' && <span style={{ fontSize: "12px", color: "var(--success-color)", fontWeight: "bold" }}>Sent</span>}
                      {file.status === 'error' && (
                        <>
                          <span style={{ fontSize: "12px", color: "var(--danger-color)", fontWeight: "bold" }}>Error</span>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "11px", height: "auto" }}
                            onClick={async () => {
                              if (bulkSending) return;
                              // Retry just this file
                              setBulkSending(true);
                              const updated = [...bulkFiles];
                              updated[idx] = { ...file, status: 'sending', errorMsg: undefined };
                              setBulkFiles([...updated]);
                              
                              const finalCorrelationId = correlationId.trim() || null;
                              const finalMessageId = messageId.trim() || null;

                              try {
                                const content = await invoke<string>("read_message_file", { path: file.path });
                                await invoke("send_message", {
                                  tabId: tab.id,
                                  body: content,
                                  routingKey: routingKey.trim() || null,
                                  headers: headers.trim() || null,
                                  properties: {
                                    content_type: contentType.trim() || null,
                                    delivery_mode: deliveryMode,
                                    correlation_id: finalCorrelationId,
                                    message_id: finalMessageId,
                                  },
                                });
                                updated[idx] = { ...updated[idx], status: 'sent' };
                                
                                const updates: any = {};
                                if (autoCorrelationId) updates.correlationId = uuidv4();
                                if (autoMessageId) updates.messageId = uuidv4();
                                if (Object.keys(updates).length > 0) updateTab(tab.id, updates);
                              } catch (e) {
                                updated[idx] = { ...updated[idx], status: 'error', errorMsg: String(e) };
                              }
                              setBulkFiles([...updated]);
                              setBulkSending(false);
                            }}
                            disabled={bulkSending}
                          >
                            Retry
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      <div className="write-tab-footer" style={{ padding: "16px 40px", borderTop: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", marginTop: 0, flexShrink: 0 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
          {mode === 'single' && status && (
            <span className={`send-status ${status.ok ? "ok" : "err"}`}>
              {status.ok ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              {status.msg}
            </span>
          )}
          {mode === 'bulk' && bulkFiles.some(f => f.status === 'sent') && (
            <span style={{ fontSize: "13px", color: "var(--success-color)", fontWeight: 500 }}>
              {bulkFiles.filter(f => f.status === 'sent').length} / {bulkFiles.length} sent
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
          {mode === 'bulk' && bulkFiles.some(f => f.status === 'error') && (
            <button 
              type="button"
              className="btn-secondary" 
              onClick={handleBulkSend}
              disabled={bulkSending}
              style={{ color: "var(--danger-color)", borderColor: "var(--danger-color)" }}
            >
              Resend failed
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            disabled={sending || bulkSending}
            style={{ borderColor: "var(--border-color)" }}
          >
            Reset
          </button>

          <button
            className="btn-primary"
            onClick={mode === 'single' ? handleSend : handleBulkSend}
            disabled={mode === 'single' ? (sending || !body.trim() || !!headersError) : (bulkSending || bulkFiles.every(f => f.status === 'sent') || bulkFiles.length === 0)}
            style={{ width: "220px", display: "flex", justifyContent: "center", alignItems: "center", whiteSpace: "nowrap" }}
          >
            {mode === 'single' ? (
              sending ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
                  </svg>
                  Publishing…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Publish Message
                </>
              )
            ) : (
              bulkSending ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
                  </svg>
                  Publishing All…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Publish All Messages
                </>
              )
            )}
          </button>
        </div>
      </div>

      {showResetConfirm && (
        <div className="mode-picker-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="mode-picker" onClick={(e) => e.stopPropagation()}>
            <div className="mode-picker-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--danger-color)" }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <strong>Reset Writer?</strong>
            </div>

            <div style={{ fontSize: "14px", color: "var(--text-secondary)", margin: "16px 0", lineHeight: "1.5" }}>
              Are you sure you want to reset all fields? This will clear the message body, routing key, headers, and all publisher properties.
            </div>

            <div className="mode-picker-actions">
              <button className="btn-secondary" onClick={() => setShowResetConfirm(false)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ backgroundColor: "var(--danger-color)", borderColor: "var(--danger-color)" }}
                onClick={() => {
                  updateTab(tab.id, {
                    body: "",
                    routingKey: "",
                    contentType: "",
                    deliveryMode: 1,
                    correlationId: "",
                    autoCorrelationId: false,
                    messageId: "",
                    autoMessageId: false,
                    headers: "",
                  });
                  setStatus(null);
                  setBulkFiles([]);
                  setShowResetConfirm(false);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
