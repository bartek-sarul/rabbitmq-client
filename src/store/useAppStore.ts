import { create } from "zustand";
import { Tab, Message } from "../types";

/// Consumers can stream indefinitely; without a cap the array (and the memory
/// behind every payload in it) grows without bound. Older messages remain on
/// disk in the tab's message folder.
export const MAX_MESSAGES_PER_TAB = 2000;

/// Stable reference for "this tab has no messages", so selectors do not hand
/// React a freshly allocated array on every render.
export const EMPTY_MESSAGES: Message[] = [];

interface AppStore {
  tabs: Tab[];
  activeTabId: string | null;
  messages: Record<string, Message[]>;

  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  addMessage: (tabId: string, msg: Message) => void;
  setMessages: (tabId: string, msgs: Message[]) => void;
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
      messages: { ...s.messages, [tab.id]: EMPTY_MESSAGES },
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
    set((s) => {
      const next = [msg, ...(s.messages[tabId] ?? EMPTY_MESSAGES)];
      if (next.length > MAX_MESSAGES_PER_TAB) next.length = MAX_MESSAGES_PER_TAB;

      // Only stamp the background-activity marker for tabs the user is not
      // looking at. Touching `tabs` on every delivery would re-render every
      // component subscribed to the tab list for the active tab too.
      const tabs =
        tabId === s.activeTabId
          ? s.tabs
          : s.tabs.map((t) => (t.id === tabId ? { ...t, lastReceived: Date.now() } : t));

      return { messages: { ...s.messages, [tabId]: next }, tabs };
    }),

  setMessages: (tabId, msgs) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [tabId]: msgs.slice(0, MAX_MESSAGES_PER_TAB),
      },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, lastReceived: msgs.length > 0 ? Date.now() : t.lastReceived } : t)),
    })),

  clearMessages: (tabId) =>
    set((s) => ({ messages: { ...s.messages, [tabId]: EMPTY_MESSAGES } })),

  updateTab: (tabId, updates) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    })),
}));
