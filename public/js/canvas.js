/* The map canvas: one map drawn on dotted paper, edited in place.
 *
 * A world div (translate + scale) holds an SVG branch layer and one button
 * per idea, so the browser's own focus and keyboard work. Branch geometry is
 * measured from the rendered idea boxes, so the canvas re-measures after
 * every change. All strings reach the DOM through textContent. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var doc = null; // set per view, below

  var COLOR_CLASSES = ['c-teal', 'c-amber', 'c-violet', 'c-rose', 'c-sky'];
  var DOT_CLASSES = ['b-teal', 'b-amber', 'b-violet', 'b-rose', 'b-sky'];
  var COLOR_NAMES = ['teal', 'amber', 'violet', 'rose', 'sky'];

  var ICONS = {
    grid: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    fit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    share: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    link: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(name) {
    var span = el('span');
    span.innerHTML = ICONS[name]; // static markup written here, never user text
    return span.firstChild;
  }

  var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Small stand-ins used only if the native UI kit did not load: the app
  // stays usable, just plainer.
  var un = root.unNative || {
    presentSheet: function (opts) {
      var input = opts.content.querySelector('input');
      var form = opts.content.querySelector('form');
      if (form && input) {
        form.addEventListener('submit', function (e) { e.preventDefault(); opts.onSubmit(input.value); });
      }
      return { dismiss: function () {} };
    },
    toast: function (message, opts) {
      opts = opts || {};
      if (opts.action) setTimeout(opts.action.handler, 100);
      else console.log('toast:', message);
      return { dismiss: function () {} };
    },
    alert: function (opts) {
      var ok = (opts.buttons || []).filter(function (b) { return b.style === 'destructive'; })[0];
      if (ok && window.confirm(opts.title + (opts.message ? ' ' + opts.message : ''))) {
        if (ok.handler) ok.handler();
      }
      return Promise.resolve({ button: null });
    },
  };

  // The loading placeholder and the error state, drawn on the dotted canvas.
  function loadingEl() {
    var c = el('div', 'canvas');
    c.appendChild(el('div', 'load-pill'));
    return c;
  }

  function errorEl(opts) {
    var c = el('div', 'canvas');
    var state = el('div', 'canvas-state');
    var title = el('p', 'text-heading', opts.title);
    var note = el('p', 'text-small text-muted', opts.message);
    state.appendChild(title);
    state.appendChild(note);
    if (opts.retry) {
      var retry = el('button', 'btn-secondary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', opts.retry);
      state.appendChild(retry);
    }
    if (opts.back) {
      var back = el('button', 'btn-secondary', 'Back to maps');
      back.type = 'button';
      back.addEventListener('click', opts.back);
      state.appendChild(back);
    }
    c.appendChild(state);
    return c;
  }

  // One open map on screen. With opts.readOnly (someone else's map, shared
  // with the viewer) there is no bottom bar and no editing: pan, pinch,
  // wheel and Fit only. opts.onShare adds the Share button; without
  // opts.onOpenMaps there is no Maps button.
  function CanvasView(container, opts) {
    var d = opts.doc;
    var readOnly = !!opts.readOnly;
    var selectedId = null;
    var linkingFrom = null; // the idea a link starts from, while Link waits for the other
    var tx = 0, ty = 0, scale = 1;
    var els = new Map(); // node id -> button
    var linkEls = new Map(); // link id -> label button

    // The world, back to front: branches and link lines, link labels, ideas.
    var rootEl = el('div', 'canvas');
    var world = el('div', 'world');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'branches');
    world.appendChild(svg);
    var labelLayer = el('div', 'link-labels');
    world.appendChild(labelLayer);
    rootEl.appendChild(world);

    // Top bar: Maps, the demo and View only pills, save status, Share and Fit.
    var topbar = el('header', 'topbar');
    if (opts.onOpenMaps) {
      var mapsBtn = el('button', 'btn-secondary');
      mapsBtn.type = 'button';
      mapsBtn.appendChild(icon('grid'));
      mapsBtn.appendChild(document.createTextNode('Maps'));
      mapsBtn.addEventListener('click', opts.onOpenMaps);
      topbar.appendChild(mapsBtn);
    }
    if (opts.demo || readOnly) {
      var pills = el('div', 'top-pills');
      if (opts.demo) pills.appendChild(el('span', 'demo-pill', 'Staging demo'));
      if (readOnly) pills.appendChild(el('span', 'view-pill', 'View only'));
      topbar.appendChild(pills);
    }
    var topRight = el('div', 'top-right');
    var statusEl = el('span', 'save-status');
    statusEl.hidden = true;
    topRight.appendChild(statusEl);
    if (opts.onShare) {
      var shareBtn = el('button', 'btn-secondary');
      shareBtn.type = 'button';
      shareBtn.setAttribute('aria-label', 'Share');
      shareBtn.appendChild(icon('share'));
      shareBtn.appendChild(el('span', 'btn-label', 'Share'));
      shareBtn.addEventListener('click', opts.onShare);
      topRight.appendChild(shareBtn);
    }
    var fitBtn = el('button', 'btn-secondary btn-icon');
    fitBtn.type = 'button';
    fitBtn.setAttribute('aria-label', 'Fit map to screen');
    fitBtn.appendChild(icon('fit'));
    fitBtn.addEventListener('click', function () { fit(true); });
    topRight.appendChild(fitBtn);
    topbar.appendChild(topRight);
    rootEl.appendChild(topbar);

    // Bottom bar: the selection line, then Add idea, or only Cancel while a
    // link waits for its second idea. A read-only view has none of it.
    var bar = null, selLine, addBtn, cancelBtn;
    if (!readOnly) {
      bar = el('div', 'bottom-bar');
      selLine = el('div', 'selection');
      bar.appendChild(selLine);
      var actions = el('div', 'actions');
      addBtn = el('button', 'btn-primary');
      addBtn.type = 'button';
      addBtn.appendChild(icon('plus'));
      addBtn.appendChild(document.createTextNode('Add idea'));
      cancelBtn = el('button', 'btn-secondary btn-wide', 'Cancel');
      cancelBtn.type = 'button';
      cancelBtn.hidden = true;
      actions.appendChild(addBtn);
      actions.appendChild(cancelBtn);
      bar.appendChild(actions);
      rootEl.appendChild(bar);
    }

    // The idea menu: Edit, Add child, Join and Delete, floating beside the
    // selected idea (#9). It lives over the paper, not in the world, so it
    // keeps its size at any zoom; placeMenu() follows the idea as the map
    // pans, zooms or the idea is dragged. Each button keeps its words for
    // screen readers and as a tooltip when a phone shows the icon alone.
    var menu = null, editItem, addItem, joinItem, deleteItem;
    if (!readOnly) {
      menu = el('div', 'idea-menu');
      menu.setAttribute('role', 'toolbar');
      menu.setAttribute('aria-label', 'Idea actions');
      menu.hidden = true;
      var menuItem = function (name, text, cls) {
        var b = el('button', 'menu-btn' + (cls ? ' ' + cls : ''));
        b.type = 'button';
        b.appendChild(icon(name));
        var label = el('span', 'btn-label', text);
        b.appendChild(label);
        b.title = text;
        menu.appendChild(b);
        return { btn: b, label: label };
      };
      editItem = menuItem('pencil', 'Edit');
      addItem = menuItem('plus', 'Add child');
      joinItem = menuItem('link', 'Join');
      deleteItem = menuItem('bin', 'Delete', 'is-danger');
      joinItem.btn.title = 'Join with another idea';
      // Right after the world in the DOM, so Tab reaches it after the ideas
      // and before the bars.
      rootEl.insertBefore(menu, world.nextSibling);
    }

    // The bottom bar's height, for keeping the map clear of it.
    function barHeight() {
      return bar ? bar.offsetHeight || 100 : 0;
    }

    function setStatus(kind) {
      statusEl.hidden = readOnly || kind === 'none';
      statusEl.classList.toggle('is-error', kind === 'error');
      if (kind === 'saving') { statusEl.textContent = 'Saving'; }
      else if (kind === 'saved') { statusEl.textContent = ''; statusEl.appendChild(icon('check')); statusEl.appendChild(document.createTextNode('Saved')); }
      else if (kind === 'error') { statusEl.textContent = 'Not saved'; }
      else if (kind === 'guest') { statusEl.textContent = 'Sign in to save'; }
      else { statusEl.textContent = ''; }
    }
    setStatus(opts.initialStatus || 'none');

    function selNode() { return selectedId ? M.node(d, selectedId) : null; }

    function commit() {
      // The caller saves; the canvas only redraws and reports.
      drawBranches();
      renderBar();
      opts.onChange();
    }

    // ── Rendering ────────────────────────────────────────────────────────
    function ideaLabel(n) {
      if (n.id === 'root') return n.text + ', central idea';
      if (n.parent === 'root') return n.text + ', main idea';
      return n.text + ', idea';
    }

    function render() {
      els.forEach(function (old) { if (old.parentNode) old.parentNode.removeChild(old); });
      els.clear();
      M.nodes(d).forEach(function (n) {
        var b = el('button', 'idea');
        b.type = 'button';
        b.textContent = n.text;
        b.dataset.id = n.id;
        if (n.id === 'root') b.classList.add('idea-central');
        else if (n.parent === 'root') {
          b.classList.add('idea-main');
          b.classList.add(COLOR_CLASSES[n.color || 0]);
        } else {
          b.classList.add('idea-sub');
          var c = M.branchColor(d, n.id);
          b.classList.add(COLOR_CLASSES[c == null ? 0 : c]);
          var p = M.node(d, n.parent);
          if (p && n.x < p.x) b.classList.add('left');
        }
        if (n.id === selectedId) {
          b.classList.add('is-selected');
          b.setAttribute('aria-pressed', 'true');
        }
        b.setAttribute('aria-label', ideaLabel(n));
        b.style.left = n.x + 'px';
        b.style.top = n.y + 'px';
        world.appendChild(b);
        els.set(n.id, b);
      });
      // One label per link; drawBranches() only moves them, so a drag keeps
      // focus where it is.
      linkEls.forEach(function (old) { if (old.parentNode) old.parentNode.removeChild(old); });
      linkEls.clear();
      M.links(d).forEach(function (l) {
        var b = el('button', 'link-label');
        b.type = 'button';
        b.dataset.link = l.id;
        labelLayer.appendChild(b);
        linkEls.set(l.id, b);
      });
      labelLinks();
      // Branch ends need the measured text widths, so draw after layout.
      requestAnimationFrame(drawBranches);
      drawBranchesSoon();
    }

    var branchFrame = 0;
    function drawBranchesSoon() {
      if (branchFrame) return;
      branchFrame = requestAnimationFrame(function () { branchFrame = 0; drawBranches(); });
    }

    // A link label's words: its name (or a dot when it has none), and the two
    // ideas it joins for screen readers. Rerun when an idea is renamed.
    function labelLinks() {
      M.links(d).forEach(function (l) {
        var b = linkEls.get(l.id);
        var a = M.node(d, l.from), z = M.node(d, l.to);
        if (!b || !a || !z) return;
        b.textContent = l.text;
        b.classList.toggle('is-empty', !l.text);
        b.setAttribute('aria-label', 'Link between ' + a.text + ' and ' + z.text + (l.text ? ', ' + l.text : ''));
      });
    }

    function widthOf(n) {
      var b = els.get(n.id);
      return b ? b.offsetWidth : 80;
    }

    // Where an idea's branch leaves it: the centre of a pill, or the
    // underline end of a text idea, facing the child.
    function edgeStart(n) {
      if (M.isPill(d, n.id)) return [n.x, n.y];
      var gp = M.node(d, n.parent);
      var right = gp ? n.x >= gp.x : true;
      return [right ? n.x + widthOf(n) : n.x - widthOf(n), n.y];
    }

    function drawBranches() {
      var paths = '';
      M.nodes(d).forEach(function (n) {
        if (n.id === 'root' || !n.parent) return;
        var from = M.node(d, n.parent);
        if (!from) return;
        var s = edgeStart(from);
        var depth = M.depth(d, n.id);
        var w = depth === 1 ? 'w1' : depth === 2 ? 'w2' : 'w3';
        var c = M.branchColor(d, n.id);
        var cls = w + ' ' + COLOR_CLASSES[c == null ? 0 : c];
        var mx = (s[0] + n.x) / 2;
        paths += '<path class="' + cls + '" d="M' + s[0] + ' ' + s[1] +
          'C' + mx + ' ' + s[1] + ', ' + mx + ' ' + n.y + ', ' + n.x + ' ' + n.y + '"/>';
      });
      M.links(d).forEach(function (l) {
        var seg = linkSegment(l);
        var b = linkEls.get(l.id);
        if (seg && seg.line) {
          var ln = seg.line;
          paths += '<path class="link-line" d="M' + ln[0] + ' ' + ln[1] + 'L' + ln[2] + ' ' + ln[3] + '"/>';
        }
        // The label stays even when the line cannot be drawn, lifted over
        // the overlapping ideas, so the link can always be tapped to rename
        // or delete it.
        if (b && seg) {
          b.style.left = seg.mid[0] + 'px';
          b.style.top = seg.mid[1] + 'px';
          b.classList.toggle('is-over', !seg.line);
        }
      });
      svg.innerHTML = paths; // coordinates and class names only, never user text
      placeMenu(); // the selected idea may have moved or changed size
    }

    // The straight line between two linked ideas, from where it leaves one
    // box to where it meets the other, 4 px short of each, and where its
    // label goes: { line: [x1, y1, x2, y2] rounded to 0.1 px, mid: [x, y] }.
    // When the boxes overlap there is no gap to draw in: line is null and
    // the label sits midway between the two box centres. Null before the
    // ideas are drawn.
    function linkSegment(l) {
      var a = M.node(d, l.from), z = M.node(d, l.to);
      var ba = a && boxOf(a), bz = z && boxOf(z);
      if (!ba || !bz) return null;
      var ax = ba.x + ba.w / 2, ay = ba.y + ba.h / 2;
      var zx = bz.x + bz.w / 2, zy = bz.y + bz.h / 2;
      var dx = zx - ax, dy = zy - ay;
      // How far along the centre line (0 to 1) each box ends.
      function exit(b) {
        var ex = dx ? (b.w / 2 + 4) / Math.abs(dx) : Infinity;
        var ey = dy ? (b.h / 2 + 4) / Math.abs(dy) : Infinity;
        return Math.min(ex, ey);
      }
      var t0 = exit(ba), t1 = 1 - exit(bz);
      var r = function (v) { return Math.round(v * 10) / 10; };
      if (!(t0 < t1)) return { line: null, mid: [r((ax + zx) / 2), r((ay + zy) / 2)] };
      var line = [r(ax + dx * t0), r(ay + dy * t0), r(ax + dx * t1), r(ay + dy * t1)];
      return { line: line, mid: [(line[0] + line[2]) / 2, (line[1] + line[3]) / 2] };
    }

    // ── View transforms ──────────────────────────────────────────────────
    function applyTransform() {
      world.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
      rootEl.style.backgroundPosition = tx + 'px ' + ty + 'px';
      placeMenu();
    }

    // Put the idea menu just above the selected idea, centred on it and kept
    // on screen; below it when the top bar is in the way. Read from the
    // model and the view's own numbers, so a gliding Fit lands it where the
    // idea will be.
    function placeMenu() {
      if (!menu || menu.hidden) return;
      var n = selNode();
      var box = n && boxOf(n);
      if (!box) return;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var mw = menu.offsetWidth, mh = menu.offsetHeight;
      var left = box.x * scale + tx, top = box.y * scale + ty;
      var w = box.w * scale, h = box.h * scale;
      // An idea panned out of view takes its menu with it: it would point
      // at nothing. Not the hidden attribute, which renderMenu owns.
      var away = left + w < 0 || left > W || top + h < 60 || top > H - barHeight();
      menu.style.visibility = away ? 'hidden' : '';
      if (away) return;
      var x = Math.min(Math.max(left + w / 2 - mw / 2, 8), Math.max(W - mw - 8, 8));
      var y = top - mh - 10;
      var below = top + h + 10;
      if (y < 68 && below + mh <= H - barHeight() - 8) y = below;
      menu.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
    }

    function glide(on) {
      world.classList.toggle('glide', !!on && !reducedMotion);
      // The menu moves with the same easing, so it stays on its idea.
      if (menu) menu.classList.toggle('glide', !!on && !reducedMotion);
    }

    function screenToWorld(px, py) {
      return [(px - tx) / scale, (py - ty) / scale];
    }

    // One idea's drawn box in world coordinates, or null before it is drawn:
    // a pill is centred on its anchor, an outer idea's text runs left or right
    // of it, by the side it grows on.
    function boxOf(n) {
      var b = els.get(n.id);
      if (!b) return null;
      var w = b.offsetWidth, hh = b.offsetHeight;
      var x0;
      if (M.isPill(d, n.id)) x0 = n.x - w / 2;
      else {
        var p = M.node(d, n.parent);
        x0 = p && n.x < p.x ? n.x - w : n.x;
      }
      return { x: x0, y: n.y - hh / 2, w: w, h: hh };
    }

    // The bounding box of every idea, in world coordinates.
    function bounds() {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var any = false;
      M.nodes(d).forEach(function (n) {
        var box = boxOf(n);
        if (!box) return;
        any = true;
        minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
      });
      if (!any) return { x: -100, y: -60, w: 200, h: 120 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // Bring the whole map into the space between the bars.
    function fit(animated) {
      var b = bounds();
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = barHeight();
      var top = 60 + 24, bottom = H - barH - 24;
      var availW = W - 48, availH = Math.max(bottom - top, 120);
      var s = Math.min(availW / Math.max(b.w, 1), availH / Math.max(b.h, 1), 1);
      scale = Math.max(s, 0.3);
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      tx = W / 2 - cx * scale;
      ty = (top + bottom) / 2 - cy * scale;
      glide(animated);
      applyTransform();
    }

    // Pan just enough to show a world point, after an idea is added.
    function reveal(x, y, animated) {
      var sx = x * scale + tx, sy = y * scale + ty;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = barHeight();
      var pad = 40, top = 60 + pad, bottom = H - barH - pad;
      var dx = 0, dy = 0;
      if (sx < pad) dx = pad - sx;
      if (sx > W - pad) dx = (W - pad) - sx;
      if (sy < top) dy = top - sy;
      if (sy > bottom) dy = bottom - sy;
      if (dx || dy) {
        glide(animated);
        tx += dx; ty += dy;
        applyTransform();
      }
    }

    // ── Gestures ─────────────────────────────────────────────────────────
    var pointers = new Map();
    var gesture = null; // {kind:'pan'|'maybe-drag'|'drag'|'link-tap'|'pinch', ...}
    var lastTap = { id: null, at: 0 };

    rootEl.addEventListener('pointerdown', function (e) {
      // The bars and the idea menu float over the paper; a press on them is
      // not a tap on it (one used to clear the selection before an action
      // could act).
      if (e.target.closest && e.target.closest('.topbar, .bottom-bar, .idea-menu')) return;
      if (pointers.size === 2) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // A second pointer turns any gesture into a pinch.
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        gesture = { kind: 'pinch', baseScale: scale, baseDist: dist, baseCx: cx, baseCy: cy };
        return;
      }
      // Read only, an idea is just more paper: dragging it pans the map.
      var labelEl = !readOnly && e.target.closest ? e.target.closest('.link-label') : null;
      var ideaEl = !readOnly && e.target.closest ? e.target.closest('.idea') : null;
      if (labelEl) {
        gesture = { kind: 'link-tap', id: labelEl.dataset.link, x: e.clientX, y: e.clientY, moved: false };
      } else if (ideaEl) {
        gesture = { kind: 'maybe-drag', id: ideaEl.dataset.id, x: e.clientX, y: e.clientY, moved: false };
      } else {
        gesture = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false };
      }
    });

    rootEl.addEventListener('pointermove', function (e) {
      var p = pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (!gesture) return;
      if (gesture.kind === 'pinch' && pointers.size === 2) {
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        var s = Math.min(2, Math.max(0.3, gesture.baseScale * (dist / gesture.baseDist)));
        // Keep the world point under the starting midpoint still there.
        var wx = (gesture.baseCx - tx) / scale, wy = (gesture.baseCy - ty) / scale;
        scale = s;
        tx = cx - wx * s;
        ty = cy - wy * s;
        applyTransform();
        return;
      }
      var dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (gesture.kind === 'link-tap') {
        // A press on a link's name that moves pans the paper instead.
        if (Math.hypot(dx, dy) < 6) return;
        gesture.kind = 'pan';
      }
      if (gesture.kind === 'pan') {
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        gesture.moved = true;
        tx += e.clientX - (gesture.lastX == null ? gesture.x : gesture.lastX);
        ty += e.clientY - (gesture.lastY == null ? gesture.y : gesture.lastY);
        gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        applyTransform();
      } else if (gesture.kind === 'maybe-drag' || gesture.kind === 'drag') {
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        if (!gesture.moved) {
          gesture.moved = true;
          gesture.kind = 'drag';
        }
        var wdx = (e.clientX - (gesture.lastX == null ? gesture.x : gesture.lastX)) / scale;
        var wdy = (e.clientY - (gesture.lastY == null ? gesture.y : gesture.lastY)) / scale;
        gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        M.moveSubtree(d, gesture.id, wdx, wdy);
        M.subtree(d, gesture.id).forEach(function (n) {
          var b = els.get(n.id);
          if (b) { b.style.left = n.x + 'px'; b.style.top = n.y + 'px'; }
        });
        drawBranchesSoon();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') {
        if (pointers.size < 2) gesture = null;
        return;
      }
      if (gesture.kind === 'drag') {
        commit();
      } else if (gesture.kind === 'maybe-drag' && !gesture.moved) {
        var id = gesture.id;
        var now = Date.now();
        if (linkingFrom) {
          finishLink(id); // the second idea of a link, not a selection
          lastTap = { id: null, at: 0 };
        } else if (lastTap.id === id && now - lastTap.at < 300) {
          openRename(id);
          lastTap = { id: null, at: 0 };
        } else {
          lastTap = { id: id, at: now };
          select(id);
        }
      } else if (gesture.kind === 'link-tap') {
        if (!linkingFrom) openLink(gesture.id);
      } else if (gesture.kind === 'pan' && !gesture.moved && !readOnly) {
        // A tap on the dotted paper stops a link, or else clears the selection.
        if (linkingFrom) cancelLink();
        else select(null);
      }
      gesture = null;
    }
    rootEl.addEventListener('pointerup', endPointer);
    rootEl.addEventListener('pointercancel', endPointer);
    rootEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var rect = rootEl.getBoundingClientRect();
        var px = e.clientX - rect.left, py = e.clientY - rect.top;
        var wx = (px - tx) / scale, wy = (py - ty) / scale;
        scale = Math.min(2, Math.max(0.3, scale * Math.exp(-e.deltaY * 0.002)));
        tx = px - wx * scale;
        ty = py - wy * scale;
      } else {
        tx -= e.deltaX;
        ty -= e.deltaY;
      }
      applyTransform();
    }, { passive: false });

    // ── Selection and the bottom bar ─────────────────────────────────────
    function select(id) {
      if (selectedId && els.get(selectedId)) {
        els.get(selectedId).classList.remove('is-selected');
        els.get(selectedId).removeAttribute('aria-pressed');
      }
      selectedId = id;
      linkingFrom = null;
      if (id && els.get(id)) {
        els.get(id).classList.add('is-selected');
        els.get(id).setAttribute('aria-pressed', 'true');
      }
      renderBar();
    }

    function countText(n) {
      if (n.id === 'root') {
        var mains = M.childrenOf(d, 'root').length;
        return 'Central idea, ' + mains + ' main ' + (mains === 1 ? 'idea' : 'ideas');
      }
      var under = M.countUnder(d, n.id);
      return under === 1 ? '1 idea under it' : under + ' ideas under it';
    }

    function renderBar() {
      if (!bar) return;
      selLine.textContent = '';
      var n = selNode();
      var full = M.ideaCount(d) >= M.MAX_NODES;
      var deepest = !!n && !M.canAddUnder(d, n.id);
      var linking = !!n && linkingFrom === n.id;
      addBtn.disabled = full || deepest;
      if (linking) {
        selLine.appendChild(dotFor(n));
        selLine.appendChild(el('span', 'sel-name', n.text));
        selLine.appendChild(el('span', 'sel-meta', 'Tap another idea to link to it'));
      } else if (full) {
        selLine.appendChild(el('span', 'sel-meta', 'This map is full (500 ideas)'));
      } else if (n) {
        selLine.appendChild(dotFor(n));
        selLine.appendChild(el('span', 'sel-name', n.text));
        selLine.appendChild(el('span', 'sel-meta', deepest
          ? 'Ideas go ' + M.MAX_DEPTH + ' levels deep'
          : countText(n)));
      } else {
        selLine.appendChild(el('span', 'sel-meta', 'Tap an idea to select it'));
      }
      addBtn.hidden = linking;
      cancelBtn.hidden = !linking;
      renderMenu(n, linking, full || deepest);
    }

    // The menu shows for a selected idea, and steps aside while a link waits
    // for its second idea (the bottom bar says what to do then).
    function renderMenu(n, linking, cannotAdd) {
      if (!menu) return;
      menu.hidden = !n || linking;
      if (menu.hidden) return;
      var isRoot = n.id === 'root';
      var deleteText = isRoot ? 'Delete map' : 'Delete';
      deleteItem.label.textContent = deleteText;
      deleteItem.btn.title = deleteText;
      addItem.btn.disabled = cannotAdd;
      joinItem.btn.disabled = M.links(d).length >= M.MAX_LINKS;
      placeMenu();
    }

    // The selection line's dot, in the branch's colour (ink for the centre).
    function dotFor(n) {
      var dot = el('span', 'dot');
      if (n.id !== 'root') {
        var c = M.branchColor(d, n.id);
        dot.classList.add(DOT_CLASSES[c == null ? 0 : c]);
      } else {
        dot.classList.add('bg-accent');
      }
      return dot;
    }

    // ── Sheets ───────────────────────────────────────────────────────────
    // `options.allowEmpty` lets an empty field through (a link's name);
    // `options.extra` ({ label, onClick }) adds a secondary button under the
    // primary one that closes the sheet and runs onClick.
    function sheetForm(labelText, placeholder, value, buttonLabel, maxlength, onSubmit, options) {
      options = options || {};
      var form = el('form');
      form.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 4px 12px';
      var label = el('label', 'section-label', labelText);
      var input = el('input', 'field');
      input.type = 'text';
      input.maxLength = maxlength;
      input.placeholder = placeholder;
      input.value = value || '';
      label.htmlFor = input.id = 'sheet-field';
      var btn = el('button', 'btn-primary', buttonLabel);
      btn.type = 'submit';
      if (!options.allowEmpty) {
        btn.disabled = !input.value.trim();
        input.addEventListener('input', function () { btn.disabled = !input.value.trim(); });
      }
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(btn);
      if (options.extra) {
        var extra = el('button', 'btn-secondary', options.extra.label);
        extra.type = 'button';
        extra.addEventListener('click', function () {
          handle.dismiss();
          options.extra.onClick();
        });
        form.appendChild(extra);
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v && !options.allowEmpty) return;
        handle.dismiss();
        onSubmit(v);
      });
      var handle = un.presentSheet({ contentEl: form });
      setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
      return handle;
    }

    function openAdd() {
      if (M.ideaCount(d) >= M.MAX_NODES) return;
      var parent = selNode() || M.node(d, 'root');
      if (!M.canAddUnder(d, parent.id)) return;
      sheetForm('Idea', 'e.g. Book a table', '', 'Add idea', M.MAX_TEXT, function (text) {
        // The parent's measured width, so the new idea clears its text.
        var n = M.addIdea(d, parent.id, text, widthOf(parent));
        if (!n) return;
        render();
        var b = els.get(n.id);
        if (b && !reducedMotion) b.classList.add('idea-in');
        select(parent.id); // the idea you added to stays selected
        reveal(n.x, n.y, true);
        commit();
      });
    }

    function openRename(id) {
      var n = M.node(d, id || selectedId);
      if (!n) return;
      sheetForm('Idea', 'e.g. Book a table', n.text, 'Save', n.id === 'root' ? M.MAX_ROOT_TEXT : M.MAX_TEXT, function (text) {
        M.rename(d, n.id, text);
        var b = els.get(n.id);
        if (b) b.textContent = text;
        labelLinks(); // their screen-reader names say which ideas they join
        commit();
      });
    }

    function openDelete() {
      var n = selNode();
      if (!n) return;
      if (n.id === 'root') {
        var count = M.ideaCount(d) - 1;
        un.alert({
          title: 'Delete ' + d.nodes[0].text.trim() + '?',
          message: 'This deletes the map and its ' + count + ' ideas.',
          buttons: [
            { label: 'Cancel', style: 'cancel' },
            { label: 'Delete', style: 'destructive', handler: function () { opts.onDeleteMap(); } },
          ],
        });
        return;
      }
      // Deleting an idea asks first (#9), then still offers Undo.
      var under = M.countUnder(d, n.id);
      un.alert({
        title: 'Delete ' + n.text.trim() + '?',
        message: under > 0
          ? 'This also deletes the ' + (under === 1 ? 'idea' : under + ' ideas') + ' under it.'
          : 'It comes off this map.',
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          { label: 'Delete', style: 'destructive', handler: function () { deleteIdea(n.id); } },
        ],
      });
    }

    function deleteIdea(id) {
      if (!M.node(d, id)) return;
      var removed = M.removeSubtree(d, id);
      var under = removed.length - 1;
      var text = removed[0].text;
      select(null);
      render();
      commit();
      var message = 'Deleted ' + text + (under > 0 ? ' and ' + under + ' idea' + (under === 1 ? '' : 's') + ' under it' : '');
      un.toast(message, {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            M.restore(d, removed);
            render();
            commit();
          },
        },
      });
    }

    // ── Links ────────────────────────────────────────────────────────────
    // Link waits for a second idea; tapping it (or Enter on it) asks for an
    // optional name. Cancel, the paper or Escape stop without linking, and the
    // first idea stays selected.
    function startLink() {
      var n = selNode();
      if (!n || M.links(d).length >= M.MAX_LINKS) return;
      linkingFrom = n.id;
      renderBar();
      cancelBtn.focus(); // the one button left, and where Escape is heard
    }

    function cancelLink() {
      if (!linkingFrom) return;
      var refocus = document.activeElement === cancelBtn;
      linkingFrom = null;
      renderBar();
      if (refocus && joinItem) joinItem.btn.focus();
    }

    function finishLink(id) {
      var from = linkingFrom;
      if (!from || id === from) return; // the same idea: keep waiting
      linkingFrom = null;
      renderBar();
      if (M.linkBetween(d, from, id)) {
        un.toast('These ideas are already linked');
        return;
      }
      sheetForm('Link name', 'e.g. Depends on', '', 'Add link', M.MAX_LINK_TEXT, function (text) {
        if (!M.addLink(d, from, id, text)) return;
        render(); // the first idea stays selected
        commit();
      }, { allowEmpty: true });
    }

    // A tap on a link's name (or dot): rename it, or delete it with Undo.
    function openLink(id) {
      var l = M.linkById(d, id);
      if (!l) return;
      sheetForm('Link name', 'e.g. Depends on', l.text, 'Save', M.MAX_LINK_TEXT, function (text) {
        M.renameLink(d, id, text);
        render();
        commit();
      }, {
        allowEmpty: true,
        extra: {
          label: 'Delete link',
          onClick: function () {
            var removed = M.removeLink(d, id);
            if (!removed) return;
            render();
            commit();
            un.toast('Deleted link', {
              priority: true,
              action: {
                label: 'Undo',
                handler: function () {
                  M.restoreLinks(d, [removed]);
                  render();
                  commit();
                },
              },
            });
          },
        },
      });
    }

    if (bar) {
      cancelBtn.addEventListener('click', cancelLink);
      addBtn.addEventListener('click', openAdd);
    }
    if (menu) {
      editItem.btn.addEventListener('click', function () { openRename(); });
      addItem.btn.addEventListener('click', openAdd);
      joinItem.btn.addEventListener('click', startLink);
      deleteItem.btn.addEventListener('click', openDelete);
    }

    // ── Keyboard ─────────────────────────────────────────────────────────
    // Every shortcut edits or selects, so a read-only view has none.
    rootEl.addEventListener('keydown', function (e) {
      if (readOnly) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // A key on a bar's or the menu's own button is that button's: Enter
      // presses it, rather than adding an idea. Escape in the menu closes it
      // and hands focus back to the idea.
      if (e.target.closest && e.target.closest('.topbar, .bottom-bar, .idea-menu')) {
        if (e.key === 'Escape' && e.target.closest('.idea-menu') && selectedId) {
          var back = els.get(selectedId);
          select(null);
          if (back) back.focus();
          e.preventDefault();
        } else if (e.key === 'Escape' && linkingFrom) {
          cancelLink();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          select(null);
        }
        return;
      }
      var focused = e.target.closest ? e.target.closest('.idea') : null;
      var focusedId = focused ? focused.dataset.id : null;
      var focusedLink = e.target.closest ? e.target.closest('.link-label') : null;
      if (linkingFrom) {
        // While a link waits, Enter on an idea finishes it and Escape stops
        // it. Arrows still move the selected idea; the shortcuts for the
        // hidden buttons wait.
        if (e.key === 'Enter' && focusedId) { finishLink(focusedId); e.preventDefault(); }
        else if (e.key === 'Escape') { cancelLink(); e.preventDefault(); }
        if (e.key.indexOf('Arrow') !== 0) return;
      } else if (focusedLink && (e.key === 'Enter' || e.key === ' ')) {
        openLink(focusedLink.dataset.link);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        if (focusedId && focusedId !== selectedId) { select(focusedId); e.preventDefault(); }
        else if (selectedId) { openAdd(); e.preventDefault(); }
      } else if (e.key === 'F2') {
        openRename(focusedId || selectedId);
        e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) { openDelete(); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        select(null);
      } else if (selectedId && e.key.indexOf('Arrow') === 0) {
        var step = e.shiftKey ? 50 : 10;
        var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx || dy) {
          M.moveSubtree(d, selectedId, dx, dy);
          M.subtree(d, selectedId).forEach(function (n) {
            var b = els.get(n.id);
            if (b) { b.style.left = n.x + 'px'; b.style.top = n.y + 'px'; }
          });
          drawBranchesSoon();
          commit();
          e.preventDefault();
        }
      }
    });

    // ── Boot ─────────────────────────────────────────────────────────────
    container.textContent = '';
    container.appendChild(rootEl);
    render();
    renderBar();
    // Measure once the layout has settled, then fit the whole map.
    requestAnimationFrame(function () { fit(false); });

    // A resized window moves the idea under the menu on screen.
    var onResize = function () { placeMenu(); };
    root.addEventListener('resize', onResize);

    return {
      el: rootEl,
      setStatus: setStatus,
      fit: function () { fit(true); },
      destroy: function () {
        root.removeEventListener('resize', onResize);
        container.textContent = '';
      },
    };
  }

  root.M2Canvas = {
    CanvasView: CanvasView,
    loadingEl: loadingEl,
    errorEl: errorEl,
  };
})(typeof self !== 'undefined' ? self : this);
