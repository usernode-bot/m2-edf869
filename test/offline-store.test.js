'use strict';
// The pure helpers of the offline store (#40): who a token names, which
// records eviction may drop, how the device's list is folded into the
// server's, and which ids a map made up offline carries.
var test = require('node:test');
var assert = require('node:assert');

var path = require('path');
// The UMD picks `self` as its root in a browser; define it before the
// require so the test can stub the page's M2Model for mergeList.
var rootStub = {};
globalThis.self = rootStub;
var store = require(path.join(__dirname, '..', 'public', 'js', 'offline-store.js'));
var tokenIdentity = store.tokenIdentity;

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function tokenFor(payload) {
  return 'a.' + b64url(payload) + '.b';
}

test('tokenIdentity reads a user id out of the unverified payload', function () {
  assert.equal(tokenIdentity(tokenFor({ id: 'u1', pur: 'user' })), 'u:u1');
});

test('tokenIdentity names a guest', function () {
  assert.equal(tokenIdentity(tokenFor({ id: 'g1', pur: 'guest' })), 'guest');
  assert.equal(tokenIdentity(tokenFor({ id: 'g2', guest: true })), 'guest');
});

test('tokenIdentity answers null for junk and for nothing', function () {
  assert.equal(tokenIdentity('not-a-token'), null);
  assert.equal(tokenIdentity('a.' + b64url('plain') + '.b'), null);
  assert.equal(tokenIdentity(''), null);
});

function rec(id, openedAt, extra) {
  return Object.assign({ id: id, openedAt: openedAt }, extra || {});
}

// evictions names the records to DROP: the oldest ones, until KEEP fits,
// never touching one with edits waiting.
test('evictions drops the oldest down to KEEP', function () {
  var recs = [];
  for (var i = 0; i < 25; i++) recs.push(rec('m' + i, i));
  var out = store.evictions(recs, store.KEEP);
  assert.deepEqual(out, recs.slice(0, 5).map(function (r) { return r.id; }));
});

test('evictions keeps a pending record no matter how old', function () {
  var recs = [];
  for (var i = 0; i < 25; i++) recs.push(rec('m' + i, i));
  recs[0].pending = true;
  var out = store.evictions(recs, store.KEEP);
  assert.deepEqual(out, ['m1', 'm2', 'm3', 'm4', 'm5']);
});

test('evictions never drops a temp map either', function () {
  var recs = [];
  for (var i = 0; i < 25; i++) recs.push(rec('m' + i, i));
  recs[0].temp = true;
  var out = store.evictions(recs, store.KEEP);
  assert.ok(!out.some(function (r) { return r.id === 'm0'; }));
});

test('evictions drops oldest until there is room', function () {
  var out = store.evictions([rec('a', 1), rec('b', 2)], 1);
  assert.deepEqual(out, ['a']);
});

test('isTempId matches only the made-up ids', function () {
  assert.ok(store.isTempId(store.newTempId()));
  assert.ok(!store.isTempId('real-map-id'));
  assert.ok(!store.isTempId('local-' + 'a'.repeat(11) + 'ab'));
});

var DOC = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Central', x: 0, y: 0 }] };

// mergeList draws its outline through M2Model, which loads with the page;
// in Node a stub answers for it.
rootStub.M2Model = {
  outline: function (doc) {
    return doc.nodes.slice(1).map(function (n) { return { x: n.x, y: n.y, color: 0 }; });
  },
};

test('mergeList folds the device records into the server list', function () {
  var list = [
    { id: 'a', title: 'A', ideaCount: 2, updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'b', title: 'B', ideaCount: 3, updatedAt: '2026-01-02T00:00:00Z' },
  ];
  var renamed = { v: 1, nodes: [{ id: 'root', parent: null, text: 'A renamed', x: 0, y: 0 }] };
  var local = [
    { id: 'a', doc: renamed, pending: true, title: 'A renamed', ideaCount: 1, openedAt: 2 },
    rec('t1', 3, { temp: true, doc: DOC, title: 'Made up', ideaCount: 1 }),
  ];
  var rows = store.mergeList(list, local);
  assert.equal(rows.length, 3);
  // Made-up maps first, in opening order.
  assert.equal(rows[0].id, 't1');
  assert.ok(rows[0].temp);
  var a = rows.filter(function (r) { return r.id === 'a'; })[0];
  assert.ok(a.pending);
  assert.equal(a.title, 'A renamed');
  assert.equal(a.ideaCount, 1);
  assert.ok(Array.isArray(a.outline));
  var b = rows.filter(function (r) { return r.id === 'b'; })[0];
  assert.ok(b.unavailable);
});

test('mergeList leaves the server list untouched', function () {
  var list = [{ id: 'a', title: 'A', ideaCount: 2, updatedAt: 'z' }];
  store.mergeList(list, [{ id: 'a', doc: DOC, pending: true }]);
  assert.ok(!('pending' in list[0]));
});
