import { useAppStore } from "../store/useAppStore";
import { invoke } from "@tauri-apps/api/core";
import { Tab } from "../types";

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const removeTab = useAppStore((s) => s.removeTab);

  async function closeTab(tabId: string) {
    try {
      await invoke("close_tab", { tabId });
    } catch (_) {
      // best-effort: remove tab even if backend close fails
    }
    removeTab(tabId);
  }

  const hasDuplicateReader = (tab: Tab) => {
    if (tab.mode !== "read") return false;
    return tabs.some(
      (t) =>
        t.id !== tab.id &&
        t.mode === "read" &&
        t.connUrl === tab.connUrl &&
        t.targetName === tab.targetName
    );
  };

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 14px 0 12px" }}
        >
          {tab.lastReceived && (
            <div key={tab.lastReceived} className="tab-flash-indicator" />
          )}
          {hasDuplicateReader(tab) && (
            <span title="Warning: Multiple reader tabs are listening to this queue simultaneously!" style={{ cursor: "help", fontSize: "12px", display: "inline-flex", alignItems: "center" }}>
              ⚠️
            </span>
          )}
          {/* Mode tag */}
          <span
            className={`badge ${tab.mode === "read" ? "read" : "write"}`}
            style={{ fontSize: "8px", fontWeight: "800", padding: "2px 4px", borderRadius: "3px" }}
          >
            {tab.mode === "read" ? "READ" : "WRITE"}
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ fontSize: "12px", fontWeight: tab.id === activeTabId ? "600" : "500", color: "var(--text-primary)", lineHeight: "1.2" }}>
              {tab.targetName}
            </span>
            <span style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: "1" }}>
              {tab.connName}
            </span>
          </div>

          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            title="Close tab"
            style={{ marginLeft: "4px" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
