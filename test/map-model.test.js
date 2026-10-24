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

const { demoMaps, sharedDemoDoc, lisbonDoc } = require('../server/demo-maps');

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

// ---- Colour palette (#20): ten colours, setColor, pickFreeColor ----

// A raw map with the main ideas given straight: text, side (x sign) and
// colour, so a test can lay out any palette situation.
function mainsDoc(list) {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Centre', x: 0, y: 0 }], links: [] };
  list.forEach(function (m, i) {
    doc.nodes.push({
      id: 'm' + i, parent: 'root', text: m.text, x: m.side * (200 + 80 * i), y: 50 * i,
      color: m.color,
    });
  });
  return doc;
}

test('validate takes colours 0 to 9 on a main idea, and nothing outside', () => {
  for (let c = 0; c < M.COLORS; c++) {
    const doc = mainsDoc([{ text: 'M', side: 1, color: c }]);
    assert.equal(M.validate(doc), null, 'colour ' + c + ' is on the palette');
  }
  [M.COLORS, -1, 1.5].forEach(function (c) {
    const doc = mainsDoc([{ text: 'M', side: 1, color: c }]);
    assert.equal(M.validate(doc), 'bad color');
  });
});

test('a colour on a deeper idea still fails validation', () => {
  const doc = mainsDoc([{ text: 'M', side: 1, color: 0 }]);
  const kid = { id: 'k', parent: 'm0', text: 'Kid', x: 300, y: 0, color: 1 };
  doc.nodes.push(kid);
  assert.equal(M.validate(doc), 'color on a non-main idea');
});

test('old maps with colours 0 to 4 read exactly as they did', () => {
  const doc = mainsDoc([
    { text: 'A', side: 1, color: 0 },
    { text: 'B', side: -1, color: 1 },
    { text: 'C', side: 1, color: 2 },
    { text: 'D', side: -1, color: 3 },
    { text: 'E', side: 1, color: 4 },
  ]);
  assert.equal(M.validate(doc), null);
  const ids = ['A', 'B', 'C', 'D', 'E'].map((t) => byText(doc, t).id);
  ids.forEach(function (id, i) {
    assert.equal(M.branchColor(doc, id), i);
    assert.equal(M.branchColor(doc, byText(doc, 'A').id), 0); // unchanged each pass
  });
});

test('the example map keeps its first five branches on colours 0 to 4', () => {
  const doc = exampleDoc();
  const mains = M.childrenOf(doc, 'root');
  assert.equal(mains.length, 5);
  mains.forEach(function (n, i) {
    assert.equal(n.color, i, 'main ' + i + ' keeps colour ' + i);
  });
});

test('a new main idea takes the first colour no main idea uses', () => {
  const doc = mainsDoc([
    { text: 'A', side: 1, color: 0 },
    { text: 'B', side: -1, color: 1 },
    { text: 'C', side: 1, color: 2 },
    { text: 'D', side: -1, color: 3 },
    { text: 'E', side: 1, color: 4 },
  ]);
  assert.equal(M.pickFreeColor(doc, 1), M.COLORS - 5); // the sixth colour
  // Freeing a colour makes it the next pick, before anything later.
  M.removeSubtree(doc, byText(doc, 'C').id);
  assert.equal(M.pickFreeColor(doc, 1), 2);
});

test('with all colours used, the pick goes to the idea’s own side first', () => {
  // Ten mains, every colour used, but the right side is missing colour 9.
  const list = [];
  for (let i = 0; i < 9; i++) list.push({ text: 'R' + i, side: 1, color: i });
  list.push({ text: 'L', side: -1, color: 9 });
  const doc = mainsDoc(list);
  assert.equal(M.pickFreeColor(doc, 1), 9); // unused on the right side
  // ...and the left side is missing none of them, so the rotation answers.
  assert.equal(M.pickFreeColor(doc, -1), list.length % M.COLORS);
});

// ---- Find (#23): search over idea text and link names ----

test('search finds ideas in tree order, folded and caseless', () => {
  const doc = lisbonDoc();
  // 'tram' meets Tram 28 (a child of Transit) and the tram day pass idea,
  // walking depth-first under Transit.
  const tram = M.search(doc, 'tram');
  assert.deepEqual(tram.map((r) => r.id), ['c2', 'c4']);
  tram.forEach((r) => assert.deepEqual(r, { kind: 'idea', id: r.id, field: 'text' }));
  // Diacritics and case fold away: Cafe, CAFÉ, belem.
  const cafe = M.search(doc, 'cafe');
  assert.deepEqual(cafe.map((r) => r.id), ['a3']);
  assert.deepEqual(M.search(doc, 'CAFÉ').map((r) => r.id), ['a3']);
  assert.deepEqual(M.search(doc, 'belem').map((r) => r.id), ['b2']);
});

test('search finds a link by its name, and skips unnamed ones', () => {
  const doc = lisbonDoc();
  const arrive = M.search(doc, 'arrive');
  assert.deepEqual(arrive, [{ kind: 'link', id: 'l1', field: 'text' }]);
  // An unnamed link has no name to match, ever.
  doc.links.push({ id: 'l2', from: 'a1', to: 'b1', text: '' });
  assert.deepEqual(M.search(doc, 'l2').length, 0);
  assert.equal(M.search(doc, '').length, 0);
  assert.equal(M.search(doc, '   ').length, 0);
  assert.equal(M.search(doc, 'zzz').length, 0);
});

test('search walks depth-first: a later child precedes the next main idea', () => {
  const { doc, a2 } = smallDoc();
  const hits = M.search(doc, 'child');
  // 'Left child' comes before 'Left child two' (its later sibling), and both
  // before 'Right child' under the next main idea.
  assert.deepEqual(hits.map((r) => r.id), [byText(doc, 'Left child').id, a2.id, byText(doc, 'Right child').id]);
});

test('search changes nothing in the document', () => {
  const doc = lisbonDoc();
  const before = JSON.parse(JSON.stringify(doc));
  M.search(doc, 'tram');
  assert.deepEqual(doc, before);
});

test('setColor changes a main idea and refuses everything else', () => {
  const { doc, a, a1, b } = smallDoc();
  assert.equal(M.setColor(doc, a.id, M.COLORS - 1), true);
  assert.equal(a.color, M.COLORS - 1);
  assert.equal(M.validate(doc), null);
  assert.equal(M.setColor(doc, 'root', 0), false, 'the root has no colour');
  assert.equal(M.setColor(doc, a1.id, 1), false, 'a deeper idea has no colour of its own');
  assert.equal(M.setColor(doc, b.id, M.COLORS), false, 'past the palette');
  assert.equal(M.setColor(doc, b.id, -1), false, 'before the palette');
  assert.equal(M.setColor(doc, b.id, 1.5), false, 'not a whole colour');
  assert.equal(b.color, 1, 'refused colours change nothing');
  assert.equal(M.validate(doc), null);
});

// ---- Tree order (#39): the map as a screen reader walks it ----

test('treeOrder walks pre-order from the centre, with level, rank and size', () => {
  const { doc, a, b, a1, a2, b1 } = smallDoc();
  const order = M.treeOrder(doc);
  assert.deepEqual(order.map((t) => t.node.id), [doc.nodes[0].id, a.id, a1.id, a2.id, b.id, b1.id]);
  // The centre: level 1, the one and only at its rank.
  assert.equal(order[0].level, 1);
  assert.equal(order[0].pos, 1);
  assert.equal(order[0].size, 1);
  // The main ideas: level 2, ranked among both, each with its own children.
  assert.equal(order[1].level, 2);
  assert.equal(order[1].pos, 1);
  assert.equal(order[1].size, 2);
  assert.equal(order[4].pos, 2);
  // A grandchild is level 3.
  assert.equal(order[2].level, 3);
  assert.equal(order[2].node, a1);
});

test('treeOrder says which ideas have children, for aria-expanded', () => {
  const { doc, a, a1, b1 } = smallDoc();
  const order = M.treeOrder(doc);
  const has = Object.fromEntries(order.map((t) => [t.node.id, t.hasChildren]));
  assert.equal(has[a.id], true);
  assert.equal(has[a1.id], false, 'a leaf says so');
  assert.equal(has[b1.id], false);
  assert.equal(has[doc.nodes[0].id], true);
});

test('treeOrder keeps a collapsed idea and walks its children anyway', () => {
  const { doc, a, a1 } = smallDoc();
  a.collapsed = true;
  const order = M.treeOrder(doc);
  assert.ok(order.some((t) => t.node === a), 'the collapsed idea is still in the tree');
  assert.ok(order.some((t) => t.node === a1), 'its children are still after it');
});

test('treeOrder skips an idea whose parent is gone', () => {
  const { doc, b, b1 } = smallDoc();
  doc.nodes.splice(doc.nodes.indexOf(b), 1);
  const order = M.treeOrder(doc);
  assert.ok(!order.some((t) => t.node === b1), 'the orphan never appears');
});

test('treeOrder answers an empty doc with nothing and changes no document', () => {
  assert.deepEqual(M.treeOrder({ v: 1, nodes: [] }), []);
  const { doc } = smallDoc();
  const before = JSON.parse(JSON.stringify(doc));
  M.treeOrder(doc);
  assert.deepEqual(doc, before);
});

// ── Version history (#32) ─────────────────────────────────────────────

test('versionReason keeps nothing within 10 minutes of the last version', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  assert.equal(M.versionReason(10, 10, null, now), 'auto'); // the map's first
  assert.equal(M.versionReason(10, 10, new Date('2026-06-01T11:51:00Z'), now), null);
  assert.equal(M.versionReason(10, 10, new Date('2026-06-01T11:50:00Z'), now), 'auto');
});

test('versionReason calls a save that drops a fifth of the ideas a big delete', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const aMinuteAgo = new Date('2026-06-01T11:59:00Z');
  assert.equal(M.versionReason(20, 15, aMinuteAgo, now), 'big-delete');
  assert.equal(M.versionReason(20, 16, aMinuteAgo, now), null); // exactly 80%: kept
});

const { lisbonVersions } = require('../server/demo-maps');

test('compareVersion carries the current ideas over as ghosts', () => {
  const lisbonNow = lisbonDoc();
  const version = lisbonVersions(new Date())[0].doc; // 16 ideas, no Budget
  const merged = M.compareVersion(version, lisbonNow);
  assert.deepEqual(merged.ghostIds, ['e1', 'e2', 'e3']);
  assert.equal(merged.doc.nodes.length, 19);
  merged.ghostIds.forEach((id) => {
    const ghost = merged.doc.nodes.find((n) => n.id === id);
    assert.ok(merged.doc.nodes.some((n) => n.id === ghost.parent),
      'ghost ' + id + ' keeps a parent in the merged tree');
  });
  assert.equal(merged.doc.nodes.find((n) => n.id === 'root').text, 'Lisbon weekend');
  assert.ok(!merged.doc.links, 'the links are the version own');
});

test('compareVersion prefers the version text and changes no input', () => {
  const version = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Old title', x: 0, y: 0 }] };
  const current = {
    v: 1,
    nodes: [{ id: 'root', parent: null, text: 'New title', x: 5, y: 5 },
      { id: 'n1', parent: 'root', text: 'New idea', x: 10, y: 10 }],
  };
  const beforeVersion = JSON.parse(JSON.stringify(version));
  const beforeCurrent = JSON.parse(JSON.stringify(current));
  const merged = M.compareVersion(version, current);
  assert.equal(merged.doc.nodes[0].text, 'Old title');
  assert.deepEqual(merged.ghostIds, ['n1']);
  assert.deepEqual(version, beforeVersion);
  assert.deepEqual(current, beforeCurrent);
});

test('lisbonVersions seeds two versions with fewer ideas than today', () => {
  const versions = lisbonVersions(new Date('2026-06-01T12:00:00Z'));
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.map((v) => v.ideaCount), [16, 11]);
  assert.ok(versions[0].createdAt > versions[1].createdAt, 'newest first');
  versions.forEach((v) => assert.equal(v.reason, 'auto'));
});

// ── Big maps (#38) ──────────────────────────────────────────────────────
// The lookup index must answer exactly as a scan would, through every kind
// of change: a new idea, a delete, a reparent, a reorder, an undo, and a
// whole new nodes array.

test('the index answers the same as the doc after every kind of change', () => {
  const { doc, a, b1 } = smallDoc();
  const snapshotAnswers = (d) => {
    const byId = {};
    d.nodes.forEach((n) => { byId[n.id] = n; });
    const scan = (id) => d.nodes.find((n) => n.id === id) || null;
    return {
      lengths: d.nodes.map((n) => M.subtree(d, n.id).length),
      depths: d.nodes.map((n) => M.depth(d, n.id)),
      colors: d.nodes.map((n) => M.branchColor(d, n.id)),
      counts: d.nodes.map((n) => M.countUnder(d, n.id)),
      kids: d.nodes.map((n) => M.childrenOf(d, n.id).map((k) => k.id).join(',')),
      ancestors: d.nodes.map((n) => M.ancestors(d, n.id).map((k) => k.id).join(',')),
      order: M.treeOrder(d).map((t) => t.node.id + ':' + t.level + ':' + t.pos + ':' + t.size).join(' '),
      missing: scan('nope') === null && M.depth(d, 'nope') === -1 && M.countUnder(d, 'nope') === 0,
      nodeOk: d.nodes.every((n) => M.node(d, n.id) === byId[n.id]),
    };
  };
  const answers = [];
  answers.push(snapshotAnswers(doc));
  const c = M.addIdea(doc, a.id, 'Third child', 100);
  answers.push(snapshotAnswers(doc));
  M.reparent(doc, b1.id, a.id, 200); // changes a parent, same array length
  answers.push(snapshotAnswers(doc));
  const moveBack = { id: c.id, index: doc.nodes.indexOf(M.node(doc, c.id)),
    nodes: [Object.assign({}, M.node(doc, c.id))] };
  M.moveSibling(doc, c.id, -1);
  answers.push(snapshotAnswers(doc));
  assert.equal(M.undoMove(doc, moveBack), true);
  answers.push(snapshotAnswers(doc));
  const before = doc.nodes.length;
  const removed = M.removeSubtree(doc, c.id); // a new array
  answers.push(snapshotAnswers(doc));
  assert.equal(doc.nodes.length, before - 1);
  M.restore(doc, removed);
  answers.push(snapshotAnswers(doc));
  doc.nodes = doc.nodes.slice(); // a reassigned array, same content
  answers.push(snapshotAnswers(doc));
  // Every answer is internally right: the model's own helpers agree with a
  // plain walk of the tree.
  const last = answers[answers.length - 1];
  assert.equal(last.lengths.length, doc.nodes.length);
  assert.equal(last.missing, true);
  doc.nodes.forEach((n, i) => {
    const walk = [];
    (function w(id) {
      doc.nodes.forEach((m) => { if (m.parent === id) { walk.push(m.id); w(m.id); } });
    })(n.id);
    assert.equal(last.lengths[i], walk.length + 1, 'subtree of ' + n.text);
    assert.equal(last.counts[i], walk.length, 'countUnder of ' + n.text);
  });
  // The reorder, the delete and the restore all left the order honest.
  assert.deepEqual(
    M.treeOrder(doc).map((t) => t.node.id),
    preOrder(doc)
  );
});

function preOrder(doc) {
  const out = [];
  (function w(id) {
    if (id === 'root') out.push('root');
    doc.nodes.filter((n) => n.parent === id).forEach((n) => { out.push(n.id); w(n.id); });
  })('root');
  return out;
}

function byIdText(doc, text) {
  return doc.nodes.find((n) => n.text === text);
}

test('a map may hold 2000 ideas and 500 links, and not more', () => {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Big', x: 0, y: 0 }] };
  let side = 1;
  for (let i = 1; i < 2000; i++) {
    const parent = i % 20 === 0 ? 'root' : 'root';
    doc.nodes.push({ id: 'n' + i, parent, text: 'Idea ' + i,
      x: 220 * side, y: (i % 300 - 150) * 50, color: i % 10 });
    side = -side;
  }
  assert.equal(doc.nodes.length, 2000);
  assert.equal(M.validate(doc), null);
  doc.nodes.push({ id: 'extra', parent: 'root', text: 'One more', x: 220, y: 0, color: 0 });
  assert.equal(M.validate(doc), 'wrong node count');
  doc.nodes.pop();

  const links = [];
  for (let i = 1; i <= 500; i++) links.push({ id: 'l' + i, from: 'n' + i, to: 'n' + (i + 1) * 2, text: '' });
  doc.links = links;
  assert.equal(M.validate(doc), null);
  doc.links.push({ id: 'l501', from: 'n1', to: 'n3', text: '' });
  assert.equal(M.validate(doc), 'too many links');
  doc.links.pop();
  assert.equal(M.MAX_NODES, 2000);
  assert.equal(M.MAX_LINKS, 500);
});

test('a doc larger than the saved-form cap is refused, and the big demo fits', () => {
  assert.equal(M.MAX_DOC_CHARS, 3000000);
  const doc = {
    v: 1,
    nodes: [
      { id: 'root', parent: null, text: 'Huge', x: 0, y: 0 },
      { id: 'a', parent: 'root', text: 'A'.repeat(120), x: 220, y: 0, color: 0, notes: 'x'.repeat(4000000) },
    ],
  };
  assert.ok(JSON.stringify(doc).length > M.MAX_DOC_CHARS);
  assert.equal(M.validate(doc), 'map too big');

  const { bigDemoDoc } = require('../server/demo-maps');
  const big = bigDemoDoc();
  assert.equal(big.nodes.length, 1511);
  assert.equal(M.validate(big), null);
  assert.ok(JSON.stringify(big).length < M.MAX_DOC_CHARS);
  // The costly walk a big map asks for most often stays quick.
  const t0 = Date.now();
  M.nodes(big).forEach((n) => M.countUnder(big, n.id));
  assert.ok(Date.now() - t0 < 50, 'countUnder over every idea took ' + (Date.now() - t0) + ' ms');
  // The existing fixtures still validate unchanged.
  assert.equal(M.validate(exampleDoc()), null);
});
