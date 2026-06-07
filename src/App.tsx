import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { WriteTab } from "./components/WriteTab";
import { ReadTab } from "./components/ReadTab";
import { useAppStore } from "./store/useAppStore";
import { MessageListenerManager } from "./components/MessageListenerManager";

function App() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app-layout">
      <MessageListenerManager />
      <Sidebar />
      <div className="main-area">
        <TabBar />
        <div className="tab-content">
          {!activeTab ? (
            <div className="empty-state">
              <p>Select a queue or exchange from the sidebar to open a tab.</p>
            </div>
          ) : activeTab.mode === "write" ? (
            <WriteTab key={activeTab.id} tab={activeTab} />
          ) : (
            <ReadTab key={activeTab.id} tab={activeTab} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
