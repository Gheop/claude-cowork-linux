# Codex Collaboration Modes (Plan, Code, Execute, Pair, Custom)

This document explains what Codex “collaboration modes” do, what they *do not* do, and where to verify behavior in code.

Scope: Verified against the local Codex checkout at `/home/zack/dev/codex` (Rust CLI lineage), using code as the source of truth. File/line references may drift across versions.

## Quick Answer (The Common Confusion)

Switching **Plan → Code** mode does **not** clear the conversation history/context by itself.

What it does instead:
- changes the session’s **mode** (and therefore some UI + streaming behavior)
- can change the **model / reasoning effort / dev-instructions** defaults (because those live under collaboration mode settings)
- can gate which tools are allowed in the current mode (example: `request_user_input`)

## Terms

Codex uses “mode” as a *session configuration knob*, not as a “new chat / wipe memory” operation.

Key types and where they live:
- `ModeKind` and `CollaborationMode` are defined in `/home/zack/dev/codex/codex-rs/protocol/src/config_types.rs` (see `ModeKind` at lines 168-180 and `CollaborationMode` at lines 182-188).
- `OverrideTurnContext` is defined in `/home/zack/dev/codex/codex-rs/protocol/src/protocol.rs` (see lines 145-151 for the statement that it does not enqueue input, it only updates defaults).

## What Each Mode Is For

Codex ships per-mode behavior templates under:

- `/home/zack/dev/codex/codex-rs/core/templates/collaboration_mode/`

These templates are model-facing instructions that describe how the assistant should behave in each mode.

### Code

“Code” is the normal coding-agent workflow (implementing, editing files, running commands subject to approvals/sandboxing).

### Plan

“Plan” is a strict planning workflow intended to produce a decision-complete plan. It is explicitly non-executing for repo-tracked changes and it uses `<proposed_plan>...</proposed_plan>` blocks for special plan rendering/streaming.

Reference: `/home/zack/dev/codex/codex-rs/core/templates/collaboration_mode/plan.md`

### PairProgramming

“PairProgramming” is a collaborative, interactive mode: keep steps smaller, check alignment, and invite decisions instead of executing large chunks unilaterally.

Reference: `/home/zack/dev/codex/codex-rs/core/templates/collaboration_mode/pair_programming.md`

Tool gating note: `request_user_input` is allowed in `Plan` and `PairProgramming` only (see `/home/zack/dev/codex/codex-rs/core/src/tools/handlers/request_user_input.rs:39-50`).

### Execute

“Execute” is execution-forward: make reasonable assumptions when details are missing, proceed without asking questions, and report progress as you go.

Reference: `/home/zack/dev/codex/codex-rs/core/templates/collaboration_mode/execute.md`

### Custom

“Custom” is a catch-all mode for non-preset configurations. In practice:

- It is not treated as Plan mode for streaming, so `<proposed_plan>` tags will not be split into plan events (Plan-only behavior is gated by `ModeKind::Plan`).
- The TUI does not show a label/indicator for `Custom` (see `/home/zack/dev/codex/codex-rs/tui/src/chatwidget.rs:5429-5453`).
- Tool gating treats it like other non-Plan modes (example: `request_user_input` rejects in Custom, per the same handler).

## What Changes When You Switch Modes

### 1) The Session’s Collaboration Mode Kind

The session’s collaboration mode is stored in `SessionConfiguration` and copied into each `TurnContext`:
- `TurnContext { collaboration_mode: session_configuration.collaboration_mode.clone(), ... }` is constructed in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:714-734`.

### 2) The Model + Reasoning Settings Used For Turns

The collaboration mode also contains per-mode settings (model slug, reasoning effort, optional developer instructions):
- `CollaborationMode::model()` and `CollaborationMode::reasoning_effort()` are in `/home/zack/dev/codex/codex-rs/protocol/src/config_types.rs:196-202`.
- Those values are fed into the `ModelClient` when a turn context is created in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:695-706`.

So switching modes can indirectly change “how the model behaves” *without* resetting history.

### 3) Tool Availability (Mode-Gating)

Some tools are only valid in certain modes.

Example: `request_user_input` is only allowed in `Plan` or `PairProgramming`:
- The gate is enforced in `/home/zack/dev/codex/codex-rs/core/src/tools/handlers/request_user_input.rs:39-50`.

### 4) Streaming/UI Behavior (Plan Mode Is Special)

Plan mode changes how streaming output is interpreted and emitted:
- When `plan_mode = turn_context.collaboration_mode.mode == ModeKind::Plan` in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4229-4231`, Codex splits streaming output into:
  - normal assistant deltas (`EventMsg::AgentMessageContentDelta`)
  - proposed plan deltas (`EventMsg::PlanDelta`) + a `TurnItem::Plan`
- The intention is documented directly in code in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3926-3929`.

For the details of `<proposed_plan>` parsing and the exact event flow, see `docs/codex-plan-mode-streaming.md`.

## What Does *Not* Change When You Switch Modes

### 1) Conversation History Is Not Cleared

The session’s conversation history is stored on `SessionState.history`:
- `SessionState { history: ContextManager, ... }` in `/home/zack/dev/codex/codex-rs/core/src/state/session.rs:15-18`.

Updating collaboration mode updates only the session configuration:
- `SessionConfiguration::apply()` updates `collaboration_mode` and other config fields, but does not touch `history`. See `/home/zack/dev/codex/codex-rs/core/src/codex.rs:615-639`.

## When Context *Actually* Changes

Switching modes does not clear history, but other operations can reduce or rebuild it.

Common cases:
- Compaction can rebuild/replace history when applying a compacted transcript.
  - Reconstruction logic is in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1780-1814`.
  - `replace_history()` is exposed on `Session` at `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1842-1845`.
- Thread rollback drops user turns (also handled during reconstruction):
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:1807-1809`.

## A Practical Mental Model

If you’re trying to reason about “does Codex remember X?”:
- History (what the model sees) is the `ContextManager` recorded in `SessionState.history`.
- Collaboration mode is a turn-default configuration: it changes how the next turn is executed and streamed.
- A mode switch is closer to “change the working style” than “start a fresh chat.”
