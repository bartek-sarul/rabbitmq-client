import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Message } from "../types";

interface Props {
  message: Message;
}

interface FullMessage {
  id: string;
  timestamp: string;
  headers: string;
  properties: {
    content_type: string | null;
    delivery_mode: number | null;
    correlation_id: string | null;
    message_id: string | null;
  };
  body: string;
}

export function MessageRow({ message }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [fullMessage, setFullMessage] = useState<FullMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    
    if (nextExpanded && !fullMessage && !loading) {
      setLoading(true);
      setError(null);
      try {
        const dataStr = await invoke<string>("read_message_file", { path: message.filePath });
        const data = JSON.parse(dataStr) as FullMessage;
        setFullMessage(data);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    } else if (!nextExpanded) {
      // Clear fullMessage from memory when collapsed to prevent bloat
      setFullMessage(null);
    }
  }

  const fullJson = fullMessage ? JSON.stringify(fullMessage, null, 2) : "";



  function doCopy(text: string, section: string) {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedSection(section);
        setTimeout(() => setCopiedSection(null), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className={`message-row ${expanded ? "expanded" : ""}`}>
      {/* Collapsed single-line view */}
      <div className="message-row-summary" onClick={handleToggle}>
        <span className="col col-ts">
          {message.timestamp.replace("T", " ").slice(0, 19)}
        </span>
        <span className="col col-id">
          {message.id.slice(0, 8)}
        </span>
        <span className="col col-body">
          {message.bodyPreview}
        </span>
        <span className="col col-arrow" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", display: "inline-flex", alignItems: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {/* Expanded detail view */}
      {expanded && (
        <div className="message-detail">
          {loading && (
            <div className="message-loading" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", padding: "12px 0" }}>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
              </svg>
              Loading full message from disk…
            </div>
          )}

          {error && (
            <div className="message-error" style={{ color: "var(--danger-color)", padding: "12px 0" }}>
              Error loading message file: {error}
            </div>
          )}

          {!loading && !error && fullMessage && (
            <>
              <div className="detail-section">
                <div className="detail-header">
                  <span>Headers</span>
                  <button
                    className={copiedSection === "headers" ? "copied" : ""}
                    onClick={() => doCopy(fullMessage.headers || "", "headers")}
                  >
                    {copiedSection === "headers" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <pre className="detail-pre">{fullMessage.headers || "(none)"}</pre>
              </div>

              <div className="detail-section">
                <div className="detail-header">
                  <span>Properties</span>
                  <button
                    className={copiedSection === "properties" ? "copied" : ""}
                    onClick={() => doCopy(JSON.stringify(fullMessage.properties, null, 2), "properties")}
                  >
                    {copiedSection === "properties" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <pre className="detail-pre">{JSON.stringify(fullMessage.properties, null, 2)}</pre>
              </div>

              <div className="detail-section">
                <div className="detail-header">
                  <span>Body</span>
                  <button
                    className={copiedSection === "body" ? "copied" : ""}
                    onClick={() => doCopy(fullMessage.body, "body")}
                  >
                    {copiedSection === "body" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <pre className="detail-pre">{fullMessage.body}</pre>
              </div>

              <div className="detail-actions">
                <button
                  className={copiedSection === "full" ? "copied" : ""}
                  onClick={() => doCopy(fullJson, "full")}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  {copiedSection === "full" ? (
                    <>Copied ✓</>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy Full JSON
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
