import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { MessageRow } from "./MessageRow";
import { MessageDetailPanel } from "./MessageDetailPanel";

interface Props {
  tabId: string;
  started: boolean;
  loading?: boolean;
}

export function ReadMessageList({ tabId, started, loading }: Props) {
  const messages = useAppStore((s) => s.messages[tabId] ?? []);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('messagePanelWidth');
    if (saved) return parseInt(saved, 10);
    return Math.floor(window.innerWidth * 0.5); // 1/2 of window width
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<"everywhere" | "headers" | "properties" | "body">("everywhere");

  useEffect(() => {
    localStorage.setItem('messagePanelWidth', panelWidth.toString());
  }, [panelWidth]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedMsgId !== null) {
        setSelectedMsgId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedMsgId]);

  const dragRef = useRef<boolean>(false);

  const selectedMessage = messages.find(m => m.id === selectedMsgId) || null;

  const filteredMessages = messages.filter((msg) => {
    if (!searchQuery.trim()) return true;
    try {
      const regex = new RegExp(searchQuery, "i");
      if (searchTarget === "everywhere") {
         return regex.test(msg.body || "") || regex.test(msg.headersStr || "") || regex.test(JSON.stringify(msg.properties));
      } else if (searchTarget === "body") {
         return regex.test(msg.body || "");
      } else if (searchTarget === "headers") {
         return regex.test(msg.headersStr || "");
      } else if (searchTarget === "properties") {
         return regex.test(JSON.stringify(msg.properties));
      }
    } catch (e) {
      return false;
    }
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", position: "relative" }}>
      {/* Filter Bar */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", display: "flex", gap: "12px", alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <svg style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input
            type="text"
            placeholder="Regex search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", padding: "8px 32px", fontSize: "13px", height: "36px", boxSizing: "border-box" }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
              title="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          )}
        </div>
        <select
          value={searchTarget}
          onChange={(e) => setSearchTarget(e.target.value as any)}
          style={{ padding: "8px 30px 8px 12px", fontSize: "13px", height: "36px", boxSizing: "border-box", width: "140px" }}
        >
          <option value="everywhere">Everywhere</option>
          <option value="body">Body</option>
          <option value="headers">Headers</option>
          <option value="properties">Properties</option>
        </select>
        <div style={{ fontSize: "12px", color: "var(--text-muted)", width: "60px", textAlign: "right" }}>
          {filteredMessages.length} / {messages.length}
        </div>
      </div>
      
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        <div className="message-list" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        {loading ? (
          <div className="empty-state" style={{ height: "100%", justifyContent: "center" }}>
            <div className="loading-spinner" style={{
              width: "40px",
              height: "40px",
              border: "3px solid var(--border-color)",
              borderTopColor: "var(--accent-color)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite"
            }}></div>
            <p style={{ fontSize: "14px", marginTop: "16px" }}>Loading messages from disk...</p>
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="empty-state" style={{ height: "100%", justifyContent: "center" }}>
            <svg className="empty-state-icon" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              {messages.length > 0 && searchQuery
                ? "No messages match your search filter."
                : started
                  ? "Listening for streaming messages from queue..."
                  : "Press Connect to begin consuming messages."}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <MessageRow 
              key={msg.id} 
              message={msg} 
              isSelected={msg.id === selectedMsgId}
              onClick={() => setSelectedMsgId(msg.id === selectedMsgId ? null : msg.id)}
            />
          ))
        )}
      </div>
      {selectedMessage && (
        <div style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${panelWidth}px`,
          maxWidth: "90%",
          display: "flex",
          zIndex: 10,
          boxShadow: "-4px 0 12px rgba(0,0,0,0.15)",
          backgroundColor: "var(--bg-primary)"
        }}>
          {/* Drag Handle */}
          <div
            style={{
              width: "8px",
              cursor: "col-resize",
              backgroundColor: "transparent",
              position: "absolute",
              left: "-4px",
              top: 0,
              bottom: 0,
              zIndex: 11
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              dragRef.current = true;
              document.body.style.cursor = "col-resize";
              
              const handleMouseMove = (me: MouseEvent) => {
                if (!dragRef.current) return;
                setPanelWidth(prev => Math.max(300, prev - me.movementX));
              };
              
              const handleMouseUp = () => {
                dragRef.current = false;
                document.body.style.cursor = "";
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
              };
              
              window.addEventListener("mousemove", handleMouseMove);
              window.addEventListener("mouseup", handleMouseUp);
            }}
          />
          <div style={{ flex: 1, overflow: "hidden" }}>
             <MessageDetailPanel message={selectedMessage} onClose={() => setSelectedMsgId(null)} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
