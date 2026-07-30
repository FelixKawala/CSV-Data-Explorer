#!/usr/bin/env node
// Generate a synthetic dataset for the test suites.
//
// The repository holds no real data, so the suites need something to run
// against. This produces a bundle that is *shape-identical* to a real one —
// same cardinalities, same sparsity, same value ranges per measure — with
// numbers from a fixed seed. Every structural assertion in the suites (bar
// counts, panel counts, facet counts, pruned combinations) therefore holds,
// while nothing measured is committed.
//
//   node tools/make-fixture.mjs
//     -> test/fixtures/dataset.json   the bundle
//     -> test/fixtures/demo.csv       the same data, tidy (Phase 3 import demo)
//     -> src/dev-dataset.js           so src/index.html works unbuilt, from file://
//     -> dist/fixture.html            the built page the suites read
//
// Shape reproduced deliberately:
//   2 datasets x 5 apps x 11 (device, size) combos x 3 variants
//   - the first device has no 1024 size            -> pruned axis slots
//   - the third variant exists for one app only    -> sparse series, gaps in lines
//   - rates span 0..100, counts ~2 decades, deltas both signs
//
// Phase 2 replaces the app's hardcoded dimension vocabulary with a data-driven
// one; at that point this generator switches to neutral labels too.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');

// deterministic PRNG so the fixture — and every assertion about it — is stable
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5EED);
const between = (lo, hi) => lo + rnd() * (hi - lo);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const DATASETS = ['setA', 'setB'];
const APPS = ['alpha', 'beta', 'gamma', 'kappa', 'omega'];
const DEVICES = ['dev1', 'dev2', 'dev3'];
const SIZES = ['1024', '512', '256', '128'];
const VARIANTS = ['base', 'tuned', 'tunedAlt'];
const SPARSE_VARIANT = 'tunedAlt';        // exists for one app only
const SPARSE_VARIANT_APP = 'alpha';
const NO_LARGEST_SIZE = 'dev1';       // this device has no 1024 config

function combosFor() {
  const out = [];
  for (const device of DEVICES) {
    for (const size of SIZES) {
      if (device === NO_LARGEST_SIZE && size === SIZES[0]) continue;
      out.push({ device, size, key: device + '_' + size });
    }
  }
  return out;
}

// A rate falls as the size shrinks; counts do not depend on the
// size at the first level. Reproducing that keeps log axes and delta signs realistic.
function buildDataset() {
  const combos = combosFor();
  const data = {};
  for (const app of APPS) {
    const perApp = {};
    const l1AccessBase = between(3e5, 9e6);          // constant across sizes
    const l1Ceiling = between(20, 78);
    const l2Ceiling = between(12, 72);
    for (const combo of combos) {
      const shrink = SIZES.indexOf(combo.size) / (SIZES.length - 1); // 0 big .. 1 small
      const point = { rateA: {}, rateB: {}, countA: {}, countB: {} };
      for (const variant of VARIANTS) {
        if (variant === SPARSE_VARIANT && app !== SPARSE_VARIANT_APP) continue;
        const lift = variant === 'base' ? 0 : between(-14, 22);   // both signs
        const l1 = Math.max(0.4, Math.min(99, l1Ceiling * (1 - 0.75 * shrink) + lift));
        const l2 = Math.max(0.4, Math.min(99, l2Ceiling * (1 - 0.55 * shrink) + lift * 0.6));
        const l1a = l1AccessBase * (variant === 'base' ? 1 : between(0.55, 1.6));
        point.rateA[variant] = round(l1, 2);
        point.rateB[variant] = round(l2, 2);
        point.countA[variant] = Math.round(l1a);
        point.countB[variant] = Math.round(l1a * (1 - l1 / 100) * between(0.8, 1.25));
      }
      perApp[combo.key] = point;
    }
    data[app] = perApp;
  }
  return { apps: APPS.slice(), combos, data };
}

const bundle = {};
for (const ds of DATASETS) bundle[ds] = buildDataset();

// tidy form of the same numbers — the Phase 3 import demo, and proof that the
// bundle and a CSV can describe the same thing
function toTidyCsv(bundle) {
  const rows = [['dataset', 'app', 'device', 'size', 'variant',
    'rate_a', 'rate_b', 'count_a', 'count_b'].join(',')];
  for (const [dsName, ds] of Object.entries(bundle)) {
    for (const app of ds.apps) {
      for (const combo of ds.combos) {
        const p = ds.data[app][combo.key];
        for (const variant of VARIANTS) {
          if (p.rateA[variant] === undefined) continue;
          rows.push([dsName, app, combo.device, combo.size, variant,
            p.rateA[variant], p.rateB[variant], p.countA[variant], p.countB[variant]].join(','));
        }
      }
    }
  }
  return rows.join('\n') + '\n';
}

mkdirSync(resolve(root, 'test/fixtures'), { recursive: true });
const jsonPath = resolve(root, 'test/fixtures/dataset.json');
const csvPath = resolve(root, 'test/fixtures/demo.csv');
writeFileSync(jsonPath, JSON.stringify(bundle), 'utf8');
writeFileSync(csvPath, toTidyCsv(bundle), 'utf8');

// src/index.html cannot fetch its data over file://, so hand it a plain script.
// Gitignored; the build strips the reference and embeds the data instead.
writeFileSync(resolve(root, 'src/dev-dataset.js'),
  'window.__VIZ_DATASET__ = ' + JSON.stringify(bundle) + ';\n', 'utf8');

const cells = Object.values(bundle).reduce((n, ds) =>
  n + ds.apps.length * ds.combos.length, 0);
console.log(`fixture: ${DATASETS.length} datasets x ${APPS.length} apps x `
  + `${bundle[DATASETS[0]].combos.length} combos = ${cells} cells`);

const build = spawnSync(process.execPath,
  [resolve(root, 'tools/build.mjs'), jsonPath, resolve(root, 'dist/fixture.html')],
  { encoding: 'utf8', stdio: 'inherit' });
process.exit(build.status ?? 1);
