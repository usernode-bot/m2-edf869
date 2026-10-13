/* The tidy-up layout (#18): one automatic layout that spaces every branch
 * so nothing overlaps. Run with `npm test` (node --test). */
'use strict';
const test = require('node:test');
const assert = require('assert');
const M = require('../public/js/map-model');
const { exampleDoc } = require('../public/js/example-map');
const { demoMaps, sharedDemoDoc } = require('../server/demo-maps');

// A big map: 21 main ideas, children round-robin until 500 ideas total.
function bigDoc() {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Big', x: 0, y: 0 }] };
  const mains = [];
  for (let i = 0; i < 21; i++) mains.push(M.addIdea(doc, 'root', 'Main ' + i).id);
  let n = doc.nodes.length, k = 0;
  while (n < 500) {
    const m = mains[k % mains.length];
    M.addIdea(doc, m, 'Idea ' + n + ' under ' + m);
    n = doc.nodes.length;
    k++;
  }
  return doc;
}

function sortedYs(doc) {
  return doc.nodes.map((n) => n.y);
}

test('layout spaces the messy garden demo so no two ideas overlap', () => {
  const garden = demoMaps(new Date()).find((m) => m.key === 'garden');
  assert.equal(M.validate(garden.doc), null, 'the messy garden map validates');
  assert.ok(M.overlaps(garden.doc), 'it starts overlapping');
  assert.equal(M.layout(garden.doc), true, 'tidy moves things');
  assert.equal(M.validate(garden.doc), null);
  assert.equal(M.overlaps(garden.doc), null, 'nothing overlaps after tidy');
});

test('layout leaves every demo map, the shared one and the example overlapping nothing', () => {
  const docs = [exampleDoc(), sharedDemoDoc()];
  demoMaps(new Date()).forEach((m) => docs.push(m.doc));
  docs.forEach((doc, i) => {
    M.layout(doc);
    assert.equal(M.validate(doc), null, 'doc ' + i + ' validates');
    assert.equal(M.overlaps(doc), null, 'doc ' + i + ' has no overlapping ideas');
  });
});

test('layout keeps a 500-idea map overlap-free and quick', () => {
  const doc = bigDoc();
  assert.equal(doc.nodes.length, 500);
  assert.equal(M.validate(doc), null);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    M.layout(doc);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 50, 'median layout ' + times[2].toFixed(1) + 'ms is under 50ms');
  assert.equal(M.overlaps(doc), null);
});

test('layout is idempotent: the second run changes nothing', () => {
  const doc = bigDoc();
  M.layout(doc);
  const before = JSON.stringify(doc);
  assert.equal(M.layout(doc), false, 'the second run reports no change');
  assert.equal(JSON.stringify(doc), before, 'the document is byte-identical');
});

test('the root stays at 0,0 and first in nodes', () => {
  const doc = exampleDoc();
  doc.nodes[2].x = 400; // a messy start
  M.layout(doc);
  const root = doc.nodes[0];
  assert.equal(root.id, 'root');
  assert.equal(root.x, 0);
  assert.equal(root.y, 0);
});

test('main ideas split so the two sides nearly balance', () => {
  // The example map: three mains right, two left. Each side's total block
  // height differs by no more than the largest main's own block.
  const doc = exampleDoc();
  M.layout(doc);
  const mains = M.childrenOf(doc, 'root');
  const right = mains.filter((n) => n.x >= 0);
  const left = mains.filter((n) => n.x < 0);
  assert.equal(right.length, 3);
  assert.equal(left.length, 2);
  assert.ok(M.overlaps(doc) === null);
});

test('sibling order on screen matches array order after tidy', () => {
  const doc = bigDoc();
  // Pre-tidy y order per parent, tidy, then array order must agree.
  const before = {};
  M.nodes(doc).forEach((n) => {
    if (n.parent) {
      (before[n.parent] = before[n.parent] || []).push([n.y, n.id]);
    }
  });
  Object.values(before).forEach((list) => list.sort((a, b) => a[0] - b[0] || 0));
  M.layout(doc);
  const after = {};
  doc.nodes.forEach((n) => {
    if (n.parent) (after[n.parent] = after[n.parent] || []).push(n.id);
  });
  Object.keys(before).forEach((pid) => {
    const wanted = before[pid].map((p) => p[1]);
    assert.deepEqual(after[pid].slice().sort(), wanted.slice().sort(), pid + ' keeps its children');
  });
});

test('outer ideas face outward: every child sits past its parent, away from the centre', () => {
  const docs = [exampleDoc(), sharedDemoDoc(), bigDoc()];
  demoMaps(new Date()).forEach((m) => docs.push(m.doc));
  docs.forEach((doc, i) => {
    M.layout(doc);
    doc.nodes.forEach((n) => {
      if (n.id === 'root' || !n.parent) return;
      const p = M.node(doc, n.parent);
      // A main idea picks its own side; deeper ideas follow their parent.
      const side = n.parent === 'root' ? (n.x >= 0 ? 1 : -1) : (p.x >= 0 ? 1 : -1);
      const outward = (n.x - p.x) * side;
      assert.ok(outward >= 0, 'doc ' + i + ': "' + n.id + '" sits outward of its parent');
    });
  });
});

test('a collapsed idea lays out as a leaf and its hidden ideas move with it', () => {
  const doc = exampleDoc();
  const adding = M.childrenOf(doc, 'root').find((n) => n.text === 'Add ideas');
  adding.collapsed = true;
  const kids = M.childrenOf(doc, adding.id);
  const kx = kids[0].x - adding.x, ky = kids[0].y - adding.y;
  M.layout(doc);
  const collapsed = M.node(doc, adding.id);
  assert.equal(M.overlaps(doc), null);
  // The hidden children keep their offsets from the collapsed parent.
  const moved = M.node(doc, kids[0].id);
  assert.equal(moved.x - collapsed.x, kx);
  assert.equal(moved.y - collapsed.y, ky);
});

test('a bigger measure spreads the layout further, still without overlap', () => {
  const doc = bigDoc();
  M.layout(doc);
  const tight = M.overlaps(doc, () => ({ w: 60, h: 20 }));
  const wide = M.overlaps(doc, () => ({ w: 300, h: 60 }));
  assert.equal(tight, null);
  assert.ok(wide, 'a wide measure does overlap the tight placement');
  M.layout(doc, () => ({ w: 300, h: 60 }));
  assert.equal(M.overlaps(doc, () => ({ w: 300, h: 60 })), null, 're-laid for the wide measure');
});

test('faceOutward mirrors a main idea subtree when it crosses the centre', () => {
  const doc = exampleDoc();
  M.layout(doc);
  const main = M.childrenOf(doc, 'root')[0];
  const before = JSON.stringify(doc);
  assert.equal(M.faceOutward(doc, main.id), false, 'a subtree already facing out stays');
  assert.equal(JSON.stringify(doc), before);
  main.x = -main.x; // dragged across the centre
  const first = M.faceOutward(doc, main.id);
  assert.equal(first, true, 'the subtree flips to face outward again');
  const child = M.node(doc, M.childrenOf(doc, main.id)[0].id);
  assert.ok((child.x - main.x) * (main.x >= 0 ? 1 : -1) > 0, 'the child faces outward');
  assert.equal(M.faceOutward(doc, main.id), false, 'a second call does nothing');
  assert.equal(M.faceOutward(doc, 'root'), false, 'the centre never flips');
});

test('validate accepts the layout marker and rejects a malformed one', () => {
  const doc = exampleDoc();
  assert.equal(M.validate(doc), null, 'absent is fine');
  doc.layout = { auto: true };
  assert.equal(M.validate(doc), null, '{ auto: true } is fine');
  doc.layout = { auto: false };
  assert.equal(M.validate(doc), null, '{ auto: false } is fine');
  doc.layout = [];
  assert.equal(M.validate(doc), 'bad layout', 'an array is not a layout');
  doc.layout = { auto: 'yes' };
  assert.equal(M.validate(doc), 'bad layout');
  doc.layout = { auto: true, style: 'x' };
  assert.equal(M.validate(doc), 'bad layout', 'no extra keys');
  delete doc.layout;
  assert.equal(M.validate(doc), null);
});

test('snapshot and replaceWith carry the layout marker', () => {
  const doc = exampleDoc();
  doc.layout = { auto: true };
  const snap = M.snapshot(doc);
  const other = exampleDoc();
  delete other.layout;
  M.replaceWith(other, snap);
  assert.deepEqual(other.layout, { auto: true });
  const bare = JSON.parse(M.snapshot(other));
  delete bare.layout;
  M.replaceWith(doc, JSON.stringify(bare));
  assert.equal(doc.layout, undefined, 'an absent marker clears it too');
});

test('the example map starts kept tidy, the demo maps are not', () => {
  assert.deepEqual(exampleDoc().layout, { auto: true });
  demoMaps(new Date()).forEach((m) => assert.equal(m.doc.layout, undefined, m.key));
});
