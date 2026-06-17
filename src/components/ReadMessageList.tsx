import { useAppStore } from "../store/useAppStore";
import { MessageRow } from "./MessageRow";

interface Props {
  tabId: string;
  started: boolean;
}

export function ReadMessageList({ tabId, started }: Props) {
  const messages = useAppStore((s) => s.messages[tabId] ?? []);

  return (
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
  );
}
