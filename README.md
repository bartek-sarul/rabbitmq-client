# RabbitMQ Desktop Client

A lightweight, premium, cross-platform desktop application for interacting with RabbitMQ queues and exchanges. Built with **Tauri v2 (Rust backend) + React 19 + TypeScript + Zustand + Vite**.

This document is the architectural reference for the RabbitMQ Desktop Client: every frontend and backend component, feature, state schema, and IPC contract. For day-to-day contributor conventions (commands, file layout, styling rules), see [`CLAUDE.md`](CLAUDE.md).

---

## 1. Core Features

### Universal UI & Layout
![Main Application Interface](docs/screenshots/01-main-layout.png)
* **Multi-Tabbed Interface**: Open multiple concurrent publisher and consumer sessions targeting different queues/exchanges.
* **Offline-First**: Tabs open instantly without establishing a connection. AMQP sockets are only opened when explicitly starting a stream or sending a message.
* **Smart Background Sync**: Inactive tabs flash a green notification dot in the TabBar when they receive a background message.
* **Native Desktop Feel**: Intercepts native window closing events (Mac traffic lights, Windows X button) to gracefully disconnect active streams, prompting for confirmation if tabs are open to avoid accidental closures.

### Config & Connection Manager
![Configuration Editor Modal](docs/screenshots/02-config-editor.png)
* **YAML Based**: Saves environment connections, queues, and exchanges securely to `~/.rabbit-client.yaml`.
* **Visual Config Editor**: Built-in modal for visually editing the config. Instantly parses, validates, and reloads the left sidebar without requiring application restarts.
* **Connection Search**: Fuzzy subsequence search over the connection list (in both the sidebar and the config editor), so `prd` matches `payments-prod-eu`.
* **Resizable Editor**: The config editor can be resized from its bottom-right corner, and the divider between the connection list and the editor can be dragged left or right (double-click it to reset). Both dimensions persist between sessions.
* **Path Shortcuts**: The editor shows the **configuration file path** and the **message store folder** side by side, each with a folder button that reveals it in Finder / Explorer / the system file manager.

### Consumer Tab (Read Mode)
![Consumer Stream UI](docs/screenshots/03-consumer-tab.png)
* **ACK / NACK Control**: Choose between **Consume (ACK)**, the default, which permanently dequeues messages, or **Peek (NACK)** which reads them while leaving them on the broker. Peek holds each delivery unacknowledged for the life of the session, so every message is read exactly once and the whole batch is returned to the queue the moment you disconnect.
* **Live Streaming & UI**: Split-pane layout. Left side shows a streaming list of incoming messages with timestamps. Right side is a detailed inspector.
* **High-Performance Payload Search**: 
  * The message payload inspector features a blazing-fast, case-insensitive text search.
  * To bypass React's Virtual DOM rendering bottleneck on massive multi-megabyte JSON files, it uses a custom string-injection engine (`dangerouslySetInnerHTML`) mapped via invisible unicode control characters (`\u0001`, `\u0002`, `\u0003`) to safely parse, escape, and wrap exact matches in `<mark>` HTML tags.
  * Features a native `Cmd/Ctrl + F` shortcut, a 300ms debounce loop to preserve UI responsiveness during typing, active occurrence tracking (e.g. `2 / 52`), and `Enter` key or Up/Down UI buttons to navigate matches.
  * Smart `Escape` flow: clears search input text first -> drops input focus -> closes the side panel completely.
  * The active match is instantly highlighted via a targeted dynamic CSS `<style>` block injection. This completely avoids expensive full-document regeneration during next/prev occurrence navigation.
* **Scroll-Lock**: Toggle scroll-freeze to read incoming bursts of messages without the screen jumping.
* **Header & Property Inspector**: Shows `Content-Type`, `Delivery Mode`, `Correlation ID`, `Message ID`, and Custom Headers.
* **Disk Persistence**: Saves all incoming messages cleanly to disk as formatted JSON payloads in a designated folder (e.g. `YYYY-MM-DD_HH-MM-SS_Local-Host_my-queue`). "Open Folder" button natively opens the system file explorer directly to that log folder.

### Publisher Tab (Write Mode)
![Publisher Single Send UI](docs/screenshots/04-publisher-single.png)
![Publisher Bulk Send UI](docs/screenshots/05-publisher-bulk.png)
* **Single Send**: Craft custom payloads in a text editor. Supports building dynamic AMQP headers, custom properties, and routing keys.
* **Smart Routing Keys**: The Routing Key field is automatically disabled and greyed out when targeting a Queue directly, as it is only applicable for Exchange publishing.
* **Auto-Generating UUIDs**: "Auto" checkboxes next to Correlation ID and Message ID. If checked, the fields become read-only and automatically inject a fresh UUIDv4 upon every message dispatched.
* **JSON Safety**: Automatically detects and corrects "smart quotes" (curly quotes) typed by macOS keyboards into standard straight quotes to prevent JSON parse errors.
* **Bulk Sender**: "Bulk send" mode allows the user to multi-select JSON files from their local disk. The app sequentially publishes the contents of each file to the target using the currently defined properties/headers. Features individual status indicators (pending, sending, sent, failed) and a "Resend Failed" button.
* **Safe Resets**: "Reset form" includes a safety confirmation modal.

---

## 2. System Architecture Diagram

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

## 3. Configuration System

The application reads and writes its connection definitions from a localized configuration file.

*   **Location**: `~/.rabbit-client.yaml` (auto-created from a template on first launch)
*   **Format**: YAML
*   **`save_path`**: the *message store folder* — where consumed messages are written to disk. It is distinct from the config file location above.

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
pub enum TabMode { Read, Write }
pub enum AckMode { Ack, Nack }
pub enum TargetType { Queue, Exchange }

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

// Publisher connections, reused across sends and keyed by AMQP URL.
pub struct ConnectionPool(pub tokio::sync::Mutex<HashMap<String, Connection>>);
```

### Encapsulated Methods on `TabManager`
*   **`open_tab(tab_id, ActiveTab)`**: Registers a new tab session.
*   **`close_tab_session(tab_id)`**: Cancels background consumer loops and removes the tab registry slot.
*   **`get_publisher_info(tab_id)`**: Retreives the AMQP configuration parameters (`conn_url`, `target_name`, `target_type`) for message dispatching.
*   **`start_consumer_session(tab_id, ack_mode)`**: Mutates the active tab's `ack_mode` and retrieves connection info and the `CancellationToken` in a single transaction.
*   **`stop_consumer_session(tab_id)`**: Safely triggers `cancel.cancel()` and swaps in a fresh, un-triggered `CancellationToken` inside the tab registry slot.

---

## 5. Tauri IPC Command API

| Command Name | Arguments | Behavior |
|---|---|---|
| `load_config_cmd` | None | Parses and validates `~/.rabbit-client.yaml`. |
| `read_raw_config` | None | Reads the raw text contents of the YAML configuration file. |
| `save_raw_config` | `content` | Validates and saves a raw configuration YAML string to disk. |
| `save_config_struct` | `config` | Serializes an edited `AppConfig` back to YAML and writes it. |
| `parse_yaml_config` | `content` | Parses and validates YAML without writing, for live editor feedback. |
| `get_config_path` | None | Returns the absolute path of `~/.rabbit-client.yaml` for display in the editor. |
| `show_config_in_file_manager` | None | Reveals the config file in Finder / Explorer / the file manager. |
| `open_tab` | `tab_id`, `conn_name`, `target_name`, `target_type`, `mode`, `ack_mode` | Inserts tab state metadata into the `TabManager`. Takes a connection *name*: AMQP URLs (and their credentials) are resolved backend-side and never reach the frontend. |
| `close_tab` | `tab_id` | Cancels any active consumer loop and removes metadata. |
| `send_message` | `tab_id`, `body`, `routing_key`, `headers`, `properties` | Publishes over a pooled connection, confirms, and closes the channel. |
| `start_consumer` | `tab_id`, `ack_mode: AckMode` | Spawns a background Tokio task to loop and consume messages, returning folder path details. |
| `stop_consumer` | `tab_id` | Signals the background loop to cancel and exit gracefully. |
| `generate_default_folder_path` | `conn_name`, `target_name` | Builds the timestamped message-store subfolder path under `save_path`. |
| `load_folder_messages` | `folder_path` | Re-reads a previously used message folder so a reopened tab shows its history. |
| `read_message_file` | `path` | Reads a message's full payload JSON file from disk on demand. Confined to the message store folder. |
| `read_picked_file` | `path` | Reads a file chosen in the native dialog, for bulk publishing. |
| `open_folder` | `path` | Spawns Finder (mac), Explorer (Win), or xdg-open (Linux) for the specified directory. Confined to the message store folder. |
| `exit_app` | `AppHandle` | Gracefully and instantly force-kills the native process to bypass Javascript event loop. |

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

---

## 7. Frontend State Management (Zustand)

All global frontend state lives in a single, deliberately small Zustand store (`src/store/useAppStore.ts`).

### Shape
```typescript
interface AppStore {
  tabs: Tab[];                          // ordered list, drives the TabBar
  activeTabId: string | null;
  messages: Record<string, Message[]>;  // per tab, newest first (prepended)
}
```

### Actions
`addTab`, `removeTab`, `setActiveTab`, `addMessage`, `setMessages`, `clearMessages`, `updateTab`.

*   `addTab` seeds an empty message list and focuses the new tab.
*   `removeTab` drops the tab's messages and falls back to the last remaining tab.
*   `addMessage` prepends the message, capping each tab's list at `MAX_MESSAGES_PER_TAB` (2000);
    everything received is still on disk in the tab's message folder.
*   `lastReceived` is stamped only for tabs that are not currently focused, which is what drives the
    activity flash on background tabs in the `TabBar`.

### Rendering Strategy
*   **Every tab stays mounted.** `App.tsx` renders all tabs and hides the inactive ones with
    `display: none`, so a background consumer keeps its scroll position, filters and message list.
*   **Select narrowly.** Components subscribe to individual slices
    (`useAppStore((s) => s.updateTab)`), never the whole store object, because a busy consumer writes
    to the store on every delivery.

---

## 8. Event Listener Lifecycle

Tauri event listeners are registered in exactly one place, `MessageListenerManager.tsx`, which is
mounted once by `App.tsx` and renders nothing.

*   It keeps a `useRef<Map<tabId, UnlistenFn[]>>` of live subscriptions.
*   On every store change it reconciles that map against the set of read tabs currently consuming:
    tabs that started consuming get `msg-{tabId}`, `status-{tabId}` and `consumer-error-{tabId}`
    listeners; tabs that stopped or were closed have their `unlisten()` functions invoked and their
    entry dropped.
*   A final unmount effect tears down everything remaining.

Because registration is asynchronous, a placeholder entry is inserted synchronously to stop a second
effect run from double-subscribing the same tab.

No other component may call `listen()` — routing every subscription through this one reconciler is
what keeps listeners from outliving their tabs.

---

## 9. Verification & Rebuild Guide

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
npm start          # tauri dev — full app (Rust + webview)
npm run dev        # vite only — faster loop for pure UI work
```

#### 3. Run Frontend Unit Tests (Vitest)
```bash
npm run test
```

#### 4. Compile Frontend Bundle
```bash
npm run build
```

#### 5. Build Production Installers (OS Native)
```bash
npm run build:app
```
This builds native installer packages for macOS (`.dmg`/`.app`), Windows (`.msi`), or Linux (`.deb`/`.rpm`) depending on your current host platform.
