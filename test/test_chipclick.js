const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/cache_explorer.html', 'utf8');
let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
function block(d, label) {
  return Array.from(d.querySelectorAll('#plots .dim-block'))
    .find(b => b.querySelector('.dim-label') && b.querySelector('.dim-label').textContent.trim().indexOf(label) === 0);
}
const cols = (d, label) => block(d, label).querySelectorAll('.dual-col');
const names = col => Array.from(col.querySelectorAll('.dnd-chip')).map(c => c.textContent.replace(/[+×]$/, ''));

console.log('\n=== Clicking anywhere on a chip toggles it ===');
{
  const { w, d } = boot();
  ok(names(cols(d, 'GPU')[0]).join(',') === '2080,4070,5090', 'three GPUs shown');

  // click the chip body (the label), not the little icon
  const chip = cols(d, 'GPU')[0].querySelectorAll('.dnd-chip')[0];
  ok(chip.getAttribute('role') === 'button', 'the chip is exposed as a button');
  ok(chip.tabIndex === 0, 'and is keyboard focusable');
  ok(/^Click to remove/.test(chip.getAttribute('title')), 'with a title saying what a click does', chip.getAttribute('title'));
  chip.querySelector('span:nth-of-type(2)').click();   // the text label
  ok(names(cols(d, 'GPU')[0]).join(',') === '4070,5090', 'clicking the label removed it', names(cols(d, 'GPU')[0]).join(','));

  // and clicking it in Available adds it back
  const back = Array.from(cols(d, 'GPU')[1].querySelectorAll('.dnd-chip')).find(c => /2080/.test(c.textContent));
  back.click();
  ok(names(cols(d, 'GPU')[0]).indexOf('2080') !== -1, 'clicking it in Available adds it back', names(cols(d, 'GPU')[0]).join(','));

  // the little icon still works (it just bubbles now)
  cols(d, 'GPU')[0].querySelectorAll('.dnd-chip')[0].querySelector('button').click();
  ok(names(cols(d, 'GPU')[0]).length === 2, 'the +/x icon still works', names(cols(d, 'GPU')[0]).join(','));
  ok(!d.querySelector('#plots .dim-block .dnd-chip button[tabindex="0"]'), 'the icon is not separately focusable');
  w.close();
}

console.log('\n=== Keyboard works too ===');
{
  const { w, d } = boot();
  const chip = cols(d, 'Application')[0].querySelectorAll('.dnd-chip')[0];
  const before = names(cols(d, 'Application')[0]).length;
  chip.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  ok(names(cols(d, 'Application')[0]).length === before - 1, 'Enter toggles the focused chip', before + ' -> ' + names(cols(d, 'Application')[0]).length);
  const chip2 = cols(d, 'Application')[1].querySelectorAll('.dnd-chip')[0];
  chip2.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  ok(names(cols(d, 'Application')[0]).length === before, 'Space adds it back', names(cols(d, 'Application')[0]).length);
  w.close();
}

console.log('\n=== A drag must not also count as a click ===');
{
  const { w, d } = boot();
  const dt = { data: {}, setData() {}, getData() { return ''; } };
  const fire = (el, t) => { const e = new w.Event(t, { bubbles: true, cancelable: true }); e.dataTransfer = dt; el.dispatchEvent(e); };
  const before = names(cols(d, 'GPU')[0]).join(',');
  const chip = cols(d, 'GPU')[0].querySelectorAll('.dnd-chip')[0];
  fire(chip, 'dragstart');
  fire(chip, 'dragend');
  chip.click();  // browsers may emit a trailing click after a drag
  ok(names(cols(d, 'GPU')[0]).join(',') === before, 'the trailing click after a drag is swallowed', before + ' -> ' + names(cols(d, 'GPU')[0]).join(','));
  chip.click();  // a genuine click afterwards still works
  ok(names(cols(d, 'GPU')[0]).join(',') !== before, 'but the next real click works', names(cols(d, 'GPU')[0]).join(','));
  w.close();
}

console.log('\n=== Metric chips in "Data shown" behave the same ===');
{
  const { w, d } = boot();
  const avail = d.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  const l2 = Array.from(avail.querySelectorAll('.dnd-chip')).find(c => /L2 hit rate/.test(c.textContent));
  l2.click();
  const shown = Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col')[0].querySelectorAll('.dnd-chip')).map(c => c.textContent);
  ok(shown.length === 2, 'clicking a metric card selects it', shown.join(' | '));
  ok(!!d.querySelector('#plots .zone-chip[data-dim="metric"]'), 'and the Metric chip appears in the zones');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
