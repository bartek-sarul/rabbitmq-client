# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A cross-platform desktop RabbitMQ client: **Tauri v2 (Rust) + React 19 + TypeScript + Zustand + Vite**.
Users open tabs against queues/exchanges; a tab is either a **Consumer** (streams messages, writes each
to disk as JSON) or a **Publisher** (single or bulk send). Connections live in `~/.rabbit-client.yaml`.

`README.md` is the user-facing / architectural document. This file is the working guide.

## Commands

```bash
npm install          # deps
npm start            # tauri dev  (alias for `tauri dev`)
npm run dev          # vite only, no Rust — useful for pure UI work
npm test             # vitest run (unit tests only, no component tests)
npm run build        # tsc --noEmit-style typecheck + vite build  -> dist/
npm run build:app    # tauri build -> native installers
cd src-tauri && cargo test   # Rust unit tests
```

Before committing, always run `npx tsc --noEmit` **and** `npm test`. `npm run build` runs `tsc` too,
but it is much slower.

## Layout

```
src/
  App.tsx                     shell: Sidebar | TabBar + active tab content
  types.ts                    ALL shared TS types (Tab, Message, AppConfig, …)
  store/useAppStore.ts        the single zustand store
  components/                 one file per feature area, no sub-folders
  utils/                      pure helpers, each with a colocated *.test.ts
src-tauri/src/
  lib.rs                      Tauri builder + invoke_handler registry
  commands.rs                 every #[tauri::command] (large; ~750 lines)
  config.rs                   AppConfig struct, load/validate, YAML
  tab_manager.rs              TabManager + ConnectionPool shared state
```

## Conventions that matter here

- **Styling is inline `style={{…}}` objects**, plus a few shared classes in `src/App.css`
  (`btn-primary`, `btn-secondary`, `input`, `mode-picker*`, `config-conn-item`, `ack-toggle`).
  Colors always come from CSS variables (`var(--bg-primary)`, `var(--text-muted)`,
  `var(--accent-color)`, `var(--danger-color)`, …) — never hardcode a hex.
- **Icons are inline SVG** (feather-style, `stroke="currentColor"`, `strokeWidth` 2–2.5). Copy an
  existing one rather than adding an icon dependency.
- **No component library and no CSS framework.** Keep it that way; the bundle is deliberately small.
- Types go in `src/types.ts`, not next to the component.
- Rust commands return `Result<T, String>`; the frontend surfaces the string via a local
  `setError(String(err))`. Keep that shape.
- Every new `#[tauri::command]` must be added to the `invoke_handler![]` list in `lib.rs`,
  otherwise the frontend call fails at runtime only.

## State model

`src/store/useAppStore.ts` is deliberately small:

```ts
tabs: Tab[]                       // ordered; NOT a record
activeTabId: string | null
messages: Record<string, Message[]>   // newest first, prepended
```

Actions: `addTab`, `removeTab`, `setActiveTab`, `addMessage`, `setMessages`, `clearMessages`,
`updateTab`. All tabs stay mounted and are hidden with `display: none` so a background consumer keeps
its scroll position and message list.

Select narrowly — `useAppStore((s) => s.updateTab)`, never the whole store — because every incoming
message writes to the store.

## Backend model

- `TabManager(Mutex<HashMap<String, ActiveTab>>)` — one entry per open tab, holding the AMQP
  `ack_mode`, target info, and a `CancellationToken`. `stop_consumer_session` cancels and swaps in a
  fresh token so the tab can be restarted.
- `ConnectionPool` — publisher connections keyed by AMQP URL, reused across sends.
- `start_consumer` spawns a Tokio task: connect → `basic_consume` → for each delivery write
  `<folder>/<uuid>.json`, emit `msg-{tabId}`, then ACK or NACK(requeue) per `ack_mode`. Status is
  broadcast on `status-{tabId}` as `connecting | consuming | disconnected`.
- `MessageListenerManager.tsx` is the only place that registers Tauri event listeners. It reconciles
  listeners against consuming read tabs; do not `listen()` anywhere else.

## Config

`~/.rabbit-client.yaml`, auto-created with a sample on first run.
`save_path` is the **message store folder** (where consumed messages are written) — it is not the
config path. The config path itself comes from the `get_config_path` command.

## Behaviour to preserve

- New consumer tabs default to **Consume (ACK)** — `DEFAULT_ACK_MODE` in `Sidebar.tsx`.
- Payload search in `MessageDetailPanel.tsx` uses a hand-rolled unicode-token → `escapeHtml` →
  `<mark>` pipeline with `dangerouslySetInnerHTML`. It is deliberate and performance-critical for
  multi-MB payloads; read the comments before touching it, and never inject unescaped payload text.
- The config editor modal's size and left-panel width persist to `localStorage`
  (`configEditorModalSize.v2`, `configEditorLeftPanelWidth`).

## Releasing

Version lives in **three** places that must be bumped together, or the build produces a mismatched
bundle:

1. `package.json` → `version`
2. `src-tauri/tauri.conf.json` → `version`
3. `src-tauri/Cargo.lock` → the `rabbit-client` package entry (regenerated by `cargo check`)

Then `npm run build:app`, commit, and push to `main` (this repo releases directly from `main`).
