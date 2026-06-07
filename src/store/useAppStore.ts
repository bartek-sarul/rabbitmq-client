import { create } from "zustand";
import { Tab, Message } from "../types";

interface AppStore {
  tabs: Tab[];
  activeTabId: string | null;
  messages: Record<string, Message[]>;

  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  addMessage: (tabId: string, msg: Message) => void;
  clearMessages: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  tabs: [],
  activeTabId: null,
  messages: {},

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      messages: { ...s.messages, [tab.id]: [] },
    })),

  removeTab: (tabId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      const newMessages = { ...s.messages };
      delete newMessages[tabId];
      const newActive =
        s.activeTabId === tabId
          ? (remaining[remaining.length - 1]?.id ?? null)
          : s.activeTabId;
      return { tabs: remaining, activeTabId: newActive, messages: newMessages };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  addMessage: (tabId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [tabId]: [msg, ...(s.messages[tabId] ?? [])],
      },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, lastReceived: Date.now() } : t)),
    })),

  clearMessages: (tabId) =>
    set((s) => ({ messages: { ...s.messages, [tabId]: [] } })),

  updateTab: (tabId, updates) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    })),
}));
