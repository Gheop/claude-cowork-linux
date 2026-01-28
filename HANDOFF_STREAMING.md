# Handoff: Claude Desktop Linux Streaming/Buffering Investigation

**Date**: 2026-01-27
**Status**: Needs Investigation
**Priority**: High

---

## Problem Statement

Claude Desktop on Linux exhibits **output buffering** where messages and file operations come in batches rather than streaming in real-time. Users report the UI appearing "hung" for extended periods, then suddenly 10+ messages appear at once.

---

## What Was Tried (and Failed)

### Attempt 1: stdbuf wrapper
Added `stdbuf -oL -eL` to force line-buffered output:

```javascript
// In stubs/@ant/claude-swift/js/index.js spawn()
bwrapArgs.push('--', 'stdbuf', '-oL', '-eL', hostCommand, ...(args || []));
```

**Result**: Caused crashes with error:
```
Error: Render frame was disposed before WebFrameMain could be accessed
```

The stdbuf wrapper interfered with Electron's IPC communication, causing the renderer process to disconnect.

### Attempt 2: stdbuf on Electron launch
```bash
exec stdbuf -oL -eL electron linux-loader.js ... 2>&1 | stdbuf -oL tee -a ...
```

**Result**: Same crash - stdbuf doesn't play well with Electron's internal communication.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process                                        │
│   └── linux-loader.js (platform spoofing, module intercept) │
│         └── @ant/claude-swift stub                           │
│               └── spawn() with bwrap                         │
│                     └── Claude Code binary (inside sandbox)  │
│                           ├── stdout → vm._onStdout callback │
│                           └── stderr → vm._onStderr callback │
└─────────────────────────────────────────────────────────────┘
```

### Key Files
- `stubs/@ant/claude-swift/js/index.js` - Main stub with spawn(), writeStdin(), kill()
- `linux-app-extracted/` - Extracted Claude Desktop app (repacked to asar on launch)
- `test-launch.sh` - Development launcher

### Spawn Configuration
```javascript
const proc = nodeSpawn('bwrap', bwrapArgs, {
  env: vmEnv,
  stdio: ['pipe', 'pipe', 'pipe']
});

if (proc.stdout) {
  proc.stdout.on('data', (data) => {
    if (vm._onStdout) vm._onStdout(id, data.toString('utf-8'));
  });
}
```

---

## Potential Solutions to Investigate

### 1. Node.js Stream Options
Try setting encoding or using different stream modes:
```javascript
proc.stdout.setEncoding('utf-8');
// or
proc.stdout.on('readable', () => {
  let chunk;
  while ((chunk = proc.stdout.read()) !== null) {
    vm._onStdout(id, chunk);
  }
});
```

### 2. PTY (Pseudo-Terminal)
Use `node-pty` instead of regular spawn to get TTY-like behavior:
```javascript
const pty = require('node-pty');
const proc = pty.spawn('bwrap', bwrapArgs, { /* options */ });
```
- Requires adding node-pty dependency
- May solve buffering since PTYs are line-buffered by default

### 3. Environment Variables
Set unbuffered mode via environment:
```javascript
const vmEnv = {
  ...existingEnv,
  PYTHONUNBUFFERED: '1',
  NODE_OPTIONS: '--no-buffering', // If such option exists
  FORCE_COLOR: '1', // Sometimes helps with TTY detection
};
```

### 4. Flush After Each Write
If Claude Code has control over its output, ensure it flushes stdout after each message. But we don't control Claude Code's source.

### 5. Check if Issue is in Claude Code Binary
The Claude Code binary itself might be buffering. Check:
- Does it detect it's not in a TTY and buffer?
- Is there an env var to force unbuffered mode?

### 6. IPC Instead of stdio
Instead of piping stdout/stderr, use a different communication channel:
- Unix socket
- Named pipe (FIFO)
- Shared memory

---

## How to Test

1. **Launch with debug**:
   ```bash
   CLAUDE_TRACE=1 ./test-launch.sh
   ```

2. **Watch trace log**:
   ```bash
   tail -f ~/.local/share/claude-cowork/logs/claude-swift-trace.log
   ```

3. **Test streaming**:
   - Open Claude Desktop
   - Select a folder (e.g., ~/dev/claude-cowork-linux)
   - Ask Claude to do something with multiple steps
   - Observe if output streams or batches

4. **Check timestamps in trace**:
   - Look for gaps between `writeStdin()` calls and response data
   - Compare timing of `proc.stdout.on('data')` events

---

## Other Open Issues

### 1. UI Freeze on Long Operations
The UI sometimes freezes showing a timer (e.g., "51s") while work completes in background. May be related to buffering or separate React state issue.

### 2. Unknown SDK Message Types
Console spam with:
```
[LOCAL_SESSION] unknown sdk message type: queue-operation
```
These should either be handled or suppressed.

### 3. install-oneclick.sh Refactoring (NOT STARTED)
Need to refactor to download stubs from GitHub instead of embedding inline (~380 lines of JS).

**Current state**: Lines 355-735 contain inline SWIFTSTUB and NATIVESTUB heredocs.

**Required changes**:
1. Add to config section:
   ```bash
   REPO_BASE="https://raw.githubusercontent.com/johnzfitch/claude-cowork-linux/master"
   SWIFT_STUB_URL="${REPO_BASE}/stubs/@ant/claude-swift/js/index.js"
   NATIVE_STUB_URL="${REPO_BASE}/stubs/@ant/claude-native/index.js"
   ```

2. Replace `create_swift_stub()` and `create_native_stub()` (lines 355-738) with:
   ```bash
   download_swift_stub() {
       local stub_dir="$1"
       mkdir -p "$stub_dir"
       curl -fsSL "$SWIFT_STUB_URL" -o "$stub_dir/index.js" || die "Failed to download Swift stub"
   }

   download_native_stub() {
       local stub_dir="$1"
       mkdir -p "$stub_dir"
       curl -fsSL "$NATIVE_STUB_URL" -o "$stub_dir/index.js" || die "Failed to download Native stub"
   }
   ```

3. Update call sites (~line 969) from `create_*` to `download_*`

### 4. File Opening Not Working
User reports "This file type cannot be opened" when clicking files in the UI.

**Possible causes**:
- Path translation issue in `translateVmPathToHost()`
- xdg-open not finding appropriate handler
- App expecting different return format from openFile()
- File type not registered with desktop environment

**To investigate**:
```bash
CLAUDE_TRACE=1 claude-cowork
# Then click a file and check:
grep -i openFile ~/.local/share/claude-cowork/logs/claude-swift-trace.log
```

---

## Files Modified Recently

| File | Changes |
|------|---------|
| `stubs/@ant/claude-swift/js/index.js` | writeStdin returns Promise, stdbuf reverted |
| `test-launch.sh` | Conditional asar repack, stdbuf reverted |
| `install.sh` | Launcher flags, stdbuf reverted |
| `install-oneclick.sh` | Added download functions (incomplete) |

---

## Environment

- **OS**: Arch Linux (kernel 6.17.9)
- **Desktop**: Hyprland (Wayland)
- **Node**: 22.x
- **Electron**: From AppImage (Chromium 144)
- **Claude Desktop**: 1.1.799

---

## Success Criteria

1. Output streams in real-time (no multi-second batching)
2. No crashes or IPC errors
3. UI remains responsive during operations
4. Solution works without additional system dependencies

---

## Commands for Quick Context

```bash
# View current stub
cat stubs/@ant/claude-swift/js/index.js | head -100

# Check spawn implementation
grep -A 50 "spawn:" stubs/@ant/claude-swift/js/index.js

# View recent traces
tail -50 ~/.local/share/claude-cowork/logs/claude-swift-trace.log

# Test launch
CLAUDE_TRACE=1 ./test-launch.sh
```
