import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";
import { useAppStore } from "../store/useAppStore";
import { ReadMessageList } from "./ReadMessageList";
import { useEffect, useRef } from "react";
interface Props {
  tab: Tab;
}

interface ConsumerSessionInfo {
  folder_path: string;
  folder_name: string;
}

export function ReadTab({ tab }: Props) {
  const [error, setError] = useState<string | null>(null);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const updateTab = useAppStore((s) => s.updateTab);
  const setMessages = useAppStore((s) => s.setMessages);

  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);

  const started = tab.consuming ?? false;
  const ackMode = tab.ackMode;

  const hasLoadedInitial = useRef(false);

  useEffect(() => {
    async function initFolder() {
      if (tab.folderPath && !hasLoadedInitial.current) {
        hasLoadedInitial.current = true;
        setLoadingMessages(true);
        try {
          const msgs = await invoke<any[]>("load_folder_messages", { folderPath: tab.folderPath });
          console.log("LOADED MSGS:", msgs);
          if (msgs.length > 0) {
            setMessages(tab.id, msgs);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingMessages(false);
        }
      }
    }
    
    if (tab.folderPath && !hasLoadedInitial.current) {
      const currentMsgs = useAppStore.getState().messages[tab.id];
      if (!currentMsgs || currentMsgs.length === 0) {
        initFolder();
      } else {
        hasLoadedInitial.current = true;
      }
    }
  }, [tab.id, tab.folderPath, setMessages]);

  async function handleReloadFolder() {
    if (tab.folderPath) {
      setLoadingMessages(true);
      try {
        const msgs = await invoke<any[]>("load_folder_messages", { folderPath: tab.folderPath });
        console.log("RELOADED MSGS:", msgs);
        setMessages(tab.id, msgs);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingMessages(false);
      }
    }
  }

  async function startConsuming() {
    setError(null);
    try {
      const res = await invoke<ConsumerSessionInfo>("start_consumer", { 
        tabId: tab.id, 
        ackMode,
        folderPath: tab.folderPath || ""
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
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
              Connection: <strong>{tab.connName}</strong>
              {tab.folderPath && (
                <>
                  <span style={{ color: "var(--border-color)" }}>|</span>
                  <span>Folder:</span>
                  <button
                    className="btn-secondary"
                    onClick={() => navigator.clipboard.writeText(tab.folderPath || "")}
                    title="Copy path location"
                    style={{ padding: "2px 6px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleReloadFolder}
                    title="Reload from disk"
                    disabled={loadingMessages || started}
                    style={{ padding: "2px 6px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                  </button>
                  <button
                    className="btn-secondary btn-open-folder"
                    onClick={handleOpenFolder}
                    title="See on disk"
                    style={{ padding: "2px 6px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  </button>
                </>
              )}
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

               <button className="btn-primary" onClick={startConsuming} disabled={!tab.folderPath || loadingMessages} style={{ padding: "8px 16px" }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
          </div>
        </div>
      </div>

      {error && <div className="read-error">{error}</div>}

      <ReadMessageList tabId={tab.id} started={started} loading={loadingMessages} />
    </div>
  );
}
