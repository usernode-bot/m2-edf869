/* Offline (#40): the device's copy of recently opened maps, in IndexedDB.
 * No library — a tiny keyrange wrapper with every access guarded, so a
 * browser that refuses storage (private mode, quota) leaves the app exactly
 * as it was offline-blind: writes resolve quietly and reads answer null.
 *
 * One database, `m2-offline`, two stores:
 *   maps  — key [ns, id]: one record per map this device keeps
 *   lists — key ns: the Your maps response last fetched
 * The namespace (`u:<userId>` or `guest`) keeps each person's maps apart,
 * and comes from the identity remembered in api.js (`m2.offline.who`).
 *
 * Pure helpers are exported for tests: tokenIdentity, evictions, mergeList,
 * isTempId, newTempId. Nothing here answers a server request; the app's own
 * save always goes to the network. */
(function (root) {
  'use strict';

  var DB_NAME = 'm2-offline';
  var DB_VERSION = 1;
  var KEEP = 20; // the maps the device keeps, most recently opened first

  var dbPromise = null;
  var failed = false; // once opening fails, every call answers null quietly

  function available() {
    return !failed && typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  function open() {
    if (!available()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('maps')) {
          db.createObjectStore('maps', { keyPath: ['ns', 'id'] });
        }
        if (!db.objectStoreNames.contains('lists')) {
          db.createObjectStore('lists', { keyPath: 'ns' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { failed = true; resolve(null); };
      req.onblocked = function () { failed = true; resolve(null); };
    });
    return dbPromise;
  }

  function tx(mode, store, work) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var t;
        try {
          t = db.transaction(store, mode);
        } catch (e) {
          failed = true;
          resolve(null);
          return;
        }
        var out = null;
        var st = t.objectStore(store);
        try { out = work(st); } catch (e) { resolve(null); return; }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function reqResult(req) {
    return req; // tx() reads .result on complete
  }

  // ── Records ──────────────────────────────────────────────────────────
  // One record: { ns, id, doc, revision, baseDoc, access, shareToken,
  // pending, temp, title, ideaCount, outline, openedAt, updatedAt }.

  function getMap(ns, id) {
    return tx('readonly', 'maps', function (st) {
      return reqResult(st.get([ns, id]));
    });
  }

  function putMap(ns, record) {
    var rec = Object.assign({}, record, { ns: ns });
    return tx('readwrite', 'maps', function (st) {
      st.put(rec);
      return true;
    }).then(function () { evict(ns); return true; });
  }

  function removeMap(ns, id) {
    return tx('readwrite', 'maps', function (st) {
      st.delete([ns, id]);
      return true;
    });
  }

  // Every record in the namespace (used for share-token lookup and eviction).
  function localMaps(ns) {
    return tx('readonly', 'maps', function (st) {
      return reqResult(st.getAll(IDBKeyRange.bound([ns, ''], [ns, '￿'])));
    }) || Promise.resolve(null);
  }

  // Records with unsent edits, for the sync pass.
  function pending(ns) {
    return localMaps(ns).then(function (recs) {
      return (recs || []).filter(function (r) { return r.pending || r.temp; });
    });
  }

  function putList(ns, list) {
    return tx('readwrite', 'lists', function (st) {
      st.put({ ns: ns, maps: list, at: Date.now() });
      return true;
    });
  }

  function getList(ns) {
    return tx('readonly', 'lists', function (st) {
      return reqResult(st.get(ns));
    }).then(function (row) { return row ? row.maps : null; });
  }

  // Eviction: keep the KEEP most recently opened records, never letting go
  // of one with unsent edits or one the server does not know yet. Runs
  // after every putMap; other namespaces are never touched.
  function evict(ns) {
    localMaps(ns).then(function (recs) {
      (evictions(recs || [], KEEP) || []).forEach(function (id) {
        removeMap(ns, id);
      });
    });
  }

  // Pure: which ids to drop. Sorts by openedAt, oldest first, skips pending
  // and temp, and returns the ids past the keep count.
  function evictions(records, keep) {
    var sorted = (records || []).slice().sort(function (a, b) {
      return (a.openedAt || 0) - (b.openedAt || 0);
    });
    var out = [];
    var room = keep - records.length;
    for (var i = 0; i < sorted.length && room < 0; i++) {
      var r = sorted[i];
      if (r.pending || r.temp) continue;
      out.push(r.id);
      room++;
    }
    return out;
  }

  // ── Identity ─────────────────────────────────────────────────────────
  // The token payload names the storage namespace only; it is never
  // verified here (the server verifies it on every API call).
  function tokenIdentity(token) {
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      var payload = JSON.parse(decodePayload(parts[1]));
      if (!payload || typeof payload !== 'object') return null;
      if (payload.pur === 'guest' || payload.guest === true) return 'guest';
      if (payload.id) return 'u:' + payload.id;
      return null;
    } catch (e) { return null; }
  }

  function decodePayload(part) {
    var s = part.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }

  // ── Temporary ids (#40): a map created offline ───────────────────────
  function newTempId() {
    var s = '';
    for (var i = 0; i < 12; i++) s += Math.floor(Math.random() * 36).toString(36);
    return 'local-' + s;
  }

  function isTempId(id) {
    return typeof id === 'string' && id.indexOf('local-') === 0 && id.length === 18;
  }

  // ── Your maps, offline ───────────────────────────────────────────────
  // The list the server last answered, refreshed with what this device
  // holds: a temp map appears first (waiting to sync), a pending row is
  // flagged, a listed map with no local copy is unavailable. Pure.
  function mergeList(list, localRecords) {
    var rows = (list || []).map(function (m) { return Object.assign({}, m); });
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    var temps = [];
    (localRecords || []).forEach(function (rec) {
      var row = byId[rec.id];
      if (row) {
        if (rec.pending) row.pending = true;
        if (rec.doc) {
          row.title = rec.doc.nodes && rec.doc.nodes[0] ? rec.doc.nodes[0].text.trim() : row.title;
          row.ideaCount = rec.doc.nodes ? rec.doc.nodes.length : row.ideaCount;
          if (root.M2Model && root.M2Model.outline) row.outline = root.M2Model.outline(rec.doc);
        }
      } else if (rec.temp) {
        temps.push({
          id: rec.id,
          title: rec.title != null ? rec.title : (rec.doc && rec.doc.nodes && rec.doc.nodes[0] ? rec.doc.nodes[0].text.trim() : ''),
          ideaCount: rec.ideaCount != null ? rec.ideaCount : (rec.doc && rec.doc.nodes ? rec.doc.nodes.length : 0),
          outline: rec.outline || (rec.doc && root.M2Model && root.M2Model.outline ? root.M2Model.outline(rec.doc) : null),
          updatedAt: rec.updatedAt || new Date(rec.openedAt || Date.now()).toISOString(),
          temp: true,
        });
      }
    });
    rows.forEach(function (row) {
      // A row this device holds no copy of can't open offline.
      row.unavailable = !(localRecords || []).some(function (r) { return r.id === row.id; });
    });
    return temps.concat(rows);
  }

  // ── Kick: "the next successful request" ──────────────────────────────
  // api.js calls kick() after every successful response; app.js listens and
  // runs its sync pass when edits are waiting.
  var kickFn = null;
  function kick() {
    if (kickFn) { try { kickFn(); } catch (e) {} }
  }
  function onKick(fn) { kickFn = fn; }

  var api = {
    available: available,
    open: open,
    getMap: getMap,
    putMap: putMap,
    removeMap: removeMap,
    localMaps: localMaps,
    pending: pending,
    putList: putList,
    getList: getList,
    newTempId: newTempId,
    isTempId: isTempId,
    tokenIdentity: tokenIdentity,
    evictions: evictions,
    mergeList: mergeList,
    kick: kick,
    onKick: onKick,
    KEEP: KEEP,
  };

  root.M2Offline = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign({}, api, { decodePayload: decodePayload, M2Offline: api });
  }
})(typeof self !== 'undefined' ? self : this);
