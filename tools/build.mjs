#!/usr/bin/env node
// Assemble src/index.html into one self-contained page.
//
//   node tools/build.mjs [dataset.json] [output.html]
//
// Every <link rel="stylesheet"> and <script src> is replaced by its inlined
// contents, in document order, so the output has no external references at all
// and runs from file://, a static host, or an email attachment.
//
// The dataset is embedded into <script id="dataset" type="application/json">,
// which is what lets the page boot synchronously with data already present --
// the property the test suites depend on.
//
// Deliberately not a bundler: the job is "concatenate N files in order", and a
// bundler would add a network install and a config surface for that.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const PLACEHOLDER = '__DATASET_JSON__';
const root = resolve(import.meta.dirname, '..');
const srcDir = resolve(root, 'src');

const [, , datasetArg, outArg] = process.argv;
const outPath = resolve(outArg || join(root, 'dist/explorer.html'));

function die(msg) {
  console.error('build: ' + msg);
  process.exit(1);
}
function read(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    die(`cannot read ${what} ${path}\n  ${e.message}`);
  }
}

const indexPath = resolve(srcDir, 'index.html');
let html = read(indexPath, 'shell');

// Drop the dev-only dataset shim; the built page embeds its data instead.
html = html
  .replace(/^.*dev only.*\n/m, '')
  .replace(/^[ \t]*<script src="dev-dataset\.js"><\/script>[ \t]*\n/m, '');

let cssCount = 0;
let jsCount = 0;
let inlined = 0;

html = html.replace(/^[ \t]*<link[^>]*href="([^"]+\.css)"[^>]*>[ \t]*$/gm, (_, href) => {
  const body = read(resolve(srcDir, href), 'stylesheet');
  cssCount++;
  inlined += body.length;
  return `<style>\n/* ${href} */\n${body.trim()}\n</style>`;
});

html = html.replace(/^[ \t]*<script src="([^"]+\.js)"><\/script>[ \t]*$/gm, (_, src) => {
  const body = read(resolve(srcDir, src), 'script');
  jsCount++;
  inlined += body.length;
  return `<script>\n// ${src}\n${body.trim()}\n</script>`;
});

if (cssCount === 0 || jsCount === 0) {
  die(`${indexPath} referenced ${cssCount} stylesheets and ${jsCount} scripts; expected both non-zero`);
}
const leftovers = html.match(/<(?:link|script)[^>]*(?:href|src)="(?!https?:)[^"]*"/g);
if (leftovers) die('an external reference survived inlining:\n  ' + leftovers.join('\n  '));

// Dataset is optional: without one the page still builds and shows its empty state.
let dataset = '';
if (datasetArg) {
  dataset = read(resolve(datasetArg), 'dataset');
  try {
    JSON.parse(dataset);
  } catch (e) {
    die(`${datasetArg} is not valid JSON\n  ${e.message}`);
  }
}
if (!html.includes(PLACEHOLDER)) die(`${indexPath} has no ${PLACEHOLDER} placeholder`);
html = html.replace(PLACEHOLDER, dataset);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`build: ${outPath.replace(root + '/', '')}  `
  + `(${cssCount} css + ${jsCount} js = ${kb(inlined)}`
  + (dataset ? ` + data ${kb(dataset.length)}` : ', no data') + ')');
