import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";
import { useAppStore } from "../store/useAppStore";
import { MessageRow } from "./MessageRow";

interface Props {
  tab: Tab;
}

interface ConsumerSessionInfo {
  folder_path: string;
  folder_name: string;
}

export function ReadTab({ tab }: Props) {
  const [error, setError] = useState<string | null>(null);
  const messages = useAppStore((s) => s.messages[tab.id] ?? []);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const updateTab = useAppStore((s) => s.updateTab);

  const started = tab.consuming ?? false;
  const ackMode = tab.ackMode;

  async function startConsuming() {
    setError(null);
    try {
      updateTab(tab.id, { consuming: true, status: "connecting" });
      const res = await invoke<ConsumerSessionInfo>("start_consumer", { 
        tabId: tab.id, 
        ackMode, 
      });
      updateTab(tab.id, {
        consuming: true,
        status: "connecting",
        folderPath: res.folder_path,
        folderName: res.folder_name,
      });
    } catch (e) {
      setError(String(e));
      updateTab(tab.id, { consuming: false, status: "disconnected" });
    }
  }

  async function stopConsuming() {
    setError(null);
    try {
      await invoke("stop_consumer", { tabId: tab.id });
      updateTab(tab.id, { consuming: false, status: "disconnected" });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpenFolder() {
    if (tab.folderPath) {
      try {
        await invoke("open_folder", { path: tab.folderPath });
      } catch (e) {
        setError("Failed to open folder: " + String(e));
      }
    }
  }

  return (
    <div className="read-tab">
      <div className="read-tab-header">
        <div className="header-info-group">
          <span className="badge read">Consumer</span>
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

        <div className="header-actions-group">
          {!started && (
            <>
              <div className="ack-toggle">
                <label>
                  <input
                     type="radio"
                     name={`ack-${tab.id}`}
                     value="nack"
                     checked={ackMode === "nack"}
                     onChange={() => updateTab(tab.id, { ackMode: "nack" })}
                   />
                   Peek (NACK)
                 </label>
                 <label>
                   <input
                     type="radio"
                     name={`ack-${tab.id}`}
                     value="ack"
                     checked={ackMode === "ack"}
                     onChange={() => updateTab(tab.id, { ackMode: "ack" })}
                   />
                   Consume (ACK)
                 </label>
               </div>

               <button className="btn-primary" onClick={startConsuming} style={{ padding: "8px 16px" }}>
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                   <polygon points="5 3 19 12 5 21" />
                 </svg>
                 Connect
               </button>
             </>
           )}

           {started && (
             <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
               {tab.status === "connecting" ? (
                 <span className="consuming-badge connecting">Connecting...</span>
               ) : (
                 <span className="consuming-badge">Consuming</span>
               )}
               {tab.folderName && (
                 <button
                   className="btn-secondary btn-open-folder"
                   onClick={handleOpenFolder}
                   style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px" }}
                 >
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                     <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                   </svg>
                   Open folder
                 </button>
               )}
               <button
                 className="btn-secondary"
                 onClick={stopConsuming}
                 style={{ padding: "8px 16px", borderColor: "var(--danger-color)", color: "var(--danger-color)" }}
               >
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                   <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                 </svg>
                 Disconnect
               </button>
             </div>
           )}

          <button
            className="btn-secondary"
            onClick={() => clearMessages(tab.id)}
            title="Clear message list"
            style={{ padding: "8px 12px" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Clear
          </button>

          <span className="msg-count" style={{ marginLeft: "6px" }}>
            {messages.length} received
          </span>
        </div>
      </div>

      {error && <div className="read-error">{error}</div>}

      <div className="message-list">
        {messages.length === 0 ? (
          <div className="empty-state" style={{ height: "100%", justifyContent: "center" }}>
            <svg className="empty-state-icon" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              {started
                ? "Listening for streaming messages from queue..."
                : "Press Connect to begin consuming messages."}
            </p>
          </div>
        ) : (
          messages.map((msg) => <MessageRow key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  );
}
