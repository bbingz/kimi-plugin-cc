// Integration tests for /kimi:continue + /kimi:resume — spawn real companion
// process with overridden $HOME. Covers PRE-CALL error paths only (happy-path
// requires real kimi-cli + credentials and is exercised by manual smoke tests).
// Spec §8.2 specified mock-based coverage; plan v2 review-log documents the
// deviation to spawn-based (simpler, deterministic for error paths).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createHash } from 'node:crypto';

const COMPANION = pathJoin(process.cwd(), 'plugins/kimi/scripts/kimi-companion.mjs');

function runCompanion(args, { home } = {}) {
  const env = { ...process.env };
  if (home) env.HOME = home;
  // Reduce LLM-call risk: if any test accidentally reaches callKimi, the spawn
  // would make a network call. We rely on pre-validation failure to short-circuit.
  const r = spawnSync(process.execPath, [COMPANION, ...args], {
    env, cwd: process.cwd(), encoding: 'utf8', timeout: 15000,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function setupHome() {
  return mkdtempSync(pathJoin(tmpdir(), 'kimi-p2-int-'));
}

function seedKimiJson(home, workDirs) {
  mkdirSync(pathJoin(home, '.kimi'), { recursive: true });
  writeFileSync(pathJoin(home, '.kimi', 'kimi.json'), JSON.stringify({ work_dirs: workDirs }));
}

function seedSession(home, cwd, uuid, contextContent = 'user: hi\n') {
  const md5 = createHash('md5').update(cwd).digest('hex');
  const dir = pathJoin(home, '.kimi', 'sessions', md5, uuid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(pathJoin(dir, 'context.jsonl'), contextContent);
}

// ── /kimi:continue ───────────────────────────────────────────────────────

test('continue: missing prompt → exit 2 usage error', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['continue'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /requires a <prompt>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('continue: no kimi.json → no-work-dir path, exit 1', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['continue', 'hello'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no prior kimi session for this directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('continue: no-work-dir for current cwd → exit 1', () => {
  const home = setupHome();
  try {
    seedKimiJson(home, [{ path: '/other/dir', kaos: 'local', last_session_id: 'aaa' }]);
    const r = runCompanion(['continue', 'hello'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no prior kimi session/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('continue: session-not-found (stale kimi.json) → exit 1', () => {
  const home = setupHome();
  const realpath = realpathSync(process.cwd());
  try {
    seedKimiJson(home, [{ path: realpath, kaos: 'local', last_session_id: '236d5d09-0c3e-49af-b637-d03ae2ca194b' }]);
    const r = runCompanion(['continue', 'hello'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /session .* not found for this directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('continue: rejects flags → exit 2', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['continue', '--foo', 'hi'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not accept flags/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── /kimi:resume ─────────────────────────────────────────────────────────

test('resume: missing sessionId → exit 2', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['resume'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /requires <sessionId>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resume: missing prompt after sessionId → exit 2', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['resume', '236d5d09-0c3e-49af-b637-d03ae2ca194b'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /requires a <prompt>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resume: invalid-uuid (36 dashes) → exit 2', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['resume', '------------------------------------', 'hello'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /invalid sessionId format/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resume: session-not-found (valid UUID, no session) → exit 1', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['resume', '236d5d09-0c3e-49af-b637-d03ae2ca194b', 'hello'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /session 236d5d09.*not found for this directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resume: session-empty (dir exists, context.jsonl zero-byte) → exit 1', () => {
  const home = setupHome();
  const realpath = realpathSync(process.cwd());
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  try {
    seedSession(home, realpath, uuid, '');
    const r = runCompanion(['resume', uuid, 'hello'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /has no stored messages/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resume: rejects flags → exit 2', () => {
  const home = setupHome();
  try {
    const r = runCompanion(['resume', '--foo', 'uuid', 'hi'], { home });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not accept flags/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
