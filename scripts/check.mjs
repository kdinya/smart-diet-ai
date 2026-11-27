// Fast local check: node scripts/check.mjs  (npm run check). No dependencies, no browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const errors = [];
const fail = (msg) => errors.push(msg);
const list = (dir, re) => fs.readdirSync(path.join(root, dir)).filter((f) => re.test(f)).map((f) => `${dir}/${f}`);

// 1. JSON files parse.
for (const f of ['manifest.json', 'package.json']) {
  try { JSON.parse(read(f)); } catch (e) { fail(`${f}: invalid JSON (${e.message})`); }
}

// 2. Syntax of inline scripts and every JS file.
const html = read('index.html');
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
  try { new vm.Script(m[1]); } catch (e) { fail(`index.html inline script #${i + 1}: ${e.message}`); }
});
for (const f of ['sw.js', ...list('js', /\.js$/), ...list('tests', /\.js$/), ...list('scripts', /\.m?js$/)]) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${f}: syntax error\n${r.stderr.trim()}`);
}

// 3. Every local file the page loads must be precached by sw.js, and every precached file must exist.
const sw = read('sw.js');
const shellMatch = sw.match(/const SHELL=\[([\s\S]*?)\];/);
const norm = (p) => p.replace(/^\.\//, '').replace(/[?#].*$/, '') || './';
if (!shellMatch) fail('sw.js: SHELL array not found');
else {
  const shell = new Set([...shellMatch[1].matchAll(/'([^']+)'/g)].map((m) => norm(m[1])));
  const used = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) used.add(m[1]);
  for (const u of used) {
    if (/^(https?:)?\/\//.test(u) || u.startsWith('data:')) continue;
    if (!shell.has(norm(u))) fail(`sw.js SHELL is missing "${u}" used by index.html`);
  }
  for (const f of shell) if (f !== './' && !fs.existsSync(path.join(root, f))) fail(`sw.js SHELL lists "${f}" but the file does not exist`);

  // 4. If a precached file changed against the base branch, the cache name must change too.
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const base = ['origin/main', 'main'].find((b) => git('rev-parse', '--verify', '-q', b).status === 0);
  const cacheOf = (src) => (src.match(/const CACHE='([^']+)'/) || [])[1];
  if (!base) console.log('note: no base branch found, cache-version check skipped');
  else {
    const changed = git('diff', '--name-only', base).stdout.split('\n').filter(Boolean).map(norm);
    const touched = changed.filter((f) => shell.has(f) && f !== 'sw.js');
    const baseSw = git('show', `${base}:sw.js`);
    if (touched.length && baseSw.status === 0 && cacheOf(baseSw.stdout) === cacheOf(sw)) {
      fail(`sw.js: CACHE is still "${cacheOf(sw)}" but precached files changed (${touched.join(', ')}); bump it`);
    }
  }
}

// 5. Unit tests.
for (const f of list('tests/unit', /\.test\.mjs$/)) {
  const r = spawnSync(process.execPath, [path.join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${f}: failed\n${(r.stdout + r.stderr).trim().split('\n').slice(-12).join('\n')}`);
}

if (errors.length) {
  console.error(`check failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('check passed');
