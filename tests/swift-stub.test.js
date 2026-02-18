/**
 * Unit tests for the claude-swift Linux stub
 *
 * Tests the pure functions extracted from the stub without
 * requiring Electron or the full app runtime.
 *
 * Run with: node --test tests/
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ============================================================
// Extract testable functions from the stub source
// We can't require() the stub directly (it has side-effects
// like console.log and fs.mkdirSync at module scope), so we
// eval the pure functions in isolation.
// ============================================================

const STUB_PATH = path.join(__dirname, '..', 'stubs', '@ant', 'claude-swift', 'js', 'index.js');
const stubSource = fs.readFileSync(STUB_PATH, 'utf8');

// Extract function bodies by regex - these are self-contained pure functions
function extractFunction(source, name) {
  // Match "function name(...) {" and capture until balanced braces
  const startPattern = new RegExp(`function ${name}\\s*\\(`);
  const match = startPattern.exec(source);
  if (!match) throw new Error(`Function ${name} not found in stub`);

  let depth = 0;
  let start = match.index;
  let inStr = false;
  let strChar = '';

  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (inStr) {
      if (ch === strChar && prev !== '\\') inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      strChar = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.substring(start, i + 1);
      }
    }
  }
  throw new Error(`Could not find end of function ${name}`);
}

// Build a mini-module with testable functions
const testModule = new Function('path', 'os', 'fs', 'crypto', `
  ${extractFunction(stubSource, 'redactForLogs')}
  ${extractFunction(stubSource, 'isPathSafe')}
  ${extractFunction(stubSource, 'parseSemver')}
  ${extractFunction(stubSource, 'compareSemverDesc')}
  function trace() {} // no-op for tests
  ${extractFunction(stubSource, 'extractSessionName')}
  ${extractFunction(stubSource, 'generateUUID')}

  const ENV_ALLOWLIST = [
    'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS',
    'NODE_ENV', 'ELECTRON_RUN_AS_NODE',
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'
  ];

  ${extractFunction(stubSource, 'filterEnv')}

  return {
    redactForLogs,
    isPathSafe,
    parseSemver,
    compareSemverDesc,
    filterEnv,
    extractSessionName,
    generateUUID,
  };
`)(path, os, fs, require('crypto'));

// ============================================================
// Tests
// ============================================================

describe('redactForLogs', () => {
  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer sk-ant-1234567890abcdef';
    const result = testModule.redactForLogs(input);
    assert.ok(!result.includes('sk-ant-1234567890abcdef'));
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts JSON api_key fields', () => {
    const input = '{"api_key": "secret-key-123"}';
    const result = testModule.redactForLogs(input);
    assert.ok(!result.includes('secret-key-123'));
  });

  it('redacts ANTHROPIC_API_KEY env var', () => {
    const input = 'ANTHROPIC_API_KEY=sk-ant-abc123';
    const result = testModule.redactForLogs(input);
    assert.ok(!result.includes('sk-ant-abc123'));
  });

  it('redacts cookies', () => {
    const input = 'cookie: sessionId=abc123xyz';
    const result = testModule.redactForLogs(input);
    assert.ok(!result.includes('sessionId=abc123xyz'));
  });

  it('leaves normal text untouched', () => {
    const input = 'Starting Claude Desktop v1.23.26';
    assert.equal(testModule.redactForLogs(input), input);
  });
});

describe('isPathSafe', () => {
  it('allows paths within base', () => {
    assert.ok(testModule.isPathSafe('/home/user', 'subdir/file.txt'));
  });

  it('allows the base path itself', () => {
    assert.ok(testModule.isPathSafe('/home/user', '.'));
  });

  it('rejects path traversal with ..', () => {
    assert.ok(!testModule.isPathSafe('/home/user/data', '../../etc/passwd'));
  });

  it('rejects absolute paths outside base', () => {
    assert.ok(!testModule.isPathSafe('/home/user/data', '/etc/passwd'));
  });
});

describe('parseSemver', () => {
  it('parses valid semver', () => {
    assert.deepEqual(testModule.parseSemver('2.1.41'), [2, 1, 41]);
  });

  it('parses 0.0.0', () => {
    assert.deepEqual(testModule.parseSemver('0.0.0'), [0, 0, 0]);
  });

  it('returns null for invalid input', () => {
    assert.equal(testModule.parseSemver('not-a-version'), null);
    assert.equal(testModule.parseSemver('1.2'), null);
    assert.equal(testModule.parseSemver(''), null);
    assert.equal(testModule.parseSemver(null), null);
  });
});

describe('compareSemverDesc', () => {
  it('sorts higher versions first (descending)', () => {
    assert.ok(testModule.compareSemverDesc('2.1.41', '2.1.40') < 0);
  });

  it('returns 0 for equal versions', () => {
    assert.equal(testModule.compareSemverDesc('1.0.0', '1.0.0'), 0);
  });

  it('sorts major version higher', () => {
    assert.ok(testModule.compareSemverDesc('3.0.0', '2.9.9') < 0);
  });

  it('handles null/invalid gracefully', () => {
    assert.ok(testModule.compareSemverDesc('1.0.0', 'invalid') < 0);
    assert.ok(testModule.compareSemverDesc('invalid', '1.0.0') > 0);
    assert.equal(testModule.compareSemverDesc('invalid', 'invalid'), 0);
  });
});

describe('filterEnv', () => {
  it('only passes allowlisted vars', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      SECRET_KEY: 'should-not-pass',
      SSH_AUTH_SOCK: '/tmp/ssh-agent',
      AWS_SECRET_ACCESS_KEY: 'nope',
    };
    const filtered = testModule.filterEnv(env, null);
    assert.equal(filtered.PATH, '/usr/bin');
    assert.equal(filtered.HOME, '/home/user');
    assert.equal(filtered.SECRET_KEY, undefined);
    assert.equal(filtered.SSH_AUTH_SOCK, undefined);
    assert.equal(filtered.AWS_SECRET_ACCESS_KEY, undefined);
  });

  it('merges additional env vars', () => {
    const env = { PATH: '/usr/bin' };
    const additional = { CUSTOM_VAR: 'value' };
    const filtered = testModule.filterEnv(env, additional);
    assert.equal(filtered.CUSTOM_VAR, 'value');
  });

  it('handles null additional env', () => {
    const env = { HOME: '/home/user' };
    const filtered = testModule.filterEnv(env, null);
    assert.equal(filtered.HOME, '/home/user');
  });
});

describe('extractSessionName', () => {
  it('extracts from args with /sessions/ path', () => {
    const args = ['--config', '/sessions/abc-123/mnt/.claude/config'];
    assert.equal(testModule.extractSessionName('proc', args), 'abc-123');
  });

  it('falls back to processName', () => {
    const args = ['--flag', 'value'];
    assert.equal(testModule.extractSessionName('cli-abcdef', args), 'cli-abcdef');
  });

  it('falls back to processName with no args', () => {
    assert.equal(testModule.extractSessionName('cli-xyz', null), 'cli-xyz');
  });
});

describe('generateUUID', () => {
  it('returns a valid UUID v4 format', () => {
    const uuid = testModule.generateUUID();
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique values', () => {
    const a = testModule.generateUUID();
    const b = testModule.generateUUID();
    assert.notEqual(a, b);
  });
});

describe('stub command allowlist', () => {
  it('accepts /usr/local/bin/claude', () => {
    // Verify the pattern exists in the source
    assert.ok(stubSource.includes("command === '/usr/local/bin/claude'"));
  });

  it('accepts /usr/local/bin path', () => {
    assert.ok(stubSource.includes("/usr/local/bin/claude"));
  });

  it('blocks unexpected commands', () => {
    assert.ok(stubSource.includes('Unexpected command blocked'));
  });
});

describe('stub module structure', () => {
  it('exports as EventEmitter', () => {
    assert.ok(stubSource.includes('extends EventEmitter'));
  });

  it('has setEventCallbacks on vm', () => {
    assert.ok(stubSource.includes('setEventCallbacks'));
  });

  it('has spawn method', () => {
    assert.ok(stubSource.includes('spawn('));
  });

  it('has isGuestConnected method', () => {
    assert.ok(stubSource.includes('isGuestConnected'));
  });
});
