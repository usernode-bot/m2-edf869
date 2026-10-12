/* M2's map model: the doc shape and every change to it, shared by the page
 * and the server so both validate a map the same way. UMD: window.M2Model,
 * or module.exports for server.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.M2Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_NODES = 500;
  var MAX_TEXT = 120;
  var MAX_ROOT_TEXT = 80;
  var MAX_XY = 20000;
  // How deep a map goes: the central idea is level 0, a main idea level 1,
  // and ideas nest under them down to level 10.
  var MAX_DEPTH = 10;
  // The widest an idea draws before it wraps (.idea's max-width), and the
  // room left between an idea and the ideas under it.
  var MAX_IDEA_W = 236;
  var CHILD_GAP = 40;
  // Links: named lines between any two ideas, outside the tree.
  var MAX_LINKS = 200;
  var MAX_LINK_TEXT = 60;

  // Main-idea colours, in the order new main branches get them.
  var COLORS = 5;

  function newId() {
    var s = Math.random().toString(36).slice(2, 10);
    return 'n' + s;
  }

  function nodes(doc) { return doc && doc.nodes ? doc.nodes : []; }

  function node(doc, id) {
    var list = nodes(doc);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function childrenOf(doc, id) {
    return nodes(doc).filter(function (n) { return n.parent === id; });
  }

  // Depth in the tree: the root is 0, a main idea 1, everything under it 2+.
  function depth(doc, id) {
    var d = 0, n = node(doc, id);
    while (n && n.parent) { d++; n = node(doc, n.parent); }
    return n ? d : -1;
  }

  // The colour of the branch an idea sits on: the main-idea ancestor's own.
  function branchColor(doc, id) {
    var n = node(doc, id);
    while (n && n.parent) {
      if (n.color != null) return n.color;
      n = node(doc, n.parent);
    }
    return null;
  }

  function countUnder(doc, id) {
    var all = nodes(doc), n = 0;
    // Count descendants by walking up each node's ancestors.
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.id === id) continue;
      var a = p;
      while (a && a.parent) {
        if (a.parent === id) { n++; break; }
        a = node(doc, a.parent);
      }
    }
    return n;
  }

  function ideaCount(doc) { return nodes(doc).length; }

  // Main ideas only, for thumbnails: where each branch reaches and its colour.
  function outline(doc) {
    return childrenOf(doc, 'root').map(function (n) {
      return { x: n.x, y: n.y, color: n.color || 0 };
    });
  }

  // Pills are the central idea and the main ideas; everything deeper is
  // plain underlined text.
  function isPill(doc, id) { return depth(doc, id) <= 1; }

  // Whether an idea can take another idea under it: not past MAX_DEPTH.
  function canAddUnder(doc, id) {
    var d = depth(doc, id);
    return d >= 0 && d < MAX_DEPTH;
  }

  // An idea's drawn width, for placing what grows out of it when no page has
  // measured it (the server's demo maps, the example map): about 8.8 px a
  // character in a main idea's 16px pill, 7.4 px in an outer idea's 14px text,
  // never wider than an idea draws before it wraps.
  function estimatedWidth(doc, n) {
    var len = n.text ? n.text.length : 0;
    var w = isPill(doc, n.id) ? Math.ceil(len * 8.8) + 32 : Math.ceil(len * 7.4) + 4;
    return Math.min(w, MAX_IDEA_W);
  }

  function trim(t) { return typeof t === 'string' ? t.trim() : ''; }

  // Add an idea under parentId, placed by the same rules the canvas uses, and
  // return the new node. Under the root the side with fewer main ideas grows
  // the next branch; anywhere else the new idea sits beside its parent, past
  // the end of the parent's own text so the two never overlap, however deep
  // the map goes. `parentWidth` is the parent's drawn width when the page has
  // measured it; without it the width is estimated from the text. Returns
  // null past MAX_DEPTH.
  function addIdea(doc, parentId, text, parentWidth) {
    var parent = node(doc, parentId);
    if (!parent || !canAddUnder(doc, parentId)) return null;
    var t = trim(text);
    if (!t) return null;
    var id = newId(), x, y, color;
    if (parentId === 'root') {
      var mains = childrenOf(doc, 'root');
      var right = mains.filter(function (n) { return n.x >= 0; }).length;
      var side = right <= mains.length - right ? 1 : -1; // right on a tie
      var sameSide = mains.filter(function (n) { return (n.x >= 0 ? 1 : -1) === side; });
      y = 0;
      for (var k = 0; k <= 40; k++) {
        var cand = k === 0 ? 0 : (k % 2 === 1 ? -Math.ceil(k / 2) * 140 : (k / 2) * 140);
        var taken = sameSide.some(function (n) { return Math.abs(n.y - cand) < 60; });
        if (!taken) { y = cand; break; }
        y = cand;
      }
      x = 220 * side;
      color = mains.length % COLORS;
    } else {
      var gp = node(doc, parent.parent);
      var s = gp ? (parent.x >= gp.x ? 1 : -1) : 1;
      var w = typeof parentWidth === 'number' && parentWidth > 0
        ? parentWidth : estimatedWidth(doc, parent);
      // A main idea's pill is centred on its anchor, so only half of it lies
      // ahead; an outer idea's text runs from its anchor the whole way. The
      // old fixed steps stay the minimum, so short ideas sit where they did.
      var step = isPill(doc, parentId)
        ? Math.max(150, Math.ceil(w / 2) + CHILD_GAP)
        : Math.max(110, Math.ceil(w) + CHILD_GAP);
      x = parent.x + s * step;
      var kids = childrenOf(doc, parentId);
      y = kids.length ? kids[kids.length - 1].y + 50 : parent.y;
    }
    var n = { id: id, parent: parentId, text: t, x: x, y: y };
    if (parentId === 'root') n.color = color;
    doc.nodes.push(n);
    return n;
  }

  function rename(doc, id, text) {
    var n = node(doc, id);
    var t = trim(text);
    if (!n || !t) return false;
    n.text = t;
    return true;
  }

  function subtree(doc, id) {
    var out = [], stack = [id];
    while (stack.length) {
      var cur = stack.shift();
      var n = node(doc, cur);
      if (!n) continue;
      out.push(n);
      childrenOf(doc, cur).forEach(function (c) { stack.push(c.id); });
    }
    return out;
  }

  // Move an idea and everything under it.
  function moveSubtree(doc, id, dx, dy) {
    subtree(doc, id).forEach(function (n) { n.x += dx; n.y += dy; });
  }

  // Remove an idea and everything under it; returns them in tree order so
  // restore() can put them back exactly as they were. Links touching any of
  // them go too, and ride along on the returned array as `removed.links`.
  function removeSubtree(doc, id) {
    if (id === 'root') return [];
    var removed = subtree(doc, id);
    var ids = {};
    removed.forEach(function (n) { ids[n.id] = true; });
    doc.nodes = nodes(doc).filter(function (n) { return !ids[n.id]; });
    var out = removed.map(function (n) { return JSON.parse(JSON.stringify(n)); });
    out.links = removeLinksFor(doc, Object.keys(ids));
    return out;
  }

  // Put back what removeSubtree() took: the ideas first, then their links.
  function restore(doc, removed) {
    (removed || []).forEach(function (n) {
      if (!node(doc, n.id)) doc.nodes.push(JSON.parse(JSON.stringify(n)));
    });
    if (removed && removed.links) restoreLinks(doc, removed.links);
  }

  // ── Links ──────────────────────────────────────────────────────────────
  // A link is { id, from, to, text } in the optional doc.links array. It has
  // no direction, so two ideas are linked at most once; an empty text is an
  // unnamed link. Maps without links simply have no links field.
  function links(doc) { return doc && doc.links ? doc.links : []; }

  function linkById(doc, id) {
    var list = links(doc);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // The link joining two ideas, in either direction.
  function linkBetween(doc, a, b) {
    var list = links(doc);
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if ((l.from === a && l.to === b) || (l.from === b && l.to === a)) return l;
    }
    return null;
  }

  function linkText(text) { return trim(text).slice(0, MAX_LINK_TEXT); }

  // Whether a link from `from` to `to` may be added: two different ideas
  // that exist, not linked yet, with room left.
  function canLink(doc, from, to) {
    return from !== to && !!node(doc, from) && !!node(doc, to) &&
      !linkBetween(doc, from, to) && links(doc).length < MAX_LINKS;
  }

  // Link two ideas and return the new link, or null for a missing idea, the
  // same idea twice, a pair already linked or a full list.
  function addLink(doc, from, to, text) {
    if (!canLink(doc, from, to)) return null;
    var id;
    do { id = 'l' + Math.random().toString(36).slice(2, 10); } while (linkById(doc, id));
    var l = { id: id, from: from, to: to, text: linkText(text) };
    if (!doc.links) doc.links = [];
    doc.links.push(l);
    return l;
  }

  // Rename a link; an empty name is allowed and leaves it unnamed.
  function renameLink(doc, id, text) {
    var l = linkById(doc, id);
    if (!l) return false;
    l.text = linkText(text);
    return true;
  }

  // Remove one link; returns a copy for Undo, or null.
  function removeLink(doc, id) {
    var list = links(doc);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return JSON.parse(JSON.stringify(list.splice(i, 1)[0]));
    }
    return null;
  }

  // Remove every link touching any of the ideas in `ids`; returns copies.
  function removeLinksFor(doc, ids) {
    if (!doc || !doc.links) return [];
    var gone = {};
    (ids || []).forEach(function (id) { gone[id] = true; });
    var removed = [];
    doc.links = doc.links.filter(function (l) {
      var hit = gone[l.from] === true || gone[l.to] === true;
      if (hit) removed.push(JSON.parse(JSON.stringify(l)));
      return !hit;
    });
    return removed;
  }

  // Put removed links back, each only while both its ideas exist and the
  // pair is still free.
  function restoreLinks(doc, list) {
    (list || []).forEach(function (l) {
      if (!l || linkById(doc, l.id) || !canLink(doc, l.from, l.to)) return;
      if (!doc.links) doc.links = [];
      doc.links.push(JSON.parse(JSON.stringify(l)));
    });
  }

  function outlineFit(outline, w, h, pad) {
    pad = pad == null ? 4 : pad;
    if (!outline.length) return null;
    var minX = 0, maxX = 0, minY = 0, maxY = 0;
    outline.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var sx = (w - pad * 2) / Math.max(maxX - minX, 1);
    var sy = (h - pad * 2) / Math.max(maxY - minY, 1);
    var s = Math.min(sx, sy, 1);
    var ox = w / 2 - ((minX + maxX) / 2) * s;
    var oy = h / 2 - ((minY + maxY) / 2) * s;
    return function (x, y) { return [ox + x * s, oy + y * s]; };
  }

  // Reject an invalid doc with a reason, or return null when it is fine.
  function validate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
    if (doc.v !== 1) return 'unsupported version';
    if (!Array.isArray(doc.nodes)) return 'nodes missing';
    if (doc.nodes.length < 1 || doc.nodes.length > MAX_NODES) return 'wrong node count';
    var seen = {}, roots = [], byId = {};
    for (var i = 0; i < doc.nodes.length; i++) {
      var n = doc.nodes[i];
      if (!n || typeof n !== 'object') return 'bad node';
      if (typeof n.id !== 'string' || !n.id || n.id.length > 40) return 'bad id';
      if (seen[n.id]) return 'duplicate id';
      seen[n.id] = true;
      byId[n.id] = n;
      var t = typeof n.text === 'string' ? n.text.trim() : '';
      if (t.length < 1 || t.length > MAX_TEXT) return 'bad text';
      if (n.id === 'root') roots.push(n);
    }
    if (roots.length !== 1) return 'not exactly one root';
    var root = roots[0];
    if (root.parent !== null) return 'root has a parent';
    if (root.text.trim().length > MAX_ROOT_TEXT) return 'root text too long';
    if (root.x !== 0 || root.y !== 0) return 'root off centre';
    for (var j = 0; j < doc.nodes.length; j++) {
      var m = doc.nodes[j];
      if (m.id === 'root') continue;
      if (typeof m.parent !== 'string' || !byId[m.parent]) return 'missing parent';
      var fx = typeof m.x === 'number' && isFinite(m.x);
      var fy = typeof m.y === 'number' && isFinite(m.y);
      if (!fx || !fy || Math.abs(m.x) > MAX_XY || Math.abs(m.y) > MAX_XY) return 'bad position';
      var isMain = m.parent === 'root';
      if (isMain) {
        if (typeof m.color !== 'number' || m.color % 1 !== 0 || m.color < 0 || m.color > COLORS - 1) return 'bad color';
      } else if ('color' in m) {
        return 'color on a non-main idea';
      }
    }
    // A cycle would mean a node is its own ancestor.
    for (var k = 0; k < doc.nodes.length; k++) {
      var c = doc.nodes[k], hops = 0, p = c;
      while (p && p.parent) { p = byId[p.parent]; if (++hops > doc.nodes.length) return 'cycle'; }
    }
    return validateLinks(doc, byId);
  }

  // The optional links array: absent is fine; if present, every link joins
  // two different existing ideas, once, with a short (possibly empty) name.
  function validateLinks(doc, byId) {
    if (doc.links === undefined) return null;
    if (!Array.isArray(doc.links)) return 'links not a list';
    if (doc.links.length > MAX_LINKS) return 'too many links';
    var has = Object.prototype.hasOwnProperty;
    // No prototype, so an id such as '__proto__' is counted like any other.
    var ids = Object.create(null), pairs = Object.create(null);
    for (var i = 0; i < doc.links.length; i++) {
      var l = doc.links[i];
      if (!l || typeof l !== 'object' || Array.isArray(l)) return 'bad link';
      if (typeof l.id !== 'string' || !l.id || l.id.length > 40) return 'bad link id';
      if (has.call(ids, l.id)) return 'duplicate link id';
      ids[l.id] = true;
      if (typeof l.from !== 'string' || typeof l.to !== 'string' ||
        !has.call(byId, l.from) || !has.call(byId, l.to)) return 'link to a missing idea';
      if (l.from === l.to) return 'link to itself';
      var key = l.from < l.to ? l.from + '\n' + l.to : l.to + '\n' + l.from;
      if (has.call(pairs, key)) return 'duplicate link';
      pairs[key] = true;
      // The raw length: the page always stores a trimmed name, so padding
      // around a short word is no way past the limit.
      if (typeof l.text !== 'string' || l.text.length > MAX_LINK_TEXT) return 'bad link text';
    }
    return null;
  }

  return {
    MAX_NODES: MAX_NODES,
    MAX_TEXT: MAX_TEXT,
    MAX_ROOT_TEXT: MAX_ROOT_TEXT,
    MAX_DEPTH: MAX_DEPTH,
    MAX_LINKS: MAX_LINKS,
    MAX_LINK_TEXT: MAX_LINK_TEXT,
    COLORS: COLORS,
    newId: newId,
    node: node,
    nodes: nodes,
    childrenOf: childrenOf,
    depth: depth,
    branchColor: branchColor,
    countUnder: countUnder,
    ideaCount: ideaCount,
    outline: outline,
    outlineFit: outlineFit,
    isPill: isPill,
    canAddUnder: canAddUnder,
    addIdea: addIdea,
    rename: rename,
    moveSubtree: moveSubtree,
    removeSubtree: removeSubtree,
    restore: restore,
    subtree: subtree,
    links: links,
    linkById: linkById,
    linkBetween: linkBetween,
    addLink: addLink,
    renameLink: renameLink,
    removeLink: removeLink,
    removeLinksFor: removeLinksFor,
    restoreLinks: restoreLinks,
    validate: validate,
  };
});
