# Codex Plan Mode Streaming (`<proposed_plan>` blocks)

This document explains what makes **Plan mode** special: during streaming, Codex splits assistant output into “normal text” vs “proposed plan text,” and emits dedicated plan events.

Scope: Verified against `/home/zack/dev/codex` source (Rust CLI lineage). Paths/lines may drift across versions.

## High-Level Behavior

When the session is in **Plan** mode (`ModeKind::Plan`), Codex:

1. Watches streaming `OutputTextDelta` events from the model.
2. Parses assistant text looking for `<proposed_plan> ... </proposed_plan>` blocks.
3. Emits:
   - `EventMsg::AgentMessageContentDelta` for normal assistant text.
   - `EventMsg::PlanDelta` for proposed plan text (plus a `TurnItem::Plan` that represents the plan item in the UI).

The design intent is explicitly documented in code:
- `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3926-3929`

## Where Plan Mode Is Activated

Plan mode is checked per turn:
- `plan_mode = turn_context.collaboration_mode.mode == ModeKind::Plan` in `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4229-4231`

If plan mode is active, Codex sets up plan streaming state:
- `let mut plan_mode_state = plan_mode.then(|| PlanModeStreamState::new(...))` in the same block (`/home/zack/dev/codex/codex-rs/core/src/codex.rs:4229-4231`).

## How Streaming Deltas Are Routed

When Codex receives `ResponseEvent::OutputTextDelta(delta)`, it chooses a different path in plan mode:

- If plan mode is active and the current active turn item is an agent message, it parses deltas into segments and calls `handle_plan_segments(...)`.
  - See `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4364-4376`.

- Otherwise (non-plan mode, or not an agent-message item), it emits the normal assistant delta event:
  - See `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4377-4385`.

## Segment Types (Normal vs Proposed Plan)

`handle_plan_segments(...)` drives the splitting behavior:
- `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3929-3990`

Behavior by segment:
- `ProposedPlanSegment::Normal(delta)`
  - emitted as `AgentMessageContentDelta` after handling whitespace buffering and pending-start logic.
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3938-3970`
- `ProposedPlanSegment::ProposedPlanStart`
  - ensures a plan item exists/has started.
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3971-3975`
- `ProposedPlanSegment::ProposedPlanDelta(delta)`
  - emits a `PlanDelta` event and updates the plan item text.
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3976-3986`

## How `PlanDelta` Is Emitted

Plan deltas are emitted via `ProposedPlanItemState::push_delta(...)`:
- `PlanDeltaEvent { thread_id, turn_id, item_id, delta }`
- sent as `EventMsg::PlanDelta(event)`

See:
- `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3861-3876`

## How Plan Items Start/Complete

Plan mode uses a synthetic “plan turn item”:
- It is created with `TurnItem::Plan(PlanItem { id, text })` and started via `emit_turn_item_started(...)`.
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3849-3859`

Plan completion happens when the final assistant message is available:
- Codex rebuilds the final assistant text, extracts the `<proposed_plan>` content, and completes the plan item.
  - `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4024-4049`

## What This Means Operationally

1. Plan mode is primarily a *streaming/UI protocol feature*.
2. It does not “clear context” by itself; assistant messages are still recorded into history after being handled:
   - See `sess.record_conversation_items(...)` in the plan-mode completion path at `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4139-4140`.

## Debug Checklist

If plan streaming looks wrong, check:

1. Are you actually in `ModeKind::Plan` for the turn?
   - `TurnStartedEvent` includes `collaboration_mode_kind` in `/home/zack/dev/codex/codex-rs/protocol/src/protocol.rs:1116-1122`.
2. Are `PlanDelta` events emitted?
   - emission site `/home/zack/dev/codex/codex-rs/core/src/codex.rs:3868-3875`.
3. Are deltas being parsed into segments?
   - routing site `/home/zack/dev/codex/codex-rs/core/src/codex.rs:4364-4376`.

