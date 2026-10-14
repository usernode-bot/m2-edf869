/* Three-way merge for live co-editing (#34): what this screen holds (mine)
 * meets a newer copy of the map (theirs), with the copy both started from
 * (base). Pure, and never touches the DOM or the network — app.js calls it
 * with a parsed baseDoc, the live doc and the server's doc, and applies the
 * answer with the model's own replaceWith.
 *
 * The rules, per idea by id:
 *  - an unsaved local edit wins over the server's change to the same field;
 *  - a delete wins over an untouched idea; an idea deleted on the server
 *    but edited here unsaved stays, with its ancestors restored;
 *  - an idea added here stays; one added over there arrives;
 *  - the drawn order follows theirs, with ideas only this screen has placed
 *    after the idea they followed; links follow the same rules and are
 *    dropped when either of their ideas is gone;
 *  - Keep tidy follows whoever changed it.
 * When the result would not be a map the model accepts (a cycle, too deep,
 * a broken root), the answer is { doc: null } and the caller falls back to
 * the conflict sheet — the model's validate is never re-implemented here. */
(function (root) {
  'use strict';

  // One canonical line per node, so "did anything actually change" is a
  // string compare that ignores key order.
  function fingerprint(doc) {
    var nodes = (doc.nodes || []).map(function (n) {
      return [n.id, n.parent, n.text, n.x, n.y, n.color == null ? null : n.color].join('\u0001');
    });
    var links = (doc.links || []).map(function (l) {
      return [l.id, l.from, l.to, l.text || ''].join('\u0001');
    });
    return JSON.stringify([nodes, links, doc.layout || null]);
  }

  // Is one of these a real change? `false` for an absent field. Works for
  // text, parent and colour, which are always present or always absent.
  function changed(baseValue, nowValue) {
    if (baseValue === undefined) return false;
    return nowValue !== baseValue;
  }

  // The ideas both copies hold, with the base's idea id -> index.
  function byId(doc) {
    var map = new Map();
    (doc.nodes || []).forEach(function (n) { map.set(n.id, n); });
    return map;
  }

  function merge(base, mine, theirs) {
    if (!base || !mine || !theirs) return { doc: null, changed: false };
    var baseNodes = byId(base);
    var mineNodes = byId(mine);
    var theirNodes = byId(theirs);

    // ── Ideas ──────────────────────────────────────────────────────────
    var out = []; // the merged nodes, in the order decided below
    var kept = {}; // id -> merged node
    var deleted = {}; // id -> true

    // Which side deleted what, and was the other side looking away?
    (baseNodes.forEach(function (b, id) {
      var inMine = mineNodes.has(id);
      var inTheirs = theirNodes.has(id);
      if (inMine && inTheirs) return;
      if (!inMine && !inTheirs) { deleted[id] = true; return; } // both went
      if (!inTheirs) {
        // Deleted over there. Was it touched here since the base? Then it
        // stays; the local edit is work someone has not saved yet.
        deleted[id] = true;
        var m = mineNodes.get(id);
        if (changed(b.text, m.text) || changed(b.parent, m.parent)
          || changed(b.x, m.x) || changed(b.y, m.y)) {
          delete deleted[id];
        }
        return;
      }
      // Deleted here: my delete wins, changed there or not.
      deleted[id] = true;
    }));

    // Everything still alive, merged field by field: what mine changed
    // locally wins; otherwise theirs (a change or an untouched field).
    mineNodes.forEach(function (m, id) {
      var b = baseNodes.get(id);
      var t = theirNodes.get(id);
      if (deleted[id]) return; // a delete won over this idea
      if (!t) {
        // Added here. Kept as-is; theirs cannot have it.
        kept[id] = { id: id, parent: m.parent, text: m.text, x: m.x, y: m.y };
        if (m.color !== undefined) kept[id].color = m.color;
        return;
      }
      var n = {
        id: id,
        parent: changed(b ? b.parent : undefined, m.parent) || b === undefined ? m.parent : t.parent,
        text: changed(b ? b.text : undefined, m.text) || b === undefined ? m.text : t.text,
        x: changed(b ? b.x : undefined, m.x) || b === undefined ? m.x : t.x,
        y: changed(b ? b.y : undefined, m.y) || b === undefined ? m.y : t.y,
      };
      // Colour: mine's unsaved recolour wins, theirs' otherwise.
      var mc = m.color, bc = b && b.color, tc = t.color;
      if (b === undefined || (bc !== undefined ? mc !== bc : mc !== undefined)) {
        if (mc !== undefined) n.color = mc;
      } else if (tc !== undefined) {
        n.color = tc;
      }
      kept[id] = n;
    });
    // Added over there, never here.
    theirNodes.forEach(function (t, id) {
      if (mineNodes.has(id) || deleted[id]) return;
      var n = { id: id, parent: t.parent, text: t.text, x: t.x, y: t.y };
      if (t.color !== undefined) n.color = t.color;
      kept[id] = n;
    });

    // An idea deleted over there but kept for its local edit still needs
    // the line of ancestors it hung from.
    function restoreLine(id) {
      var b = baseNodes.get(id);
      if (!b) return;
      var parent = b.parent;
      while (parent && !kept[parent] && !deleted[parent]) {
        var bp = baseNodes.get(parent);
        if (!bp) break;
        var tp = theirNodes.get(parent);
        var mp = mineNodes.get(parent);
        var copy = { id: parent, parent: bp.parent, text: bp.text, x: bp.x, y: bp.y };
        if (bp.color !== undefined) copy.color = bp.color;
        // Either side's newer words for the restored idea are fine.
        if (mp) copy.text = mp.text;
        else if (tp) copy.text = tp.text;
        kept[parent] = copy;
        parent = bp.parent;
      }
    }
    Object.keys(deleted).forEach(function (id) { if (!deleted[id]) restoreLine(id); });

    // ── Order ──────────────────────────────────────────────────────────
    // Theirs' drawn order is the skeleton; each idea only mine knows is
    // placed right after the sibling it followed on this screen.
    var order = (theirs.nodes || []).filter(function (n) { return kept[n.id]; })
      .map(function (n) { return kept[n.id]; });
    var placed = {};
    order.forEach(function (n) { placed[n.id] = true; });
    var mineOrder = mine.nodes || [];
    for (var i = mineOrder.length - 1; i >= 0; i--) {
      var m = mineOrder[i];
      if (!kept[m.id] || placed[m.id]) continue;
      // Walk back through mine's siblings for one already placed.
      var at = -1;
      for (var j = i - 1; j >= 0; j--) {
        if (placed[mineOrder[j].id] && kept[mineOrder[j].id].parent === m.parent) { at = j; break; }
      }
      var insertAt = order.length;
      if (at >= 0) {
        for (var k = 0; k < order.length; k++) {
          if (order[k].id === mineOrder[at].id) { insertAt = k + 1; break; }
        }
      } else {
        // Nothing placed ahead of it: end of its parent's children.
        for (var k2 = order.length; k2 > 0; k2--) {
          if (order[k2 - 1].parent === m.parent) { insertAt = k2; break; }
        }
      }
      order.splice(insertAt, 0, kept[m.id]);
      placed[m.id] = true;
    }
    // Anything left (added over there, unplaced parents): theirs' order
    // already holds it; restore-anywhere stragglers go at the end.
    Object.keys(kept).forEach(function (id) {
      if (!placed[id]) order.push(kept[id]);
    });

    // ── Links ───────────────────────────────────────────────────────────
    var baseLinks = new Map();
    (base.links || []).forEach(function (l) { baseLinks.set(l.id, l); });
    var mineLinks = new Map();
    (mine.links || []).forEach(function (l) { mineLinks.set(l.id, l); });
    var theirLinks = new Map();
    (theirs.links || []).forEach(function (l) { theirLinks.set(l.id, l); });
    var outLinks = [];
    var seenPairs = new Set();
    function pushLink(l) {
      if (!kept[l.from] || !kept[l.to]) return; // an idea is gone, the link goes
      var pair = [l.from, l.to].sort().join('\u0001');
      if (seenPairs.has(pair)) return; // two ideas are linked once
      seenPairs.add(pair);
      outLinks.push({ id: l.id, from: l.from, to: l.to, text: l.text || '' });
    }
    baseLinks.forEach(function (b, id) {
      var m = mineLinks.get(id);
      var t = theirLinks.get(id);
      if (m && t) {
        // Link kept on both: the text follows the same rule as a field.
        var text = changed(b.text || '', m.text || '') ? m.text || '' : (t.text || '');
        pushLink({ id: id, from: t.from, to: t.to, text: text });
        return;
      }
      if (!m && !t) return; // both went
      if (!t) return; // deleted over there; here it is untouched, so it goes
      // Deleted here: my delete wins.
    });
    theirLinks.forEach(function (t, id) {
      if (baseLinks.has(id) || mineLinks.has(id)) return;
      pushLink(t); // added over there
    });
    mineLinks.forEach(function (m, id) {
      if (!baseLinks.has(id) && !theirLinks.has(id)) pushLink(m); // added here
    });

    // ── Keep tidy ───────────────────────────────────────────────────────
    var layout;
    var bLayout = base.layout || null, mLayout = mine.layout || null, tLayout = theirs.layout || null;
    if (JSON.stringify(mLayout) !== JSON.stringify(bLayout)) layout = mLayout;
    else layout = tLayout;

    var doc = { v: 1, nodes: order };
    if (outLinks.length) doc.links = outLinks;
    if (layout) doc.layout = layout;

    // A merged doc that would not validate is not one anyone can open: the
    // caller shows the conflict sheet instead of applying it.
    if (typeof root.M2Model !== 'undefined' && root.M2Model.validate) {
      var why = root.M2Model.validate(doc);
      if (why) return { doc: null, changed: false };
    } else if (typeof module !== 'undefined' && module.exports && require) {
      var why2 = require('./map-model').validate(doc);
      if (why2) return { doc: null, changed: false };
    }

    return { doc: doc, changed: fingerprint(doc) !== fingerprint(mine) };
  }

  root.M2Merge = { merge: merge, sameDoc: function (a, b) { return fingerprint(a) === fingerprint(b); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.M2Merge
    || { merge: merge, sameDoc: function (a, b) { return fingerprint(a) === fingerprint(b); } };
})(typeof self !== 'undefined' ? self : this);
