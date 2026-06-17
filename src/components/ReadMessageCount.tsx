import { useAppStore } from "../store/useAppStore";

interface Props {
  tabId: string;
}

export function ReadMessageCount({ tabId }: Props) {
  const count = useAppStore((s) => s.messages[tabId]?.length ?? 0);
  
  return (
    <span className="msg-count" style={{ marginLeft: "6px" }}>
      {count} received
    </span>
  );
}
