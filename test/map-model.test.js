/* The map model's restructure rules (#16): reparenting an idea under
 * another, reordering siblings, and undoing both. Run with `npm test`
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