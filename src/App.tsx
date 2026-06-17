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

  return (
    <div className="app-layout">
      <MessageListenerManager />
      <Sidebar />
      <div className="main-area">
        <TabBar />
        <div className="tab-content">
          {tabs.length === 0 ? (
            <div className="empty-state">
              <p>Select a queue or exchange from the sidebar to open a tab.</p>
            </div>
          ) : (
            tabs.map((tab) => (
              <div 
                key={tab.id}
                style={{ 
                  display: tab.id === activeTabId ? "flex" : "none",
                  flexDirection: "column",
                  flexGrow: 1,
                  overflow: "hidden"
                }}
              >
                {tab.mode === "write" ? (
                  <WriteTab tab={tab} />
                ) : (
                  <ReadTab tab={tab} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
