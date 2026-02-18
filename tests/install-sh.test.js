/**
 * Static analysis tests for install.sh
 *
 * These validate the install script structure without actually running it.
 * Run with: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_SH = fs.readFileSync(
  path.join(__dirname, '..', 'install.sh'),
  'utf8'
);

describe('install.sh structure', () => {
  it('starts with bash shebang', () => {
    assert.ok(INSTALL_SH.startsWith('#!/bin/bash'));
  });

  it('uses set -e for error handling', () => {
    assert.ok(INSTALL_SH.includes('set -e'));
  });

  it('has all 9 installation steps', () => {
    for (let i = 1; i <= 9; i++) {
      assert.ok(
        INSTALL_SH.includes(`[${i}/9]`),
        `Missing step [${i}/9]`
      );
    }
  });
});

describe('install.sh DMG detection', () => {
  it('accepts $1 argument for DMG path', () => {
    assert.ok(INSTALL_SH.includes('"$1"'));
  });

  it('searches for Claude*.dmg pattern', () => {
    assert.ok(INSTALL_SH.includes('Claude*.dmg'));
  });

  it('shows usage on failure', () => {
    assert.ok(INSTALL_SH.includes('Usage:'));
  });
});

describe('install.sh i18n handling', () => {
  it('creates app/resources/i18n directory', () => {
    assert.ok(INSTALL_SH.includes('app/resources/i18n'));
  });

  it('copies locale JSON files', () => {
    assert.ok(INSTALL_SH.includes('Installing i18n locale files'));
  });
});

describe('install.sh symlink', () => {
  it('uses configurable SYMLINK_NAME', () => {
    assert.ok(INSTALL_SH.includes('SYMLINK_NAME'));
  });

  it('defaults SYMLINK_NAME to cowork', () => {
    assert.ok(INSTALL_SH.includes('SYMLINK_NAME:-cowork'));
  });

  it('creates symlink in /usr/local/bin', () => {
    assert.ok(INSTALL_SH.includes('/usr/local/bin/$SYMLINK_NAME'));
  });
});

describe('install.sh security', () => {
  it('does not contain hardcoded user home paths', () => {
    const lines = INSTALL_SH.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (line.trim().startsWith('#')) continue;
      assert.ok(
        !line.includes('/home/zack') && !line.includes('/home/sib'),
        `Line ${i + 1} contains hardcoded user path: ${line.trim()}`
      );
    }
  });

  it('sets secure permissions on user directories', () => {
    assert.ok(INSTALL_SH.includes('chmod 700'));
  });
});
