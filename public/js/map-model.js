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
  // Tidy up (#18) spacing: centre pill to a main idea, between the ideas
  // stacked under one parent, and between the main-idea blocks on one side.
  var ROOT_GAP = 60;
  var SIBLING_GAP = 16;
  var MAIN_GAP = 24;
  // Links: named lines between any two ideas, outside the tree.
  var MAX_LINKS = 200;
  var MAX_LINK_TEXT = 60;

  // Main-idea colours, in the order new main branches get them.
  var COLORS = 10;

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

  // The ideas from the root down to, but not including, this one: the
  // breadcrumb trail of a focused branch (#25). An unknown id has none.
  function ancestors(doc, id) {
    var chain = [], n = node(doc, id);
    while (n && n.parent) {
      n = node(doc, n.parent);
      if (!n) return [];
      chain.unshift(n);
    }
    return n ? chain : [];
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

  // The size an idea draws, when no page has measured it: the width above,
  // plus the pill or text height and one extra text line per wrap. The
  // line heights are the page's CSS ones (28 root, 24 main, 20 outer).
  function estimatedSize(doc, n) {
    var len = n.text ? n.text.length : 0;
    var pill = isPill(doc, n.id);
    var raw = pill ? Math.ceil(len * 8.8) + 32 : Math.ceil(len * 7.4) + 4;
    var lines = Math.max(1, Math.ceil(raw / MAX_IDEA_W));
    if (n.id === 'root') return { w: Math.min(raw, MAX_IDEA_W), h: 52 + (lines - 1) * 28 };
    if (pill) return { w: Math.min(raw, MAX_IDEA_W), h: 38 + (lines - 1) * 24 };
    return { w: Math.min(raw, MAX_IDEA_W), h: 25 + (lines - 1) * 20 };
  }

  function trim(t) { return typeof t === 'string' ? t.trim() : ''; }

  // The x/y a new child of parentId gets, by addIdea's own rules: the root's
  // less-crowded side and a free y slot, or beside the parent past the end of
  // its text at the last child's y + 50. `parentWidth` is the parent's drawn
  // width when the page has measured it; `skipId` is left out of the lists
  // (reparenting uses it to leave the moved idea out of its own new home).
  // Returns null when the parent is missing.
  function placeUnder(doc, parentId, parentWidth, skipId) {
    var parent = node(doc, parentId);
    if (!parent) return null;
    if (parentId === 'root') {
      var mains = childrenOf(doc, 'root').filter(function (n) { return n.id !== skipId; });
      var right = mains.filter(function (n) { return n.x >= 0; }).length;
      var side = right <= mains.length - right ? 1 : -1; // right on a tie
      var sameSide = mains.filter(function (n) { return (n.x >= 0 ? 1 : -1) === side; });
      var ry = 0;
      for (var k = 0; k <= 40; k++) {
        var cand = k === 0 ? 0 : (k % 2 === 1 ? -Math.ceil(k / 2) * 140 : (k / 2) * 140);
        var taken = sameSide.some(function (n) { return Math.abs(n.y - cand) < 60; });
        if (!taken) { ry = cand; break; }
        ry = cand;
      }
      return { x: 220 * side, y: ry };
    }
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
    var kids = childrenOf(doc, parentId).filter(function (n) { return n.id !== skipId; });
    return {
      x: parent.x + s * step,
      y: kids.length ? kids[kids.length - 1].y + 50 : parent.y,
    };
  }

  // Where the next idea under parentId goes, without changing the doc:
  // { x, y, color } (the colour only under the root), or null past MAX_DEPTH.
  // `parentWidth` is the parent's drawn width when the page has measured it;
  // without it the width is estimated from the text. The inline editor uses
  // this to show a draft idea before its text exists.
  function placeIdea(doc, parentId, parentWidth) {
    if (!node(doc, parentId) || !canAddUnder(doc, parentId)) return null;
    var place = placeUnder(doc, parentId, parentWidth);
    return {
      x: place.x,
      y: place.y,
      color: parentId === 'root' ? pickFreeColor(doc, place.x >= 0 ? 1 : -1) : null,
    };
  }

  // The colour a new main idea gets: the first one no main idea uses
  // anywhere on the map, else the first unused on the idea's own side
  // (`side` is 1 right, -1 left), else the rotation. Keeps the example
  // map's first five branches on 0-4 as they always were.
  function pickFreeColor(doc, side, skipId) {
    var mains = childrenOf(doc, 'root').filter(function (n) { return n.id !== skipId; });
    var used = mains.map(function (n) { return n.color == null ? 0 : n.color; });
    for (var c = 0; c < COLORS; c++) {
      if (used.indexOf(c) === -1) return c;
    }
    var usedOnSide = mains
      .filter(function (n) { return (n.x >= 0 ? 1 : -1) === side; })
      .map(function (n) { return n.color == null ? 0 : n.color; });
    for (var s = 0; s < COLORS; s++) {
      if (usedOnSide.indexOf(s) === -1) return s;
    }
    return mains.length % COLORS;
  }

  // Give a main idea one of the palette colours; its whole branch follows,
  // because branchColor() walks up to the main-idea ancestor's own. Returns
  // false for anything but a main idea, or a colour off the palette.
  function setColor(doc, id, color) {
    var n = node(doc, id);
    if (!n || n.parent !== 'root') return false;
    if (typeof color !== 'number' || color % 1 !== 0 || color < 0 || color > COLORS - 1) return false;
    n.color = color;
    return true;
  }

  // Add an idea under parentId, placed by the same rules the canvas uses, and
  // return the new node. Returns null for empty text or past MAX_DEPTH.
  function addIdea(doc, parentId, text, parentWidth) {
    var t = trim(text);
    if (!t) return null;
    var p = placeIdea(doc, parentId, parentWidth);
    if (!p) return null;
    var n = { id: newId(), parent: parentId, text: t, x: p.x, y: p.y };
    if (p.color != null) n.color = p.color;
    doc.nodes.push(n);
    return n;
  }

  // Add a sibling next to an idea, above or below, and return the new node.
  // The ideas past it on that branch move one step (50 px) to make room.
  // On the central idea, or a main idea, there is no "beside": the next main
  // idea grows where addIdea() puts one, on the side with fewer of them.
  // Returns null for a missing idea or empty text.
  function addSibling(doc, id, text, above) {
    var n = node(doc, id);
    if (!n) return null;
    if (id === 'root' || n.parent === 'root') return addIdea(doc, 'root', text);
    var t = trim(text);
    if (!t) return null;
    var dy = above ? -50 : 50;
    childrenOf(doc, n.parent).forEach(function (k) {
      if (above ? k.y < n.y : k.y > n.y) moveSubtree(doc, k.id, 0, dy);
    });
    var m = { id: newId(), parent: n.parent, text: t, x: n.x, y: n.y + dy };
    nodes(doc).splice(nodes(doc).indexOf(n) + (above ? 0 : 1), 0, m);
    return m;
  }

  // ── Walking the map from the keyboard ──────────────────────────────────
  // Which idea lies from another one in a direction ('left' | 'right' |
  // 'up' | 'down'), by the anchors alone, so it needs no measuring. A
  // branch's side decides what outwards means: on a left-side branch, the
  // children lie to the left. Returns the idea's id; when nothing lies that
  // way, the nearest idea that does, else the idea itself. An unknown id
  // answers 'root', so the caller always has somewhere to be.

  // Which side of its parent an idea draws on: the render rule (.left), so
  // the keys agree with the picture. The central idea is on neither side.
  function sideOf(doc, n) {
    if (n.id === 'root') return 0;
    var p = node(doc, n.parent);
    if (!p) return 0;
    return n.x >= p.x ? 1 : -1;
  }

  // The item whose y is nearest, ties to doc order (first wins).
  function nearestY(list, y) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var dist = Math.abs(list[i].y - y);
      if (dist < bestD) { best = list[i]; bestD = dist; }
    }
    return best;
  }

  // Nothing on the branch lies that way: the nearest idea whose anchor does,
  // counting the way there double. Primary is the direction's own axis.
  function fallbackIdea(doc, n, dir) {
    var primary = dir === 'left' || dir === 'right' ? 'x' : 'y';
    var sign = dir === 'right' || dir === 'down' ? 1 : -1;
    var best = null, bestScore = Infinity;
    nodes(doc).forEach(function (o) {
      if (o.id === n.id) return;
      var delta = (o[primary] - n[primary]) * sign;
      if (delta <= 0) return;
      var cross = primary === 'x' ? Math.abs(o.y - n.y) : Math.abs(o.x - n.x);
      var score = delta + 2 * cross;
      if (score < bestScore) { best = o; bestScore = score; }
    });
    return best ? best.id : n.id;
  }

  function nextIdea(doc, id, dir) {
    var n = node(doc, id);
    if (!n) return 'root';
    var toward = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    if (toward) {
      var side = sideOf(doc, n);
      if (n.id === 'root') {
        var first = nearestY(childrenOf(doc, 'root').filter(function (k) {
          return sideOf(doc, k) === toward;
        }), 0);
        return first ? first.id : fallbackIdea(doc, n, dir);
      }
      if (side === toward) {
        var kids = childrenOf(doc, n.id);
        var child = kids.length ? nearestY(kids, n.y) : null;
        return child ? child.id : fallbackIdea(doc, n, dir);
      }
      if (side === -toward) return n.parent;
      return fallbackIdea(doc, n, dir);
    }
    // Up or down: the sibling above or below, among main ideas only those
    // on the same side of the centre.
    var sibs = childrenOf(doc, n.parent).filter(function (k) {
      return k.id !== n.id && (n.parent !== 'root' || sideOf(doc, k) === sideOf(doc, n));
    });
    var want = dir === 'up' ? -1 : 1;
    var best = null, bestD = Infinity;
    sibs.forEach(function (k) {
      var delta = (k.y - n.y) * want;
      if (delta <= 0) return;
      if (delta < bestD) { best = k; bestD = delta; }
    });
    return best ? best.id : fallbackIdea(doc, n, dir);
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

  // ── Reparenting (#16) ─────────────────────────────────────────────────
  // Sibling order is array order in doc.nodes, kept in step with the order
  // shown on screen (top to bottom). Links are never touched by a move.

  // Whether `id` may move under `newParentId`: not the root moving, not its
  // current parent, not itself or one of its own ideas (a cycle), and not so
  // deep that something in the moved subtree would pass MAX_DEPTH.
  function canReparent(doc, id, newParentId) {
    var n = node(doc, id), p = node(doc, newParentId);
    if (!n || !p || id === 'root' || n.parent === newParentId) return false;
    var mine = subtree(doc, id);
    for (var i = 0; i < mine.length; i++) if (mine[i].id === newParentId) return false;
    var h = 0; // the moved subtree's own height
    mine.forEach(function (m) { h = Math.max(h, depth(doc, m.id) - depth(doc, id)); });
    return depth(doc, newParentId) + 1 + h <= MAX_DEPTH;
  }

  // How far the next idea sits out from a parent: addIdea's step rule,
  // applied to a measured or estimated width and the parent's pill-ness.
  function childStep(w, pill) {
    return pill
      ? Math.max(150, Math.ceil(w / 2) + CHILD_GAP)
      : Math.max(110, Math.ceil(w) + CHILD_GAP);
  }

  // Move `id` under `newParentId` with its whole subtree, fixing colours and
  // position by the same rules a new idea gets. Returns an undo record for
  // undoMove(), or null when the move is not allowed (canReparent).
  function reparent(doc, id, newParentId, parentWidth) {
    if (!canReparent(doc, id, newParentId)) return null;
    var n = node(doc, id);
    var record = {
      id: id,
      index: nodes(doc).indexOf(n),
      nodes: subtree(doc, id).map(function (m) { return JSON.parse(JSON.stringify(m)); }),
    };
    var oldParent = node(doc, n.parent);
    var oldSide = n.x >= oldParent.x ? 1 : -1;
    var depthBefore = depth(doc, id);
    var widthBefore = estimatedWidth(doc, n);
    // Colours: becoming a main idea keeps the branch colour it came from
    // (or takes the next in rotation); stopping being one loses its own.
    var fromColor = n.color != null ? n.color : branchColor(doc, id);
    n.parent = newParentId;
    if (newParentId === 'root') {
      n.color = fromColor != null ? fromColor : childrenOf(doc, 'root').length % COLORS;
    } else {
      delete n.color;
    }
    // Sit beside the new parent, and bring the subtree along by the same dx/dy.
    var place = placeUnder(doc, newParentId, parentWidth, id);
    moveSubtree(doc, id, place.x - n.x, place.y - n.y);
    // Crossing the centre mirrors the subtree around the moved idea, so its
    // own ideas still sit past its text, now facing outward the other way.
    var newSide = n.x >= node(doc, newParentId).x ? 1 : -1;
    if (oldSide !== newSide) {
      var ax = n.x;
      subtree(doc, id).forEach(function (m) { if (m !== n) m.x = 2 * ax - m.x; });
    }
    // Switching between pill and text changes how far its ideas sit out.
    var depthAfter = depth(doc, id);
    if ((depthBefore <= 1) !== (depthAfter <= 1)) {
      var sh = childStep(estimatedWidth(doc, n), depthAfter <= 1) -
        childStep(widthBefore, depthBefore <= 1);
      if (sh) {
        subtree(doc, id).forEach(function (m) {
          if (m !== n) m.x += sh * (m.x >= n.x ? 1 : -1);
        });
      }
    }
    // Last among its new siblings: array order stays the screen order.
    doc.nodes.splice(record.index, 1);
    doc.nodes.push(n);
    return record;
  }

  // Put back what reparent() changed: parent, x, y and colour on every saved
  // node that still exists, and the moved idea back at its old array index.
  // Refuses when the idea or its old parent is gone. True when it worked.
  function undoMove(doc, record) {
    if (!record || !record.nodes || !record.nodes.length) return false;
    var n = node(doc, record.id);
    if (!n || !node(doc, record.nodes[0].parent)) return false;
    record.nodes.forEach(function (m) {
      var cur = node(doc, m.id);
      if (!cur) return;
      cur.parent = m.parent;
      cur.x = m.x;
      cur.y = m.y;
      if ('color' in m) cur.color = m.color;
      else delete cur.color;
    });
    var i = nodes(doc).indexOf(n);
    if (i >= 0 && i !== record.index && record.index >= 0 && record.index <= nodes(doc).length) {
      doc.nodes.splice(i, 1);
      doc.nodes.splice(record.index, 0, n);
    }
    return true;
  }

  // The idea's siblings on its own side of its parent (the root's x is 0 for
  // main ideas), itself included, sorted by y; ties keep array order.
  function siblingsInOrder(doc, id) {
    var n = node(doc, id);
    if (!n || n.parent == null) return [];
    var p = node(doc, n.parent);
    var px = p ? p.x : 0;
    return nodes(doc)
      .map(function (m, i) { return { n: m, i: i }; })
      .filter(function (e) {
        return e.n.parent === n.parent &&
          ((e.n.x >= px ? 1 : -1) === (n.x >= px ? 1 : -1));
      })
      .sort(function (a, b) { return a.n.y - b.n.y || a.i - b.i; })
      .map(function (e) { return e.n; });
  }

  // Swap an idea's place with the sibling next to it: delta −1 up, +1 down.
  // Each subtree moves vertically by the other's y minus its own, and the two
  // nodes swap in doc.nodes so array order stays the screen order. Doing it
  // again with −delta restores exactly. False with no neighbour.
  function moveSibling(doc, id, delta) {
    var n = node(doc, id);
    if (!n || id === 'root') return false;
    var sibs = siblingsInOrder(doc, id);
    var i = sibs.indexOf(n), j = i + delta;
    if (i < 0 || j < 0 || j >= sibs.length) return false;
    var other = sibs[j];
    // Both deltas first: the first move changes n.y, the second reads it.
    var dy1 = other.y - n.y, dy2 = n.y - other.y;
    moveSubtree(doc, id, 0, dy1);
    moveSubtree(doc, other.id, 0, dy2);
    var list = nodes(doc);
    var a = list.indexOf(n), b = list.indexOf(other);
    list[a] = other;
    list[b] = n;
    return true;
  }

  // Every idea `id` may move under, in tree order from the root, for the
  // Move to… sheet.
  function validParents(doc, id) {
    var out = [];
    (function walk(pid) {
      var p = node(doc, pid);
      if (p && canReparent(doc, id, pid)) out.push(p);
      childrenOf(doc, pid).forEach(function (k) { walk(k.id); });
    })('root');
    return out;
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

  // The doc's nodes and links as one string, for the canvas's undo history.
  // Links are left out when the doc has none, so a snapshot of a map without
  // links restores a map without links.
  function snapshot(doc) {
    var snap = { nodes: nodes(doc) };
    if (doc && doc.links) snap.links = doc.links;
    if (doc && doc.layout) snap.layout = doc.layout;
    return JSON.stringify(snap);
  }

  // Replace a doc's nodes and links with a snapshot's, on the same doc
  // object, so a saver holding the reference keeps saving the same doc.
  function replaceWith(doc, snap) {
    var s = JSON.parse(snap);
    doc.nodes = s.nodes;
    if (s.links) doc.links = s.links;
    else delete doc.links;
    if (s.layout) doc.layout = s.layout;
    else delete doc.layout;
  }

  // ── Version history (#32) ────────────────────────────────────────────
  // Whether a save is worth keeping as a version: it is when it leaves
  // under 80% of the ideas (a big delete, the one edit you most often want
  // back), or when the last kept version is gone or at least 10 minutes
  // old. Otherwise the version just now would be identical to the one
  // before it, and null means "do not keep".
  function versionReason(prevCount, nextCount, lastAt, now) {
    if (nextCount < prevCount * 0.8) return 'big-delete';
    if (!lastAt || now.getTime() - lastAt.getTime() >= 10 * 60000) return 'auto';
    return null;
  }

  // A version laid over the map as it is now, so it can be shown without
  // changing anything: the version's doc with every idea added since
  // appended (in the current order, so the tree stays whole), and their ids
  // listed so the view can fade them. Neither input is touched.
  function compareVersion(versionDoc, currentDoc) {
    var copy = JSON.parse(JSON.stringify(versionDoc));
    var ghostIds = [];
    if (currentDoc && copy.nodes) {
      var have = {};
      copy.nodes.forEach(function (n) { have[n.id] = true; });
      nodes(currentDoc).forEach(function (n) {
        if (!have[n.id]) {
          ghostIds.push(n.id);
          copy.nodes.push(JSON.parse(JSON.stringify(n)));
        }
      });
    }
    return { doc: copy, ghostIds: ghostIds };
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

  // ── Tidy up (#18): one automatic layout ──────────────────────────────────
  // A balanced mind map: the main ideas split right and left by their total
  // subtree height, and each side is a horizontal tree — children stacked
  // top to bottom, a parent centred on its stack. Pure: same doc in, same
  // doc out, so tidying twice changes nothing the second time.

  // Which ideas are hidden under a collapsed one (some strict ancestor has
  // collapsed === true). A collapsed idea itself stays visible.
  function hiddenUnder(byId, all) {
    var hidden = {};
    all.forEach(function (n) {
      var cur = n;
      while (cur && cur.parent != null) {
        cur = byId[cur.parent];
        if (!cur) break;
        if (cur.collapsed === true) { hidden[n.id] = true; break; }
      }
    });
    return hidden;
  }

  // Lay the whole map out. `measure(n)` gives an idea's drawn {w, h} when
  // the page has measured it; the default is estimatedSize. Mutates the doc
  // and returns whether any position or order changed.
  function layout(doc, measure) {
    var all = nodes(doc);
    var root = null;
    var i;
    for (i = 0; i < all.length; i++) if (all[i].parent == null) root = all[i];
    if (!root) return false;
    var byId = {}, kids = {}, idx = {};
    for (i = 0; i < all.length; i++) {
      byId[all[i].id] = all[i];
      idx[all[i].id] = i;
      if (all[i].parent != null) {
        if (!kids[all[i].parent]) kids[all[i].parent] = [];
        kids[all[i].parent].push(all[i]);
      }
    }
    var hidden = hiddenUnder(byId, all);
    var sizeOf = typeof measure === 'function'
      ? function (n) {
          var s = measure(n);
          return s && typeof s.w === 'number' && typeof s.h === 'number'
            ? s
            : estimatedSize(doc, n);
        }
      : function (n) { return estimatedSize(doc, n); };
    var W = {}, H = {};
    all.forEach(function (n) {
      var s = sizeOf(n);
      W[n.id] = typeof s.w === 'number' && isFinite(s.w) ? s.w : 80;
      H[n.id] = typeof s.h === 'number' && isFinite(s.h) ? s.h : 30;
    });
    // Depth once per idea, for pill-ness.
    var depthOf = {};
    all.forEach(function (n) {
      if (n.parent == null) { depthOf[n.id] = 0; return; }
      var d = 0, cur = n;
      while (cur && cur.parent != null) { d++; cur = byId[cur.parent]; }
      depthOf[n.id] = cur ? d : -1;
    });
    // A parent's drawn children in stack order: by current y, ties by array
    // position. Only the order is read, never a distance, so a second run
    // reads the same order it wrote.
    function stackOrder(pid) {
      return (kids[pid] || [])
        .filter(function (c) { return !hidden[c.id]; })
        .sort(function (a, b) { return a.y - b.y || idx[a.id] - idx[b.id]; });
    }
    // Block heights, bottom-up: an idea fills at least its own height, else
    // its children's stack plus the gap between them. A collapsed idea, like
    // a leaf, is just its own height.
    var blockH = {};
    (function measureBlocks(n) {
      var cs = stackOrder(n.id);
      var sum = 0;
      cs.forEach(function (c) { sum += measureBlocks(c); });
      var h = H[n.id];
      if (cs.length) h = Math.max(h, sum + SIBLING_GAP * (cs.length - 1));
      blockH[n.id] = h;
      return h;
    })(root);
    // The main sequence: right side (x >= 0) by y, then left side by y,
    // ties by array position. The first k of it goes right, the rest left.
    var seq = [];
    [1, -1].forEach(function (side) {
      stackOrder(root.id).forEach(function (m) {
        if ((m.x >= 0 ? 1 : -1) === side) seq.push(m);
      });
    });
    // Choose k to balance the two sides' total height, gaps counted; a tie
    // takes the larger k, so one main idea goes right.
    var k = seq.length;
    if (seq.length > 1) {
      var grand = 0;
      seq.forEach(function (m) { grand += blockH[m.id]; });
      grand += MAIN_GAP * (seq.length - 1);
      var acc = 0, best = -1;
      for (var kk = 1; kk < seq.length; kk++) {
        acc += blockH[seq[kk - 1].id];
        var leftSum = acc + MAIN_GAP * (kk - 1);
        var diff = Math.abs(leftSum - (grand - leftSum));
        if (best < 0 || diff <= best) { best = diff; k = kk; }
      }
    }
    // Place top-down. Each side's stack is centred on the centre idea; a
    // node sits in the middle of its own block, its children's stack centred
    // on it, each a step further out from its parent.
    var at = {};
    at[root.id] = { x: 0, y: 0 };
    var rootW = W[root.id];
    function placeKids(n, side, gap) {
      var cs = stackOrder(n.id);
      if (!cs.length) return;
      var total = 0;
      cs.forEach(function (c) { total += blockH[c.id]; });
      total += gap * (cs.length - 1);
      var top = at[n.id].y - total / 2;
      var step = childStep(W[n.id], depthOf[n.id] <= 1);
      cs.forEach(function (c) {
        at[c.id] = {
          x: at[n.id].x + side * step,
          y: top + blockH[c.id] / 2,
        };
        top += blockH[c.id] + gap;
        placeKids(c, side, SIBLING_GAP);
      });
    }
    [1, -1].forEach(function (side, si) {
      var list = si === 0 ? seq.slice(0, k) : seq.slice(k);
      if (!list.length) return;
      var total = 0;
      list.forEach(function (m) { total += blockH[m.id]; });
      total += MAIN_GAP * (list.length - 1);
      var top = -total / 2;
      list.forEach(function (m) {
        at[m.id] = {
          x: side * (rootW / 2 + ROOT_GAP + W[m.id] / 2),
          y: top + blockH[m.id] / 2,
        };
        top += blockH[m.id] + MAIN_GAP;
        placeKids(m, side, SIBLING_GAP);
      });
    });
    // Write it back. Hidden subtrees move rigidly with their nearest
    // visible ancestor; every coordinate lands on a whole pixel.
    var old = {};
    all.forEach(function (n) { old[n.id] = [n.x, n.y]; });
    var moved = false;
    all.forEach(function (n) {
      var p = at[n.id];
      if (!p) return;
      var x = Math.round(p.x), y = Math.round(p.y);
      if (x !== n.x || y !== n.y) moved = true;
      n.x = x;
      n.y = y;
    });
    all.forEach(function (n) {
      if (!hidden[n.id]) return;
      var anc = byId[n.parent];
      while (anc && hidden[anc.id]) anc = byId[anc.parent];
      if (!anc || !at[anc.id]) return;
      var dx = anc.x - old[anc.id][0];
      var dy = anc.y - old[anc.id][1];
      if (dx || dy) moved = true;
      n.x = Math.round(old[n.id][0] + dx);
      n.y = Math.round(old[n.id][1] + dy);
    });
    // Rewrite the array in pre-order — the centre first, then each idea's
    // children in their new order — so the order kept is the order shown.
    // A collapsed idea's hidden children keep their own order after it.
    var order = [];
    (function walk(n) {
      order.push(n);
      if (n === root) { seq.forEach(walk); return; }
      var cs = kids[n.id] || [];
      if (!cs.length) return;
      if (n.collapsed === true || hidden[n.id]) cs.forEach(walk);
      else stackOrder(n.id).forEach(walk);
    })(root);
    if (order.length === all.length) {
      for (i = 0; i < all.length; i++) {
        if (order[i] !== all[i]) { moved = true; doc.nodes = order; break; }
      }
    }
    return moved;
  }

  // The first pair of drawn ideas whose boxes overlap, as [idA, idB], or
  // null. Boxes as the page draws them: a pill centred on its anchor, an
  // outer idea's text running from its anchor away from its parent. Ideas
  // hidden under a collapsed idea are not drawn, so not checked.
  function overlaps(doc, measure) {
    var all = nodes(doc);
    var byId = {};
    all.forEach(function (n) { byId[n.id] = n; });
    var hidden = hiddenUnder(byId, all);
    var boxes = {}, ids = [];
    all.forEach(function (n) {
      if (hidden[n.id]) return;
      var s = typeof measure === 'function' ? measure(n) : null;
      if (!s || typeof s.w !== 'number' || typeof s.h !== 'number') s = estimatedSize(doc, n);
      var x0;
      if (n.parent == null || isPill(doc, n.id)) x0 = n.x - s.w / 2;
      else {
        var p = byId[n.parent];
        x0 = p && n.x < p.x ? n.x - s.w : n.x;
      }
      boxes[n.id] = { x: x0, y: n.y - s.h / 2, w: s.w, h: s.h };
      ids.push(n.id);
    });
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = boxes[ids[i]], b = boxes[ids[j]];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          return [ids[i], ids[j]];
        }
      }
    }
    return null;
  }

  // Turn a main idea's branch to face outward again after it was dragged
  // across the centre: when most of its direct children sit between it and
  // the centre, mirror every descendant's x around it. Returns whether it
  // flipped; any other idea is left alone.
  function faceOutward(doc, id) {
    var n = node(doc, id);
    if (!n || n.parent !== 'root') return false;
    var kids = childrenOf(doc, n.id);
    if (!kids.length) return false;
    var side = n.x >= 0 ? 1 : -1;
    var inward = 0, outward = 0;
    kids.forEach(function (c) {
      var d = (c.x - n.x) * side;
      if (d < 0) inward++;
      else if (d > 0) outward++;
    });
    if (inward <= outward) return false;
    subtree(doc, id).forEach(function (m) {
      if (m !== n) m.x = 2 * n.x - m.x;
    });
    return true;
  }

  // Whether a map keeps itself tidy: every edit relays it out as it saves.
  function isAutoLayout(doc) {
    return !!(doc && doc.layout && doc.layout.auto);
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
    // A cycle would mean a node is its own ancestor; a chain longer than
    // MAX_DEPTH is just as unreadable, so the server enforces it too.
    for (var k = 0; k < doc.nodes.length; k++) {
      var c = doc.nodes[k], hops = 0, p = c;
      while (p && p.parent) {
        p = byId[p.parent];
        if (++hops > doc.nodes.length) return 'cycle';
        if (hops > MAX_DEPTH) return 'too deep';
      }
    }
    // The optional layout marker (#18): absent is fine; if present, a plain
    // object whose only key is the boolean `auto`.
    if (doc.layout !== undefined) {
      if (!doc.layout || typeof doc.layout !== 'object' || Array.isArray(doc.layout)) return 'bad layout';
      var lkeys = Object.keys(doc.layout);
      if (lkeys.length !== 1 || lkeys[0] !== 'auto' || typeof doc.layout.auto !== 'boolean') return 'bad layout';
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

  // Find (#23): a query folded to lowercase without diacritics, so 'Cafe'
  // meets 'Café' and 'BELEM' meets 'Belém'.
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Every place a trimmed query matches, in reading order: ideas depth-first
  // from the centre, then the named links in doc order. One result per idea
  // (its text); an unnamed link has nothing to match. Find never edits, so
  // the doc comes back untouched.
  function search(doc, query) {
    var q = fold(query).trim();
    if (!q) return [];
    var out = [];
    (function walk(pid) {
      childrenOf(doc, pid).forEach(function (n) {
        if (fold(n.text).indexOf(q) !== -1) out.push({ kind: 'idea', id: n.id, field: 'text' });
        walk(n.id);
      });
    })('root');
    links(doc).forEach(function (l) {
      if (l.text && fold(l.text).indexOf(q) !== -1) {
        out.push({ kind: 'link', id: l.id, field: 'text' });
      }
    });
    return out;
  }

  // The tree as a screen reader should hear it: every idea in pre-order
  // from the centre, each with its level (the central idea is level 1),
  // its rank among the siblings it is shown with, how many sit at that
  // rank, and whether it has ideas under it (for aria-expanded). A node
  // whose parent is gone never appears. Pure: the doc comes back untouched.
  function treeOrder(doc) {
    var out = [];
    var rootN = node(doc, 'root');
    if (!rootN) return out;
    out.push({ node: rootN, level: 1, pos: 1, size: 1,
      hasChildren: childrenOf(doc, 'root').length > 0 });
    (function walk(pid, level) {
      var kids = childrenOf(doc, pid);
      kids.forEach(function (n, i) {
        out.push({ node: n, level: level, pos: i + 1, size: kids.length,
          hasChildren: childrenOf(doc, n.id).length > 0 });
        walk(n.id, level + 1);
      });
    })('root', 2);
    return out;
  }

  return {
    MAX_NODES: MAX_NODES,
    MAX_TEXT: MAX_TEXT,
    MAX_ROOT_TEXT: MAX_ROOT_TEXT,
    MAX_DEPTH: MAX_DEPTH,
    MAX_LINKS: MAX_LINKS,
    MAX_LINK_TEXT: MAX_LINK_TEXT,
    COLORS: COLORS,
    pickFreeColor: pickFreeColor,
    setColor: setColor,
    newId: newId,
    node: node,
    nodes: nodes,
    childrenOf: childrenOf,
    depth: depth,
    ancestors: ancestors,
    branchColor: branchColor,
    countUnder: countUnder,
    ideaCount: ideaCount,
    outline: outline,
    outlineFit: outlineFit,
    isPill: isPill,
    canAddUnder: canAddUnder,
    addIdea: addIdea,
    placeIdea: placeIdea,
    addSibling: addSibling,
    nextIdea: nextIdea,
    rename: rename,
    moveSubtree: moveSubtree,
    canReparent: canReparent,
    reparent: reparent,
    undoMove: undoMove,
    siblingsInOrder: siblingsInOrder,
    moveSibling: moveSibling,
    validParents: validParents,
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
    search: search,
    treeOrder: treeOrder,
    snapshot: snapshot,
    replaceWith: replaceWith,
    versionReason: versionReason,
    compareVersion: compareVersion,
    validate: validate,
    layout: layout,
    estimatedSize: estimatedSize,
    overlaps: overlaps,
    faceOutward: faceOutward,
    isAutoLayout: isAutoLayout,
  };
});
