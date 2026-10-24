/* Importing a map from a file or a pasted outline (#28). Pure: no DOM, no
 * network. Each format is read into a small tree, buildDoc fits that tree to
 * the map model's limits (text lengths, 10 levels, 500 ideas), lays it out
 * tidy and validates it with M2Model, and the page POSTs the finished doc.
 * UMD: window.M2Import, or module.exports for node --test. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./map-model'));
  else root.M2Import = factory(root.M2Model);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var MAX_FILE_BYTES = 2 * 1024 * 1024;

  var ERR_UNREADABLE = 'This file isn’t a mind map M2 can read (expected Markdown, OPML, FreeMind or M2)';
  var ERR_TOO_BIG = 'This file is too big to import (the limit is 2 MB)';
  var ERR_EMPTY = 'This file is empty';
  var ERR_DAMAGED_M2 = 'This M2 file is damaged, so it can’t be imported';

  // CRLF and a UTF-8 BOM are normalised away before any format is read.
  function normalise(text) {
    return String(text == null ? '' : text)
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n');
  }

  // Every idea's words are one line: newlines and runs of spaces collapse.
  function collapse(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function lostZero() { return { notes: 0, webLinks: 0, tasks: 0, links: 0 }; }

  // ── A small safe XML reader ──────────────────────────────────────────────
  // Shared by OPML and FreeMind so the same code runs in the page and in
  // node --test (no DOMParser). Only the five predefined entities and
  // numeric references are expanded, custom entities never are, and a
  // DOCTYPE is skipped without reading its internals.
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (all, body) {
      if (body.charAt(0) === '#') {
        var code = (body.charAt(1) === 'x' || body.charAt(1) === 'X')
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (isFinite(code) && code > 0 && code <= 0x10FFFF) {
          try { return String.fromCodePoint(code); } catch (e) { return all; }
        }
        return all;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : all;
    });
  }

  // Returns { root } (a #document with element children) or { error }.
  // Explicit stack, never recursion, so a hostile file cannot nest forever
  // in the parser itself.
  function parseXml(text) {
    var s = normalise(text);
    var n = s.length;
    var i = 0;
    var top = { name: '#document', attrs: {}, children: [], text: '' };
    var stack = [top];
    var bad = { error: ERR_UNREADABLE };

    function put(t) { if (t) stack[stack.length - 1].text += decodeEntities(t); }
    function cur() { return stack[stack.length - 1]; }

    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt === -1) { put(s.slice(i)); break; }
      if (lt > i) put(s.slice(i, lt));
      if (s.substr(lt, 4) === '<!--') {
        var cend = s.indexOf('-->', lt + 4);
        if (cend === -1) return bad;
        i = cend + 3;
        continue;
      }
      if (s.substr(lt, 9) === '<![CDATA[') {
        var dend = s.indexOf(']]>', lt + 9);
        if (dend === -1) return bad;
        cur().text += s.slice(lt + 9, dend); // raw text, never entity-decoded
        i = dend + 3;
        continue;
      }
      if (s.substr(lt, 2) === '<?') {
        var pend = s.indexOf('?>', lt + 2);
        if (pend === -1) return bad;
        i = pend + 2;
        continue;
      }
      if (s.substr(lt, 2) === '<!') {
        // A DOCTYPE (or any declaration): skipped, never expanded. A '[' opens
        // an internal subset, which may itself contain '>'.
        var tend = lt + 2, depth = 0;
        while (tend < n) {
          var ch = s.charAt(tend);
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '>' && depth <= 0) break;
          tend++;
        }
        if (tend >= n) return bad;
        i = tend + 1;
        continue;
      }
      // The tag ends at the first > outside a quoted attribute value.
      var gt = -1, quote = null;
      for (var q = lt + 1; q < n; q++) {
        var qc = s.charAt(q);
        if (quote) { if (qc === quote) quote = null; }
        else if (qc === '"' || qc === "'") quote = qc;
        else if (qc === '>') { gt = q; break; }
      }
      if (gt === -1) return bad;
      var raw = s.slice(lt + 1, gt);
      if (raw.charAt(0) === '/') {
        var closeName = raw.slice(1).trim();
        if (stack.length < 2 || cur().name !== closeName) return bad;
        stack.pop();
        i = gt + 1;
        continue;
      }
      var selfClose = raw.charAt(raw.length - 1) === '/';
      if (selfClose) raw = raw.slice(0, -1);
      var nameMatch = raw.match(/^([^\s/>]+)/);
      if (!nameMatch) return bad;
      var el = { name: nameMatch[1], attrs: {}, children: [], text: '' };
      var attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
      while ((am = attrRe.exec(raw))) {
        el.attrs[am[1]] = decodeEntities(am[3] !== undefined ? am[3] : am[4]);
      }
      cur().children.push(el);
      if (!selfClose) stack.push(el);
      i = gt + 1;
    }
    if (stack.length !== 1) return bad;
    return { root: top };
  }

  // An element's whole text, tags stripped.
  function fullText(el) {
    var out = el.text || '';
    (el.children || []).forEach(function (c) { out += ' ' + fullText(c); });
    return out;
  }

  function byName(el, name) {
    var lower = String(name).toLowerCase();
    return (el.children || []).filter(function (c) {
      return String(c.name).toLowerCase() === lower;
    });
  }

  // ── Indentation shared by Markdown lists and plain text outlines ─────────
  // A tab counts as one level; spaces divide by the smallest non-zero space
  // indent in the file, so a file indented by 2 or by 4 is found on its own.
  function spaceUnit(lines) {
    var min = 0;
    lines.forEach(function (line) {
      var m = /^ */.exec(line)[0].length;
      if (m > 0 && (min === 0 || m < min)) min = m;
    });
    return min || 2;
  }

  function indentLevel(prefix, unit) {
    var tabs = 0, spaces = 0;
    for (var i = 0; i < prefix.length; i++) {
      if (prefix.charAt(i) === '\t') tabs++; else spaces++;
    }
    return tabs + Math.floor(spaces / unit);
  }

  function tree(format, rootItem, lost, arrows) {
    return {
      format: format,
      root: rootItem,
      lost: lost || lostZero(),
      arrows: arrows || [],
    };
  }

  // ── Plain text outlines ─────────────────────────────────────────────────
  function plainText(text) {
    var lines = normalise(text).split('\n');
    var unit = spaceUnit(lines);
    var entries = [];
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var prefix = /^[ \t]*/.exec(line)[0];
      var body = collapse(line.slice(prefix.length)
        .replace(/^(?:[-*+•]|\d+[.)])\s+/, ''));
      if (!body) return;
      entries.push({ level: indentLevel(prefix, unit), text: body });
    });
    if (!entries.length) return tree('text', { text: null, children: [] });
    var min = entries[0].level;
    entries.forEach(function (e) { if (e.level < min) min = e.level; });
    var tops = entries.filter(function (e) { return e.level === min; }).length;
    var firstIsRoot = entries[0].level === min && tops === 1;
    var rootItem = { text: firstIsRoot ? entries[0].text : null, children: [] };
    var stack = [];
    entries.slice(firstIsRoot ? 1 : 0).forEach(function (e) {
      // Directly under the root is level 1 when there is no root line.
      var level = e.level - min + (firstIsRoot ? 0 : 1);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      var parent = stack.length ? stack[stack.length - 1].item : rootItem;
      var item = { text: e.text, children: [] };
      parent.children.push(item);
      stack.push({ level: level, item: item });
    });
    return tree('text', rootItem);
  }

  // Markdown's inline syntax comes out as plain words; a link keeps its
  // words and is counted as a web address M2 cannot keep.
  function cleanInline(raw, lost) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, function (all, label) {
      if (lost) lost.webLinks++;
      return label;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1');
    return collapse(s);
  }

  // ── Markdown ────────────────────────────────────────────────────────────
  function markdown(text) {
    var src = normalise(text);
    var raw = src.split('\n');
    // Optional front matter: --- on its own first line, closed by another.
    var start = 0;
    if (/^---\s*$/.test(raw[0] || '')) {
      for (var f = 1; f < raw.length; f++) {
        if (/^---\s*$/.test(raw[f])) { start = f + 1; break; }
      }
    }
    var lines = raw.slice(start);
    var unit = spaceUnit(lines);
    var lost = lostZero();
    var rootItem = { text: null, children: [] };
    var headStack = []; // headings nested by their level, {level, item}
    var listStack = []; // list items nested by indentation, {level, item}
    var headingSeen = false;
    var sawList = false;
    var noteBlock = false;
    var inFence = false;
    var lastItem = null;

    lines.forEach(function (line) {
      if (inFence) {
        if (/^\s*```/.test(line)) { inFence = false; noteBlock = false; }
        return;
      }
      if (/^\s*```/.test(line)) {
        inFence = true;
        if (!noteBlock) { if (lastItem) lost.notes++; noteBlock = true; }
        return;
      }
      if (!line.trim()) { noteBlock = false; return; }

      var hm = /^([ \t]*)(#{1,6})\s+(.*)$/.exec(line);
      if (hm) {
        sawList = false;
        listStack = [];
        noteBlock = false;
        var hashes = hm[2].length;
        var headingText = cleanInline(hm[3].replace(/\s+#+\s*$/, ''), lost);
        headingSeen = true;
        if (hashes === 1 && rootItem.text == null) {
          rootItem.text = headingText;
          headStack = [{ level: 0, item: rootItem }];
          lastItem = rootItem;
          return;
        }
        // ## is a main idea, ### one under it, and a later # is a main idea.
        var level = hashes === 1 ? 1 : hashes - 1;
        while (headStack.length && headStack[headStack.length - 1].level >= level) headStack.pop();
        var parent = headStack.length ? headStack[headStack.length - 1].item : rootItem;
        var hItem = { text: headingText, children: [] };
        parent.children.push(hItem);
        headStack.push({ level: level, item: hItem });
        lastItem = hItem;
        return;
      }

      var bm = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (bm) {
        sawList = true;
        noteBlock = false;
        var content = bm[2];
        var task = /^\[([ xX])\]\s*(.*)$/.exec(content);
        if (task) { lost.tasks++; content = task[2]; }
        var ideaText = cleanInline(content, lost);
        if (!ideaText) return; // a bare bullet holds no idea; its list goes up
        var level2 = indentLevel(bm[1], unit);
        while (listStack.length && listStack[listStack.length - 1].level >= level2) listStack.pop();
        var parent2 = listStack.length ? listStack[listStack.length - 1].item
          : (headStack.length ? headStack[headStack.length - 1].item : rootItem);
        var item = { text: ideaText, children: [] };
        parent2.children.push(item);
        listStack.push({ level: level2, item: item });
        lastItem = item;
        return;
      }

      // A paragraph, quote or code block: one note per block, on the idea above.
      if (!noteBlock) {
        if (lastItem) lost.notes++;
        noteBlock = true;
      }
    });

    if (!headingSeen && !sawList) {
      var plain = plainText(src);
      if (plain && plain.error) return plain;
      plain.lost = lost; // link and task counts found on the way still count
      return plain;
    }
    return tree('markdown', rootItem, lost);
  }

  // ── OPML ────────────────────────────────────────────────────────────────
  function opml(text) {
    var parsed = parseXml(text);
    if (!parsed || parsed.error) return { error: ERR_UNREADABLE };
    var opmlEl = byName(parsed.root, 'opml')[0];
    if (!opmlEl) return { error: ERR_UNREADABLE };
    var body = byName(opmlEl, 'body')[0];
    if (!body) return { error: ERR_UNREADABLE };
    var lost = lostZero();

    function toItem(el) {
      var text = el.attrs.text != null ? el.attrs.text : el.attrs.title;
      var item = { text: collapse(text), children: [] };
      if (el.attrs._note && String(el.attrs._note).trim()) lost.notes++;
      if (el.attrs.url || el.attrs.htmlUrl || el.attrs.xmlUrl) lost.webLinks++;
      if (String(el.attrs._status || '').toLowerCase() === 'checked') lost.tasks++;
      byName(el, 'outline').forEach(function (kid) {
        var child = toItem(kid);
        // An empty item holds no idea: the ideas under it move up.
        if (!child.text) item.children = item.children.concat(child.children);
        else item.children.push(child);
      });
      return item;
    }

    var tops = byName(body, 'outline');
    var rootItem;
    if (tops.length === 1) {
      rootItem = toItem(tops[0]);
      if (!rootItem.text) rootItem.text = null; // fall back to the file name
    } else {
      var head = byName(opmlEl, 'head')[0];
      var titleEl = head ? byName(head, 'title')[0] : null;
      rootItem = { text: titleEl ? collapse(fullText(titleEl)) : null, children: [] };
      tops.forEach(function (top) {
        var item = toItem(top);
        if (!item.text) rootItem.children = rootItem.children.concat(item.children);
        else rootItem.children.push(item);
      });
    }
    return tree('opml', rootItem, lost);
  }

  // ── FreeMind / Freeplane ────────────────────────────────────────────────
  function freemind(text) {
    var parsed = parseXml(text);
    if (!parsed || parsed.error) return { error: ERR_UNREADABLE };
    var mapEl = byName(parsed.root, 'map')[0];
    if (!mapEl) return { error: ERR_UNREADABLE };
    var top = byName(mapEl, 'node')[0];
    if (!top) return { error: ERR_UNREADABLE };
    var lost = lostZero();
    var arrows = [];

    function typeOf(el) { return String(el.attrs.TYPE || '').toUpperCase(); }

    function nodeText(el) {
      if (el.attrs.TEXT != null) return collapse(el.attrs.TEXT);
      var rich = byName(el, 'richcontent').filter(function (c) { return typeOf(c) === 'NODE'; })[0];
      return rich ? collapse(fullText(rich)) : '';
    }

    function toItem(el) {
      var item = { text: nodeText(el), children: [], srcId: el.attrs.ID || null };
      if (el.attrs.LINK) lost.webLinks++;
      byName(el, 'richcontent').forEach(function (c) {
        if (typeOf(c) === 'NOTE' || typeOf(c) === 'DETAILS') {
          if (collapse(fullText(c))) lost.notes++;
        }
      });
      if (byName(el, 'details').length) lost.notes++;
      byName(el, 'arrowlink').forEach(function (a) {
        if (el.attrs.ID && a.attrs.DESTINATION) {
          arrows.push({ from: el.attrs.ID, to: a.attrs.DESTINATION, text: a.attrs.MIDDLE_LABEL || '' });
        }
      });
      byName(el, 'node').forEach(function (kid) { item.children.push(toItem(kid)); });
      return item;
    }

    return tree('freemind', toItem(top), lost, arrows);
  }

  // ── An M2 map file ──────────────────────────────────────────────────────
  // The doc exactly as M2 stores it: bare, or wrapped as { doc } or
  // { map: { doc } }. Kept as it is, positions included.
  function m2(text) {
    var data;
    try {
      data = JSON.parse(normalise(text));
    } catch (e) {
      return { error: ERR_DAMAGED_M2 };
    }
    var doc = data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.doc && typeof data.doc === 'object') doc = data.doc;
      else if (data.map && data.map.doc) doc = data.map.doc;
    }
    if (M.validate(doc)) return { error: ERR_DAMAGED_M2 };
    return { format: 'm2', doc: doc, lost: lostZero(), arrows: [] };
  }

  // ── Which format is this? ───────────────────────────────────────────────
  // The extension first, then a look at the contents (always for pasted text).
  function sniff(text, name) {
    var lower = String(name || '').toLowerCase();
    var dot = lower.lastIndexOf('.');
    if (dot !== -1) {
      var ext = lower.slice(dot + 1);
      if (ext === 'md' || ext === 'markdown') return 'markdown';
      if (ext === 'opml') return 'opml';
      if (ext === 'mm') return 'freemind';
      if (ext === 'json') return 'm2';
      if (ext === 'txt') return /^#{1,6}\s+\S/m.test(text) ? 'markdown' : 'text';
    }
    var head = normalise(text).replace(/^\s+/, '').slice(0, 1000);
    if (head.charAt(0) === '{' || head.charAt(0) === '[') return 'm2';
    if (/<opml[\s>]/i.test(head)) return 'opml';
    if (/<map[\s>]/i.test(head)) return 'freemind';
    if (/^\s*(?:#{1,6}\s+\S|[-*+]\s+\S|\d+[.)]\s+\S)/m.test(text)) return 'markdown';
    return 'text';
  }

  // ── Fitting a tree into an M2 doc ───────────────────────────────────────
  function shorten(s, max) {
    var t = collapse(s);
    if (t.length <= max) return { text: t, cut: false };
    return { text: t.slice(0, max - 1) + '…', cut: true };
  }

  // Empty items hold no idea: they are skipped and their children move up.
  function cleanList(list) {
    var out = [];
    (list || []).forEach(function (item) {
      var text = collapse(item.text);
      if (!text) { out = out.concat(cleanList(item.children)); return; }
      out.push({ text: text, children: cleanList(item.children), srcId: item.srcId });
    });
    return out;
  }

  function labelFromName(name) {
    if (!name) return null;
    var base = String(name).replace(/^.*[\\/]/, '');
    var dot = base.lastIndexOf('.');
    if (dot > 0) base = base.slice(0, dot);
    return base || null;
  }

  function depthReport(doc) {
    var byId = {}, levels = 0;
    doc.nodes.forEach(function (n) { byId[n.id] = n; });
    doc.nodes.forEach(function (n) {
      var d = 0, cur = n;
      while (cur && cur.parent) { d++; cur = byId[cur.parent]; }
      if (d > levels) levels = d;
    });
    return levels;
  }

  function buildDoc(t, name) {
    if (!t || t.error) return t || { error: ERR_UNREADABLE };
    var label = name || 'Pasted outline';
    if (t.format === 'm2') {
      return {
        doc: t.doc,
        name: label,
        format: 'm2',
        ideaCount: t.doc.nodes.length,
        levels: depthReport(t.doc),
        total: t.doc.nodes.length,
        flattened: 0,
        shortened: 0,
        rootShortened: false,
        lost: lostZero(),
      };
    }

    var src = t.root || { text: null, children: [] };
    var rootText = collapse(src.text) || labelFromName(name) || 'Imported map';
    var rootShort = shorten(rootText, M.MAX_ROOT_TEXT);
    var lost = t.lost || lostZero();

    var nodes = [{ id: 'root', parent: null, text: rootShort.text, x: 0, y: 0 }];
    var byParent = {}; // how many children each idea already has
    var srcToId = {}; // a FreeMind node's ID → the kept idea's id
    var state = { total: 1, levels: 0, flattened: 0, shortened: 0 };

    function visit(item, parentId, depth, anc9) {
      state.total++;
      var kept = nodes.length < M.MAX_NODES;
      var flat = depth > M.MAX_DEPTH;
      var myId = null;
      var myAnc9 = anc9;
      if (kept) {
        var attach = flat ? (anc9 || parentId) : parentId;
        var s = shorten(item.text, M.MAX_TEXT);
        if (s.cut) state.shortened++;
        var idx = byParent[attach] = (byParent[attach] || 0) + 1;
        var n = { id: M.newId(), parent: attach, text: s.text, x: 0, y: idx - 1 };
        nodes.push(n);
        myId = n.id;
        if (flat) state.flattened++;
        if (item.srcId) srcToId[item.srcId] = n.id;
        var myDepth = flat ? M.MAX_DEPTH : depth;
        if (depth === M.MAX_DEPTH - 1) myAnc9 = n.id;
        if (myDepth > state.levels) state.levels = myDepth;
      }
      (item.children || []).forEach(function (kid) {
        visit(kid, myId || parentId, depth + 1, myAnc9);
      });
    }
    cleanList(src.children).forEach(function (kid) { visit(kid, 'root', 1, null); });

    var doc = { v: 1, nodes: nodes, layout: { auto: true } };

    // FreeMind arrows become named links between the ideas they joined, when
    // both ends were kept, once each, and under the 200-link limit.
    var links = [];
    (t.arrows || []).forEach(function (a) {
      var from = srcToId[a.from], to = srcToId[a.to];
      if (!from || !to || from === to) { lost.links++; return; }
      var dup = links.some(function (l) {
        return (l.from === from && l.to === to) || (l.from === to && l.to === from);
      });
      if (dup) return;
      if (links.length >= M.MAX_LINKS) { lost.links++; return; }
      links.push({ id: M.newId(), from: from, to: to, text: shorten(a.text, M.MAX_LINK_TEXT).text });
    });
    if (links.length) doc.links = links;

    M.layout(doc); // tidy, no measure: the same estimate every page uses
    // Colours in the order the ideas are shown: teal, amber, violet, and
    // round the ten colours like any new main idea (#z).
    M.childrenOf(doc, 'root').forEach(function (n, i) { n.color = i % M.COLORS; });

    var why = M.validate(doc);
    if (why) return { error: ERR_UNREADABLE };

    return {
      doc: doc,
      name: label,
      format: t.format,
      ideaCount: nodes.length,
      levels: state.levels,
      total: state.total,
      flattened: state.flattened,
      shortened: state.shortened,
      rootShortened: rootShort.cut,
      lost: lost,
    };
  }

  // ── Reading a file or pasted outline ────────────────────────────────────
  function read(text, name) {
    var s = normalise(text);
    if (!s.trim()) return { error: ERR_EMPTY };
    // A NUL or other C0 control character means this is not a text outline.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) return { error: ERR_UNREADABLE };
    var format = sniff(s, name);
    var parsed;
    if (format === 'markdown') parsed = markdown(s);
    else if (format === 'opml') parsed = opml(s);
    else if (format === 'freemind') parsed = freemind(s);
    else if (format === 'm2') parsed = m2(s);
    else parsed = plainText(s);
    if (!parsed || parsed.error) return parsed || { error: ERR_UNREADABLE };
    return buildDoc(parsed, name);
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // The summary before anything is created: the headline first, then one
  // line for each thing that had to change to fit M2.
  function summaryLines(result) {
    if (!result || result.error) return [];
    var ideas = result.ideaCount + ' ' + plural(result.ideaCount, 'idea', 'ideas');
    var levels = result.levels > 0
      ? ', ' + result.levels + ' ' + plural(result.levels, 'level', 'levels') + ' deep'
      : '';
    var lines = [result.name + ': ' + ideas + levels + '. Import?'];
    if (result.total > M.MAX_NODES) {
      lines.push('Imported the first ' + M.MAX_NODES + ' ideas of ' + result.total + '.');
    }
    if (result.flattened > 0) {
      lines.push(result.flattened + ' ' + plural(result.flattened, 'idea was', 'ideas were') +
        ' deeper than ' + M.MAX_DEPTH + ' levels moved up to level ' + M.MAX_DEPTH + '.');
    }
    if (result.shortened > 0) {
      lines.push(result.shortened + ' ' + plural(result.shortened, 'idea was', 'ideas were') +
        ' shortened to fit ' + M.MAX_TEXT + ' characters.');
    }
    if (result.rootShortened) {
      lines.push('The central idea was shortened to fit ' + M.MAX_ROOT_TEXT + ' characters.');
    }
    var lost = result.lost || {};
    var parts = [];
    if (lost.notes) parts.push(lost.notes + ' ' + plural(lost.notes, 'note', 'notes'));
    if (lost.webLinks) parts.push(lost.webLinks + ' ' + plural(lost.webLinks, 'web address', 'web addresses'));
    if (lost.tasks) parts.push(lost.tasks + ' ' + plural(lost.tasks, 'task tick', 'task ticks'));
    if (parts.length) lines.push('Left out: ' + parts.join(', ') + '. M2 ideas hold text only.');
    return lines;
  }

  return {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    ERR_UNREADABLE: ERR_UNREADABLE,
    ERR_TOO_BIG: ERR_TOO_BIG,
    ERR_EMPTY: ERR_EMPTY,
    ERR_DAMAGED_M2: ERR_DAMAGED_M2,
    parseXml: parseXml,
    markdown: markdown,
    plainText: plainText,
    opml: opml,
    freemind: freemind,
    m2: m2,
    sniff: sniff,
    buildDoc: buildDoc,
    read: read,
    summaryLines: summaryLines,
  };
});
