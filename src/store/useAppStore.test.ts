import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "./useAppStore";
import { Tab, Message } from "../types";

describe("useAppStore", () => {
  beforeEach(() => {
    // Reset state before each test
    useAppStore.setState({
      tabs: [],
      activeTabId: null,
      messages: {},
    });
  });

  it("should have correct initial state", () => {
    const state = useAppStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.messages).toEqual({});
  });

  it("should add a tab and set it as active", () => {
    const tab: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "my-queue",
      targetType: "queue",
      mode: "write",
      ackMode: "ack",
      label: "my-queue (local)",
    };

    useAppStore.getState().addTab(tab);

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toEqual(tab);
    expect(state.activeTabId).toBe("tab-1");
    expect(state.messages["tab-1"]).toEqual([]);
  });

  it("should update an existing tab", () => {
    const tab: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "my-queue",
      targetType: "queue",
      mode: "write",
      ackMode: "ack",
      label: "my-queue (local)",
      body: "original body",
    };

    useAppStore.getState().addTab(tab);
    useAppStore.getState().updateTab("tab-1", { body: "updated body", routingKey: "new-key" });

    const state = useAppStore.getState();
    expect(state.tabs[0].body).toBe("updated body");
    expect(state.tabs[0].routingKey).toBe("new-key");
  });

  it("should set active tab id", () => {
    const tab1: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "q1",
      targetType: "queue",
      mode: "write",
      ackMode: "ack",
      label: "q1",
    };
    const tab2: Tab = {
      id: "tab-2",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "q2",
      targetType: "queue",
      mode: "write",
      ackMode: "ack",
      label: "q2",
    };

    useAppStore.getState().addTab(tab1);
    useAppStore.getState().addTab(tab2);

    expect(useAppStore.getState().activeTabId).toBe("tab-2");

    useAppStore.getState().setActiveTab("tab-1");
    expect(useAppStore.getState().activeTabId).toBe("tab-1");
  });

  it("should remove tab and clean up messages", () => {
    const tab: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "q1",
      targetType: "queue",
      mode: "write",
      ackMode: "ack",
      label: "q1",
    };

    useAppStore.getState().addTab(tab);
    useAppStore.getState().addMessage("tab-1", {
      id: "msg-1",
      timestamp: "2026-06-06T12:00:00Z",
      filePath: "/tmp/msg-1.json",
      bodyPreview: "test",
      properties: {
        content_type: null,
        delivery_mode: null,
        correlation_id: null,
        message_id: null,
      },
    });

    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().messages["tab-1"]).toHaveLength(1);

    useAppStore.getState().removeTab("tab-1");

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.messages["tab-1"]).toBeUndefined();
    expect(state.activeTabId).toBeNull();
  });

  it("should adjust active tab selection when active tab is removed", () => {
    const tab1: Tab = { id: "tab-1", connName: "local", connUrl: "", targetName: "q1", targetType: "queue", mode: "write", ackMode: "ack", label: "q1" };
    const tab2: Tab = { id: "tab-2", connName: "local", connUrl: "", targetName: "q2", targetType: "queue", mode: "write", ackMode: "ack", label: "q2" };
    const tab3: Tab = { id: "tab-3", connName: "local", connUrl: "", targetName: "q3", targetType: "queue", mode: "write", ackMode: "ack", label: "q3" };

    useAppStore.getState().addTab(tab1);
    useAppStore.getState().addTab(tab2);
    useAppStore.getState().addTab(tab3);

    // Active tab is tab-3 (last added)
    expect(useAppStore.getState().activeTabId).toBe("tab-3");

    // Remove active tab-3 -> active tab shifts to tab-2 (previous tab in list)
    useAppStore.getState().removeTab("tab-3");
    expect(useAppStore.getState().activeTabId).toBe("tab-2");

    // Set active to tab-1, and remove tab-2 (which is not active) -> active remains tab-1
    useAppStore.getState().setActiveTab("tab-1");
    useAppStore.getState().removeTab("tab-2");
    expect(useAppStore.getState().activeTabId).toBe("tab-1");
  });

  it("should add messages to the beginning of the list and update lastReceived on the tab", () => {
    const tab: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "my-queue",
      targetType: "queue",
      mode: "read",
      ackMode: "ack",
      label: "my-queue",
    };

    useAppStore.getState().addTab(tab);

    const msg1: Message = {
      id: "msg-1",
      timestamp: "2026-06-06T12:00:00Z",
      filePath: "/tmp/msg-1.json",
      bodyPreview: "first",
      properties: {
        content_type: null,
        delivery_mode: null,
        correlation_id: null,
        message_id: null,
      },
    };
    const msg2: Message = {
      id: "msg-2",
      timestamp: "2026-06-06T12:01:00Z",
      filePath: "/tmp/msg-2.json",
      bodyPreview: "second",
      properties: {
        content_type: null,
        delivery_mode: null,
        correlation_id: null,
        message_id: null,
      },
    };

    // Mock Date.now to verify lastReceived update
    const mockTime = 1780826400000; // arbitrary timestamp
    vi.spyOn(Date, "now").mockReturnValue(mockTime);

    useAppStore.getState().addMessage("tab-1", msg1);
    useAppStore.getState().addMessage("tab-1", msg2);

    const state = useAppStore.getState();
    expect(state.messages["tab-1"]).toHaveLength(2);
    // msg2 should be first (index 0) due to unshifting
    expect(state.messages["tab-1"][0]).toEqual(msg2);
    expect(state.messages["tab-1"][1]).toEqual(msg1);

    // Tab lastReceived should have updated
    expect(state.tabs[0].lastReceived).toBe(mockTime);

    vi.restoreAllMocks();
  });

  it("should clear messages for a tab", () => {
    const tab: Tab = {
      id: "tab-1",
      connName: "local",
      connUrl: "amqp://localhost",
      targetName: "my-queue",
      targetType: "queue",
      mode: "read",
      ackMode: "ack",
      label: "my-queue",
    };

    useAppStore.getState().addTab(tab);
    useAppStore.getState().addMessage("tab-1", {
      id: "msg-1",
      timestamp: "2026-06-06T12:00:00Z",
      filePath: "/tmp/msg-1.json",
      bodyPreview: "test",
      properties: {
        content_type: null,
        delivery_mode: null,
        correlation_id: null,
        message_id: null,
      },
    });

    expect(useAppStore.getState().messages["tab-1"]).toHaveLength(1);

    useAppStore.getState().clearMessages("tab-1");
    expect(useAppStore.getState().messages["tab-1"]).toHaveLength(0);
  });
});
