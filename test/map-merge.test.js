'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { merge, sameDoc } = require('../public/js/map-merge');

// Small docs: one node per line, ids a/b/c…, root always first.
function doc(nodes, extra) {
  return Object.assign({ v: 1, nodes: [{ id: 'root', parent: null, text: 'Map', x: 0, y: 0 }].concat(nodes) }, extra || {});
}
const n = (id, parent, text, x, y, color) => ({ id, parent, text, x, y, ...(color !== undefined ? { color } : {}) });

test('a clean screen takes the remote copy whole', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = doc([n('a', 'root', 'Food!', 10, 20, 0), n('b', 'root', 'Sights', 30, 40, 1)]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.equal(r.doc.nodes.find(x => x.id === 'a').text, 'Food!');
  assert.ok(r.doc.nodes.find(x => x.id === 'b'));
  assert.equal(sameDoc(r.doc, mine), false);
});

test('an unsaved local edit wins over the same field changed remotely', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const mine = doc([n('a', 'root', 'Feast', 10, 20, 0)]);
  const theirs = doc([n('a', 'root', 'Food!', 10, 20, 0)]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.equal(r.doc.nodes.find(x => x.id === 'a').text, 'Feast');
});

test('an untouched idea takes the remote edit field by field', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0), n('b', 'a', 'Nata', 30, 40)]);
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = doc([n('a', 'root', 'Food', 99, 20, 3), n('b', 'a', 'Nata', 30, 40)]);
  const r = merge(base, mine, theirs);
  assert.equal(r.doc.nodes.find(x => x.id === 'a').x, 99);
  assert.equal(r.doc.nodes.find(x => x.id === 'a').color, 3);
  assert.equal(r.doc.nodes.find(x => x.id === 'a').text, 'Food');
});

test('a delete over there removes an untouched idea here', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = doc([]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.ok(!r.doc.nodes.find(x => x.id === 'a'));
});

test('a delete over there keeps an idea edited here unsaved, ancestors restored', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0), n('b', 'a', 'Nata', 30, 40)]);
  const mine = doc([n('a', 'root', 'Food', 10, 20, 0), n('b', 'a', 'Pastéis', 30, 40)]);
  const theirs = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.equal(r.doc.nodes.find(x => x.id === 'b').text, 'Pastéis');
  assert.ok(r.doc.nodes.find(x => x.id === 'a'), 'its parent line is still there');
});

test('a delete here wins, even if the idea changed over there', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const mine = doc([]);
  const theirs = doc([n('a', 'root', 'Feast', 10, 20, 0)]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.ok(!r.doc.nodes.find(x => x.id === 'a'));
});

test('an idea added here stays; one added over there arrives', () => {
  const base = doc([]);
  const mine = doc([n('a', 'root', 'Mine', 10, 20, 0)]);
  const theirs = doc([n('b', 'root', 'Theirs', 30, 40, 1)]);
  const r = merge(base, mine, theirs);
  assert.ok(r.doc.nodes.find(x => x.id === 'a'));
  assert.ok(r.doc.nodes.find(x => x.id === 'b'));
  assert.ok(r.changed);
});

test('the drawn order follows theirs, with mine-only ideas after the idea they followed', () => {
  const base = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)]);
  // On this screen C was drawn between A and B.
  const mine = doc([n('a', 'root', 'A', 10, 10, 0), n('c', 'root', 'C', 10, 110, 2), n('b', 'root', 'B', 10, 60, 1)]);
  const theirs = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)]);
  const r = merge(base, mine, theirs);
  assert.deepEqual(r.doc.nodes.map(x => x.id), ['root', 'a', 'c', 'b']);

  // A new idea at the end of the branch stays at the end.
  const mine2 = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1), n('c', 'root', 'C', 10, 110, 2)]);
  const r2 = merge(base, mine2, theirs);
  assert.deepEqual(r2.doc.nodes.map(x => x.id), ['root', 'a', 'b', 'c']);
});

test('links merge by id, drop with a gone idea, and two ideas are linked once', () => {
  const base = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)],
    { links: [{ id: 'l1', from: 'a', to: 'b', text: 'line' }] });
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = doc([n('b', 'root', 'B', 10, 60, 1)], { links: [] });
  let r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.ok(!r.doc.links || r.doc.links.length === 0, 'deleted over there, untouched here: gone');

  const base2 = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1), n('c', 'root', 'C', 10, 110, 2)]);
  const mine2 = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1), n('c', 'root', 'C', 10, 110, 2)],
    { links: [{ id: 'l1', from: 'a', to: 'b', text: 'line' }, { id: 'l2', from: 'a', to: 'c', text: '' }] });
  const theirs2 = JSON.parse(JSON.stringify(base2));
  r = merge(base2, mine2, theirs2);
  assert.ok(r.doc);
  assert.equal(r.doc.links.length, 2);
});

test('two links added on both sides between the same pair keep one', () => {
  const base = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)]);
  const mine = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)],
    { links: [{ id: 'x1', from: 'a', to: 'b', text: 'here' }] });
  const theirs = doc([n('a', 'root', 'A', 10, 10, 0), n('b', 'root', 'B', 10, 60, 1)],
    { links: [{ id: 'y1', from: 'a', to: 'b', text: 'there' }] });
  const r = merge(base, mine, theirs);
  assert.ok(r.doc);
  assert.equal(r.doc.links.length, 1);
});

test('Keep tidy follows whoever changed it', () => {
  const base = doc([], { layout: { auto: true } });
  // Untouched on both sides: it stays on.
  assert.deepEqual(merge(base, JSON.parse(JSON.stringify(base)), JSON.parse(JSON.stringify(base))).doc.layout,
    { auto: true });
  // Switched off over there, untouched here: it goes.
  assert.equal(merge(base, JSON.parse(JSON.stringify(base)), doc([], {})).doc.layout, undefined);
  // Switched off here unsaved, untouched over there: it stays off.
  assert.equal(merge(base, doc([], {}), JSON.parse(JSON.stringify(base))).doc.layout, undefined);
});

test('an unmergeable result (a cycle) answers null for the conflict sheet', () => {
  const base = doc([n('a', 'root', 'A', 10, 10)]);
  const mine = doc([n('a', 'root', 'A', 10, 10), n('b', 'a', 'B', 20, 20)]);
  const theirs = doc([n('a', 'b', 'A', 10, 10), n('b', 'root', 'B', 20, 20)]);
  const r = merge(base, mine, theirs);
  assert.equal(r.doc, null);
});

test('changed says whether the screen needs to redraw', () => {
  const base = doc([n('a', 'root', 'Food', 10, 20, 0)]);
  const mine = doc([n('a', 'root', 'Feast', 10, 20, 0)]);
  const theirs = doc([n('a', 'root', 'Food!', 10, 20, 0)]);
  // Mine's unsaved edit already wins, so the screen is right as it is.
  assert.equal(merge(base, mine, theirs).changed, false);
  // A clean screen takes theirs in: it needs to redraw.
  assert.equal(merge(base, JSON.parse(JSON.stringify(base)), theirs).changed, true);
  const same = doc([n('a', 'root', 'Food!', 10, 20, 0)]);
  assert.equal(merge(base, same, theirs).changed, false);
});
