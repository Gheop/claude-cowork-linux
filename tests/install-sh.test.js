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
  it('searches for Claude DMG files', () => {
    assert.ok(INSTALL_SH.includes('.dmg'));
  });

  it('reports when no DMG found', () => {
    assert.ok(INSTALL_SH.includes('No Claude DMG'));
  });
});

describe('install.sh locale handling', () => {
  it('installs locale files to Electron directories', () => {
    assert.ok(INSTALL_SH.includes('locale files'));
  });

  it('copies JSON locale files from Claude resources', () => {
    assert.ok(INSTALL_SH.includes('*.json'));
  });
});

describe('install.sh symlink', () => {
  it('creates symlink in /usr/local/bin', () => {
    assert.ok(INSTALL_SH.includes('/usr/local/bin/'));
  });

  it('links to Claude.app launcher', () => {
    assert.ok(INSTALL_SH.includes('/Applications/Claude.app/Contents/MacOS/Claude'));
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
