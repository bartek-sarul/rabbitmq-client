import { useEffect, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../store/useAppStore";
import { Message, TabStatus } from "../types";

export function MessageListenerManager() {
  const tabs = useAppStore((s) => s.tabs);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateTab = useAppStore((s) => s.updateTab);
  const activeListeners = useRef<Map<string, UnlistenFn[]>>(new Map());

  useEffect(() => {
    const activeTabIds = new Set<string>();

    // For each consuming read tab, ensure we have a listener
    for (const tab of tabs) {
      if (tab.mode === "read" && tab.consuming) {
        activeTabIds.add(tab.id);

        if (!activeListeners.current.has(tab.id)) {
          const tabId = tab.id;
          const msgEventName = `msg-${tabId}`;
          const statusEventName = `status-${tabId}`;
          
          // Set an empty array as a placeholder to prevent duplicate registrations
          activeListeners.current.set(tabId, []);

          Promise.all([
            listen<Message>(msgEventName, (event) => {
              addMessage(tabId, event.payload);
            }),
            listen<TabStatus>(statusEventName, (event) => {
              updateTab(tabId, { status: event.payload });
            })
          ]).then(([unlistenMsg, unlistenStatus]) => {
            // Check if this tab is still consuming
            if (activeTabIds.has(tabId)) {
              activeListeners.current.set(tabId, [unlistenMsg, unlistenStatus]);
            } else {
              unlistenMsg();
              unlistenStatus();
            }
          });
        }
      }
    }

    // Remove listeners for tabs that are no longer consuming or have been closed
    for (const [tabId, cleanups] of activeListeners.current.entries()) {
      if (!activeTabIds.has(tabId)) {
        for (const unlisten of cleanups) {
          unlisten();
        }
        activeListeners.current.delete(tabId);
      }
    }
  }, [tabs, addMessage, updateTab]);

  useEffect(() => {
    return () => {
      // Clean up all listeners on unmount
      for (const cleanups of activeListeners.current.values()) {
        for (const unlisten of cleanups) {
          unlisten();
        }
      }
      activeListeners.current.clear();
    };
  }, []);

  return null;
}
