'use strict';
/*
 * branches.sh on throwaway local repositories (never the real remote): only a scoreboard branch the remote says it does not hold
 * reads as "none yet"; a failed read stops the run; a publish never puts fewer days on the branch than were read back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const F = require('./fixture');

const SCRIPT = path.join(__dirname, '..', 'branches.sh');
const ENV = { ...process.env, SCOREBOARD_PAUSE: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=scoreboard-test', '-c', 'user.email=scoreboard-test@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout;
};
const run = (cwd, arg, env = {}) => spawnSync('bash', [SCRIPT, arg], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const dayLine = (i) => JSON.stringify({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, spec: 'abcdefabcdef', at: `2026-09-${String(i + 1).padStart(2, '0')}T06:21:00Z` });
const lines = (n) => `${Array.from({ length: n }, (_, i) => dayLine(i % 30)).join('\n')}\n`;

/** A bare "origin" with the given branches ({ branch: { path: text } }), and a work folder whose origin it is. */
function remoteWith(branches) {
  const origin = path.join(F.tmp('origin'), 'origin.git');
  git(path.dirname(origin), 'init', '-q', '--bare', origin);
  for (const [branch, files] of Object.entries(branches)) {
    const src = F.tmp('src');
    git(src, 'init', '-q', '-b', branch);
    for (const [p, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true }); fs.writeFileSync(path.join(src, p), text); }
    git(src, 'add', '-A');
    git(src, 'commit', '-q', '-m', branch);
    git(src, 'push', '-q', origin, branch);
  }
  const work = F.tmp('work');
  git(work, 'init', '-q');
  git(work, 'remote', 'add', 'origin', origin);
  return { origin, work };
}
const FEED = { 'ledger.jsonl': '{"slot":"2026-10-17T00:00:00Z"}\n', 'v1/us.json': '{"items":[]}\n' };

test('fetch: a scoreboard branch the remote does not hold is "none yet"; one it holds is read back whole', () => {
  const none = remoteWith({ feed: FEED });
  const a = run(none.work, 'fetch');
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /scoreboard branch: none yet/);
  assert.equal(fs.existsSync(path.join(none.work, 'sbbranch', 'days.jsonl')), false);
  assert.equal(fs.readFileSync(path.join(none.work, 'sbfeed', 'ledger.jsonl'), 'utf8'), FEED['ledger.jsonl']);

  const some = remoteWith({ feed: FEED, scoreboard: { 'days.jsonl': lines(3), 'latest.json': '{}\n' } });
  const b = run(some.work, 'fetch');
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /scoreboard branch: 3 days read back/);
  assert.equal(fs.readFileSync(path.join(some.work, 'sbbranch', 'days.jsonl'), 'utf8'), lines(3));
});

test('fetch: a remote that cannot be read, or a scoreboard branch without its days, stops the run (exit 1), never "none yet"', () => {
  const gone = remoteWith({ feed: FEED });
  fs.rmSync(gone.origin, { recursive: true, force: true });
  const a = run(gone.work, 'fetch');
  assert.equal(a.status, 1, a.stdout);
  assert.doesNotMatch(a.stdout, /none yet/);
  assert.equal(fs.existsSync(path.join(gone.work, 'sbbranch', 'days.jsonl')), false);

  const empty = remoteWith({ feed: FEED, scoreboard: { 'latest.json': '{}\n' } });
  const b = run(empty.work, 'fetch');
  assert.equal(b.status, 1, b.stdout);
  assert.match(b.stdout, /holds no days\.jsonl/);
});

test('publish: never fewer days than were read back (up to daysKept), and never before the guard passes', () => {
  const target = path.join(F.tmp('target'), 'target.git');
  git(path.dirname(target), 'init', '-q', '--bare', target);
  const work = F.tmp('pub');
  fs.mkdirSync(path.join(work, 'sbout'));
  fs.mkdirSync(path.join(work, 'sbbranch'));
  fs.writeFileSync(path.join(work, 'sbout', 'latest.json'), '{"schema":1}\n');
  const env = { SCOREBOARD_REMOTE: target };

  fs.writeFileSync(path.join(work, 'sbbranch', 'days.jsonl'), lines(3));
  fs.writeFileSync(path.join(work, 'sbout', 'days.jsonl'), lines(1));
  const shrunk = run(work, 'publish', env);
  assert.equal(shrunk.status, 1, shrunk.stdout);
  assert.match(shrunk.stdout, /would fall from 3 to 1 lines: nothing published/);
  assert.equal(git(target, 'branch', '--list'), '', 'nothing pushed');

  fs.writeFileSync(path.join(work, 'sbout', 'days.jsonl'), lines(4));
  fs.writeFileSync(path.join(work, 'sbout', 'latest.json'), '{"title":"Velma Orrin"}\n');
  const leak = run(work, 'publish', env);
  assert.equal(leak.status, 1, 'the guard refuses a key it does not know');
  assert.equal(git(target, 'branch', '--list'), '');

  fs.writeFileSync(path.join(work, 'sbout', 'latest.json'), '{"schema":1}\n');
  const grown = run(work, 'publish', env);
  assert.equal(grown.status, 0, grown.stdout + grown.stderr);
  assert.equal(git(target, 'show', 'scoreboard:days.jsonl'), lines(4));

  // (a branch longer than daysKept may come back at daysKept, no shorter)
  fs.writeFileSync(path.join(work, 'sbbranch', 'days.jsonl'), lines(62));
  fs.writeFileSync(path.join(work, 'sbout', 'days.jsonl'), lines(60));
  assert.equal(run(work, 'publish', env).status, 0);
  fs.writeFileSync(path.join(work, 'sbout', 'days.jsonl'), lines(59));
  assert.equal(run(work, 'publish', env).status, 1);

  // (no branch read back, as on the first day: one line is published)
  fs.rmSync(path.join(work, 'sbbranch', 'days.jsonl'));
  fs.writeFileSync(path.join(work, 'sbout', 'days.jsonl'), lines(1));
  assert.equal(run(work, 'publish', env).status, 0);
});
