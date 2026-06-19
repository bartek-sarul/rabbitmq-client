import { Message } from "../types";

interface Props {
  message: Message;
  isSelected: boolean;
  onClick: () => void;
}

export function MessageRow({ message, isSelected, onClick }: Props) {
  return (
    <div className={`message-row ${isSelected ? "expanded" : ""}`} onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="message-row-summary">
        <span className="col col-ts">
          {String(message.timestamp).replace("T", " ").slice(0, 19)}
        </span>
        <span className="col col-id">
          {message.id.slice(0, 8)}
        </span>
        <span className="col col-body">
          {message.body && message.body.length > 120 ? message.body.substring(0, 120) + "..." : message.body}
        </span>
      </div>
    </div>
  );
}
