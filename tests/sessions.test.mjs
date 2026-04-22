import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  md5CwdPath,
  sanitizeForStderr,
  UUID_RE,
  mapSessionReason,
  resolveContinueTarget,
  validateResumeTarget,
} from '../plugins/kimi/scripts/lib/sessions.mjs';

// ── md5CwdPath + UUID_RE + sanitize (Task 1) ──────────────────────────

test('md5CwdPath: known-value pinning — /tmp/foo', () => {
  assert.equal(md5CwdPath('/tmp/foo'), 'bc5487f033a0af65dff1ff0bd4000d75');
});

test('md5CwdPath: known-value pinning — /private/tmp/kimi-probe-v4-1776894306 (from probe v4)', () => {
  assert.equal(
    md5CwdPath('/private/tmp/kimi-probe-v4-1776894306'),
    '4be2dad86b97966a68e6805446b784fa'
  );
});

test('md5CwdPath: empty-string input produces md5 of empty string', () => {
  assert.equal(md5CwdPath(''), 'd41d8cd98f00b204e9800998ecf8427e');
});

test('UUID_RE accepts RFC 4122 v4 UUID', () => {
  assert.match('236d5d09-0c3e-49af-b637-d03ae2ca194b', UUID_RE);
});

test('UUID_RE rejects 36 dashes', () => {
  assert.doesNotMatch('------------------------------------', UUID_RE);
});

test('UUID_RE rejects 36 chars of hex with wrong dash placement', () => {
  assert.doesNotMatch('236d5d090c3e49afb637d03ae2ca194b----', UUID_RE);
});

test('UUID_RE rejects non-hex char at position 35', () => {
  assert.doesNotMatch('236d5d09-0c3e-49af-b637-d03ae2ca194g', UUID_RE);
});

test('UUID_RE accepts case-insensitive hex', () => {
  assert.match('236D5D09-0C3E-49AF-B637-D03AE2CA194B', UUID_RE);
});

test('sanitizeForStderr strips ANSI CSI sequences', () => {
  assert.equal(sanitizeForStderr('foo\x1b[2Jbar'), 'foobar');
});

test('sanitizeForStderr strips raw ESC + control chars', () => {
  assert.equal(sanitizeForStderr('a\x00b\x1bc\nd'), 'abcd');
});

test('sanitizeForStderr returns ? for null / undefined', () => {
  assert.equal(sanitizeForStderr(null), '?');
  assert.equal(sanitizeForStderr(undefined), '?');
});

test('sanitizeForStderr coerces non-string to string', () => {
  assert.equal(sanitizeForStderr(42), '42');
});

// ── mapSessionReason (Task 2) ───────────────────────────────────────────

test('mapSessionReason: no-work-dir fills {cwdBase}', () => {
  const er = mapSessionReason('no-work-dir', { realCwd: '/Users/bing/-Code-/foo' });
  assert.equal(er.ok, false);
  assert.equal(er.kind, 'sessions');
  assert.equal(er.status, 1);
  assert.equal(er.error, 'Error: no prior kimi session for this directory (foo). Use /kimi:ask to start one.');
  assert.equal(er.detail.reason, 'no-work-dir');
  assert.equal(er.detail.realCwd, '/Users/bing/-Code-/foo');
});

test('mapSessionReason: kimi-json-missing uses same template as no-work-dir', () => {
  const er = mapSessionReason('kimi-json-missing', { realCwd: '/tmp/foo' });
  assert.equal(er.error, 'Error: no prior kimi session for this directory (foo). Use /kimi:ask to start one.');
});

test('mapSessionReason: no-last-session uses same template as no-work-dir', () => {
  const er = mapSessionReason('no-last-session', { realCwd: '/tmp/foo' });
  assert.equal(er.error, 'Error: no prior kimi session for this directory (foo). Use /kimi:ask to start one.');
});

test('mapSessionReason: kimi-json-malformed — status 1, no substitution', () => {
  const er = mapSessionReason('kimi-json-malformed', { parseError: 'Unexpected token' });
  assert.equal(er.status, 1);
  assert.equal(er.error, 'Error: ~/.kimi/kimi.json is malformed; cannot resolve last session.');
});

test('mapSessionReason: session-not-found fills {sessionId} + {cwdBase}', () => {
  const er = mapSessionReason('session-not-found', {
    realCwd: '/Users/bing/-Code-/xyz',
    sessionId: '236d5d09-0c3e-49af-b637-d03ae2ca194b',
  });
  assert.equal(er.status, 1);
  assert.equal(er.error, 'Error: session 236d5d09-0c3e-49af-b637-d03ae2ca194b not found for this directory (xyz).');
});

test('mapSessionReason: session-empty fills {sessionId}', () => {
  const er = mapSessionReason('session-empty', { sessionId: 'aaa' });
  assert.equal(er.error, 'Error: session aaa has no stored messages; cannot resume.');
});

test('mapSessionReason: invalid-uuid — default exit 2 (resume usage error)', () => {
  const er = mapSessionReason('invalid-uuid', { candidateId: 'not-a-uuid' });
  assert.equal(er.status, 2);
  assert.equal(er.error, 'Error: invalid sessionId format; expected UUID.');
});

test('mapSessionReason: invalid-uuid with commandOrigin=continue — exit 1', () => {
  const er = mapSessionReason('invalid-uuid', { candidateId: 'not-a-uuid' }, { commandOrigin: 'continue' });
  assert.equal(er.status, 1);
  assert.equal(er.error, 'Error: invalid sessionId format; expected UUID.');
});

test('mapSessionReason: fs-error fills {errCode}', () => {
  const er = mapSessionReason('fs-error', { errCode: 'EACCES', errMessage: 'permission denied', path: '/x' });
  assert.equal(er.status, 1);
  assert.equal(er.error, 'Error: filesystem access failed — EACCES. Check permissions on ~/.kimi/.');
});

test('mapSessionReason: unknown reason → internal-error fallback', () => {
  const er = mapSessionReason('not-a-real-reason', {});
  assert.equal(er.status, 1);
  assert.equal(er.error, `Error: internal — unknown session reason 'not-a-real-reason'.`);
});

test('mapSessionReason: null realCwd falls back to ? not literal "null"', () => {
  const er = mapSessionReason('no-work-dir', { realCwd: null });
  assert.equal(er.error, 'Error: no prior kimi session for this directory (?). Use /kimi:ask to start one.');
});

test('mapSessionReason: undefined ctx — no crash', () => {
  const er = mapSessionReason('no-work-dir', undefined);
  assert.equal(er.error, 'Error: no prior kimi session for this directory (?). Use /kimi:ask to start one.');
});

test('mapSessionReason: ANSI escape in cwd basename is stripped', () => {
  const er = mapSessionReason('no-work-dir', { realCwd: '/tmp/\x1b[2Jevil' });
  assert.equal(er.error, 'Error: no prior kimi session for this directory (evil). Use /kimi:ask to start one.');
});

// ── resolveContinueTarget (Task 3) ──────────────────────────────────────

function fakeHome(kimiJsonContent) {
  const origHome = process.env.HOME;
  let home;
  try {
    home = mkdtempSync(pathJoin(tmpdir(), 'kimi-test-'));
    process.env.HOME = home;
    if (kimiJsonContent !== undefined) {
      mkdirSync(pathJoin(home, '.kimi'), { recursive: true });
      const body = typeof kimiJsonContent === 'string'
        ? kimiJsonContent
        : JSON.stringify(kimiJsonContent);
      writeFileSync(pathJoin(home, '.kimi', 'kimi.json'), body);
    }
  } catch (e) {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (home) { try { rmSync(home, { recursive: true, force: true }); } catch {} }
    throw e;
  }
  return {
    home,
    restore() {
      try { chmodSync(pathJoin(home, '.kimi', 'kimi.json'), 0o644); } catch {}
      rmSync(home, { recursive: true, force: true });
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    },
  };
}

test('resolveContinueTarget: happy path — matching path + kaos', () => {
  const fh = fakeHome({ work_dirs: [
    { path: '/other', kaos: 'local', last_session_id: 'aaa' },
    { path: '/x/cwd', kaos: 'local', last_session_id: 'bbb' },
  ]});
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.deepEqual(r, { ok: true, sessionId: 'bbb' });
  } finally { fh.restore(); }
});

test('resolveContinueTarget: kimi-json-missing', () => {
  const fh = fakeHome();
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'kimi-json-missing');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: kimi-json-malformed (garbage)', () => {
  const fh = fakeHome('this is not json');
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'kimi-json-malformed');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: kimi-json-malformed (trailing garbage after valid JSON)', () => {
  const fh = fakeHome('{"work_dirs":[]} trailing');
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'kimi-json-malformed');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: kimi-json-malformed (top-level null)', () => {
  const fh = fakeHome('null');
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'kimi-json-malformed');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: kimi-json-malformed (work_dirs not array)', () => {
  const fh = fakeHome({ work_dirs: {} });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'kimi-json-malformed');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: no-work-dir (no matching entry)', () => {
  const fh = fakeHome({ work_dirs: [{ path: '/other', kaos: 'local', last_session_id: 'aaa' }] });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-work-dir');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: no-work-dir (path matches but kaos mismatches)', () => {
  const fh = fakeHome({ work_dirs: [{ path: '/x/cwd', kaos: 'remote', last_session_id: 'aaa' }] });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-work-dir');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: no-last-session (last_session_id missing)', () => {
  const fh = fakeHome({ work_dirs: [{ path: '/x/cwd', kaos: 'local' }] });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-last-session');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: no-last-session (last_session_id is empty string)', () => {
  const fh = fakeHome({ work_dirs: [{ path: '/x/cwd', kaos: 'local', last_session_id: '' }] });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.reason, 'no-last-session');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: no-last-session (last_session_id is null)', () => {
  const fh = fakeHome({ work_dirs: [{ path: '/x/cwd', kaos: 'local', last_session_id: null }] });
  try {
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.reason, 'no-last-session');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: fs-error on unreadable kimi.json (chmod 000)', () => {
  const fh = fakeHome({ work_dirs: [] });
  try {
    chmodSync(pathJoin(fh.home, '.kimi', 'kimi.json'), 0o000);
    const r = resolveContinueTarget('/x/cwd');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'fs-error');
    assert.equal(r.detail.errCode, 'EACCES');
  } finally { fh.restore(); }
});

test('resolveContinueTarget: accepts kaos parameter for future-proofing', () => {
  const fh = fakeHome({ work_dirs: [
    { path: '/x', kaos: 'local', last_session_id: 'local-id' },
    { path: '/x', kaos: 'remote', last_session_id: 'remote-id' },
  ]});
  try {
    assert.deepEqual(resolveContinueTarget('/x', 'local'), { ok: true, sessionId: 'local-id' });
    assert.deepEqual(resolveContinueTarget('/x', 'remote'), { ok: true, sessionId: 'remote-id' });
  } finally { fh.restore(); }
});

// ── validateResumeTarget (Task 4) ───────────────────────────────────────

function fakeHomeWithSession(cwd, uuid, { contextContent = 'user: hi\nassistant: ok\n', withContextFile = true } = {}) {
  const fh = fakeHome();
  const md5 = createHash('md5').update(cwd).digest('hex');
  const sessDir = pathJoin(fh.home, '.kimi', 'sessions', md5, uuid);
  mkdirSync(sessDir, { recursive: true });
  if (withContextFile) {
    writeFileSync(pathJoin(sessDir, 'context.jsonl'), contextContent);
  }
  return { ...fh, sessDir, md5 };
}

test('validateResumeTarget: happy path — populated context.jsonl', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid);
  try {
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.deepEqual(r, { ok: true });
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (too short)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa');
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (36 dashes)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', '------------------------------------');
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (non-hex g at end)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', '236d5d09-0c3e-49af-b637-d03ae2ca194g');
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (wrong dash placement)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', '236d5d090c3e49afb637d03ae2ca194b----');
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (empty string)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', '');
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: invalid-uuid (non-string)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', null);
    assert.equal(r.reason, 'invalid-uuid');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-not-found (cwd md5 dir absent)', () => {
  const fh = fakeHome();
  try {
    const r = validateResumeTarget('/x/cwd', '236d5d09-0c3e-49af-b637-d03ae2ca194b');
    assert.equal(r.reason, 'session-not-found');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-not-found (cross-cwd — uuid exists under different md5)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwdA', uuid);
  try {
    const r = validateResumeTarget('/x/cwdB', uuid);
    assert.equal(r.reason, 'session-not-found');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-not-found (session path is a regular file, not dir)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHome();
  try {
    const md5 = createHash('md5').update('/x/cwd').digest('hex');
    const md5Dir = pathJoin(fh.home, '.kimi', 'sessions', md5);
    mkdirSync(md5Dir, { recursive: true });
    writeFileSync(pathJoin(md5Dir, uuid), 'not a directory');
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-not-found');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-not-found (dangling symlink at session dir)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHome();
  try {
    const md5 = createHash('md5').update('/x/cwd').digest('hex');
    const md5Dir = pathJoin(fh.home, '.kimi', 'sessions', md5);
    mkdirSync(md5Dir, { recursive: true });
    symlinkSync('/does/not/exist', pathJoin(md5Dir, uuid));
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-not-found');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-empty (context.jsonl absent)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid, { withContextFile: false });
  try {
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-empty');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-empty (context.jsonl zero-byte)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid, { contextContent: '' });
  try {
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-empty');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-empty (context.jsonl is a directory)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid, { withContextFile: false });
  try {
    mkdirSync(pathJoin(fh.sessDir, 'context.jsonl'));
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-empty');
  } finally { fh.restore(); }
});

test('validateResumeTarget: fs-error (EACCES on session dir chmod 000)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid);
  try {
    chmodSync(fh.sessDir, 0o000);
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'fs-error');
    assert.equal(r.detail.errCode, 'EACCES');
    chmodSync(fh.sessDir, 0o755);
  } finally { fh.restore(); }
});

test('validateResumeTarget: fs-error (ELOOP on self-referential symlink)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHome();
  try {
    const md5 = createHash('md5').update('/x/cwd').digest('hex');
    const md5Dir = pathJoin(fh.home, '.kimi', 'sessions', md5);
    mkdirSync(md5Dir, { recursive: true });
    const target = pathJoin(md5Dir, uuid);
    symlinkSync(target, target);
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'fs-error');
    assert.equal(r.detail.errCode, 'ELOOP');
  } finally { fh.restore(); }
});

test('validateResumeTarget: session-empty (context.jsonl is a FIFO)', () => {
  const uuid = '236d5d09-0c3e-49af-b637-d03ae2ca194b';
  const fh = fakeHomeWithSession('/x/cwd', uuid, { withContextFile: false });
  try {
    const ctxPath = pathJoin(fh.sessDir, 'context.jsonl');
    execFileSync('mkfifo', [ctxPath]);
    const r = validateResumeTarget('/x/cwd', uuid);
    assert.equal(r.reason, 'session-empty');
  } finally { fh.restore(); }
});
