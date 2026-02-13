# Claude Cowork Linux

Reverse-engineered Linux port of Claude Desktop's Cowork (Local Agent Mode).
Replaces macOS VM + Swift addon with direct process spawning on Linux.

## Architecture

```
Claude Desktop (Electron app.asar)
  -> loads stubs/@ant/claude-swift/js/index.js (our stub, replacing macOS Swift VM addon)
  -> linux-loader.js (Electron bootstrapping, platform spoofing, IPC)
  -> cowork/sdk_bridge.js + event_dispatch.js (session management, EIPC bridging)
  -> spawns Claude Code CLI binary (~/.local/bin/claude)
```

## Current Status

- Regular Claude chat: WORKING
- Cowork (Local Agent Mode): WORKING (auth fixed 2026-02-13)
- Session persistence between restarts: PARTIAL (safeStorage unavailable on Linux, tokens not persisted)

## Critical: Auth Flow (DO NOT CHANGE)

The auth flow is fragile. The following behavior is correct and intentional:

1. The asar performs OAuth token exchange using session cookies from claude.ai
2. The asar passes env vars to the CLI via `vm.spawn()`:
   - `CLAUDE_CODE_OAUTH_TOKEN=<token>` -- the real auth token
   - `ANTHROPIC_API_KEY=""` -- intentionally empty
   - `ANTHROPIC_BASE_URL=https://api.anthropic.com`
3. Our stub's `filterEnv()` merges these into the spawned process env
4. The CLI handles `CLAUDE_CODE_OAUTH_TOKEN` through its own internal OAuth code path

### DO NOT:
- Inject `ANTHROPIC_AUTH_TOKEN` from the OAuth token. This bypasses the CLI's
  OAuth handling and sends the token as a raw Bearer header, which the API
  rejects with 401: "OAuth authentication is currently not supported."
- Store the token from `addApprovedOauthToken()`. On macOS the VM's MITM proxy
  uses it; on Linux we don't need it because the asar already passes
  `CLAUDE_CODE_OAUTH_TOKEN` in the spawn env vars.
- Override or delete `CLAUDE_CODE_OAUTH_TOKEN` from the env vars.
- Set `ANTHROPIC_API_KEY` to the OAuth token (different token type).

### Why macOS is different:
On macOS, the CLI runs inside a VM with a MITM proxy that intercepts ALL
outbound HTTPS. The proxy transforms auth headers before forwarding to the API.
On Linux there is no VM or proxy -- the CLI talks directly to api.anthropic.com
and must authenticate via its own `CLAUDE_CODE_OAUTH_TOKEN` code path.

## Key Files

| File | Purpose |
|------|---------|
| `stubs/@ant/claude-swift/js/index.js` | Core stub replacing Swift VM addon. Handles spawn, auth passthrough, mount symlinks, process lifecycle |
| `linux-loader.js` | Electron bootstrap: platform spoofing, IPC setup, session ID generation, browser OAuth flow |
| `cowork/sdk_bridge.js` | SDK bridge for session management, conversation ID extraction, process coordination |
| `cowork/event_dispatch.js` | EIPC event dispatch, handler registration |
| `test-launch.sh` | Launch script with env setup |

## Known Issues

- `safeStorage not available` warning: Electron's safeStorage requires a system keyring
  (gnome-keyring, kwallet, libsecret). Without it, OAuth tokens are not persisted between
  app restarts -- the user must re-authenticate each launch. The token works fine for the
  current session.
- Session ID / UUID persistence between sessions is still WIP.

## Build / Test

```bash
# Launch cowork
./test-launch.sh

# Full log capture
./test-launch.sh 2>&1 | tee ~/cowork-full-log.txt
```

## Code Style Notes

- Use `trace()` for debug logging (writes to claude-swift-trace.log)
- Auth-related env var values must NEVER be logged unredacted (use `redactForLogs()`)
- Security: all spawned commands use `execFile`/`spawn` with argument arrays, never string interpolation
- Paths under `SESSIONS_BASE` are validated with `isPathSafe()` to prevent traversal
