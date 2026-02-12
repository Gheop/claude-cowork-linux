# Codex Context: History vs UI Indicators vs Threads

This document clarifies what “context” means in Codex, because multiple layers use the term differently.

Scope: Verified against local checkout `/home/zack/dev/codex` (Rust CLI lineage). Paths/lines may drift across versions.

## The Three Layers

### 1) Model-Facing Conversation History (What the Model Sees)

This is the real “conversation context” in the sense most people care about.

Codex stores it in memory as a `ContextManager` hanging off session state:
- `SessionState { history: ContextManager, ... }` in `/home/zack/dev/codex/codex-rs/core/src/state/session.rs:15-18`

When Codex records conversation items, it appends to this history:
- `record_conversation_items()` calls `record_into_history()` in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1768-1778`
- `record_into_history()` records into history with truncation policy in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1816-1824`

Important: switching Plan/Code/Execute modes updates turn defaults but does not clear `SessionState.history`.

### 2) UI “Context Window” Indicator (A Display of Token Usage)

The TUI has a “context usage” indicator that is based on token-count events.

That indicator can be reset without any “memory wipe” in the underlying session history.

There is a test that explicitly documents this behavior:
- “Receiving a TokenCount event without usage clears the context indicator.”
- See `/home/zack/dev/codex/codex-rs/tui/src/chatwidget/tests.rs:635-660`

So if you see the UI indicator disappear/reset, that is not proof that the session history was cleared.

### 3) Thread/Session State and “Starting Fresh”

If you actually want to start fresh, you need a new thread/session (or you need to compact/replace history).

Examples of operations that *do* change what the model sees:

1. History replacement:
   - `Session::replace_history(...)` replaces the recorded items
   - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1842-1845`

2. Compaction / reconstruction:
   - `reconstruct_history_from_rollout(...)` may rebuild the history from rollout items and compaction markers
   - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1780-1814`

3. Thread rollback:
   - rollback drops the last N user turns during reconstruction
   - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1807-1809`

## What Plan → Code Mode Switch Does (In Context Terms)

Mode switching changes the session’s “collaboration mode” configuration:

- `ModeKind` lives in `/home/zack/dev/codex/codex-rs/protocol/src/config_types.rs:168-180`
- that mode is copied into each `TurnContext` at `/home/zack/dev/codex/codex-rs/core/src/codex.rs:714-723`

In Plan mode, streaming is treated differently (normal deltas vs plan deltas), but the assistant messages are still recorded into history when completed (see `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4139-4140`).

## FAQ

### Does switching modes clear context?

No. It updates configuration for subsequent turns; it does not clear `SessionState.history`.

The underlying history is separate from session configuration:
- history: `/home/zack/dev/codex/codex-rs/core/src/state/session.rs:15-18`
- config apply: `/home/zack/dev/codex/codex-rs/core/src/codex.rs:615-639`

### Why does the “context” indicator reset sometimes?

Because the UI indicator is driven by token-count events, and a `TokenCount` event with `info: None` clears it:
- `/home/zack/dev/codex/codex-rs/tui/src/chatwidget/tests.rs:635-660`

That’s a UI display state change, not necessarily a history change.

