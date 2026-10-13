/* The map model's restructure rules (#16): reparenting an idea under
 * another, reordering siblings, and undoing both; and the keyboard helpers
 * nextIdea and addSibling. Run with `npm test`
 * (node --test). */
'use strict';
const test = require('node:test');
const assert = require('assert');
const M = require('../public/js/map-model');
const { exampleDoc } = require('../public/js/example-map');

// Two main ideas with a child each, and a link between the children.
function smallDoc() {
  const doc = {
    v: 1,
    nodes: [{ id: 'root', parent: null, text: 'Centre', x: 0, y: 0 }],
    links: [],
  };
  const a = M.addIdea(doc, 'root', 'Left', 200);
  const b = M.addIdea(doc, 'root', 'Right', 200);
  a.color = 0;
  const a1 = M.addIdea(doc, a.id, 'Left child', 100);
  const a2 = M.addIdea(doc, a.id, 'Left child two', 100);
  const b1 = M.addIdea(doc, b.id, 'Right child', 100);
  M.addLink(doc, a1.id, b1.id, 'tied');
  return { doc, a, b, a1, a2, b1 };
}

function byText(doc, text) {
  return doc.nodes.find((n) => n.text === text);
}

test('canReparent refuses the root, the current parent, and own subtree', () => {
  const { doc, a, a1 } = smallDoc();
  assert.equal(M.canReparent(doc, 'root', a.id), false);
  assert.equal(M.canReparent(doc, a1.id, a.id), false); // already there
  assert.equal(M.canReparent(doc, a.id, a1.id), false); // own child
  assert.equal(M.canReparent(doc, a.id, a.id), false);
  assert.equal(M.canReparent(doc, a1.id, 'root'), true);
});

test('canReparent refuses a move that would pass MAX_DEPTH', () => {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'C', x: 0, y: 0 }] };
  let prev = 'root';
  const ids = [];
  for (let i = 0; i < M.MAX_DEPTH; i++) {
    const n = M.addIdea(doc, prev, 'Level ' + i, 80);
    ids.push(n.id);
    prev = n.id;
  }
  // ids[i] sits at depth i + 1, so the last is at the limit: moving the
  // second idea under the last would push its subtree one too deep.
  assert.equal(M.validate(doc), null);
  assert.equal(M.canReparent(doc, ids[0], ids[M.MAX_DEPTH - 1]), false);
  assert.equal(M.canReparent(doc, ids[1], 'root'), true);
});

test('reparent moves the whole subtree and keeps the document valid', () => {
  const { doc, a, a1, a2 } = smallDoc();
  const record = M.reparent(doc, a1.id, a2.id, 100);
  assert.ok(record);
  assert.equal(M.validate(doc), null);
  assert.equal(a1.parent, a2.id);
  // The subtree's own positions move with it, not with the old layout.
  assert.notDeepEqual({ x: a1.x, y: a1.y }, { x: record.nodes[0].x, y: record.nodes[0].y });
  assert.equal(M.depth(doc, a1.id), 3);
});

test('a promoted idea keeps its branch colour, a demoted main loses its own', () => {
  const { doc, a, a1 } = smallDoc();
  const colour = M.branchColor(doc, a1.id);
  assert.equal(M.reparent(doc, a1.id, 'root', 200).id, a1.id);
  assert.equal(a1.parent, 'root');
  assert.equal(a1.color, colour); // keeps the branch it came from

  const { doc: doc2, b, a: aMain } = smallDoc();
  assert.equal(M.reparent(doc2, b.id, aMain.id, 100).id, b.id); // demoted under another main
  assert.equal(b.parent, aMain.id);
  assert.equal('color' in b, false); // no longer a main idea
  assert.equal(M.validate(doc2), null);
});

test('crossing the centre mirrors the subtree around the moved idea', () => {
  const { doc, a, a1 } = smallDoc();
  const rightOfA = a1.x > a.x;
  M.reparent(doc, a.id, 'root', 200); // a moves to the other side (5 mains, so it flips)
  assert.equal(a.x < 0, !rightOfA);
  assert.equal(a1.x < a.x, !rightOfA); // its child now faces the other way too
});

test('moveSibling swaps two siblings, and undoMove restores every position', () => {
  const { doc, a, a1, a2 } = smallDoc();
  const before = JSON.parse(JSON.stringify(doc));
  const first = a1.y < a2.y ? a1 : a2;
  const second = a1.y < a2.y ? a2 : a1;
  const y1 = first.y, y2 = second.y;
  assert.equal(M.moveSibling(doc, first.id, 1), true);
  assert.equal(first.y, y2); // they swapped places
  assert.equal(second.y, y1);
  assert.ok(M.validate(doc) === null);
  // Putting it back restores the document exactly, nodes and order.
  assert.equal(M.moveSibling(doc, first.id, -1), true);
  assert.deepEqual(doc, before);
});

test('undoMove puts a reparented subtree back exactly, links included', () => {
  const { doc, a, a1 } = smallDoc();
  const before = JSON.parse(JSON.stringify(doc));
  const record = M.reparent(doc, a1.id, 'root', 200);
  assert.notDeepEqual(doc, before);
  assert.equal(M.undoMove(doc, record), true);
  assert.deepEqual(doc, before); // same parents, positions, colours, order
  assert.equal(doc.links[0].from, byText(before, 'Left child').id);
  assert.equal(doc.links[0].to, byText(before, 'Right child').id);
});

test('undoMove refuses when the old parent is gone', () => {
  const { doc, a, a1 } = smallDoc();
  const record = M.reparent(doc, a1.id, 'root', 200);
  M.removeSubtree(doc, a.id); // the idea it came from is deleted meanwhile
  assert.equal(M.undoMove(doc, record), false);
  assert.equal(a1.parent, 'root');
});

test('validParents lists every allowed target, in tree order, never own subtree', () => {
  const { doc, a, a1, b } = smallDoc();
  const texts = M.validParents(doc, a1.id).map((n) => n.text);
  // 'Left' is where a1 already sits, so it is not offered.
  assert.deepEqual(texts, ['Centre', 'Left child two', 'Right', 'Right child']);
  assert.ok(!texts.includes('Left child')); // its own subtree
  assert.ok(M.validParents(doc, a.id).every((n) => n.id !== a1.id));
});

test('validate rejects a chain past MAX_DEPTH, the server included', () => {
  function chain(k) {
    const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'C', x: 0, y: 0 }] };
    let prev = 'root';
    for (let i = 0; i < k; i++) {
      const n = { id: 'c' + i, parent: prev, text: 't' + i, x: 10 * (i + 1), y: 0 };
      if (i === 0) n.color = 0;
      doc.nodes.push(n);
      prev = n.id;
    }
    return doc;
  }
  assert.equal(M.validate(chain(M.MAX_DEPTH)), null);
  assert.equal(M.validate(chain(M.MAX_DEPTH + 1)), 'too deep');
});

test('reparent works on the example map and the result still validates', () => {
  const doc = exampleDoc();
  const rename = byText(doc, 'Rename');
  const record = M.reparent(doc, rename.id, byText(doc, 'Add ideas').id, 200);
  assert.ok(record);
  assert.equal(M.validate(doc), null);
  assert.equal(M.undoMove(doc, record), true);
  assert.equal(M.validate(doc), null);
});

const { demoMaps, sharedDemoDoc } = require('../server/demo-maps');

const DIRS = ['left', 'right', 'up', 'down'];

// A small map: a centre, one main idea, two ideas under it (the second 50 px
// below the first, by addIdea's own placement).
function keyboardDoc() {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Centre', x: 0, y: 0 }] };
  const main = M.addIdea(doc, 'root', 'Main');
  const a = M.addIdea(doc, main.id, 'First');
  const b = M.addIdea(doc, main.id, 'Second');
  return { doc, main, a, b };
}

test('nextIdea walks out to a child and back to the parent', function () {
  const doc = exampleDoc();
  const adding = M.childrenOf(doc, 'root').find((n) => n.text === 'Add ideas');
  assert.ok(adding, 'example map has Add ideas');
  const kid = M.childrenOf(doc, adding.id)[0];
  assert.equal(M.nextIdea(doc, 'root', 'right'), adding.id);
  assert.equal(M.nextIdea(doc, adding.id, 'right'), kid.id);
  assert.equal(M.nextIdea(doc, kid.id, 'left'), adding.id);
});

test('nextIdea steps between main ideas on the same side', function () {
  const doc = exampleDoc();
  const byText = (t) => M.childrenOf(doc, 'root').find((n) => n.text === t);
  const adding = byText('Add ideas');
  const rename = byText('Rename');
  const tidy = byText('Tidy up');
  assert.equal(M.nextIdea(doc, adding.id, 'up'), rename.id);
  assert.equal(M.nextIdea(doc, adding.id, 'down'), tidy.id);
});

test('nextIdea answers the centre for an unknown id', function () {
  const doc = exampleDoc();
  assert.equal(M.nextIdea(doc, 'nope', 'down'), 'root');
});

test('nextIdea from every idea, in every direction, lands on a real idea', function () {
  const docs = [exampleDoc(), sharedDemoDoc()];
  demoMaps(new Date()).forEach((m) => docs.push(m.doc));
  docs.forEach(function (doc, i) {
    assert.equal(M.validate(doc), null, 'doc ' + i + ' validates');
    doc.nodes.forEach(function (from) {
      DIRS.forEach(function (dir) {
        const to = M.nextIdea(doc, from.id, dir);
        assert.ok(
          M.node(doc, to),
          'doc ' + i + ': ' + dir + ' from "' + from.text + '" lands on an idea'
        );
      });
    });
  });
});

test('nextIdea holds still when nothing lies that way', function () {
  const { doc, a, b } = keyboardDoc();
  // Below the last idea on the branch there is nothing: stay put.
  assert.equal(M.nextIdea(doc, b.id, 'down'), b.id);
  assert.equal(M.nextIdea(doc, a.id, 'up'), a.id);
  // From the centre, nothing is further out than the ideas themselves.
  const only = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Alone', x: 0, y: 0 }] };
  assert.equal(M.nextIdea(only, 'root', 'right'), 'root');
});

test('addSibling adds below and moves the ideas past it down', function () {
  const { doc, a, b } = keyboardDoc();
  const aY = a.y, bY = b.y;
  const n = M.addSibling(doc, a.id, 'New', false);
  assert.ok(n, 'returns the new idea');
  assert.equal(n.parent, a.parent);
  assert.equal(n.y, aY + 50);
  assert.equal(M.node(doc, b.id).y, bY + 50, 'the idea below moved to make room');
  const order = M.nodes(doc).map((x) => x.id);
  assert.ok(order.indexOf(n.id) === order.indexOf(a.id) + 1, 'sits just after its idea');
  assert.equal(M.validate(doc), null);
});

test('addSibling adds above and moves the ideas before it up', function () {
  const { doc, a, b } = keyboardDoc();
  const aY = a.y, bY = b.y;
  const n = M.addSibling(doc, b.id, 'New', true);
  assert.ok(n, 'returns the new idea');
  assert.equal(n.y, bY - 50);
  assert.equal(M.node(doc, a.id).y, aY - 50, 'the idea above moved to make room');
  const order = M.nodes(doc).map((x) => x.id);
  assert.ok(order.indexOf(n.id) === order.indexOf(b.id) - 1, 'sits just before its idea');
  assert.equal(M.validate(doc), null);
});

test('addSibling beside the centre or a main idea grows a main idea', function () {
  const { doc } = keyboardDoc();
  const fromRoot = M.addSibling(doc, 'root', 'Another main', false);
  assert.ok(fromRoot);
  assert.equal(fromRoot.parent, 'root');
  assert.equal(typeof fromRoot.color, 'number');
  const fromMain = M.addSibling(doc, fromRoot.id, 'Third main', true);
  assert.ok(fromMain);
  assert.equal(fromMain.parent, 'root');
  assert.equal(M.childrenOf(doc, 'root').length, 3);
  assert.equal(M.validate(doc), null);
});

test('addSibling refuses an unknown idea or an empty name', function () {
  const { doc, a } = keyboardDoc();
  assert.equal(M.addSibling(doc, 'nope', 'New', false), null);
  assert.equal(M.addSibling(doc, a.id, '   ', false), null);
  assert.equal(M.addSibling(doc, a.id, '', true), null);
  assert.equal(M.ideaCount(doc), 4, 'nothing was added');
});

test('walking and adding never strand the keys', function () {
  // A map built entirely by the two helpers stays walkable everywhere.
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Centre', x: 0, y: 0 }] };
  for (let i = 0; i < 5; i++) {
    const main = M.addSibling(doc, 'root', 'Main ' + i, false);
    for (let j = 0; j < 3; j++) M.addSibling(doc, main.id, 'Idea ' + j, j % 2 === 0);
  }
  assert.equal(M.validate(doc), null);
  doc.nodes.forEach(function (from) {
    DIRS.forEach(function (dir) {
      assert.ok(M.node(doc, M.nextIdea(doc, from.id, dir)));
    });
  });
});

// ── ancestors (#25) ─────────────────────────────────────────────────────
// The trail from the root down to, but not including, an idea: what the
// focus chip shows as crumbs.
test('ancestors walks from the root down to an idea', function () {
  const { doc, a, a1 } = smallDoc();
  assert.deepEqual(M.ancestors(doc, 'root'), []);
  assert.deepEqual(M.ancestors(doc, a.id), [doc.nodes[0]]);
  const trail = M.ancestors(doc, a1.id);
  assert.deepEqual(trail.map((n) => n.id), [doc.nodes[0].id, a.id]);
  assert.equal(trail[trail.length - 1].text, 'Left');
});

test('ancestors of an unknown idea are none', function () {
  const { doc } = smallDoc();
  assert.deepEqual(M.ancestors(doc, 'nope'), []);
});
