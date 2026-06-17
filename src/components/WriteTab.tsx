import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/useAppStore";
import { AutocompleteInput } from "./AutocompleteInput";
import { sanitizeQuotes } from "../utils/sanitize";
import { BulkSender } from "./BulkSender";
import { HeadersEditorModal } from "./HeadersEditorModal";

interface Props {
  tab: Tab;
}

export function WriteTab({ tab }: Props) {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHeadersEditor, setShowHeadersEditor] = useState(false);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [footerPortalTarget, setFooterPortalTarget] = useState<HTMLDivElement | null>(null);

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
          <AutocompleteInput
            value={tab.targetType === "queue" ? "" : routingKey}
            onChange={(val) => handleTextChange("routingKey", val)}
            options={tab.predefinedRoutingKeys || []}
            placeholder={tab.targetType === "queue" ? "Not applicable for queues" : "Enter routing key (defaults to empty)"}
            disabled={tab.targetType === "queue"}
            title={tab.targetType === "queue" ? "Routing keys are not used when publishing directly to a queue" : ""}
          />
        </div>
      </div>

      {/* Headers & Properties Panel */}
      <div className="write-options-panel">
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Content Type</label>
          <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
            <AutocompleteInput
              value={contentType}
              onChange={(val) => handleTextChange("contentType", val)}
              options={[
                "application/json",
                "text/plain",
                "application/xml",
                "text/html",
                "application/x-www-form-urlencoded"
              ]}
              placeholder="e.g. application/json"
            />
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className="field-label" style={{ fontSize: "11px", margin: 0 }}>
              Headers <span className="optional">(JSON object)</span>
              {headersError && <span style={{ color: "var(--danger-color)", marginLeft: "12px", fontSize: "11px" }}>{headersError}</span>}
            </label>
            <button
              type="button"
              onClick={() => setShowHeadersEditor(true)}
              style={{
                background: "var(--bg-active)",
                border: "1px solid var(--border-color)",
                color: "var(--text-primary)",
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit Headers
            </button>
          </div>
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

              <div style={{ flexGrow: 1, display: mode === 'single' ? "flex" : "none", flexDirection: "column" }}>
            <label className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Message payload (JSON)</span>
              {headersError && <span style={{ color: "var(--danger-color)", fontSize: "12px", fontWeight: "normal" }}>Cannot send: {headersError}</span>}
            </label>
            <div style={{ position: "relative", flexGrow: 1, display: "flex", flexDirection: "column" }}>
              <textarea
                className="payload-editor"
                value={body}
                onChange={(e) => handleTextChange("body", e.target.value)}
                placeholder={`{
  "key": "value"
}`}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                style={{
                  flexGrow: 1,
                  resize: "none",
                  height: "100%",
                  minHeight: "150px"
                }}
              />
              {body && (
                <button
                  type="button"
                  onClick={() => handleTextChange("body", "")}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "12px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                  }}
                  title="Clear payload"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          
          <BulkSender 
            tab={tab}
            routingKey={routingKey}
            headers={headers}
            contentType={contentType}
            deliveryMode={deliveryMode}
            correlationId={correlationId}
            autoCorrelationId={autoCorrelationId}
            messageId={messageId}
            autoMessageId={autoMessageId}
            onReset={handleReset}
            footerPortalTarget={footerPortalTarget}
            isActive={mode === 'bulk'}
          />
        </div>
      </div>

      <div 
        className="write-tab-footer" 
        ref={setFooterPortalTarget} 
        style={{ padding: "16px 40px", borderTop: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", marginTop: 0, flexShrink: 0, display: mode === 'single' ? "flex" : (footerPortalTarget ? "flex" : "none") }}
      >
        {mode === 'single' && (
          <>
            <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
              {status && (
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
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleReset}
                disabled={sending}
                style={{ borderColor: "var(--border-color)" }}
              >
                Reset
              </button>

              <button
                className="btn-primary"
                onClick={handleSend}
                disabled={sending || !body.trim() || !!headersError}
                style={{ width: "220px", display: "flex", justifyContent: "center", alignItems: "center", whiteSpace: "nowrap" }}
              >
                {sending ? (
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
                )}
              </button>
            </div>
          </>
        )}
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
                  setShowResetConfirm(false);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showHeadersEditor && (
        <HeadersEditorModal
          initialHeadersJson={headers}
          onSave={(newJson) => {
            handleTextChange("headers", newJson);
            setShowHeadersEditor(false);
          }}
          onClose={() => setShowHeadersEditor(false)}
        />
      )}
    </div>
  );
}
