import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/useAppStore";
import { sanitizeQuotes } from "../utils/sanitize";

interface Props {
  tab: Tab;
}

export function WriteTab({ tab }: Props) {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const updateTab = useAppStore((s) => s.updateTab);

  // Read fields from the store or default them
  const body = tab.body ?? "";
  const routingKey = tab.routingKey ?? "";
  const contentType = tab.contentType ?? "application/json";
  const deliveryMode = tab.deliveryMode ?? 1;
  const correlationId = tab.correlationId ?? "";
  const messageId = tab.messageId ?? "";
  const headers = tab.headers ?? "";

  // Initialize fields on first render if tab.body is undefined
  useEffect(() => {
    if (tab.body === undefined) {
      updateTab(tab.id, {
        messageId: "", // starts empty
        contentType: "application/json",
        deliveryMode: 1,
        body: "",
        routingKey: "",
        correlationId: "",
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
      await invoke("send_message", {
        tabId: tab.id,
        body,
        routingKey: routingKey.trim() || null,
        headers: headers.trim() || null,
        properties: {
          content_type: contentType.trim() || null,
          delivery_mode: deliveryMode,
          correlation_id: correlationId.trim() || null,
          message_id: messageId.trim() || null,
        },
      });
      setStatus({ ok: true, msg: "Message sent." });
      updateTab(tab.id, {
        body: "", // clear payload only
      });
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
    <div className="write-tab">
      <div className="write-tab-info" style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid var(--border-color)", paddingBottom: "18px" }}>
        <span className="badge write">Publish</span>
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
            value={routingKey}
            onChange={(e) => handleTextChange("routingKey", e.target.value)}
            placeholder="Enter routing key (defaults to empty)"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            style={{ paddingRight: "30px", width: "100%", maxWidth: "450px" }}
          />
          {routingKey && (
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
          <div style={{ display: "flex", gap: "6px", width: "100%" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", flexGrow: 1 }}>
              <input
                type="text"
                value={correlationId}
                onChange={(e) => handleTextChange("correlationId", e.target.value)}
                placeholder="e.g. corr-123"
                style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%" }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
              {correlationId && (
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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleTextChange("correlationId", uuidv4())}
              style={{ padding: "8px 12px", fontSize: "12px", whiteSpace: "nowrap", height: "36px", boxSizing: "border-box" }}
            >
              Generate
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="field-label" style={{ fontSize: "11px" }}>Message ID</label>
          <div style={{ display: "flex", gap: "6px", width: "100%" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", flexGrow: 1 }}>
              <input
                type="text"
                value={messageId}
                onChange={(e) => handleTextChange("messageId", e.target.value)}
                placeholder="e.g. msg-123"
                style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "100%" }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
              {messageId && (
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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleTextChange("messageId", uuidv4())}
              style={{ padding: "8px 12px", fontSize: "12px", whiteSpace: "nowrap", height: "36px", boxSizing: "border-box" }}
            >
              Generate
            </button>
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
        <label className="field-label">Message body</label>
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
        />
      </div>

      <div className="write-tab-footer">
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
        <button
          type="button"
          className="btn-secondary"
          onClick={handleReset}
          disabled={sending}
          style={{ marginRight: "12px", borderColor: "var(--border-color)" }}
        >
          Reset
        </button>
        <button
          className="btn-primary"
          onClick={handleSend}
          disabled={sending || !body.trim() || !!headersError}
          style={{ minWidth: "140px" }}
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
                    messageId: "",
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
    </div>
  );
}
