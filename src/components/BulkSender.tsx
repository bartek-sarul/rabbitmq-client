import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { v4 as uuidv4 } from "uuid";
import { Tab } from "../types";
import { useAppStore } from "../store/useAppStore";
import { createPortal } from "react-dom";

interface BulkFile {
  path: string;
  name: string;
  status: 'pending' | 'sending' | 'sent' | 'error';
  errorMsg?: string;
}

interface Props {
  tab: Tab;
  routingKey: string;
  headers: string;
  contentType: string;
  deliveryMode: number;
  correlationId: string;
  autoCorrelationId: boolean;
  messageId: string;
  autoMessageId: boolean;
  onReset: () => void;
  footerPortalTarget: HTMLDivElement | null;
  isActive: boolean;
}

export function BulkSender({
  tab,
  routingKey,
  headers,
  contentType,
  deliveryMode,
  correlationId,
  autoCorrelationId,
  messageId,
  autoMessageId,
  onReset,
  footerPortalTarget,
  isActive,
}: Props) {
  const [bulkFiles, setBulkFiles] = useState<BulkFile[]>([]);
  const [bulkSending, setBulkSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'sent' | 'error'>('all');
  const abortRef = useRef<boolean>(false);
  const updateTab = useAppStore((s) => s.updateTab);

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
        return { path: p, name, status: 'pending' };
      });
      setBulkFiles(newFiles);
    } catch (e) {
      console.error("Failed to select files:", e);
    }
  }

  async function handleBulkSend(retryOnly: boolean = false) {
    setBulkSending(true);
    let currentFiles = [...bulkFiles];
    
    if (!retryOnly) {
      currentFiles = currentFiles.map(f => ({ ...f, status: 'pending', errorMsg: undefined }));
      setBulkFiles([...currentFiles]);
    }

    let currentCorrId = correlationId;
    let currentMsgId = messageId;
    
    abortRef.current = false;
    // Process files sequentially
    for (let i = 0; i < currentFiles.length; i++) {
      if (abortRef.current) break;
      const f = currentFiles[i];
      if (f.status === 'sent') continue;

      currentFiles[i] = { ...f, status: 'sending', errorMsg: undefined };
      setBulkFiles([...currentFiles]);

      try {
        const content = await invoke<string>("read_message_file", { path: f.path });
        
        let finalCorrelationId = currentCorrId.trim() || null;
        let finalMessageId = currentMsgId.trim() || null;

        if (autoCorrelationId && !finalCorrelationId) {
          finalCorrelationId = uuidv4();
          currentCorrId = finalCorrelationId;
        }
        if (autoMessageId && !finalMessageId) {
          finalMessageId = uuidv4();
          currentMsgId = finalMessageId;
        }

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
    if (Object.keys(updates).length > 0) updateTab(tab.id, updates);

    setBulkSending(false);
  }

  return (
    <>
      <div style={{ flexGrow: 1, display: isActive ? "flex" : "none", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <label className="field-label" style={{ margin: 0 }}>Payload Files</label>
            <div style={{ display: "flex", gap: "4px", background: "var(--bg-secondary)", padding: "2px", borderRadius: "6px" }}>
              {(['all', 'pending', 'sent', 'error'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  style={{
                    background: statusFilter === s ? "var(--bg-primary)" : "transparent",
                    color: statusFilter === s ? "var(--text-primary)" : "var(--text-muted)",
                    border: "1px solid",
                    borderColor: statusFilter === s ? "var(--border-color)" : "transparent",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    textTransform: "capitalize"
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn-primary" onClick={handleBulkSelect} disabled={bulkSending} style={{ padding: "4px 12px", fontSize: "12px", height: "auto" }}>
              Select files
            </button>
            <button type="button" className="btn-secondary" onClick={() => setBulkFiles([])} disabled={bulkSending || bulkFiles.length === 0} style={{ padding: "4px 12px", fontSize: "12px", height: "auto" }}>
              Clear
            </button>
          </div>
        </div>
        
        <div style={{ position: "relative", flexGrow: 1, minHeight: "150px" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "8px", display: "flex", flexDirection: "column", gap: "8px", backgroundColor: "var(--bg-primary)" }}>
            {bulkFiles.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", marginTop: "24px" }}>No files selected. Click "Select files" to add JSON payloads.</div>
            ) : (
              bulkFiles.map((file, idx) => {
                if (statusFilter !== 'all' && file.status !== statusFilter && !(statusFilter === 'pending' && file.status === 'sending')) return null;
                return (
                <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", backgroundColor: "var(--bg-secondary)", borderRadius: "4px", flexShrink: 0 }}>
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
                            setBulkSending(true);
                            const updated = [...bulkFiles];
                            updated[idx] = { ...file, status: 'sending', errorMsg: undefined };
                            setBulkFiles([...updated]);
                            
                            try {
                              const content = await invoke<string>("read_message_file", { path: file.path });

                              let finalCorrelationId = correlationId.trim() || null;
                              let finalMessageId = messageId.trim() || null;

                              if (autoCorrelationId && !finalCorrelationId) {
                                finalCorrelationId = uuidv4();
                              }
                              if (autoMessageId && !finalMessageId) {
                                finalMessageId = uuidv4();
                              }
                              
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
                              
                              const updatesObj: any = {};
                              if (autoCorrelationId) updatesObj.correlationId = uuidv4();
                              if (autoMessageId) updatesObj.messageId = uuidv4();
                              if (Object.keys(updatesObj).length > 0) updateTab(tab.id, updatesObj);
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
                    <button
                      type="button"
                      onClick={() => setBulkFiles(prev => prev.filter((_, i) => i !== idx))}
                      disabled={bulkSending}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: bulkSending ? "not-allowed" : "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "4px" }}
                      title="Remove file"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                </div>
              )})
            )}
          </div>
        </div>
      </div>

      {isActive && footerPortalTarget && createPortal(
        <>
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            {bulkFiles.some(f => f.status === 'sent') && (
              <span style={{ fontSize: "13px", color: "var(--success-color)", fontWeight: 500 }}>
                {bulkFiles.filter(f => f.status === 'sent').length} / {bulkFiles.length} sent
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
            {bulkFiles.some(f => f.status === 'error') && (
              <button 
                type="button"
                className="btn-secondary" 
                onClick={() => handleBulkSend(true)}
                disabled={bulkSending}
                style={{ color: "var(--danger-color)", borderColor: "var(--danger-color)" }}
              >
                Resend failed
              </button>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBulkFiles([]);
                onReset();
              }}
              disabled={bulkSending}
              style={{ borderColor: "var(--border-color)" }}
            >
              Reset
            </button>

            <button
              className="btn-primary"
              onClick={() => {
                if (bulkSending) {
                  abortRef.current = true;
                } else {
                  handleBulkSend(false);
                }
              }}
              disabled={!bulkSending && bulkFiles.length === 0}
              style={{ width: "220px", display: "flex", justifyContent: "center", alignItems: "center", whiteSpace: "nowrap", backgroundColor: bulkSending ? "var(--danger-color)" : undefined, borderColor: bulkSending ? "var(--danger-color)" : undefined }}
            >
              {bulkSending ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite", marginRight: "6px" }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
                  </svg>
                  Stop Publishing
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}>
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Publish All Messages
                </>
              )}
            </button>
          </div>
        </>,
        footerPortalTarget
      )}
    </>
  );
}
