/* Tests for the keyboard helpers in map-model.js: nextIdea (which idea lies
 * in a direction) and addSibling (a sibling above or below). Both must keep
 * every map they touch valid, and nextIdea must always land somewhere that
 * exists, from every idea, in every direction. */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const M = require('../public/js/map-model');
const { exampleDoc } = require('../public/js/example-map');
const { demoMaps, sharedDemoDoc } = require('../server/demo-maps');

const DIRS = ['left', 'right', 'up', 'down'];

// A small map: a centre, one main idea, two ideas under it (the second 50 px
// below the first, by addIdea's own placement).
function smallDoc() {
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
  const { doc, a, b } = smallDoc();
  // Below the last idea on the branch there is nothing: stay put.
  assert.equal(M.nextIdea(doc, b.id, 'down'), b.id);
  assert.equal(M.nextIdea(doc, a.id, 'up'), a.id);
  // From the centre, nothing is further out than the ideas themselves.
  const only = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Alone', x: 0, y: 0 }] };
  assert.equal(M.nextIdea(only, 'root', 'right'), 'root');
});

test('addSibling adds below and moves the ideas past it down', function () {
  const { doc, a, b } = smallDoc();
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
  const { doc, a, b } = smallDoc();
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
  const { doc } = smallDoc();
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
  const { doc, a } = smallDoc();
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
