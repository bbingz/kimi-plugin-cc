// STRUCTURAL REGRESSION GUARD — MUST NOT be deleted.
// Ensures /kimi:ask --resume stays removed (spec §9.1 BREAKING; MiniMax round-1).
// This file exists independently of tests/commands-p2.test.mjs so that
// deleting P2 test coverage does not inadvertently remove this assertion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('ask.md argument-hint does not advertise --resume', () => {
  const askMd = readFileSync('plugins/kimi/commands/ask.md', 'utf8');
  // Check the argument-hint frontmatter line specifically (not random prose
  // mentioning --resume — e.g. a BREAKING-change note is allowed).
  const argHintMatch = askMd.match(/^argument-hint:\s*['"](.+)['"]\s*$/m);
  assert.ok(argHintMatch, 'ask.md must have argument-hint frontmatter');
  assert.doesNotMatch(argHintMatch[1], /--resume/, `argument-hint must not include --resume. Got: ${argHintMatch[1]}`);
});

test('kimi-companion ask command rejects --resume as a usage error', () => {
  const r = spawnSync(process.execPath, [
    'plugins/kimi/scripts/kimi-companion.mjs',
    'ask', '--resume', '236d5d09-0c3e-49af-b637-d03ae2ca194b', 'hi',
  ], { encoding: 'utf8' });
  assert.notEqual(r.status, 0,
    `/kimi:ask --resume must not succeed. Got status=${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stderr, /--resume/,
    `stderr should explicitly call out the --resume flag. Got: ${r.stderr}`);
});

test('kimi-companion ask command rejects -r short form', () => {
  const r = spawnSync(process.execPath, [
    'plugins/kimi/scripts/kimi-companion.mjs',
    'ask', '-r', '236d5d09-0c3e-49af-b637-d03ae2ca194b', 'hi',
  ], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `/kimi:ask -r must not succeed. Got status=${r.status}`);
});
