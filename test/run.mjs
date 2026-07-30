#!/usr/bin/env node
// Run every test_*.js suite in this directory, in one process each, and fail
// the whole run if any suite fails. Each suite is a plain node script that
// prints its own ok/FAIL lines and exits non-zero on failure.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const only = process.argv[2];               // optional substring filter

const suites = readdirSync(here)
  .filter(f => /^test_.*\.js$/.test(f))
  .filter(f => !only || f.includes(only))
  .sort();

if (suites.length === 0) {
  console.error(only ? `no suites match "${only}"` : 'no test_*.js suites found');
  process.exit(2);
}

const verbose = process.env.VERBOSE === '1';
const failed = [];
const t0 = Date.now();

for (const suite of suites) {
  const r = spawnSync(process.execPath, [resolve(here, suite)], {
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) failed.push(suite);

  const summary = (out.match(/^(ALL PASS|\d+ FAILURE\(S\))$/m) || [])[0]
    || (r.status === null ? 'crashed' : `exit ${r.status}`);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${suite.padEnd(26)} ${summary}`);

  if (!ok && !verbose) {
    out.split('\n').filter(l => /FAIL|Error|error:/.test(l)).slice(0, 12)
      .forEach(l => console.log('         ' + l.trim()));
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${suites.length - failed.length}/${suites.length} suites passed in ${secs}s`);
if (failed.length) {
  console.log('failed: ' + failed.join(', '));
  console.log('re-run one with:  node test/<suite>.js');
  process.exit(1);
}
