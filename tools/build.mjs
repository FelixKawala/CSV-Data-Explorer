#!/usr/bin/env node
// Build a self-contained page from the template plus a dataset bundle.
//
//   node tools/build.mjs <dataset.json> <output.html>
//
// The template carries a __DATASET_JSON__ placeholder inside
// <script id="dataset" type="application/json">. Substituting it produces a
// page that boots synchronously with data already present — which is what the
// test suites rely on, and what makes a shareable single file possible.
//
// Phase 1 will grow this into the module-inlining build; today it is the
// ad-hoc python one-liner, written down at last.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PLACEHOLDER = '__DATASET_JSON__';

const [, , datasetPath, outPath] = process.argv;
if (!datasetPath || !outPath) {
  console.error('usage: node tools/build.mjs <dataset.json> <output.html>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const templatePath = resolve(root, 'src/explorer_template.html');

let template;
try {
  template = readFileSync(templatePath, 'utf8');
} catch (e) {
  console.error(`build: cannot read template ${templatePath}\n  ${e.message}`);
  process.exit(1);
}
if (!template.includes(PLACEHOLDER)) {
  console.error(`build: ${templatePath} has no ${PLACEHOLDER} placeholder`);
  process.exit(1);
}

let dataset;
try {
  dataset = readFileSync(resolve(datasetPath), 'utf8');
} catch (e) {
  console.error(`build: cannot read dataset ${datasetPath}\n  ${e.message}`);
  process.exit(1);
}
try {
  JSON.parse(dataset);
} catch (e) {
  console.error(`build: ${datasetPath} is not valid JSON\n  ${e.message}`);
  process.exit(1);
}

const out = resolve(outPath);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, template.replace(PLACEHOLDER, dataset), 'utf8');

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`build: ${outPath}  (template ${kb(template.length)} + data ${kb(dataset.length)})`);
