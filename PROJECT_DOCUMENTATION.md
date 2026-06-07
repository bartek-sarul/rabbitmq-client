# RabbitMQ Desktop Client - Project Documentation

This document serves as the complete architectural blueprint and design specification for the RabbitMQ Desktop Client. It details every frontend and backend component, feature, state schema, and IPC contract so that the entire application can be recreated from scratch.

---

## 1. System Architecture

The application is built on top of **Tauri v2**, utilizing a secure, typed IPC bridge between a **Rust backend** and a **React 19 + TypeScript frontend**.

### High-Level Architecture Diagram

```mermaid
graph TD
    subgraph Frontend [React 19 Frontend]
        Store[Zustand Store]
        UI[React Components]
        LM[Message Listener Manager]
    end

    subgraph IPC [Tauri IPC Bridge]
        Commands[Tauri Commands]
        Events[Tauri Events]
    end

    subgraph Backend [Rust Core]
        TM[Tab Manager]
        Conf[Config Engine]
        Consumer[Tokio Background Consumer]
        Publisher[AMQP Publisher]
    end

    subgraph External [Message Broker]
        RMQ[RabbitMQ Broker]
    end

    UI -->|Use Selectors & Actions| Store
    UI -->|Invoke Command| Commands
    Commands -->|Configure / Lock / Mutate| TM
    TM -->|Validate / Build Session| Consumer
    Commands -->|Establish Connection| Publisher
    Publisher -->|Publish Message| RMQ
    Consumer -->|Consume Stream| RMQ
    Consumer -->|Write File| Disk[(Local Disk)]
    Consumer -->|Emit msg-tabId / status-tabId| Events
    Events -->|Subscribe / Listen| LM
    LM -->|Dispatch to Store| Store
```

---

## 2. Technical Stack & Dependencies

### Backend (Rust `src-tauri/Cargo.toml`)
*   **Tauri v2 (`tauri`)**: Core desktop application container, window manager, and IPC bridge.
*   **lapin**: Pure Rust AMQP 0-9-1 client library.
*   **tokio**: Async run-time for the connection event loops.
*   **tokio-util**: Utilized for `CancellationToken` tasks control.
*   **futures-lite**: Stream extensions for consuming messages.
*   **serde / serde_json / serde_yaml**: Data serialization and configuration parsing.
*   **chrono**: Datetime management for file logs and UI timestamps.
*   **dirs**: Multi-platform user directory path resolution.
*   **uuid**: UUIDv4 generator for tracking unique tab and message identifiers.

### Frontend (React `package.json`)
*   **React 19**: Rendering library.
*   **TypeScript**: Type-safety layer.
*   **Vite**: Build tool and dev server.
*   **Zustand v5**: Global state manager.
*   **Vitest**: Testing framework.

---

## 3. Configuration System

The application reads and writes its connection definitions from a localized configuration file.

*   **Location**: `~/.rabbit-client.yaml`
*   **Format**: YAML

### Schema Layout
```yaml
save_path: "/path/to/save/directory" # Destination folder for disk-logging
connections:
  - name: "Local Host"
    url: "amqp://guest:guest@localhost:5672"
    queues:
      - name: "task-queue"
    exchanges:
      - name: "notifications"
        type: "fanout"
```

### Backend Config Engine (`config.rs`)
1.  **`load_config()`**: Resolves path, reads file content, and returns parsed structure. If the file does not exist, it auto-writes a template config with default connections.
2.  **`AppConfig::validate()`**: Validates parameters prior to booting the app:
    *   Rejects configurations with no connections.
    *   Requires non-empty connection names and URLs.
    *   Verifies that URLs begin with either `amqp://` or `amqps://`.
    *   Ensures all target queues/exchanges have non-empty names and type specs.

---

## 4. Rust Backend Session Manager

To maintain connection contexts, consumer streams, and cancellation handlers concurrently, the backend implements a safe thread-locked session registry.

### ActiveTab & TabManager Structure (`tab_manager.rs`)
```rust
pub enum TabMode {
    Read,
    Write,
}

pub enum AckMode {
    Ack,
    Nack,
}

pub enum TargetType {
    Queue,
    Exchange,
}

pub struct ActiveTab {
    pub connection: Option<Connection>,
    pub channel: Option<Channel>,
    pub cancel: CancellationToken,
    pub mode: TabMode,
    pub ack_mode: Option<AckMode>,
    pub target_name: String,
    pub target_type: TargetType,
    pub conn_url: String,
    pub conn_name: String,
}

pub struct TabManager(pub Mutex<HashMap<String, ActiveTab>>);
```

### Encapsulated Methods on `TabManager`
*   **`open_tab(tab_id, ActiveTab)`**: Registers a new tab session. Open operations are **offline-first**; no AMQP socket is created during tab open.
*   **`close_tab_session(tab_id)`**: Cancels background consumer loops and removes the tab registry slot.
*   **`get_publisher_info(tab_id)`**: Retreives the AMQP configuration parameters (`conn_url`, `target_name`, `target_type`) for message dispatching.
*   **`start_consumer_session(tab_id, ack_mode)`**: Mutates the active tab's `ack_mode` and retrieves connection info and the `CancellationToken` in a single transaction.
*   **`stop_consumer_session(tab_id)`**: Safely triggers `cancel.cancel()` and swaps in a fresh, un-triggered `CancellationToken` inside the tab registry slot.

---

## 5. Tauri IPC Command API

The frontend interacts with the Rust backend using the following Tauri command functions defined in `commands.rs`. All parameters are strongly-typed:

| Command Name | Arguments | Return | Behavior |
|---|---|---|---|
| `load_config_cmd` | None | `Result<AppConfig, String>` | Parses and validates `~/.rabbit-client.yaml`. |
| `open_tab` | `tab_id`, `conn_url`, `conn_name`, `target_name`, `target_type: TargetType`, `mode: TabMode`, `ack_mode: Option<AckMode>` | `Result<(), String>` | Inserts tab state metadata into the `TabManager`. |
| `close_tab` | `tab_id` | `Result<(), String>` | Cancels any active consumer loop and removes metadata. |
| `send_message` | `tab_id`, `body`, `routing_key: Option<String>`, `headers: Option<String>`, `properties: Option<SendProperties>` | `Result<(), String>` | Establishes a temporary connection, enables publisher confirmations, dispatches, confirms, and closes gracefully. |
| `start_consumer` | `tab_id`, `ack_mode: AckMode` | `Result<ConsumerSessionInfo, String>` | Spawns a background Tokio task to loop and consume messages, returning folder path details. |
| `stop_consumer` | `tab_id` | `Result<(), String>` | Signals the background loop to cancel and exit gracefully. |
| `read_message_file` | `path` | `Result<String, String>` | Reads a message's full payload JSON file from disk on demand. |
| `open_folder` | `path` | `Result<(), String>` | Spawns Finder (macOS), Explorer (Windows), or xdg-open (Linux) for the specified directory. |
| `read_raw_config` | None | `Result<String, String>` | Reads the raw text contents of the YAML configuration file. |
| `save_raw_config` | `content` | `Result<(), String>` | Validates and saves a raw configuration YAML string to disk. |
| `save_config_struct`| `config` | `Result<(), String>` | Validates and serializes an `AppConfig` struct to the YAML file. |
| `parse_yaml_config` | `content` | `Result<AppConfig, String>`| Parses and validates an arbitrary YAML configuration string. |

### Header Mappings
*   **`json_to_field_table(json_str)`**: Parses JSON objects to AMQP `FieldTable` headers. Converts:
    *   Booleans $\rightarrow$ `AMQPValue::Boolean`
    *   Integers $\rightarrow$ `AMQPValue::LongLongInt`
    *   Floating points $\rightarrow$ `AMQPValue::Double`
    *   Strings $\rightarrow$ `AMQPValue::LongString`
    *   Nulls $\rightarrow$ skipped
*   **`field_table_to_json(table)`**: Translates `FieldTable` elements back into readable JSON fields.

---

## 6. Background Consumer Event Loop

When `start_consumer` is invoked, the backend spawns a Tokio task executing an event loop.

### Consumer State Flow Chart

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> EmittingConnecting : Spawn Loop / Trigger Reconnect
    EmittingConnecting --> Connecting : Emit status("connecting")
    Connecting --> CreateChannel : Connection::connect success
    Connecting --> SleepRetry : Connection failed
    CreateChannel --> ConsumeQueue : Channel::create_channel success
    ConsumeQueue --> EmittingConsuming : basic_consume success
    ConsumeQueue --> SleepRetry : Consume failed
    EmittingConsuming --> StreamLoop : Emit status("consuming")
    
    state StreamLoop {
        [*] --> AwaitStreamEvent
        AwaitStreamEvent --> ProcessMessage : Message Received
        ProcessMessage --> WriteToDisk : Save to Disk enabled
        WriteToDisk --> EmitUI : Format payload json
        EmitUI --> AckNack : Emit msg-tabId event
        AckNack --> AwaitStreamEvent : Send AMQP Ack/Nack
        
        AwaitStreamEvent --> ReconnectionNeeded : Socket Drop / Stream End
        AwaitStreamEvent --> CancelReceived : Cancel Token Fired
    }
    
    ReconnectionNeeded --> SleepRetry
    SleepRetry --> EmittingConnecting : Sleep 1 second
    
    CancelReceived --> GracefulClose
    GracefulClose --> EmittingDisconnected : connection.close()
    EmittingDisconnected --> [*] : Emit status("disconnected")
```

### Disk Persistence Folder Architecture
When a consumer has `save_to_disk: true` enabled, messages are written into the directory designated by `save_path` inside `~/.rabbit-client.yaml`.

*   **Folder naming scheme**: `<TIMESTAMP_YYYY-MM-DD_HH-MM-SS>_<CONNECTION_NAME>_<QUEUE_NAME>`
*   *Note: folder names are sanitized to keep only alphanumeric characters, dashes, and underscores.*
*   **Filename scheme**: `<EPOCH_MILLISECONDS>_<UUID_MESSAGE_ID>.json`
    *   *Prefixed with epoch milliseconds to ensure alphanumeric list sorting corresponds to chronological arrival order.*

---

## 7. Frontend State Management (Zustand)

Global frontend states are managed via a single Zustand store (`useAppStore.ts`).

### State Schema
```typescript
interface Message {
  id: string;
  timestamp: string;
  body: string;
  headers: string; // Pretty-printed JSON
  properties: {
    content_type?: string;
    delivery_mode?: number;
    correlation_id?: string;
    message_id?: string;
  };
}

interface Tab {
  id: string;
  connName: string;
  connUrl: string;
  targetName: string;
  targetType: "queue" | "exchange";
  mode: "read" | "write";
  consuming?: boolean;
  status?: "connecting" | "consuming" | "disconnected";
  ackMode: "ack" | "nack";
  folderPath?: string;
  folderName?: string;
  lastReceived?: number; // Epoch timestamp used to flash tab items on message receipt

  // Writer form states (persisted independently per tab)
  body: string;
  routingKey: string;
  headers: string; // JSON string
  contentType: string;
  deliveryMode: number; // 1 (Transient) or 2 (Persistent)
  correlationId: string;
  messageId: string;
}

interface AppStoreState {
  connections: Connection[];
  tabs: Record<string, Tab>; // Tab details indexed by tab ID
  tabIds: string[]; // Order list of active tab IDs
  activeTabId: string | null;
  messages: Record<string, Message[]>; // Received messages indexed by tab ID
  
  // Actions
  setConnections: (conns: Connection[]) => void;
  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  setActiveTabId: (id: string | null) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  addMessage: (tabId: string, msg: Message) => void;
  clearMessages: (tabId: string) => void;
}
```

### Selector Performance Optimization
To prevent UI lagging and rendering cascades when background tabs receive streamed messages, components **must not** select the root store object or the full tabs array. Instead, they use memoized, fine-grained selectors and Zustand's `useShallow` hook:

1.  **Active Tab Isolation**:
    ```typescript
    export const selectActiveTab = (state: AppStoreState) => 
      state.activeTabId ? state.tabs[state.activeTabId] : null;
    ```
    This ensures that components displaying active tab details only re-render if the focused tab actually updates, ignoring updates to inactive tabs.
2.  **Shallow Tab ID List**:
    ```typescript
    export const selectTabIds = (state: AppStoreState) => state.tabIds;
    ```
    Used by the TabBar list container via `useShallow(selectTabIds)` so tab additions/deletions re-render the container, but individual tab updates do not.
3.  **Message Subscriptions**:
    ```typescript
    export const selectMessagesByTabId = (tabId: string) => (state: AppStoreState) => 
      state.messages[tabId] || EMPTY_ARRAY;
    ```
    Returns a static empty array reference if no messages exist, preventing downstream components from re-evaluating when other tabs receive messages.

---

## 8. React UI Components & Layouts

### Component Hierarchy Diagram

```mermaid
graph TD
    App[App.tsx] --> Sidebar[Sidebar.tsx]
    App --> MainContent[Main Content Layout]
    App --> ML[MessageListenerManager.tsx]
    
    ML --> MTL[TabMessageListener sub-components]
    
    Sidebar --> ModalSelect[Modal: Exchange Mode Selector]
    Sidebar --> ConfigEditor[ConfigEditorModal.tsx]
    
    MainContent --> TabBar[TabBar.tsx]
    MainContent --> TabViews[Active Tab Render]
    
    TabBar --> TabItem[TabItem.tsx]
    TabItem --> Flash[Flash Trigger Indicator]
    
    TabViews --> ReadTab[ReadTab.tsx]
    TabViews --> WriteTab[WriteTab.tsx]
    
    WriteTab --> ModalReset[Modal: Confirm Form Reset]
    WriteTab --> ClearInput[ClearableInput.tsx]
    WriteTab --> ClearText[ClearableTextarea.tsx]
    WriteTab --> Icons[Icons.tsx SVG Graphics]
```

### Configuration Editor Modal (`ConfigEditorModal.tsx`)
*   **Visual Form Editing**: Manage the mandatory `save_path` directory and connection records list.
*   **Connection Entries**: Add new connection targets instantaneously with pre-populated placeholders. Modify connection details, URL strings, and target lists directly on the active form.
*   **Safety Confirmations**: Clicking the "✕" button next to any connection in the left sidebar list displays a confirmation alert box before deleting.
*   **File Manager Highlights**: A footer button displays "Show in Finder" (macOS) or "Show in Explorer" (Windows) to reveal the absolute location of the `.rabbit-client.yaml` file in the native file browser context.

### Reusable UI Elements
1.  **`<Modal>`**:
    *   Renders a portal/overlay backdrop.
    *   Closes on backdrop clicks or Escape key presses.
    *   Provides standardized header, content, and button layouts.
2.  **`<ClearableInput>` / `<ClearableTextarea>`**:
    *   Wraps a standard text field or text area.
    *   Appends spellcheck suppression properties (`spellCheck={false}`, `autoCorrect="off"`).
    *   Renders an absolute-positioned clearing button `✕` on the right side if the field has text.
3.  **`<Icons>`**:
    *   Contains pure inline SVG icons compiled into React components (e.g., `<SendIcon />`, `<WarningIcon />`, `<QueueIcon />`).

### Write Tab Form & Operations (`WriteTab.tsx`)
*   **Default values**:
    *   Content-Type: `"application/json"`
    *   Delivery Mode: `1` (Transient)
    *   Message ID: empty (requires user to generate if needed)
    *   Correlation ID: empty
*   **Smart Quotes Correction**:
    Text inputs monitor key presses. If smart curly quotes (`“`, `”`, `‘`, `’`) are input, they are automatically replaced with standard straight quotes (`"`, `'`) before being saved in state.
*   **Field Clearing**:
    Selecting the `✕` inside an input clears the field. The Delivery Mode dropdown shows a `✕` if a non-transient option is chosen, resetting it to Transient.
*   **UUID Generators**:
    The Message ID and Correlation ID inputs include a **Generate** button next to them. Clicking it calls `uuidv4()` to fill the field.
*   **Message Dispatch Action**:
    Clicking the publish button sends the payload to `send_message`. On success, the UI clears **only** the message body. Headers, Routing Key, and Properties are kept to allow rapid message variants to be sent.
*   **Form Reset Flow**:
    Clicking **Reset** does not clear the fields directly. It opens a confirm modal. If the user approves, all inputs (including properties, content-type, and body) are reset to empty values.

### Read Tab Inspector & Message List (`ReadTab.tsx`)
*   **Layout Structure**:
    Split screen layout. The left column lists consumed messages chronologically. The right column displays a details inspector panel for the selected message.
*   **Independent Scroll**:
    The message list is styled with `overflow-y: auto`, `min-height: 0` and `flex-grow: 1`. Rows have `flex-shrink: 0` to prevent resizing. This keeps the header static at the top and ensures only the list scrolls.
*   **Scroll Lock / Freeze**:
    Includes a "Scroll Lock" checkbox. If checked, incoming messages do not automatically scroll the container, allowing users to inspect older messages without jumping.

---

## 9. Memory Leak Prevention

To prevent background event listener leakage, the registration of Tauri events is managed declaratively.

### Message Listener Management (`MessageListenerManager.tsx`)
*   The global manager queries the list of active tab IDs.
*   It maps over this array and renders a child `<TabMessageListener tabId={id} />` component for each tab.
*   When a `<TabMessageListener>` mounts, it handles setting up listeners for `msg-{tabId}` and `status-{tabId}`.
*   To prevent asynchronous callback races (e.g. if the user closes a tab before Tauri finishes setting up the listener), the effect utilizes a local status flag:
    ```typescript
    useEffect(() => {
      let active = true;
      let unlistenMsg: (() => void) | null = null;
      let unlistenStatus: (() => void) | null = null;

      async function setup() {
        const msgClean = await listen(`msg-${tabId}`, (event) => {
          if (active) addMessage(tabId, event.payload as Message);
        });
        if (!active) {
          msgClean();
          return;
        }
        unlistenMsg = msgClean;

        const statusClean = await listen(`status-${tabId}`, (event) => {
          if (active) updateTab(tabId, { status: event.payload as TabStatus });
        });
        if (!active) {
          statusClean();
          return;
        }
        unlistenStatus = statusClean;
      }

      setup();

      return () => {
        active = false;
        if (unlistenMsg) unlistenMsg();
        if (unlistenStatus) unlistenStatus();
      };
    }, [tabId]);
    ```
*   When a tab is closed, its ID is removed from the Zustand array. This unmounts the `<TabMessageListener>`, automatically tearing down the event listener.

---

## 10. Verification & Rebuild Guide

### Local Environment Setup
To build or test the application, ensure the following components are installed:
*   **Rust Toolchain**: Stable version (`1.80` or higher).
*   **NodeJS**: Version `18` or `20` (LTS recommended).
*   **Package Manager**: `npm`.

### Run Commands

#### 1. Setup Dependencies
```bash
npm install
```

#### 2. Run in Development Mode
```bash
npm run tauri dev
```

#### 3. Run Frontend Unit Tests (Vitest)
```bash
npm run test
```

#### 4. Run Backend Unit Tests (Cargo)
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

#### 5. Compile Frontend Bundle
```bash
npm run build
```

#### 6. Build Production Installers (OS Native)
```bash
npm run tauri build
```
This builds native installer packages for macOS (`.dmg`/`.app`), Windows (`.msi`), or Linux (`.deb`/`.rpm`) depending on your current host platform.

### Continuous Integration (GitHub Actions)
The project includes a pre-configured GitHub Actions workflow under `.github/workflows/build.yml` that automates building cross-platform packages on every push to the `main` branch:
- **Build Targets**: macOS (`.dmg`), Windows (`.exe` / `.msi`), and Linux (`.deb` / `.AppImage`).
- **Signing**: Builds unsigned binaries (with ad-hoc signing for macOS) to bypass developer certificate requirements.
- **Verification**: Automatically runs frontend tests (`npm run test`) and backend unit tests (`cargo test`) before compiling packages.
- **Outputs**: Packages are uploaded as downloadable ZIP files under the run's **Artifacts** section on the GitHub Action execution page.
