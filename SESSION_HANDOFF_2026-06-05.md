# Handoff: macOS RabbitMQ Client (Tauri)
_Date: 2026-06-05 | Status: Planning complete, implementation not started_

---

## Scope

Build a standalone macOS desktop RabbitMQ client app from scratch in the workspace at `/Users/bartoszs/UEFA/sandbox/rabbit-client`.

Features:
- YAML config at `~/.rabbit-client.yaml` listing named connections with queues/exchanges
- Left sidebar: connection tree (name only, not full URL), click to expand queues/exchanges
- Opening a queue/exchange creates a **tab** with its own independent TCP AMQP connection
- **Write tab** (queue or exchange): message textarea + optional routing key field (always shown, leave empty = no routing key) + Send button
- **Read tab** (queue only): live streaming consumer, ACK mode toggled per tab before start, message list newest-on-top; rows truncated to one line, click to expand; copy buttons (body / headers / full JSON)
- Closing a tab drops the connection

---

## Current State

Workspace is **empty** — nothing scaffolded yet. Full implementation to be done from scratch.

---

## What Changed

Nothing — this is the first agent picking up the work.

---

## Validation Performed

None yet.

---

## Open Issues / Risks

- Tauri v2 + `lapin` async: `lapin` requires a `tokio` runtime; Tauri v2 uses its own async runtime. Use `#[tokio::main]` or bridge via `tauri::async_runtime::spawn` — prefer `tauri::async_runtime::spawn` to stay within Tauri's runtime.
- `start_consumer` spawns a background task per tab; must be cancelled cleanly on `close_tab` — use a `CancellationToken` (from `tokio-util`) stored per `ActiveTab`.
- Tauri event names cannot contain `:` on some platforms — use `msg-{tab_id}` (hyphen) instead of `msg:{tab_id}`.

---

## Next Actions (ordered)

### Phase 1 — Scaffold
1. `cd /Users/bartoszs/UEFA/sandbox/rabbit-client`
2. Run: `npm create tauri-app@latest . -- --template react-ts` — select React + TypeScript + Vite
3. Verify `cargo tauri dev` opens a blank window

### Phase 2 — Rust dependencies
4. Add to `src-tauri/Cargo.toml`:
   ```toml
   lapin = "2"
   tokio = { version = "1", features = ["full"] }
   tokio-util = { version = "0.7", features = ["rt"] }
   serde = { version = "1", features = ["derive"] }
   serde_yaml = "0.9"
   serde_json = "1"
   uuid = { version = "1", features = ["v4"] }
   ```

### Phase 3 — Config layer
5. Create `src-tauri/src/config.rs`:
   - Structs: `AppConfig`, `ConnectionDef { name, url, queues: Vec<QueueDef>, exchanges: Vec<ExchangeDef> }`, `QueueDef { name }`, `ExchangeDef { name, type_ }`
   - `pub fn load_config() -> Result<AppConfig, String>` — reads `~/.rabbit-client.yaml`; if missing, writes a sample file and returns it
6. Expose `#[tauri::command] fn load_config_cmd() -> Result<AppConfig, String>` in `commands.rs`
7. Register command in `main.rs` `.invoke_handler(tauri::generate_handler![load_config_cmd, ...])`
8. Frontend `src/types.ts`: mirror Rust structs as TypeScript interfaces
9. `Sidebar.tsx`: on mount call `invoke('load_config_cmd')`, render collapsible connection list → queues (R/W chip on click) / exchanges (W only)

### Phase 4 — Tab + AMQP layer
10. Create `src-tauri/src/tab_manager.rs`:
    - `ActiveTab { connection: Connection, channel: Channel, cancel: CancellationToken, mode: TabMode }`
    - `TabManager(Mutex<HashMap<String, ActiveTab>>)` as Tauri managed state
11. `open_tab(tab_id, conn_url, target_name, target_type, mode, ack_mode)` command:
    - `lapin::Connection::connect(url, ConnectionProperties::default()).await`
    - `conn.create_channel().await`
    - Store in TabManager
12. `close_tab(tab_id)` command: cancel token, remove from map (drop closes connection)
13. Frontend: `useAppStore.ts` (Zustand) — `tabs: Tab[]`, `openTab(...)`, `closeTab(tab_id)`, `addMessage(tab_id, msg)`
14. `TabBar.tsx` + `App.tsx` render active tab component based on `tab.mode`

### Phase 5 — Write tab
15. `send_message(tab_id, body, routing_key: Option<String>)` command:
    - For queue target: `channel.basic_publish("", &queue_name, options, body.as_bytes(), properties)`; ignore `routing_key` param (queue name is the routing key to default exchange)
    - For exchange target: `channel.basic_publish(&exchange_name, routing_key.as_deref().unwrap_or(""), options, body.as_bytes(), properties)`
16. `WriteTab.tsx`:
    - Textarea for message body
    - Text input "Routing key (optional)" — always visible, empty allowed
    - Send button → `invoke('send_message', { tabId, body, routingKey: routingKey || null })`
    - Show success/error toast

### Phase 6 — Read tab
17. `start_consumer(tab_id, ack_mode)` command:
    - `channel.basic_consume(&queue_name, "", BasicConsumeOptions::default(), FieldTable::default())`
    - `tauri::async_runtime::spawn` loop: on each delivery, emit event `msg-{tab_id}` with payload `{ id: uuid, headers: {...}, properties: {...}, body: String }`
    - If `ack_mode == "ack"`: call `delivery.ack(BasicAckOptions::default())`; else `delivery.nack(BasicNackOptions { requeue: true, ..Default::default() })`
    - Store abort handle via `CancellationToken`
18. `ReadTab.tsx`:
    - ACK toggle (radio: "ACK / NACK") — locked after consumer starts
    - Start button → `invoke('start_consumer', { tabId, ackMode })`
    - `listen('msg-{tabId}', handler)` → prepend to local message array
19. `MessageRow.tsx`:
    - Single-line display: `id | timestamp | body` — CSS `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` per column
    - Click to expand: renders headers table, properties table, full body text
    - Copy buttons: "Copy body", "Copy headers", "Copy all" (JSON.stringify full message)

### Phase 7 — Polish
20. Error boundary / toast for connection failures
21. Tab labels: `{conn_name} / {target_name} [R]` or `[W]`
22. Auto-create sample `~/.rabbit-client.yaml` on first launch if missing

---

## Quick Resume Commands

```bash
# Verify Rust toolchain
rustup show

# Start dev server (once scaffolded)
cd /Users/bartoszs/UEFA/sandbox/rabbit-client
npm run tauri dev

# Local RabbitMQ for testing
docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management
# Management UI: http://localhost:15672 (guest/guest)

# Build release
npm run tauri build
```

---

## Important Paths

| Path | Purpose |
|------|---------|
| `/Users/bartoszs/UEFA/sandbox/rabbit-client/` | Workspace root |
| `src-tauri/src/config.rs` | YAML config parsing + sample file generation |
| `src-tauri/src/tab_manager.rs` | AMQP connection lifecycle per tab |
| `src-tauri/src/commands.rs` | All `#[tauri::command]` handlers |
| `src/store/useAppStore.ts` | Zustand: tabs, messages, sidebar state |
| `src/components/Sidebar.tsx` | Connection tree |
| `src/components/WriteTab.tsx` | Publish UI |
| `src/components/ReadTab.tsx` | Consumer UI |
| `src/components/MessageRow.tsx` | Truncated row + expand + copy |
| `~/.rabbit-client.yaml` | User config (created by app if missing) |

---

## YAML Config Format

```yaml
connections:
  - name: "local"
    url: "amqp://guest:guest@localhost:5672"
    queues:
      - name: "my-queue"
    exchanges:
      - name: "my-exchange"
        type: "direct"   # optional, display only
  - name: "prod"
    url: "amqp://user:pass@prod:5672"
    queues:
      - name: "orders"
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Desktop framework | Tauri v2 + React + TypeScript + Vite | Small native binary, Rust AMQP, no Node RabbitMQ deps |
| AMQP library | `lapin` (Rust) | Native async, no FFI, battle-tested |
| Tab isolation | Each tab = independent TCP connection | Simple lifecycle, no channel multiplexing complexity |
| Config location | `~/.rabbit-client.yaml` | Fixed path, no file dialog needed |
| Reading mode | Continuous consumer (subscribe) | Live streaming per user requirement |
| ACK mode | Toggle per read-tab, locked after consumer starts | User choice, safe default |
| Routing key (write) | Always shown, optional (empty = none) | Consistent UI for queue and exchange tabs |
| Message display | Raw text, CSS truncated per row, click-to-expand | User requirement: copy full message separately |
| Cancellation | `CancellationToken` per tab | Clean shutdown of consumer tokio task on tab close |
| Tauri event names | `msg-{tab_id}` (hyphen, not colon) | Colon not safe in Tauri event names cross-platform |
