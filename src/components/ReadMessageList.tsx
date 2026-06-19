import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { MessageRow } from "./MessageRow";
import { MessageDetailPanel } from "./MessageDetailPanel";

interface Props {
  tabId: string;
  started: boolean;
}

export function ReadMessageList({ tabId, started }: Props) {
  const messages = useAppStore((s) => s.messages[tabId] ?? []);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('messagePanelWidth');
    if (saved) return parseInt(saved, 10);
    return Math.floor(window.innerWidth * 0.75); // 3/4 of window width
  });

  useEffect(() => {
    localStorage.setItem('messagePanelWidth', panelWidth.toString());
  }, [panelWidth]);

  const dragRef = useRef<boolean>(false);

  const selectedMessage = messages.find(m => m.id === selectedMsgId) || null;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
      <div className="message-list" style={{ flex: 1, overflowY: "auto" }}>
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
          messages.map((msg) => (
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
  );
}
