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

  var COLOR_CLASSES = ['c-teal', 'c-amber', 'c-violet', 'c-rose', 'c-sky', 'c-green', 'c-orange', 'c-indigo', 'c-pink', 'c-slate'];
  var DOT_CLASSES = ['b-teal', 'b-amber', 'b-violet', 'b-rose', 'b-sky', 'b-green', 'b-orange', 'b-indigo', 'b-pink', 'b-slate'];
  var COLOR_NAMES = ['Teal', 'Amber', 'Violet', 'Rose', 'Sky', 'Green', 'Orange', 'Indigo', 'Pink', 'Slate'];

  var ICONS = {
    grid: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    fit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    share: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    link: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
    keyboard: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M7 14h10"/></svg>',
    undo: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    tidy:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 15l.9 2.6L22 18.5l-2.1.9L19 22l-.9-2.6L16 18.5l2.1-.9Z"/></svg>',
    minus:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    minimap: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="10" width="6" height="6" rx="1"/></svg>',
    search: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chevronUp: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
    chevronDown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    more: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
    history: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5v4h4"/><path d="M4 9.5a8 8 0 1 1-.3 4"/><path d="M12 8v4.5l3 1.8"/></svg>',
  };

  // The keyboard shortcuts (#15), one table the sheet is drawn from, so the
  // words and the behaviour stay together. 'Mod' reads Cmd on a Mac and Ctrl
  // elsewhere (both are accepted everywhere); 'Alt' reads Option on a Mac.
  // Rows marked edit:true need an owned map, so a read-only view leaves them
  // out, and a group with nothing left drops away with them.
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var SHORTCUTS = [
    { group: 'Add and change ideas', rows: [
      { keys: ['Tab'], text: 'Add an idea under the selected one', edit: true },
      { keys: ['Enter'], text: 'Add the next idea beside the one just added', edit: true },
      { keys: ['Shift', 'Enter'], text: 'Add the next idea above it instead', edit: true },
      { keys: ['Space', 'or', 'F2'], text: 'Rename the selected idea', edit: true },
      { keys: ['Delete', 'or', 'Backspace'], text: 'Delete the selected idea', edit: true },
    ] },
    { group: 'Move around', rows: [
      { keys: ['Arrows'], text: 'Move to the idea in that direction' },
      { keys: ['Alt', 'Arrows'], text: 'Nudge the selected idea across the paper, when Keep tidy is off', edit: true },
      { keys: ['Mod', 'Alt', 'Arrows'], text: 'Reorder, promote or tuck the selected idea under its sibling', edit: true },
      { keys: ['Esc'], text: 'Close a menu or sheet, or clear the selection, so Tab leaves the map' },
    ] },
    { group: 'View', rows: [
      { keys: ['Mod', '0'], text: 'Fit the map to the screen' },
      { keys: ['Mod', '+'], text: 'Zoom in' },
      { keys: ['Mod', '-'], text: 'Zoom out' },
      { keys: ['F'], text: 'Focus on the selected branch' },
      { keys: ['C'], text: 'Center the selected idea' },
      { keys: ['Mod', 'F'], text: 'Find in map, then Enter or Shift+Enter for the next or previous match' },
      { keys: ['?'], text: 'Open this sheet' },
    ] },
  ];

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

  // Reduced motion is read live: the viewer can flip the OS setting while
  // the map is open, and every glide stops (or restarts) right away.
  var motionQuery = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)');
  var reducedMotion = motionQuery ? motionQuery.matches : false;
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener('change', function (e) { reducedMotion = e.matches; });
  }

  // Say something to screen readers, once, without moving focus. The live
  // region sits outside #app (index.html), so it survives a view swap; if
  // it is missing there is nothing to say into.
  function announce(text) {
    var live = document.getElementById('announcer');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 50);
  }

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
    popover: function () {
      var p = Promise.resolve(null);
      p.dismiss = function () {};
      return p;
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
    var mapId = opts.mapId || null; // a guest's example map saves no view
    // Focus mode (#25): one branch big, the rest of the map dimmed. Focus is
    // a view state only: nothing here ever calls record().
    var focusId = null, preFocus = null;
    // The saved viewport per map (localStorage m2.view.<id>), restored on
    // open instead of an auto-fit; debounced, and never while focused.
    var saveTimer = 0;
    var els = new Map(); // node id -> button
    var linkEls = new Map(); // link id -> label button

    // Undo and redo: snapshots of the doc before each edit, in memory only,
    // so the history dies with the view and no other map ever sees it.
    var undoStack = [], redoStack = [], HISTORY_MAX = 100;
    var lastNudge = { id: null, at: 0 }; // rapid arrow-key moves of one idea
    var deleteToast = null; // an open delete toast, dismissed by the next edit
    var undoBtn = null, redoBtn = null;

    // The world, back to front: branches and link lines, link labels, ideas.
    var rootEl = el('div', 'canvas');
    rootEl.tabIndex = -1; // focusable, so keys work before any click
    var world = el('div', 'world');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'branches');
    svg.setAttribute('aria-hidden', 'true'); // the curves carry no meaning a reader needs
    world.appendChild(svg);
    var labelLayer = el('div', 'link-labels');
    world.appendChild(labelLayer);
    // The tree layer: what screen readers walk. Its children are absolutely
    // positioned against .world like before, so it needs no styling; the
    // branches and link lines stay aria-hidden graphics beside it.
    var treeEl = el('div', 'ideas');
    treeEl.setAttribute('role', 'tree');
    world.appendChild(treeEl);
    rootEl.appendChild(world);

    // Top bar: Maps, the demo and View only pills, save status, Share and Fit.
    var topbar = el('header', 'topbar');
    if (opts.onOpenMaps) {
      var mapsBtn = el('button', 'btn-secondary');
      mapsBtn.type = 'button';
      mapsBtn.setAttribute('aria-label', 'Maps');
      mapsBtn.appendChild(icon('grid'));
      mapsBtn.appendChild(el('span', 'btn-label', 'Maps'));
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
    if (!readOnly) {
      var historyEl = el('div', 'history');
      undoBtn = el('button', 'btn-secondary btn-icon undo-btn');
      undoBtn.type = 'button';
      undoBtn.appendChild(icon('undo'));
      undoBtn.disabled = true;
      undoBtn.addEventListener('click', undo);
      historyEl.appendChild(undoBtn);
      redoBtn = el('button', 'btn-secondary btn-icon redo-btn');
      redoBtn.type = 'button';
      redoBtn.appendChild(icon('redo'));
      redoBtn.disabled = true;
      redoBtn.addEventListener('click', redo);
      historyEl.appendChild(redoBtn);
      topRight.appendChild(historyEl);
    }
    if (opts.onShare) {
      var shareBtn = el('button', 'btn-secondary');
      shareBtn.type = 'button';
      shareBtn.setAttribute('aria-label', 'Share');
      shareBtn.appendChild(icon('share'));
      shareBtn.appendChild(el('span', 'btn-label', 'Share'));
      shareBtn.addEventListener('click', opts.onShare);
      topRight.appendChild(shareBtn);
    }
    // Tidy up (#18): one tap lays every branch out so nothing overlaps.
    if (!readOnly) {
      var tidyBtn = el('button', 'btn-secondary tidy-btn');
      tidyBtn.type = 'button';
      tidyBtn.setAttribute('aria-label', 'Tidy up');
      tidyBtn.title = 'Tidy up';
      tidyBtn.appendChild(icon('tidy'));
      tidyBtn.appendChild(el('span', 'btn-label', 'Tidy up'));
      tidyBtn.addEventListener('click', function () { tidy('Tidy up'); commit(); });
      topRight.appendChild(tidyBtn);
    }
    // Find in map (#23), on every view: a read-only search that a viewer or
    // a guest can use too.
    var findBtn = el('button', 'btn-secondary btn-icon find-btn');
    findBtn.type = 'button';
    findBtn.setAttribute('aria-label', 'Find in map');
    findBtn.title = 'Find in map';
    findBtn.appendChild(icon('search'));
    findBtn.addEventListener('click', function () { openFind(); });
    topRight.appendChild(findBtn);

    // The keyboard shortcuts sheet, one tap away on a wide screen. On a
    // phone the ? key still opens it from a hardware keyboard.
    var kbdBtn = el('button', 'btn-secondary btn-icon kbd-btn');
    kbdBtn.type = 'button';
    kbdBtn.setAttribute('aria-label', 'Keyboard shortcuts');
    kbdBtn.title = 'Keyboard shortcuts';
    kbdBtn.appendChild(icon('keyboard'));
    kbdBtn.addEventListener('click', function () { openShortcuts(); });
    topRight.appendChild(kbdBtn);

    // Version history (#32): one tap under More, so the top bar stays
    // quiet and later entries have somewhere to go.
    if (opts.onVersionHistory) {
      var moreBtn = el('button', 'btn-secondary btn-icon more-btn');
      moreBtn.type = 'button';
      moreBtn.setAttribute('aria-label', 'More');
      moreBtn.title = 'More';
      moreBtn.appendChild(icon('more'));
      moreBtn.addEventListener('click', function () {
        un.popover({
          anchorEl: moreBtn,
          items: [{ label: 'Version history', handler: opts.onVersionHistory }],
        });
      });
      topRight.appendChild(moreBtn);
    }
    topbar.appendChild(topRight);
    rootEl.appendChild(topbar);

    // ── The zoom group, minimap and focus chip (#25) ────────────────────
    // They live over the paper like the bars: fixed size at any zoom, and a
    // press on them is never a tap on it.
    var zoomGroup = el('div', 'zoom-group');
    zoomGroup.setAttribute('role', 'group');
    zoomGroup.setAttribute('aria-label', 'Zoom');
    var zoomBtn = function (label) {
      var b = el('button', 'zoom-btn');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      return b;
    };
    var ziBtn = zoomBtn('Zoom in');
    ziBtn.appendChild(icon('plus'));
    ziBtn.addEventListener('click', function () { zoomBy(1.25, true); });
    var zoomLevel = el('button', 'zoom-btn zoom-level');
    zoomLevel.type = 'button';
    zoomLevel.addEventListener('click', function () { resetZoom(); });
    var zoBtn = zoomBtn('Zoom out');
    zoBtn.appendChild(icon('minus'));
    zoBtn.addEventListener('click', function () { zoomBy(0.8, true); });
    var fitBtn = zoomBtn('Fit map to screen');
    fitBtn.appendChild(icon('fit'));
    fitBtn.addEventListener('click', function () { fit(true); });
    var mmBtn = zoomBtn('Show minimap');
    mmBtn.appendChild(icon('minimap'));
    mmBtn.addEventListener('click', function () { toggleMinimap(); });
    zoomGroup.appendChild(ziBtn);
    zoomGroup.appendChild(zoomLevel);
    zoomGroup.appendChild(zoBtn);
    zoomGroup.appendChild(fitBtn);
    zoomGroup.appendChild(el('div', 'zoom-sep'));
    zoomGroup.appendChild(mmBtn);
    rootEl.appendChild(zoomGroup);

    // The minimap: the whole map in miniature, with a rectangle for what is
    // on screen. Drag it or tap it to move the view.
    var minimap = el('div', 'minimap');
    minimap.hidden = true;
    var mmSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mmSvg.setAttribute('class', 'mm-svg');
    mmSvg.setAttribute('viewBox', '0 0 160 110');
    mmSvg.setAttribute('aria-hidden', 'true');
    minimap.appendChild(mmSvg);
    var mmView = el('div', 'mm-view');
    minimap.appendChild(mmView);
    rootEl.appendChild(minimap);

    // The focus chip under the top bar: where you are, and the way out.
    var focusChip = el('div', 'focus-chip');
    focusChip.hidden = true;
    var focusLabel = el('span', 'chip-label', 'Focused on');
    var crumbRow = el('div', 'chip-crumbs');
    var exitBtn = el('button', 'chip-close');
    exitBtn.type = 'button';
    exitBtn.setAttribute('aria-label', 'Exit focus');
    exitBtn.title = 'Exit focus';
    exitBtn.appendChild(icon('close'));
    exitBtn.addEventListener('click', function () { exitFocus(); });
    focusChip.appendChild(focusLabel);
    focusChip.appendChild(crumbRow);
    focusChip.appendChild(exitBtn);
    rootEl.appendChild(focusChip);

    // Both looks of the paper keep the overlays clear of the bottom bar.
    // The minimap stacks above the zoom group on a wide screen; a phone's
    // narrow one has CSS set it beside the group instead, bottoms aligned.
    function placeOverlays() {
      var base = barHeight() + 12;
      zoomGroup.style.bottom = base + 'px';
      minimap.style.bottom = rootEl.clientWidth > 767
        ? (base + zoomGroup.offsetHeight + 8) + 'px'
        : base + 'px';
    }

    // Bottom bar: the selection line, then Add idea, or only Cancel while a
    // link waits for its second idea. A read-only view has none of it.
    var bar = null, selLine, addBtn, cancelBtn;
    var ghosts = null; // ids of ideas added since the version being shown
    if (opts.version) {
      // Version mode (#32): an owned map read-only at an earlier version,
      // with its own bar saying what is on the paper.
      if (opts.version.ghostIds) {
        ghosts = {};
        opts.version.ghostIds.forEach(function (id) { ghosts[id] = true; });
      }
      bar = el('div', 'bottom-bar version-bar');
      selLine = el('div', 'selection');
      selLine.appendChild(el('span', 'sel-name',
        'Viewing the version from ' + opts.version.label));
      selLine.appendChild(el('span', 'sel-meta',
        opts.version.ideaCount + ' ideas' +
        (opts.version.ghostIds && opts.version.ghostIds.length
          ? '. Faded ideas were added since.' : '')));
      bar.appendChild(selLine);
      var vActions = el('div', 'actions');
      var restoreBtn = el('button', 'btn-primary', 'Restore this version');
      restoreBtn.type = 'button';
      restoreBtn.addEventListener('click', function () { opts.version.onRestore(); });
      var backBtn = el('button', 'btn-secondary btn-wide', 'Back to current');
      backBtn.type = 'button';
      backBtn.addEventListener('click', function () { opts.version.onBack(); });
      vActions.appendChild(restoreBtn);
      vActions.appendChild(backBtn);
      bar.appendChild(vActions);
      rootEl.appendChild(bar);
      announce('Viewing the version from ' + opts.version.label);
    } else if (!readOnly) {
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

    var saveFailing = false; // said once when saving starts to fail, once when it recovers
    function setStatus(kind) {
      statusEl.hidden = readOnly || kind === 'none';
      statusEl.classList.toggle('is-error', kind === 'error' || kind === 'conflict');
      if (kind === 'saving') { statusEl.textContent = 'Saving'; }
      else if (kind === 'saved') { statusEl.textContent = ''; statusEl.appendChild(icon('check')); statusEl.appendChild(document.createTextNode('Saved')); }
      else if (kind === 'error') { statusEl.textContent = 'Not saved'; }
      else if (kind === 'conflict') { statusEl.textContent = 'Changed elsewhere'; }
      else if (kind === 'guest') { statusEl.textContent = 'Sign in to save'; }
      else { statusEl.textContent = ''; }
      // The save status speaks at its edges only: when saving starts to
      // fail, and when it recovers. Retries (error, saving, error) stay
      // quiet so the live region never chatters.
      if (kind === 'error' && !saveFailing) { saveFailing = true; announce('Couldn’t save, retrying'); }
      else if (kind === 'saved' && saveFailing) { saveFailing = false; announce('Saved'); }
    }
    setStatus(opts.initialStatus || 'none');

    function selNode() { return selectedId ? M.node(d, selectedId) : null; }

    // The idea menu: a small popover beside the selected idea (anything but
    // the central one) with the four things you can do to it. Its handlers
    // act on selNode(), which is this idea because select(id) ran first.
    var menu = null; // { id, handle } while a menu is open
    var colourPop = null; // the Colour panel's handle, while it is open
    var menuClosed = { id: null, at: 0 }; // a menu this same press may have closed

    // One "Go to …" row per link on this idea, so a screen-reader user can
    // follow a named line without hunting for the other end. An unnamed
    // link is just the other idea's name.
    function goToItems(n) {
      var out = [];
      M.links(d).forEach(function (l) {
        var otherId = l.from === n.id ? l.to : l.to === n.id ? l.from : null;
        if (!otherId) return;
        var other = M.node(d, otherId);
        if (!other) return;
        out.push({
          label: 'Go to ' + spoken(other.text) + (l.text ? ', ' + l.text : ''),
          handler: function () {
            if (focusId && !underFocus(otherId)) exitFocus(); // the target may be dimmed
            select(otherId);
            focusIdea(otherId);
            revealIdea(otherId, true);
          },
        });
      });
      return out;
    }

    function openMenu(id) {
      if (readOnly || linkingFrom) return;
      if (id === 'root') {
        // The centre's menu is about the map itself (#18): rename, add, and
        // the tidy controls. The other ideas keep their own menu below.
        if (!els.get('root')) return;
        closeMenu();
        var rp = un.popover({
          anchorEl: els.get('root'),
          items: [
            { label: 'Rename', handler: function () { openRename('root'); } },
            { label: 'Add idea', disabled: M.ideaCount(d) >= M.MAX_NODES, handler: openAdd },
          ].concat(goToItems(M.node(d, 'root')), [
            { label: 'Tidy up', handler: function () { tidy('Tidy up'); commit(); } },
            { label: M.isAutoLayout(d) ? 'Turn off Keep tidy' : 'Turn on Keep tidy', handler: toggleKeepTidy },
          ]),
        });
        menu = { id: 'root', handle: rp };
        rp.then(function () {
          if (menu && menu.handle === rp) menu = null;
          menuClosed = { id: 'root', at: performance.now() };
        });
        return;
      }
      if (!M.node(d, id) || !els.get(id)) return;
      closeMenu();
      var n = M.node(d, id);
      var isMain = n.parent === 'root';
      var sibs = M.siblingsInOrder(d, id);
      var at = sibs.indexOf(n);
      var moveItems = [
        { label: 'Move up', disabled: at <= 0, handler: function () { applyReorder(id, at - 1); focusIdea(id); } },
        { label: 'Move down', disabled: at >= sibs.length - 1, handler: function () { applyReorder(id, at + 1); focusIdea(id); } },
      ];
      var p = un.popover({
        anchorEl: els.get(id),
        items: [
          { label: 'Rename', handler: function () { openRename(id); } },
          { label: 'Add idea', disabled: M.ideaCount(d) >= M.MAX_NODES || !M.canAddUnder(d, id), handler: openAdd },
          { label: 'Link', disabled: M.links(d).length >= M.MAX_LINKS, handler: startLink },
          { label: 'Move to…', disabled: M.validParents(d, id).length === 0, handler: function () { openMoveTo(id); } },
        ].concat(moveItems, [
          { label: 'Focus', disabled: id === 'root', handler: function () { focusOn(id); } },
          { label: 'Colour', disabled: !isMain, handler: function () { openColour(id); } },
        ], goToItems(n), [
          { label: 'Delete', destructive: true, handler: openDelete },
        ]),
      });
      menu = { id: id, handle: p };
      p.then(function () {
        if (menu && menu.handle === p) menu = null;
        menuClosed = { id: id, at: performance.now() };
      });
    }

    function closeMenu() {
      if (menu) { menu.handle.dismiss(); menu = null; }
      if (colourPop) { colourPop.dismiss(); colourPop = null; }
    }

    // The Colour panel (#20): the palette as a grid of swatches, opened from
    // a main idea's menu. Tapping one recolours the whole branch — the pill's
    // outline, the branch line, its ideas' underlines — then closes the
    // panel; tapping the branch's own colour just closes it.
    function openColour(id) {
      var n = M.node(d, id);
      if (readOnly || !n || n.parent !== 'root' || !els.get(id)) return;
      closeMenu();
      var cur = n.color == null ? 0 : n.color;
      var grid = el('div', 'colour-grid');
      var handle = null;
      for (var i = 0; i < M.COLORS; i++) {
        (function (i) {
          var sw = el('button', 'swatch');
          sw.type = 'button';
          var disc = el('span', 'swatch-disc ' + DOT_CLASSES[i]);
          sw.appendChild(disc);
          sw.setAttribute('aria-label', COLOR_NAMES[i]);
          if (i === cur) {
            sw.classList.add('is-selected');
            disc.appendChild(icon('check'));
          }
          sw.addEventListener('click', function () {
            if (handle) handle.dismiss();
            if (i === cur) return; // the same colour is no edit
            var entry = record('change colour');
            if (!M.setColor(d, id, i)) { unrecord(entry); return; }
            render();
            select(id);
            commit();
          });
          grid.appendChild(sw);
        })(i);
      }
      // contentEl mode returns { dismiss, el }, not a Promise; onDismiss
      // clears the handle whether it closed itself or closeMenu did.
      handle = un.popover({
        anchorEl: els.get(id),
        title: 'Colour',
        contentEl: grid,
        onDismiss: function () { if (colourPop === handle) colourPop = null; },
      });
      colourPop = handle;
    }

    var tidyChecks = 0; // every commit bumps it; the tidy dev check reads it

    function commit() {
      // The caller saves; the canvas only redraws and reports. A map kept
      // tidy (#18) relayouts first, so every edit path stays tidy.
      if (M.isAutoLayout(d) && !gesture) tidy();
      tidyChecks++;
      drawBranches();
      renderBar();
      refreshFind(); // an open find re-marks against the new doc
      syncTree(); // edits that skip a full render still re-sync the tree
      opts.onChange();
    }

    // ── Tidy up (#18) ────────────────────────────────────────────────────
    var tidyAt = -1; // the tidyChecks value the last tidy that moved something owns
    var tidyCheckAdded = false;

    function registerTidyCheck() {
      // Dev build only: after every tidy that moved something, re-check on
      // resize that no two ideas still overlap. Reports idea ids only, never
      // idea text. Never let a dev-only hook break a real tidy.
      if (tidyCheckAdded) return;
      var un2 = root.usernode;
      if (!un2 || !un2.invariants || typeof un2.invariants.register !== 'function') return;
      tidyCheckAdded = true;
      try {
        un2.invariants.register('tidy-leaves-no-overlap', function () {
          if (tidyChecks !== tidyAt) return true; // edited since the tidy
          var pair = M.overlaps(d, measureDom);
          return pair ? 'ideas overlap after tidy: ' + pair[0] + ', ' + pair[1] : true;
        });
      } catch (e) { /* dev only */ }
    }

    function posOf(n) {
      // While the tidy animation slides the boxes, the doc already holds the
      // final positions, so anything that draws reads the live style first.
      var b = els.get(n.id);
      if (b) {
        var x = parseFloat(b.style.left), y = parseFloat(b.style.top);
        if (isFinite(x) && isFinite(y)) return [x, y];
      }
      return [n.x, n.y];
    }

    function measureDom(n) {
      var b = els.get(n.id);
      var w = b && b.offsetWidth, h = b && b.offsetHeight;
      if (!w || !h) return M.estimatedSize(d, n);
      return { w: w, h: h };
    }

    function endTween() {
      if (!tween) return;
      cancelAnimationFrame(tween.raf);
      tween.targets.forEach(function (t) {
        t.b.style.left = t.x1 + 'px';
        t.b.style.top = t.y1 + 'px';
      });
      tween = null;
    }

    function startTween(from) {
      // Slide the ideas from where they were to where the layout put them,
      // redrawing the branches every frame. The doc itself is already final.
      var targets = [];
      M.nodes(d).forEach(function (n) {
        var p = from[n.id], b = els.get(n.id);
        if (!p || !b || (p[0] === n.x && p[1] === n.y)) return;
        targets.push({ b: b, x0: p[0], y0: p[1], x1: n.x, y1: n.y });
      });
      if (!targets.length) return;
      var t0 = performance.now();
      function frame(now) {
        var t = Math.min(1, (now - t0) / 250);
        var e = 1 - Math.pow(1 - t, 3); // ease out
        targets.forEach(function (tg) {
          tg.b.style.left = tg.x0 + (tg.x1 - tg.x0) * e + 'px';
          tg.b.style.top = tg.y0 + (tg.y1 - tg.y0) * e + 'px';
        });
        drawBranches();
        if (t < 1) tween.raf = requestAnimationFrame(frame);
        else endTween();
      }
      tween = { raf: requestAnimationFrame(frame), targets: targets };
    }
    var tween = null;

    function tidy(label) {
      // Lay the whole map out from the model. A `label` marks the button and
      // menu taps as their own undo step; the automatic relayout that keeps
      // tidy maps tidy arrives without one.
      if (readOnly) return;
      var from = {};
      M.nodes(d).forEach(function (n) { from[n.id] = [n.x, n.y]; });
      var entry = label ? record(label) : null;
      var changed = M.layout(d, measureDom);
      if (!changed) {
        if (entry) unrecord(entry);
        if (label) un.toast('Already tidy');
        return;
      }
      tidyAt = tidyChecks + 1; // the commit that follows bumps the counter
      registerTidyCheck();
      endTween();
      render();
      select(selectedId);
      fit(true);
      if (!reducedMotion) startTween(from);
    }

    function toggleKeepTidy() {
      if (readOnly) return;
      var entry = record(M.isAutoLayout(d) ? 'Keep tidy off' : 'Keep tidy on');
      if (M.isAutoLayout(d)) delete d.layout;
      else d.layout = { auto: true };
      if (M.isAutoLayout(d)) tidy(); // switching it on lays the map out now
      commit();
    }

    // ── Undo and redo ────────────────────────────────────────────────────
    // Every edit calls record(label) just before it mutates the doc, so the
    // doc state before it is on the undo stack. A snapshot holds both the
    // ideas and the links, so deleting an idea brings its links back too.
    // A pending edit that turns out to change nothing pops its entry with
    // unrecord(), only while it is still on top.

    function record(label) {
      var entry = { label: label, snap: M.snapshot(d) };
      undoStack.push(entry);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack.length = 0;
      lastNudge = { id: null, at: 0 };
      if (deleteToast && deleteToast.dismiss) deleteToast.dismiss();
      deleteToast = null;
      renderHistory();
      return entry;
    }

    function unrecord(entry) {
      if (undoStack.length && undoStack[undoStack.length - 1] === entry) {
        undoStack.pop();
        renderHistory();
      }
    }

    function undo() {
      if (!undoStack.length || gesture) return;
      step(undoStack, redoStack);
    }

    function redo() {
      if (!redoStack.length || gesture) return;
      step(redoStack, undoStack);
    }

    function step(from, to) {
      cancelLink(); // a Join waiting for its second idea stops first
      var entry = from.pop();
      to.push({ label: entry.label, snap: M.snapshot(d) });
      M.replaceWith(d, entry.snap);
      announce((from === undoStack ? 'Undone: ' : 'Redone: ') + entry.label);
      if (selectedId && !M.node(d, selectedId)) selectedId = null;
      render();
      select(selectedId);
      commit();
      lastNudge = { id: null, at: 0 };
      renderHistory();
    }

    // A whole new doc in one step, the way a restore arrives (#32): one
    // undo entry covers it, and a selection the new doc lacks is cleared.
    function replaceDoc(next, label) {
      record(label);
      M.replaceWith(d, M.snapshot(next));
      if (selectedId && !M.node(d, selectedId)) selectedId = null;
      render();
      commit();
    }

    function renderHistory() {
      if (!undoBtn) return;
      var u = undoStack[undoStack.length - 1];
      var r = redoStack[redoStack.length - 1];
      undoBtn.disabled = !u;
      redoBtn.disabled = !r;
      undoBtn.title = u ? 'Undo ' + u.label : 'Undo';
      undoBtn.setAttribute('aria-label', undoBtn.title);
      redoBtn.title = r ? 'Redo ' + r.label : 'Redo';
      redoBtn.setAttribute('aria-label', redoBtn.title);
    }

    // ── Rendering ────────────────────────────────────────────────────────
    // The idea's whole spoken line, the one helper every aria-label comes
    // from: the text, where the idea sits in the tree, and what hangs off
    // it (ideas under it, links to other ideas). Newlines are spoken as
    // spaces, so a two-line idea reads as one line.
    function spoken(text) { return (text || '').replace(/\n/g, ' '); }
    function ideaLabel(n) {
      var line = baseLabel(n);
      if (ghosts && ghosts[n.id]) line += ', added since this version';
      return line;
    }

    function baseLabel(n) {
      if (n.id === 'root') {
        var mains = M.childrenOf(d, 'root').length;
        return spoken(n.text) + ', central idea, ' + mains + ' main idea' + (mains === 1 ? '' : 's');
      }
      var parent = M.node(d, n.parent);
      var line = spoken(n.text) + ', level ' + (M.depth(d, n.id) + 1) +
        ', in ' + (parent ? spoken(parent.text) : '');
      var under = M.countUnder(d, n.id);
      if (under > 0) line += ', ' + under + ' idea' + (under === 1 ? '' : 's') + ' under it';
      var linked = [];
      M.links(d).forEach(function (l) {
        var other = l.from === n.id ? l.to : l.to === n.id ? l.from : null;
        if (!other) return;
        var on = M.node(d, other);
        if (on) linked.push(spoken(on.text));
      });
      if (linked.length === 1) line += ', linked to ' + linked[0];
      else if (linked.length === 2) line += ', linked to ' + linked[0] + ' and ' + linked[1];
      else if (linked.length > 2) {
        line += ', linked to ' + linked[0] + ', ' + linked[1] + ' and ' + (linked.length - 2) + ' more';
      }
      return line;
    }

    function render() {
      if (editing) finishEdit(true, false); // a rebuild ends the edit
      closeMenu(); // the buttons are rebuilt, so the menu's anchor would dangle
      endTween();
      els.forEach(function (old) { if (old.parentNode) old.parentNode.removeChild(old); });
      els.clear();
      // Ideas go into the tree layer in tree order, so what a screen reader
      // walks is the map itself, not the draw order.
      M.treeOrder(d).forEach(function (t) {
        var n = t.node;
        var b = el('button', 'idea');
        b.type = 'button';
        b.textContent = n.text;
        b.dataset.id = n.id;
        b.setAttribute('role', 'treeitem');
        b.setAttribute('aria-level', String(t.level));
        b.setAttribute('aria-setsize', String(t.size));
        b.setAttribute('aria-posinset', String(t.pos));
        if (t.hasChildren) b.setAttribute('aria-expanded', n.collapsed ? 'false' : 'true');
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
        if (n.id === selectedId) b.classList.add('is-selected');
        if (n.id !== 'root') b.setAttribute('aria-haspopup', 'menu');
        if (M.depth(d, n.id) >= 3) b.classList.add('lvl-deep');
        if (focusId && !underFocus(n.id)) b.classList.add('is-dim');
        if (ghosts && ghosts[n.id]) b.classList.add('is-ghost');
        b.setAttribute('aria-label', ideaLabel(n));
        b.style.left = n.x + 'px';
        b.style.top = n.y + 'px';
        treeEl.appendChild(b);
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
      refreshFind(); // a rebuild drops the find marks; re-apply them
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
        b.classList.toggle('is-dim', !!focusId && !(underFocus(l.from) && underFocus(l.to)));
        b.classList.toggle('is-empty', !l.text);
        b.setAttribute('aria-label', 'Link between ' + a.text + ' and ' + z.text + (l.text ? ', ' + l.text : ''));
      });
      syncTree();
    }

    // The idea the roving tab stop sits on: the selection, else the idea
    // with keyboard focus, else the centre — the first one that is on the
    // paper and bright.
    function rovingId() {
      var ids = [selectedId, focusId, 'root'];
      for (var i = 0; i < ids.length; i++) {
        var b = ids[i] && els.get(ids[i]);
        if (b && !b.classList.contains('is-dim')) return ids[i];
      }
      return 'root';
    }

    // Rewrite the tree layer's facts for screen readers: the tree's name
    // (the map's title), every idea's level, rank, expansion, spoken label
    // and selected mark, the DOM order the reader walks, and the one roving
    // tab stop. Runs after every change to the doc or the selection. A
    // button that moved keeps its keyboard focus across the re-append.
    function syncTree() {
      if (!treeEl) return;
      var rootN = M.node(d, 'root');
      treeEl.setAttribute('aria-label', rootN ? rootN.text : '');
      var order = M.treeOrder(d);
      order.forEach(function (t) {
        var b = els.get(t.node.id);
        if (!b || b.getAttribute('role') !== 'treeitem') return;
        b.setAttribute('aria-level', String(t.level));
        b.setAttribute('aria-setsize', String(t.size));
        b.setAttribute('aria-posinset', String(t.pos));
        if (t.hasChildren) b.setAttribute('aria-expanded', t.node.collapsed ? 'false' : 'true');
        else b.removeAttribute('aria-expanded');
        b.setAttribute('aria-label', ideaLabel(t.node));
        b.setAttribute('aria-selected', t.node.id === selectedId ? 'true' : 'false');
      });
      // Re-append only what moved (walking from the end, inserting before
      // the sibling that follows it), so an idea being edited or focused
      // elsewhere stays put.
      var ref = null, refocus = null;
      var active = document.activeElement;
      for (var i = order.length - 1; i >= 0; i--) {
        var b = els.get(order[i].node.id);
        if (!b || b.getAttribute('role') !== 'treeitem') continue;
        if (b.parentNode !== treeEl || b.nextSibling !== ref) {
          if (active === b) refocus = b;
          treeEl.insertBefore(b, ref);
        }
        ref = b;
      }
      if (refocus) refocus.focus({ preventScroll: true });
      // One idea is tabbable (the roving tab stop); the rest sit at -1, and
      // the dimmed ones say they are not usable right now.
      var rove = rovingId();
      els.forEach(function (b, id) {
        if (b.getAttribute('role') !== 'treeitem') return;
        b.tabIndex = id === rove ? 0 : -1;
        if (b.classList.contains('is-dim')) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
      });
    }

    function widthOf(n) {
      var b = els.get(n.id);
      return b ? b.offsetWidth : 80;
    }

    // Where an idea's branch leaves it: the centre of a pill, or the
    // underline end of a text idea, facing the child.
    function edgeStart(n) {
      var at = posOf(n);
      if (M.isPill(d, n.id)) return at;
      var gp = M.node(d, n.parent);
      var right = gp ? at[0] >= posOf(gp)[0] : true;
      return [right ? at[0] + widthOf(n) : at[0] - widthOf(n), at[1]];
    }

    function drawBranches() {
      var paths = '';
      // The idea being typed draws its branch too, so it grows out of its
      // parent as words go in.
      if (editing && !editing.id) {
        var dp = M.node(d, editing.parentId);
        if (dp) {
          var ds = edgeStart(dp);
          var ddep = M.depth(d, editing.parentId) + 1;
          var dw = ddep === 1 ? 'w1' : ddep === 2 ? 'w2' : 'w3';
          var dc = editing.parentId === 'root'
            ? M.pickFreeColor(d, editing.x >= 0 ? 1 : -1)
            : M.branchColor(d, editing.parentId);
          var dmx = (ds[0] + editing.x) / 2;
          paths += '<path class="' + dw + ' ' + COLOR_CLASSES[dc == null ? 0 : dc] +
            '" d="M' + ds[0] + ' ' + ds[1] + 'C' + dmx + ' ' + ds[1] + ', ' +
            dmx + ' ' + editing.y + ', ' + editing.x + ' ' + editing.y + '"/>';
        }
      }
      M.nodes(d).forEach(function (n) {
        if (n.id === 'root' || !n.parent) return;
        var from = M.node(d, n.parent);
        if (!from) return;
        var s = edgeStart(from);
        var depth = M.depth(d, n.id);
        var w = depth === 1 ? 'w1' : depth === 2 ? 'w2' : 'w3';
        var c = M.branchColor(d, n.id);
        var cls = w + ' ' + COLOR_CLASSES[c == null ? 0 : c];
        var np = posOf(n);
        var mx = (s[0] + np[0]) / 2;
        if (focusId && !underFocus(n.id)) cls += ' dim';
        if (ghosts && ghosts[n.id]) cls += ' ghost';
        paths += '<path class="' + cls + '" d="M' + s[0] + ' ' + s[1] +
          'C' + mx + ' ' + s[1] + ', ' + mx + ' ' + np[1] + ', ' + np[0] + ' ' + np[1] + '"/>';
      });
      M.links(d).forEach(function (l) {
        var seg = linkSegment(l);
        var b = linkEls.get(l.id);
        if (seg && seg.line) {
          var ln = seg.line;
          var ldim = focusId && !(underFocus(l.from) && underFocus(l.to)) ? ' dim' : '';
          paths += '<path class="link-line' + ldim + '" d="M' + ln[0] + ' ' + ln[1] + 'L' + ln[2] + ' ' + ln[3] + '"/>';
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
      drawMinimap();
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
    // The zoom clamp (#25): ten times out to three times in, so a big map
    // can be read from a distance or studied up close. Below FAR_SCALE the
    // paper is a survey view: deep ideas' words and link names step aside.
    var MIN_SCALE = 0.1, MAX_SCALE = 3, FAR_SCALE = 0.4;
    function clampScale(s) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

    function applyTransform() {
      world.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
      rootEl.style.backgroundPosition = tx + 'px ' + ty + 'px';
      var pc = Math.round(scale * 100) + '%';
      zoomLevel.textContent = pc;
      zoomLevel.setAttribute('aria-label', 'Reset zoom, ' + pc);
      rootEl.classList.toggle('is-far', scale < FAR_SCALE);
      placeMenu();
      placeMinimapView();
      scheduleSaveView();
    }

    // ── The remembered viewport ──────────────────────────────────────────
    // A map opens where it was left, not fitted from scratch. The view is
    // saved 400 ms after it stops moving, per map, on this device only; a
    // saved view that no longer overlaps the map is ignored, and focus mode
    // never writes one (leaving focus restores the view from before it).
    function saveView() {
      if (!mapId) return;
      try {
        localStorage.setItem('m2.view.' + mapId,
          JSON.stringify({ tx: Math.round(tx), ty: Math.round(ty), scale: scale }));
      } catch (e) { /* private mode: the map just opens fitted */ }
    }
    function scheduleSaveView() {
      if (!mapId || focusId) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveView, 400);
    }
    function loadSavedView() {
      if (!mapId) return false;
      try {
        var s = JSON.parse(localStorage.getItem('m2.view.' + mapId) || 'null');
        if (!s || !isFinite(s.tx) || !isFinite(s.ty) || !isFinite(s.scale)) return false;
        if (s.scale < MIN_SCALE || s.scale > MAX_SCALE) return false;
        var W = rootEl.clientWidth, H = rootEl.clientHeight;
        var x0 = -s.tx / s.scale, y0 = -s.ty / s.scale;
        var b = bounds();
        if (x0 + W / s.scale < b.x || x0 > b.x + b.w || y0 + H / s.scale < b.y || y0 > b.y + b.h) return false;
        tx = s.tx; ty = s.ty; scale = s.scale;
        return true;
      } catch (e) { return false; }
    }

    // Put the idea menu just above the selected idea, centred on it and kept
    // on screen; below it when the top bar is in the way. Read from the
    // model and the view's own numbers, so a gliding Fit lands it where the
    // idea will be.
    function placeMenu() {
      // The popover's state also lives in `menu` ({ id, handle }); only the
      // toolbar has geometry to place.
      if (!menu || !menu.style || menu.hidden) return;
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
      // The toolbar moves with the same easing, so it stays on its idea.
      if (menu && menu.style) menu.classList.toggle('glide', !!on && !reducedMotion);
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
      var at = posOf(n);
      var x0;
      if (M.isPill(d, n.id)) x0 = at[0] - w / 2;
      else {
        var p = M.node(d, n.parent);
        x0 = p && at[0] < posOf(p)[0] ? at[0] - w : at[0];
      }
      return { x: x0, y: at[1] - hh / 2, w: w, h: hh };
    }

    // The bounding box of the ideas in `list` (every idea by default), in
    // world coordinates.
    function bounds(list) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var any = false;
      (list || M.nodes(d)).forEach(function (n) {
        var box = boxOf(n);
        if (!box) return;
        any = true;
        minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
      });
      if (!any) return { x: -100, y: -60, w: 200, h: 120 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // Bring a box into the space between the bars, leaving room on the right
    // for the zoom group so Fit never hides an idea behind it.
    function fitBox(b, animated) {
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = barHeight();
      var top = 60 + 24, bottom = H - barH - 24;
      var availW = W - 48 - 72, availH = Math.max(bottom - top, 120);
      var s = Math.min(availW / Math.max(b.w, 1), availH / Math.max(b.h, 1), 1);
      scale = Math.max(s, MIN_SCALE);
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      tx = W / 2 - 36 - cx * scale;
      ty = (top + bottom) / 2 - cy * scale;
      glide(animated);
      applyTransform();
    }

    // Fit the whole map — or, while focused, the focused branch.
    function fit(animated) {
      fitBox(bounds(focusId ? M.subtree(d, focusId) : null), animated);
    }

    // Pan just enough to show a world point — or a box around one, when the
    // caller passes the idea's drawn w and h, so the whole pill or underline
    // clears the bars and the edges. A box wider or taller than the space
    // pins to its left (top) edge: one edge has to win. An optional
    // `kbBottom` (canvas pixels) tightens the bottom limit, for keeping the
    // inline editor above the on-screen keyboard.
    function reveal(x, y, animated, w, h, kbBottom, padArg) {
      var sx = x * scale + tx, sy = y * scale + ty;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = barHeight();
      var pad = typeof padArg === 'number' ? padArg : 40;
      var top = 60 + pad, bottom = H - barH - pad;
      if (typeof kbBottom === 'number' && kbBottom < bottom) bottom = kbBottom;
      var halfW = w ? w * scale / 2 : 0, halfH = h ? h * scale / 2 : 0;
      var dx = 0, dy = 0;
      if (sx - halfW < pad) dx = pad - (sx - halfW);
      else if (sx + halfW > W - pad) dx = (W - pad) - (sx + halfW);
      if (sy - halfH < top) dy = top - (sy - halfH);
      else if (sy + halfH > bottom) dy = bottom - (sy + halfH);
      if (dx || dy) {
        glide(animated);
        tx += dx; ty += dy;
        applyTransform();
      }
    }

    // Pan so the whole idea named is on the paper, not just its anchor. A
    // larger `pad` keeps it clear of the overlays too (the arrows use 48).
    function revealIdea(id, animated, pad) {
      var n = M.node(d, id);
      var box = n && boxOf(n);
      if (!n) return;
      reveal(n.x, n.y, animated, box ? box.w : 0, box ? box.h : 0, null, pad);
    }

    // Put an idea in the middle of the paper (#25): the view stays at its
    // zoom, the idea comes to you. Works read-only too.
    function centerOn(id) {
      var n = id && M.node(d, id);
      if (!n) return;
      var box = boxOf(n);
      var cx = box ? box.x + box.w / 2 : n.x, cy = box ? box.y + box.h / 2 : n.y;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      glide(true);
      tx = W / 2 - cx * scale;
      ty = (60 + H - barHeight()) / 2 - cy * scale;
      applyTransform();
    }

    // Keyboard focus on an idea, or back on the paper when there is none.
    // preventScroll: reveal() pans by the view's own rules instead.
    function focusIdea(id) {
      var b = id && els.get(id);
      if (b) b.focus({ preventScroll: true });
      else rootEl.focus({ preventScroll: true });
    }

    // One zoom step around the middle of the space between the bars, kept
    // inside the same 0.1–3 clamp the pinch and wheel use.
    function zoomBy(f, animated) {
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var px = W / 2, py = (60 + H - barHeight()) / 2;
      var wx = (px - tx) / scale, wy = (py - ty) / scale;
      scale = clampScale(scale * f);
      tx = px - wx * scale;
      ty = py - wy * scale;
      closeMenu(); // the menu's idea slides under it at the new zoom
      glide(animated);
      applyTransform();
    }

    // Back to 100% around the same centre: the tap on the zoom level.
    function resetZoom() {
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var px = W / 2, py = (60 + H - barHeight()) / 2;
      var wx = (px - tx) / scale, wy = (py - ty) / scale;
      scale = 1;
      tx = px - wx;
      ty = py - wy;
      closeMenu();
      glide(true);
      applyTransform();
    }

    // ── Focus on a branch (#25) ──────────────────────────────────────────
    // One idea's subtree fills the paper, everything else dims to a shadow
    // you cannot tap. A view state only: the doc is untouched, so no
    // record() here and nothing to undo. Leaving focus brings back the
    // exact view from before it.
    function underFocus(id) {
      if (!focusId) return true;
      var n = M.node(d, id);
      while (n) {
        if (n.id === focusId) return true;
        n = n.parent ? M.node(d, n.parent) : null;
      }
      return false;
    }

    function focusOn(id) {
      var n = M.node(d, id);
      if (!n || id === 'root' || id === focusId) return;
      if (!focusId) preFocus = { tx: tx, ty: ty, scale: scale };
      focusId = id;
      applyFocus();
      renderFocusChip();
      // Zoom so the whole branch fits, with the overlays' room reserved.
      // The focused view is never saved; applyTransform's debounced save
      // skips while focusId is set.
      fitBox(bounds(M.subtree(d, id)), true);
    }

    function exitFocus() {
      if (!focusId) return;
      focusId = null;
      applyFocus();
      renderFocusChip();
      if (preFocus) {
        glide(true);
        tx = preFocus.tx; ty = preFocus.ty; scale = preFocus.scale;
        preFocus = null;
        applyTransform();
      }
    }

    // Bright and dim, on the ideas already on the paper; the branches and
    // labels pick it up from drawBranches()/labelLinks().
    function applyFocus() {
      els.forEach(function (b, id) {
        if (id === '__draft') return;
        var dim = focusId && !underFocus(id);
        b.classList.toggle('is-dim', dim);
        if (dim) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
      });
      linkEls.forEach(function (b) {
        b.classList.remove('is-dim');
      });
      linkEls.forEach(function (b, lid) {
        var l = M.linkById(d, lid);
        if (l) b.classList.toggle('is-dim', !!focusId && !(underFocus(l.from) && underFocus(l.to)));
      });
      syncTree(); // the roving tab stop and the dimmed ideas' aria-disabled
      drawBranchesSoon();
      if (bar) renderBar();
    }

    // The chip under the top bar: every idea from the root to the focused
    // one as buttons; the root crumb leaves focus, any other refocuses there.
    function renderFocusChip() {
      crumbRow.textContent = '';
      if (!focusId) {
        focusChip.hidden = true;
        return;
      }
      focusChip.hidden = false;
      M.ancestors(d, focusId).concat([M.node(d, focusId)]).forEach(function (n) {
        var c = el('button', 'crumb' + (n.id === focusId ? ' is-current' : ''));
        c.type = 'button';
        c.textContent = n.text.trim();
        c.addEventListener('click', function () {
          if (n.id === 'root') exitFocus();
          else focusOn(n.id);
        });
        crumbRow.appendChild(c);
      });
      placeOverlays();
    }

    // ── The minimap ──────────────────────────────────────────────────────
    // The whole map at thumbnail scale; the rectangle is what the screen
    // shows. Where it sits (right or left of the zoom group) is CSS; its
    // height above the bar is placeOverlays().
    var mmScale = 1, mmOx = 0, mmOy = 0;
    var MM_W = 160, MM_H = 110, MM_PAD = 10;
    function m2x(wx) { return (wx - mmOx) * mmScale; }
    function m2y(wy) { return (wy - mmOy) * mmScale; }

    function drawMinimap() {
      if (minimap.hidden) return;
      var b = bounds();
      var s = Math.min((MM_W - MM_PAD * 2) / Math.max(b.w, 1), (MM_H - MM_PAD * 2) / Math.max(b.h, 1), 0.5);
      mmScale = s;
      mmOx = b.x + b.w / 2 - MM_W / (2 * s);
      mmOy = b.y + b.h / 2 - MM_H / (2 * s);
      var out = '';
      M.nodes(d).forEach(function (n) {
        var box = boxOf(n);
        if (!box) return;
        var w = Math.max(box.w * s, 3), h = Math.max(box.h * s, 3);
        var cls = n.id === 'root' ? 'mm-ink'
          : 'mm-' + COLOR_NAMES[M.branchColor(d, n.id) == null ? 0 : M.branchColor(d, n.id)];
        out += '<rect class="' + cls + '" x="' + (m2x(box.x) - 1) + '" y="' + (m2y(box.y) - 1) +
          '" width="' + w + '" height="' + h + '" rx="1.5"/>';
      });
      mmSvg.innerHTML = out;
      placeMinimapView();
    }

    // What the screen shows, in minimap pixels; coalesced to one rAF so a
    // pinch or glide moves it without a layout pass per frame.
    var mmFrame = 0;
    function placeMinimapView() {
      if (minimap.hidden || mmFrame) return;
      mmFrame = requestAnimationFrame(function () {
        mmFrame = 0;
        if (minimap.hidden) return;
        var W = rootEl.clientWidth, H = rootEl.clientHeight;
        var x0 = (0 - tx) / scale, y0 = (0 - ty) / scale;
        var vw = W / scale * mmScale, vh = H / scale * mmScale;
        var left = Math.max(0, Math.min(MM_W - Math.min(vw, MM_W), m2x(x0)));
        var top = Math.max(0, Math.min(MM_H - Math.min(vh, MM_H), m2y(y0)));
        mmView.style.left = left + 'px';
        mmView.style.top = top + 'px';
        mmView.style.width = Math.max(Math.min(vw, MM_W), 10) + 'px';
        mmView.style.height = Math.max(Math.min(vh, MM_H), 10) + 'px';
      });
    }

    // Tap or drag anywhere on the minimap: that map point comes to the
    // middle of the screen.
    var mmDrag = false;
    function mmPan(e) {
      var r = minimap.getBoundingClientRect();
      var wx = mmOx + (e.clientX - r.left) / mmScale;
      var wy = mmOy + (e.clientY - r.top) / mmScale;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      glide(false);
      tx = W / 2 - wx * scale;
      ty = (60 + H - barHeight()) / 2 - wy * scale;
      closeMenu();
      applyTransform();
    }
    minimap.addEventListener('pointerdown', function (e) {
      mmDrag = true;
      minimap.setPointerCapture(e.pointerId);
      mmPan(e);
      e.preventDefault();
    });
    minimap.addEventListener('pointermove', function (e) { if (mmDrag) mmPan(e); });
    minimap.addEventListener('pointerup', function () { mmDrag = false; });
    minimap.addEventListener('pointercancel', function () { mmDrag = false; });

    function toggleMinimap(force) {
      var show = typeof force === 'boolean' ? force : minimap.hidden;
      minimap.hidden = !show;
      mmBtn.setAttribute('aria-label', show ? 'Hide minimap' : 'Show minimap');
      mmBtn.title = show ? 'Hide minimap' : 'Show minimap';
      try { localStorage.setItem('m2.minimap', show ? '1' : '0'); } catch (e) { /* private mode */ }
      if (show) drawMinimap();
    }

    // ── Gestures ─────────────────────────────────────────────────────────
    var pointers = new Map();
    var gesture = null; // {kind:'pan'|'maybe-drag'|'drag'|'link-tap'|'pinch', ...}
    var lastTap = { id: null, at: 0 };

    rootEl.addEventListener('pointerdown', function (e) {
      // A press inside the editor is selecting or moving the caret there.
      if (editing && e.target.closest && e.target.closest('.is-editing')) return;
      // A press anywhere else ends the edit, committing what was typed; the
      // press itself (on an idea, the paper, a bar) then does its own thing.
      if (editing) finishEdit(true, false);
      endTween(); // a press stops the tidy animation where it is
      // The bars and the idea menu float over the paper; a press on them is
      // not a tap on it (one used to clear the selection before an action
      // could act).
      if (e.target.closest && e.target.closest('.topbar, .bottom-bar, .idea-menu, .zoom-group, .minimap, .focus-chip')) return;
      if (pointers.size === 2) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // A second pointer turns any gesture into a pinch.
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        gesture = { kind: 'pinch', baseScale: scale, baseDist: dist, baseCx: cx, baseCy: cy };
        closeMenu();
        return;
      }
      // Read only, an idea is just more paper: dragging it pans the map.
      var labelEl = !readOnly && e.target.closest ? e.target.closest('.link-label') : null;
      var ideaEl = !readOnly && e.target.closest ? e.target.closest('.idea') : null;
      if (labelEl) {
        gesture = { kind: 'link-tap', id: labelEl.dataset.link, x: e.clientX, y: e.clientY, moved: false };
      } else if (ideaEl) {
        // t: when this press began, so a tap can tell whether this same press
        // already closed the idea's own menu (outside or anchor press).
        var dragId = ideaEl.dataset.id;
        gesture = { kind: 'maybe-drag', id: dragId, x: e.clientX, y: e.clientY, moved: false, t: e.timeStamp };
        // For a structural drop the subtree snaps back here first, so the
        // model sees the layout the drag started from; and the sibling
        // column it can slot back into, top to bottom.
        gesture.positions = M.subtree(d, dragId).map(function (n) {
          return { id: n.id, x: n.x, y: n.y };
        });
        gesture.sibs = null;
        gesture.rank0 = -1;
        if (dragId !== 'root') {
          var sibs0 = M.siblingsInOrder(d, dragId);
          gesture.rank0 = sibs0.indexOf(M.node(d, dragId));
          gesture.sibs = sibs0.filter(function (m) { return m.id !== dragId; })
            .map(function (m) { return m.y; });
        }
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
        var s = clampScale(gesture.baseScale * (dist / gesture.baseDist));
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
        if (!gesture.moved) closeMenu(); // panning the map closes the menu
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
          closeMenu(); // dragging the idea closes its menu
          clearDrop();
          record('move idea'); // the whole drag is one undo step
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
        updateDrop(e);
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
        var drop = gesture.drop;
        var alt = e.altKey;
        clearDrop();
        if (!alt && drop && drop.kind === 'under') {
          // Back to where the drag started, then move under the target, so
          // the model works from the layout the ring was shown on.
          snapBack(gesture);
          applyMoveUnder(gesture.id, drop.id);
        } else if (!alt && drop && drop.kind === 'rank') {
          snapBack(gesture);
          applyReorder(gesture.id, drop.r); // a no-op when the rank is unchanged
        } else {
          // A free drop with Keep tidy off: a main idea keeps facing its
          // ideas outward. Same undo step, since the drag recorded already.
          if (!M.isAutoLayout(d) && M.faceOutward(d, gesture.id)) render();
          commit();
        }
      } else if (gesture.kind === 'maybe-drag' && !gesture.moved) {
        var id = gesture.id;
        var now = Date.now();
        if (linkingFrom) {
          finishLink(id); // the second idea of a link, not a selection
          lastTap = { id: null, at: 0 };
        } else if (lastTap.id === id && now - lastTap.at < 300) {
          closeMenu(); // the first tap opened it
          openRename(id);
          lastTap = { id: null, at: 0 };
        } else {
          lastTap = { id: id, at: now };
          // The kit closes a popover on an outside press or a press on its
          // anchor, so a tap on the idea of an open menu closes the menu
          // instead of reopening it.
          var wasOpen = (menu && menu.id === id) || (menuClosed.id === id && menuClosed.at >= gesture.t);
          select(id);
          if (!wasOpen) openMenu(id);
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
      closeMenu();
      if (e.ctrlKey || e.metaKey) {
        var rect = rootEl.getBoundingClientRect();
        var px = e.clientX - rect.left, py = e.clientY - rect.top;
        var wx = (px - tx) / scale, wy = (py - ty) / scale;
        scale = clampScale(scale * Math.exp(-e.deltaY * 0.002));
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
      closeMenu(); // selecting another idea, or nothing, never leaves a stale one
      if (selectedId && els.get(selectedId)) {
        els.get(selectedId).classList.remove('is-selected');
      }
      selectedId = id;
      linkingFrom = null;
      if (id && els.get(id)) {
        els.get(id).classList.add('is-selected');
      }
      syncTree(); // aria-selected and the roving tab stop follow the ring
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
      if (!bar || readOnly) return;
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
      if (options.hint) form.appendChild(el('p', 'text-small text-muted', options.hint));
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
      // Escape closes a sheet from the field too, and in the add chain an
      // empty Enter stops it (the submit button is disabled then, so no
      // submit event would carry it).
      form.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          handle.dismiss();
        } else if (e.key === 'Enter' && options.keepOpen && !input.value.trim()) {
          e.preventDefault();
          handle.dismiss();
        }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v && !options.allowEmpty) return;
        if (options.keepOpen) {
          // The chain: onSubmit adds one idea and keeps the sheet open; it
          // may answer false to leave the field as it is when nothing was
          // added.
          if (onSubmit(v) === false) return;
          input.value = '';
          btn.disabled = true;
          input.focus();
        } else {
          handle.dismiss();
          onSubmit(v);
        }
      });
      var handle = un.presentSheet({
        contentEl: form,
        onDismiss: function () {
          if (options.onDismiss) options.onDismiss();
          focusIdea(selectedId); // back to the idea the sheet was about
        },
      });
      setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
      return handle;
    }

    // ── The inline editor (#14) ──────────────────────────────────────────
    // An idea is edited where it sits: its button is swapped for the same
    // shape made contenteditable, and kept in `els`, so the map measures the
    // editor as it grows and the branches follow. A new idea opens empty,
    // with a faint placeholder, and is only created on commit — the model
    // never sees empty text. One edit at a time.
    var editing = null; // { el, id | null, parentId, x, y, oldText, parentWidth, max, countEl, button }
    var coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;

    // What the edit says so far: carriage returns gone, runs of newlines
    // collapsed to one, trimmed.
    function editorText(elm) {
      var t = elm.innerText;
      t = t.replace(/\r/g, '');
      t = t.replace(/\n{2,}/g, '\n');
      return t.trim();
    }

    function openAdd() {
      if (M.ideaCount(d) >= M.MAX_NODES) return;
      var parent = selNode() || M.node(d, 'root');
      if (!M.canAddUnder(d, parent.id)) return;
      // A phone held sideways has no room to type in; the sheet still works.
      if (rootEl.clientHeight < 420) { openAddSheet(parent.id); return; }
      openEditor({ parentId: parent.id });
    }

    // Tab and Enter open the add sheet as a chain: it stays open, each Enter
    // adds the typed idea and starts the next field, and the last idea added
    // becomes where the next one grows from. Esc, or Enter on an empty
    // field, stops it. `where` is 'child' (Tab: under the selected idea) or
    // 'below'/'above' (Enter/Shift+Enter: beside it); on the central or a
    // main idea there is no beside, so a new main idea grows either way.
    function openAddChain(where) {
      var anchor = selNode() || M.node(d, 'root');
      if (!anchor) return;
      if (M.ideaCount(d) >= M.MAX_NODES) {
        un.toast('This map is full (500 ideas)');
        return;
      }
      var kind = where; // 'child' only for the first idea; then siblings
      var mode = where === 'child' ? 'below' : where; // 'below' | 'above'
      if (kind === 'child' && !M.canAddUnder(d, anchor.id)) {
        un.toast('Ideas go ' + M.MAX_DEPTH + ' levels deep');
        return;
      }
      sheetForm('Idea', 'e.g. Book a table', '', 'Add idea', M.MAX_TEXT, function (text) {
        if (M.ideaCount(d) >= M.MAX_NODES) {
          un.toast('This map is full (500 ideas)');
          return false;
        }
        if (kind === 'child' && !M.canAddUnder(d, anchor.id)) {
          un.toast('Ideas go ' + M.MAX_DEPTH + ' levels deep');
          return false;
        }
        var n = kind === 'child'
          ? M.addIdea(d, anchor.id, text, widthOf(anchor))
          : M.addSibling(d, anchor.id, text, mode === 'above');
        if (!n) return false;
        var parentN = M.node(d, n.parent);
        announce('Added ' + spoken(text) + (parentN ? ' under ' + spoken(parentN.text) : ''));
        kind = 'sibling'; // the chain runs beside the idea just added
        mode = 'below';
        anchor = n;
        render();
        var b = els.get(n.id);
        if (b && !reducedMotion) b.classList.add('idea-in');
        select(n.id);
        focusIdea(n.id);
        revealIdea(n.id, true);
        commit();
        return true;
      }, {
        keepOpen: true,
        hint: 'Enter adds it and starts the next one. Esc stops.',
      });
    }

    function openRename(id) {
      var n = M.node(d, id || selectedId);
      if (!n) return;
      if (rootEl.clientHeight < 420) { openRenameSheet(n); return; }
      openEditor({ id: n.id });
    }

    // The sheet version of adding, kept for the short-canvas fallback.
    function openAddSheet(parentId) {
      var parent = M.node(d, parentId);
      if (!parent) return;
      sheetForm('Idea', 'e.g. Book a table', '', 'Add idea', M.MAX_TEXT, function (text) {
        var entry = record('add idea');
        // The parent's measured width, so the new idea clears its text.
        var n = M.addIdea(d, parentId, text, widthOf(parent));
        if (!n) { unrecord(entry); return; }
        announce('Added ' + spoken(text) + ' under ' + spoken(parent.text));
        render();
        var b = els.get(n.id);
        if (b && !reducedMotion) b.classList.add('idea-in');
        select(parentId); // the idea you added to stays selected
        revealIdea(n.id, true);
        commit();
      });
    }

    function openRenameSheet(n) {
      var id = n.id, before = n.text;
      sheetForm('Idea', 'e.g. Book a table', n.text, 'Save', id === 'root' ? M.MAX_ROOT_TEXT : M.MAX_TEXT, function (text) {
        applyRename(id, text, before);
      });
    }

    // A rename that changed something: save it, and offer Undo in one step.
    function applyRename(id, text, before) {
      if (text === before || !M.node(d, id)) return; // the same text is no edit
      var entry = record('rename idea');
      if (!M.rename(d, id, text)) { unrecord(entry); return; }
      var b = els.get(id);
      if (b) {
        b.textContent = text;
        b.setAttribute('aria-label', ideaLabel(M.node(d, id)));
      }
      labelLinks(); // their screen-reader names say which ideas they join
      commit();
      announce('Renamed to ' + spoken(text));
      un.toast('Renamed to ' + text.replace(/\n/g, ' '), {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            if (!M.node(d, id)) return;
            record('rename idea');
            M.rename(d, id, before);
            var bb = els.get(id);
            if (bb) {
              bb.textContent = before;
              bb.setAttribute('aria-label', ideaLabel(M.node(d, id)));
            }
            labelLinks();
            commit();
            announce('Renamed back to ' + spoken(before));
          },
        },
      });
    }

    // Open the inline editor: over an existing idea (o.id), or over a
    // placeholder where the next idea under o.parentId would go. The idea is
    // only created when the edit commits with words in it.
    function openEditor(o) {
      if (editing) finishEdit(true, false); // one edit at a time
      closeMenu(); // glide() moves the menu with the map; a popover here would break it
      var isRename = !!o.id;
      var n = isRename ? M.node(d, o.id) : null;
      if (isRename && !n) return;
      var parentId = isRename ? n.parent : o.parentId;
      var parentNode = M.node(d, parentId);
      if (!isRename && (!parentNode || !M.canAddUnder(d, parentId) ||
          M.ideaCount(d) >= M.MAX_NODES)) return;
      var max = isRename && n.id === 'root' ? M.MAX_ROOT_TEXT : M.MAX_TEXT;
      var ed = el('div', 'idea is-editing');
      ed.setAttribute('contenteditable', 'plaintext-only');
      if (!ed.isContentEditable) ed.setAttribute('contenteditable', 'true'); // Firefox
      ed.setAttribute('role', 'textbox');
      ed.setAttribute('aria-multiline', 'true');
      ed.setAttribute('enterkeyhint', 'done');
      ed.setAttribute('spellcheck', 'false');
      var x, y, parentWidth, button = null;
      if (isRename) {
        button = els.get(n.id);
        if (!button) return;
        // The button's own look, without the selection ring.
        Array.prototype.slice.call(button.classList).forEach(function (c) {
          if (c !== 'idea' && c.indexOf('is-') !== 0) ed.classList.add(c);
        });
        x = n.x; y = n.y;
        ed.textContent = n.text;
        ed.setAttribute('aria-label', 'Editing ' + n.text);
        button.parentNode.replaceChild(ed, button);
        els.set(n.id, ed); // the map measures the editor where the button was
      } else {
        parentWidth = widthOf(parentNode);
        var p = M.placeIdea(d, parentId, parentWidth);
        if (!p) return;
        x = p.x; y = p.y;
        var pd = M.depth(d, parentId);
        if (pd === 0) { // a main idea under the centre
          ed.classList.add('idea-main');
          ed.classList.add(COLOR_CLASSES[p.color == null ? 0 : p.color]);
        } else {
          ed.classList.add('idea-sub');
          var bc = M.branchColor(d, parentId);
          ed.classList.add(COLOR_CLASSES[bc == null ? 0 : bc]);
          if (p.x < parentNode.x) ed.classList.add('left');
        }
        ed.dataset.placeholder = 'New idea';
        ed.setAttribute('aria-label', 'Editing new idea under ' + parentNode.text);
        els.set('__draft', ed);
      }
      ed.style.left = x + 'px';
      ed.style.top = y + 'px';
      world.appendChild(ed);
      var countEl = el('span', 'edit-count');
      countEl.setAttribute('aria-hidden', 'true');
      world.appendChild(countEl);
      editing = {
        el: ed, id: isRename ? n.id : null, parentId: parentId, x: x, y: y,
        oldText: isRename ? n.text : '', parentWidth: parentWidth, max: max,
        countEl: countEl, button: button,
      };
      // The editor's own keys: Enter commits, Escape cancels, Shift+Enter is
      // a line break. Everything else (arrows, undo, IME) is the browser's.
      ed.addEventListener('keydown', function (e) {
        e.stopPropagation(); // the canvas shortcuts wait until the edit is done
        if (e.isComposing) return; // an IME mid-composition owns its keys
        if (e.key === 'Enter' && !e.shiftKey) { finishEdit(true, true); e.preventDefault(); }
        else if (e.key === 'Escape') { finishEdit(false, true); e.preventDefault(); }
        else if (e.key === 'Enter' && e.shiftKey) {
          document.execCommand('insertText', false, '\n');
          e.preventDefault();
        }
      });
      // Pasted words arrive as plain text only, capped at what is left.
      ed.addEventListener('paste', function (e) {
        e.preventDefault();
        var sel = root.getSelection();
        if (sel && sel.rangeCount && ed.contains(sel.anchorNode) && !sel.isCollapsed) {
          sel.deleteFromDocument();
        }
        var t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        var room = editing && editing.el === ed ? editing.max - editorText(ed).length : 0;
        if (room > 0) document.execCommand('insertText', false, t.slice(0, room));
      });
      ed.addEventListener('input', function () {
        // A cleared edit can leave a stray <br>, which would hide the
        // placeholder; make it truly empty then.
        if (!ed.textContent && ed.childNodes.length) ed.textContent = '';
        clampText();
        drawBranchesSoon(); // the branches follow the editor's width
        updateCount();
        revealEditor();
      });
      ed.addEventListener('blur', function () { finishEdit(true, false); });
      ed.focus();
      // All of it selected, so typing replaces the old name.
      var sel = root.getSelection();
      if (sel) {
        var r = document.createRange();
        r.selectNodeContents(ed);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      updateCount();
      revealEditor();
    }

    // Keep the edit inside its limit on any way in (a drop, autocorrect):
    // cut the overflow off the end.
    function clampText() {
      if (!editing) return;
      var ed = editing.el;
      var over = editorText(ed).length - editing.max;
      if (over <= 0) return;
      var walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      var list = [], tn;
      while ((tn = walk.nextNode())) list.push(tn);
      for (var i = list.length - 1; i >= 0 && over > 0; i--) {
        var v = list[i].nodeValue;
        if (v.length <= over) { over -= v.length; list[i].nodeValue = ''; }
        else { list[i].nodeValue = v.slice(0, v.length - over); over = 0; }
      }
      if (!editorText(ed)) ed.textContent = '';
    }

    // The editor's drawn box in world coordinates: it sits in `els` under the
    // idea's id, or '__draft' while the idea is still being typed.
    function editorBox() {
      if (!editing) return null;
      return boxOf({ id: editing.id || '__draft', x: editing.x, y: editing.y, parent: editing.parentId });
    }

    // The characters-left count, shown only near the limit.
    function updateCount() {
      if (!editing) return;
      var left = editing.max - editorText(editing.el).length;
      var c = editing.countEl;
      if (left > 20) { c.textContent = ''; return; }
      c.textContent = left + ' left';
      var b = editorBox();
      if (!b) return;
      var pill = editing.id && M.isPill(d, editing.id);
      c.style.left = (pill ? b.x + b.w / 2 : b.x) + 'px';
      c.style.top = b.y + b.h + 4 + 'px';
      c.style.transform = pill ? 'translateX(-50%)' : '';
    }

    // Pan so the editor sits above the on-screen keyboard: the visible
    // canvas ends where the keyboard starts, read from visualViewport. On a
    // touch screen the editor is also kept to the upper half, where typing
    // never hides it.
    function revealEditor() {
      if (!editing) return;
      var b = editorBox();
      if (!b) return;
      var H = rootEl.clientHeight;
      var vv = root.visualViewport;
      var bottom = H;
      if (vv) {
        var rect = rootEl.getBoundingClientRect();
        bottom = vv.offsetTop + vv.height - rect.top;
      }
      if (coarse) bottom = Math.min(bottom, H * 0.45);
      bottom -= 16;
      // Both ends of the editor, so growth to either side stays seen.
      reveal(b.x, b.y, false, 0, 0, bottom);
      reveal(b.x + b.w, b.y + b.h, false, 0, 0, bottom);
    }

    // Leave the editor. commitIt saves the words (an empty edit on a new idea
    // just goes away; on an existing one the old text was never touched, so
    // there is nothing to restore); refocus hands the keyboard's focus back
    // to the idea's button.
    function finishEdit(commitIt, refocus) {
      if (!editing) return;
      var ed = editing;
      editing = null; // first: blur and the viewport can both re-enter
      if (ed.countEl.parentNode) ed.countEl.parentNode.removeChild(ed.countEl);
      var text = editorText(ed.el).slice(0, ed.max);
      if (ed.id) {
        var btn = ed.button;
        if (ed.el.parentNode) ed.el.parentNode.replaceChild(btn, ed.el);
        els.set(ed.id, btn);
        if (commitIt && text) applyRename(ed.id, text, ed.oldText);
        else drawBranchesSoon();
        if (refocus) btn.focus();
      } else {
        if (ed.el.parentNode) ed.el.parentNode.removeChild(ed.el);
        els.delete('__draft');
        if (commitIt && text) {
          var entry = record('add idea');
          var n2 = M.addIdea(d, ed.parentId, text, ed.parentWidth);
          if (n2) {
            var parentN = M.node(d, ed.parentId);
            announce('Added ' + spoken(text) + (parentN ? ' under ' + spoken(parentN.text) : ''));
            render();
            var b = els.get(n2.id);
            if (b && !reducedMotion) b.classList.add('idea-in');
            select(ed.parentId); // the idea it grew from stays selected
            revealIdea(n2.id, false);
            commit();
          } else {
            unrecord(entry);
          }
        } else {
          drawBranchesSoon(); // the draft branch goes away
        }
        if (refocus) {
          var pb = els.get(ed.parentId);
          if (pb) pb.focus();
        }
      }
    }

    function openDelete() {
      var n = selNode();
      if (!n) return;
      if (n.id === 'root') {
        un.alert({
          title: 'Delete ' + d.nodes[0].text.trim() + '?',
          message: 'It stays in Recently deleted for 30 days.',
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
      var parentId = M.node(d, id).parent;
      var entry = record('delete idea');
      var removed = M.removeSubtree(d, id);
      if (focusId && !M.node(d, focusId)) {
        focusId = null; // the focused branch is gone; no restore, it may be gone too
        preFocus = null;
        applyFocus();
        renderFocusChip();
      }
      var under = removed.length - 1;
      var text = removed[0].text;
      select(parentId || null); // what the idea grew from takes over
      render();
      commit();
      setTimeout(function () { focusIdea(parentId || null); }, 0);
      var message = 'Deleted ' + text + (under > 0 ? ' and ' + under + ' idea' + (under === 1 ? '' : 's') + ' under it' : '');
      announce(message + '. Undo with ' + (IS_MAC ? 'Command Z' : 'Control Z'));
      deleteToast = un.toast(message, {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            // Only while the delete is still the last edit, so the toast can
            // never undo something newer than the delete it names.
            if (undoStack[undoStack.length - 1] === entry) {
              undo();
              select(id);
              setTimeout(function () { focusIdea(id); }, 0);
            }
          },
        },
      });
    }

    // ── Moving ideas (#16) ───────────────────────────────────────────────
    // A move is undoable with one tap, like Delete: the model returns a
    // record of what changed, and the toast's Undo hands it back.
    function applyMoveUnder(id, parentId) {
      var p = M.node(d, parentId);
      if (!p || !M.canReparent(d, id, parentId)) return;
      var record = M.reparent(d, id, parentId, widthOf(p));
      if (!record) return;
      var n = M.node(d, id);
      render();
      select(id);
      reveal(n.x, n.y, true);
      commit();
      announce('Moved ' + spoken(n.text) + ' under ' + spoken(p.text));
      un.toast('Moved under ' + p.text.trim(), {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            if (M.undoMove(d, record)) { render(); select(id); commit(); }
          },
        },
      });
    }

    // Swap an idea with the sibling at rank r of its side (0 = topmost):
    // repeated neighbour swaps, all undone by one record.
    function applyReorder(id, r) {
      var n = M.node(d, id);
      if (!n) return;
      var sibs = M.siblingsInOrder(d, id);
      var cur = sibs.indexOf(n);
      if (r < 0 || r >= sibs.length || r === cur) return;
      var copies = M.nodes(d).map(function (m) { return JSON.parse(JSON.stringify(m)); });
      var record = { id: id, index: M.nodes(d).indexOf(n), nodes: copies };
      var dir = r > cur ? 1 : -1;
      while (M.siblingsInOrder(d, id).indexOf(M.node(d, id)) !== r) {
        if (!M.moveSibling(d, id, dir)) break;
      }
      commit();
      announce('Moved ' + spoken(n.text) + ', ' + (r + 1) + ' of ' + sibs.length);
      un.toast('Moved ' + n.text.trim(), {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            if (M.undoMove(d, record)) { render(); select(id); commit(); }
          },
        },
      });
    }

    // The Move to… sheet: every idea the picked one may go under, filtered
    // as you type. The search field takes focus on desktop only, so a phone
    // does not open its keyboard over the list.
    function openMoveTo(id) {
      var n = M.node(d, id);
      if (!n) return;
      var all = M.validParents(d, id);
      var wrap = el('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 4px 12px';
      wrap.appendChild(el('p', 'section-label', 'Move ' + n.text.trim() + ' under'));
      var field = el('input', 'field');
      field.type = 'text';
      field.placeholder = 'e.g. Book a table';
      field.setAttribute('aria-label', 'Search ideas');
      var listEl = el('div', 'list');
      wrap.appendChild(field);
      wrap.appendChild(listEl);
      var handle = null;
      function note(t) {
        if (t.id === 'root') return 'Central idea';
        if (t.parent === 'root') return 'Main idea';
        var p = M.node(d, t.parent);
        return p ? 'Under ' + p.text.trim() : 'Idea';
      }
      function draw() {
        listEl.textContent = '';
        var needle = field.value.trim().toLowerCase();
        var shown = all.filter(function (t) {
          return !needle || t.text.trim().toLowerCase().indexOf(needle) !== -1;
        });
        if (!shown.length) {
          listEl.appendChild(el('p', 'state-empty', 'No ideas match'));
          return;
        }
        shown.forEach(function (t) {
          var row = el('button', 'list-row');
          row.type = 'button';
          var text = el('div');
          text.style.cssText = 'flex:1;min-width:0';
          text.appendChild(el('p', 'text-body font-semibold', t.text.trim()));
          text.appendChild(el('p', 'text-small text-muted', note(t)));
          row.appendChild(dotFor(t));
          row.appendChild(text);
          row.addEventListener('click', function () {
            handle.dismiss();
            applyMoveUnder(id, t.id);
          });
          listEl.appendChild(row);
        });
      }
      field.addEventListener('input', draw);
      draw();
      handle = un.presentSheet({ contentEl: wrap });
      if (document.documentElement.classList.contains('un-desktop')) {
        setTimeout(function () { field.focus(); }, 60);
      }
    }

    // ── Drag-to-move visuals ─────────────────────────────────────────────
    // While an idea is dragged, a valid drop target gets a focus ring and
    // the bottom bar says what the drop would do; hovering its own sibling
    // column shows a thin line where it would slot in.
    var dropTargetEl = null, dropLineEl = null, dragHint = null;

    function setHint(text) {
      if (text === dragHint) return;
      dragHint = text;
      if (!bar || readOnly) return;
      if (text == null) { renderBar(); return; }
      selLine.textContent = '';
      selLine.appendChild(el('span', 'sel-meta', text));
    }

    function clearDrop() {
      if (dropTargetEl) { dropTargetEl.classList.remove('is-drop-target'); dropTargetEl = null; }
      if (dropLineEl && dropLineEl.parentNode) dropLineEl.parentNode.removeChild(dropLineEl);
      dropLineEl = null;
      setHint(null);
    }

    function snapBack(g) {
      g.positions.forEach(function (p) {
        var n = M.node(d, p.id);
        if (!n) return;
        n.x = p.x; n.y = p.y;
        var b = els.get(p.id);
        if (b) { b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; }
      });
      drawBranchesSoon();
    }

    // What a drop where the pointer is would do: under an idea, into a
    // sibling slot, or nothing (a free move). Alt holds the idea back from
    // both, for a pure move.
    function updateDrop(e) {
      var rect = rootEl.getBoundingClientRect();
      var wx = (e.clientX - rect.left - tx) / scale;
      var wy = (e.clientY - rect.top - ty) / scale;
      if (e.altKey || gesture.id === 'root') {
        clearDrop();
        setHint('Moving freely');
        return;
      }
      var list = M.nodes(d);
      for (var i = list.length - 1; i >= 0; i--) {
        var n = list[i];
        if (n.id === gesture.id) continue;
        var box = boxOf(n);
        if (!box) continue;
        if (wx >= box.x - 4 && wx <= box.x + box.w + 4 && wy >= box.y - 4 && wy <= box.y + box.h + 4) {
          if (!M.canReparent(d, gesture.id, n.id)) continue;
          var b = els.get(n.id);
          if (dropTargetEl !== b) {
            clearDrop();
            dropTargetEl = b;
            if (b) b.classList.add('is-drop-target');
          } else {
            // Same target: drop the insertion line, if any.
            if (dropLineEl && dropLineEl.parentNode) dropLineEl.parentNode.removeChild(dropLineEl);
            dropLineEl = null;
          }
          gesture.drop = { kind: 'under', id: n.id };
          setHint('Move under ' + n.text.trim());
          return;
        }
      }
      if (dropTargetEl) clearDrop();
      // The sibling column: a thin line between the neighbours it would slot
      // between, drawn from the dragged idea's own width.
      var ys = gesture.sibs;
      if (ys && ys.length) {
        var top = ys[0], bottom = ys[ys.length - 1];
        if (wy >= top - 60 && wy <= bottom + 60) {
          var r = 0;
          while (r < ys.length && ys[r] < wy) r++;
          var ly = r === 0 ? top - 25 : r === ys.length ? bottom + 25 : (ys[r - 1] + ys[r]) / 2;
          var gbox = boxOf(M.node(d, gesture.id));
          if (gbox) {
            if (!dropLineEl) { dropLineEl = el('div', 'drop-line'); world.appendChild(dropLineEl); }
            dropLineEl.style.left = gbox.x + 'px';
            dropLineEl.style.width = gbox.w + 'px';
            dropLineEl.style.top = ly + 'px';
            gesture.drop = { kind: 'rank', r: r };
            setHint('Move here');
            return;
          }
        }
      }
      gesture.drop = null;
      setHint('Drop on an idea to move it under it');
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
      var from = linkingFrom;
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
        var entry = record('add link');
        if (!M.addLink(d, from, id, text)) { unrecord(entry); return; }
        render(); // the first idea stays selected
        commit();
      }, { allowEmpty: true });
    }

    // A tap on a link's name (or dot): rename it, or delete it with Undo.
    function openLink(id) {
      var l = M.linkById(d, id);
      if (!l) return;
      sheetForm('Link name', 'e.g. Depends on', l.text, 'Save', M.MAX_LINK_TEXT, function (text) {
        if (text !== l.text) record('rename link'); // the same name is no edit
        M.renameLink(d, id, text);
        render();
        commit();
      }, {
        allowEmpty: true,
        extra: {
          label: 'Delete link',
          onClick: function () {
            var entry = record('delete link');
            var removed = M.removeLink(d, id);
            if (!removed) { unrecord(entry); return; }
            render();
            commit();
            deleteToast = un.toast('Deleted link', {
              priority: true,
              action: {
                label: 'Undo',
                handler: function () {
                  if (undoStack[undoStack.length - 1] === entry) undo();
                },
              },
            });
          },
        },
      });
    }

    // The shortcuts sheet, drawn from the SHORTCUTS table above. A read-only
    // view leaves the edit-only rows out, and a group with nothing left
    // drops away with them. Escape closes it like any sheet.
    function openShortcuts() {
      var col = el('div');
      col.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 4px 12px';
      col.appendChild(el('h2', 'text-heading', 'Keyboard shortcuts'));
      SHORTCUTS.forEach(function (group) {
        var rows = group.rows.filter(function (r) { return !readOnly || !r.edit; });
        if (!rows.length) return;
        col.appendChild(el('p', 'section-label', group.group));
        var list = el('ul', 'list');
        rows.forEach(function (row) {
          var li = el('li', 'list-row shortcut-row');
          li.appendChild(el('span', 'shortcut-text', row.text));
          var keys = el('span', 'keys');
          row.keys.forEach(function (k) {
            if (k === 'or') keys.appendChild(document.createTextNode(' or '));
            else keys.appendChild(el('kbd', 'key', k === 'Mod' ? (IS_MAC ? 'Cmd' : 'Ctrl') : k === 'Alt' && IS_MAC ? 'Option' : k));
          });
          li.appendChild(keys);
          list.appendChild(li);
        });
        col.appendChild(list);
      });
      var close = el('button', 'btn-secondary', 'Close');
      close.type = 'button';
      col.appendChild(close);
      var handle = un.presentSheet({
        contentEl: col,
        onDismiss: function () { focusIdea(selectedId); },
      });
      close.addEventListener('click', function () { handle.dismiss(); });
      setTimeout(function () { close.focus(); }, 60);
    }

    if (addBtn) {
      cancelBtn.addEventListener('click', cancelLink);
      addBtn.addEventListener('click', openAdd);
    }
    if (menu) {
      editItem.btn.addEventListener('click', function () { openRename(); });
      addItem.btn.addEventListener('click', openAdd);
      joinItem.btn.addEventListener('click', startLink);
      deleteItem.btn.addEventListener('click', openDelete);
    }

    // ── Find (#23) ───────────────────────────────────────────────────────
    // Search idea text and link names from a compact bar over the top bar.
    // M.search answers the matches; the canvas only highlights and pans.
    // Find never edits, so it never records, and it works the same on a
    // read-only view.
    var find = null;

    function openFind() {
      if (!find) {
        var stale = rootEl.querySelector('.find-bar');
        if (stale) stale.remove(); // a closed find leaves its bar behind
        var bar = el('div', 'find-bar');
        bar.appendChild(icon('search'));
        var input = el('input', 'find-input');
        input.type = 'search';
        input.setAttribute('aria-label', 'Find in map');
        input.setAttribute('placeholder', 'Find in map');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('enterkeyhint', 'search');
        bar.appendChild(input);
        var count = el('span', 'find-count');
        count.setAttribute('aria-live', 'polite');
        bar.appendChild(count);
        var prevBtn = el('button', 'find-step');
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', 'Previous match');
        prevBtn.appendChild(icon('chevronUp'));
        var nextBtn = el('button', 'find-step');
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', 'Next match');
        nextBtn.appendChild(icon('chevronDown'));
        var closeBtn = el('button', 'find-step');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close find');
        closeBtn.appendChild(icon('close'));
        bar.appendChild(prevBtn);
        bar.appendChild(nextBtn);
        bar.appendChild(closeBtn);
        rootEl.appendChild(bar);
        find = { bar: bar, input: input, count: count, prev: prevBtn, next: nextBtn, query: '', matches: [], index: 0 };
        prevBtn.addEventListener('click', function () { goToMatch(find.index - 1); input.focus(); });
        nextBtn.addEventListener('click', function () { goToMatch(find.index + 1); input.focus(); });
        closeBtn.addEventListener('click', closeFind);
        input.addEventListener('input', onFindInput);
        input.addEventListener('keydown', onFindKey);
      }
      cancelLink();
      find.bar.hidden = false;
      find.input.focus();
      find.input.select();
    }

    function onFindInput() {
      find.matches = M.search(d, find.input.value);
      find.index = 0;
      if (find.matches.length) goToMatch(0);
      else applyFind(); // no matches: clear the marks, say so, dim nothing
    }

    function onFindKey(e) {
      e.stopPropagation(); // the canvas hears none of the field's keys
      if (e.key === 'Enter') {
        e.preventDefault();
        goToMatch(find.index + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); // already open: keep the field and its text
      }
    }

    // Marks: matches ring and everything else dims; the current link match
    // is outlined (an idea's current match is simply the selected one).
    function clearFindMarks() {
      rootEl.classList.remove('is-finding');
      els.forEach(function (b) { b.classList.remove('is-match'); });
      linkEls.forEach(function (b) { b.classList.remove('is-match', 'is-current'); });
    }

    function updateCount() {
      if (!find) return;
      var n = find.matches.length;
      find.count.textContent = !find.input.value.trim() ? ''
        : n ? (find.index + 1) + ' of ' + n : 'No matches';
      find.prev.disabled = !n;
      find.next.disabled = !n;
    }

    function applyFind() {
      clearFindMarks();
      updateCount();
      if (!find || !find.matches.length) return;
      rootEl.classList.add('is-finding');
      find.matches.forEach(function (m) {
        var b = m.kind === 'idea' ? els.get(m.id) : linkEls.get(m.id);
        if (b) b.classList.add('is-match');
      });
      var cur = find.matches[find.index];
      if (cur && cur.kind === 'link') {
        var b = linkEls.get(cur.id);
        if (b) b.classList.add('is-current');
      }
    }

    function goToMatch(i) {
      if (!find || !find.matches.length) return;
      var n = find.matches.length;
      find.index = ((i % n) + n) % n; // Enter and Shift+Enter wrap both ways
      var m = find.matches[find.index];
      applyFind();
      if (m.kind === 'idea') {
        select(m.id); // the selection ring marks the current match
        revealIdea(m.id, true);
      } else {
        // A named link: bring its label on the paper, and leave the idea
        // selection alone.
        var l = null;
        M.links(d).forEach(function (x) { if (x.id === m.id) l = x; });
        var seg = l && linkSegment(l);
        var b = linkEls.get(m.id);
        if (seg && b) {
          reveal(seg.mid[0], seg.mid[1], true, b.offsetWidth / scale, b.offsetHeight / scale);
        }
      }
    }

    function closeFind() {
      if (!find) return;
      find.bar.hidden = true;
      clearFindMarks();
      find = null;
      focusIdea(selectedId); // the last match stays selected
    }

    // The doc changed under an open find: re-run the search, keep the
    // current match when it still matches, else clamp; re-mark, no panning.
    function refreshFind() {
      if (!find) return;
      var cur = find.matches[find.index];
      find.matches = M.search(d, find.input.value);
      var keep = -1;
      for (var i = 0; i < find.matches.length; i++) {
        if (cur && find.matches[i].kind === cur.kind && find.matches[i].id === cur.id) {
          keep = i;
          break;
        }
      }
      find.index = keep !== -1 ? keep : Math.min(find.index, find.matches.length - 1);
      if (find.index < 0) find.index = 0;
      applyFind();
    }

    // ── Keyboard ─────────────────────────────────────────────────────────
    // The whole map is reachable from the keys (#15): the arrows walk the
    // tree by way of M.nextIdea, Tab grows the selected idea and Enter adds
    // the next one after it, ? opens the shortcuts sheet, and Alt+arrows
    // keep the pointer-free nudge (Mod+Alt+arrows restructure). A read-only view keeps the walk, the zoom
    // and the sheet; every key that edits waits for an owned map.
    rootEl.addEventListener('keydown', function (e) {
      endTween(); // any key stops the tidy animation
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.target.isContentEditable) return; // the inline editor's own keys
      var key = e.key;

      // Global keys, wherever focus sits: the sheet, and the view keys. Mod
      // is Cmd or Ctrl — both are accepted on every platform.
      if (key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        openShortcuts();
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === '0') { fit(true); e.preventDefault(); return; }
        if (key === '=' || key === '+') { zoomBy(1.25); e.preventDefault(); return; }
        if (key === '-') { zoomBy(0.8); e.preventDefault(); return; }
        if (key.toLowerCase() === 'f' && !e.shiftKey) { openFind(); e.preventDefault(); return; }
      }

      // A key on a bar's or the menu's own button is that button's: Enter
      // presses it, rather than adding an idea. Escape in the menu closes it
      // and hands focus back to the idea.
      if (e.target.closest && e.target.closest('.topbar, .bottom-bar, .idea-menu, .zoom-group, .minimap, .focus-chip')) {
        if (key === 'Escape' && e.target.closest('.idea-menu') && selectedId) {
          var back = els.get(selectedId);
          select(null);
          if (back) back.focus();
          e.preventDefault();
        } else if (key === 'Escape' && linkingFrom) {
          cancelLink();
          e.preventDefault();
        } else if (key === 'Escape') {
          select(null);
        }
        // While a link waits the arrows keep walking, so focus can leave the
        // Cancel button and move idea to idea.
        if (!(linkingFrom && key.indexOf('Arrow') === 0)) return;
      }

      var focused = e.target.closest ? e.target.closest('.idea') : null;
      var focusedId = focused ? focused.dataset.id : null;
      var focusedLink = e.target.closest ? e.target.closest('.link-label') : null;

      // A link's name opens like a tap on it — on an owned map only, where
      // tapping it does.
      if (!readOnly && focusedLink && (key === 'Enter' || key === ' ')) {
        openLink(focusedLink.dataset.link);
        e.preventDefault();
        return;
      }

      if (key.indexOf('Arrow') === 0) {
        var dir = key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right'
          : key === 'ArrowUp' ? 'up' : 'down';
        // Mod+Alt+arrows restructure (#16): up and down swap with the
        // neighbour above or below, left promotes to the parent's parent,
        // right tucks the idea under the sibling above it.
        if (e.altKey && (e.ctrlKey || e.metaKey) && !readOnly) {
          var moving = focusedId || selectedId;
          e.preventDefault();
          if (moving && moving !== 'root' && !linkingFrom) {
            select(moving);
            var sibs = M.siblingsInOrder(d, moving);
            var cur = sibs.indexOf(M.node(d, moving));
            if (dir === 'up' || dir === 'down') {
              applyReorder(moving, cur + (dir === 'up' ? -1 : 1));
            } else if (dir === 'left') {
              var mn = M.node(d, moving);
              if (mn.parent !== 'root') applyMoveUnder(moving, mn.parent);
            } else if (cur > 0) {
              applyMoveUnder(moving, sibs[cur - 1].id);
            }
          }
          return;
        }
        if (e.altKey && !readOnly) {
          // Alt+arrows: the pointer-free nudge, 50 px with Shift, else 10.
          // A map kept tidy stays tidy: nudging is off under auto layout.
          if (M.isAutoLayout(d)) { e.preventDefault(); return; }
          var step = e.shiftKey ? 50 : 10;
          var dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
          var dy = dir === 'up' ? -step : dir === 'down' ? step : 0;
          var nudged = focusedId || selectedId;
          if (nudged) {
            // Rapid nudges of the same idea are one undo step; record() resets
            // lastNudge, so the new one is set after it.
            var now = Date.now();
            if (!(lastNudge.id === nudged && now - lastNudge.at < 1000)) record('move idea');
            M.moveSubtree(d, nudged, dx, dy);
            M.faceOutward(d, nudged); // a main idea keeps facing outward
            M.subtree(d, nudged).forEach(function (m) {
              var b = els.get(m.id);
              if (b) { b.style.left = m.x + 'px'; b.style.top = m.y + 'px'; }
            });
            drawBranchesSoon();
            commit();
            lastNudge = { id: nudged, at: now };
          }
          e.preventDefault();
          return;
        }
        var at = focusedId || selectedId;
        if (at) {
          var target = M.nextIdea(d, at, dir);
          // Focused on a branch, the walk stays inside it.
          if (target && focusId && !underFocus(target)) target = null;
          if (target) {
            select(target);
            focusIdea(target);
            revealIdea(target, false, 48); // a small margin, only when needed
          }
        } else {
          select('root'); // nothing chosen yet: the centre is where you land
          focusIdea('root');
        }
        e.preventDefault();
        return;
      }

      if ((key === 'f' || key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var fid = focusedId || selectedId;
        if (fid && fid !== 'root') {
          if (focusId === fid) exitFocus();
          else focusOn(fid);
          e.preventDefault();
        }
        return;
      }
      if ((key === 'c' || key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var cid = focusedId || selectedId;
        if (cid) { centerOn(cid); e.preventDefault(); }
        return;
      }
      // Nothing left chosen while focused: Escape leaves focus and brings
      // back the view from before.
      if (key === 'Escape' && focusId && !focusedId && !selectedId) {
        exitFocus();
        e.preventDefault();
        return;
      }

      if (readOnly) return; // below here the keys change the map

      if (linkingFrom) {
        // While a link waits, Enter on an idea finishes it and Escape stops
        // it; the arrows above moved without selecting, which would have
        // cleared the pending link.
        if (key === 'Enter' && focusedId) { finishLink(focusedId); e.preventDefault(); }
        else if (key === 'Escape') { cancelLink(); e.preventDefault(); }
        return;
      }

      if (key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Tab adds an idea only when the ring is squarely on one idea: the
        // focus is it, or the focus is free and one is selected. Otherwise
        // Tab leaves the map, as a keyboard user expects — Esc clears the
        // selection to let it go.
        var armed = (focusedId && focusedId === selectedId) || (!focusedId && selectedId);
        if (armed) {
          select(focusedId || selectedId);
          openAddChain('child');
          e.preventDefault();
        }
        return; // with nothing armed, Tab keeps its usual focus walk
      }

      if (key === 'Enter') {
        var chosen = focusedId || selectedId;
        if (e.shiftKey) {
          if (chosen) {
            select(chosen);
            openAddChain('above');
            e.preventDefault();
          }
        } else if (focusedId && focusedId !== selectedId) {
          select(focusedId); // an idea focused but not chosen: choose it
          e.preventDefault();
        } else if (chosen) {
          openAddChain('below');
          e.preventDefault();
        }
        return;
      }

      if (key === ' ' || key === 'F2') {
        var named = focusedId || selectedId;
        if (named) {
          select(named);
          closeMenu(); // the menu would cover the sheet's field
          openRename(named);
          e.preventDefault();
        }
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        var gone = focusedId || selectedId;
        if (gone) {
          select(gone);
          openDelete();
          e.preventDefault();
        }
        return;
      }

      if (key === 'Escape') {
        // With a menu open, Escape only closes the menu (the kit's dismissal).
        if (find) {
          closeFind(); // the open find closes first, before the selection
          e.preventDefault();
        } else if (!menu) {
          select(null);
          focusIdea(null); // back to the paper
        }
      }
    });

    // ── Boot ─────────────────────────────────────────────────────────────
    container.textContent = '';
    container.appendChild(rootEl);
    render();
    renderBar();
    renderHistory(); // both start empty, so both buttons start disabled
    // Measure once the layout has settled, then fit the whole map and put
    // the keys on the paper straight away.
    requestAnimationFrame(function () {
      placeOverlays();
      if (!loadSavedView()) fit(false);
      applyTransform();
      // Shown by default on big maps on a wide screen; once the button is
      // used the choice is kept per device, for every map.
      var want = null;
      try { want = localStorage.getItem('m2.minimap'); } catch (e) { /* private mode */ }
      var show = want == null ? M.ideaCount(d) > 40 && rootEl.clientWidth > 768 : want === '1';
      minimap.hidden = !show;
      mmBtn.setAttribute('aria-label', show ? 'Hide minimap' : 'Show minimap');
      drawMinimap(); // the doc's earlier redraw ran while it was hidden
      rootEl.focus({ preventScroll: true });
    });

    // A resized window moves the idea under the menu on screen.
    var onResize = function () { placeMenu(); placeOverlays(); placeMinimapView(); };
    root.addEventListener('resize', onResize);
    // The on-screen keyboard arriving or moving: keep the edit above it.
    var vv = root.visualViewport;
    var onViewport = function () { if (editing) revealEditor(); };
    if (vv) {
      vv.addEventListener('resize', onViewport);
      vv.addEventListener('scroll', onViewport);
    }

    // Undo and redo also work when nothing on the canvas has focus (after a
    // click on a top-bar button, say). Fields keep their own text undo.
    function onHistoryKey(e) {
      if (rootEl.closest('[hidden]')) return; // the view is hidden behind another
      if (e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (k === 'y' && e.ctrlKey) {
        e.preventDefault();
        redo();
      }
    }
    if (!readOnly) document.addEventListener('keydown', onHistoryKey);

    return {
      el: rootEl,
      setStatus: setStatus,
      fit: function () { fit(true); },
      replaceDoc: replaceDoc,
      destroy: function () {
        // A pending save flushes on teardown, unless a focused view is what
        // is on screen: that one is never kept.
        if (saveTimer && !focusId) { clearTimeout(saveTimer); saveTimer = 0; saveView(); }
        if (editing) finishEdit(true, false);
        endTween();
        if (!readOnly) document.removeEventListener('keydown', onHistoryKey);
        root.removeEventListener('resize', onResize);
        if (vv) {
          vv.removeEventListener('resize', onViewport);
          vv.removeEventListener('scroll', onViewport);
        }
        container.textContent = '';
      },
    };
  }

  // The sheet shown when a save was refused because the map changed in
  // another tab or on another device (#12): keep the newer copy, keep this
  // one, or save this one as a copy. Each button closes the sheet, then runs
  // its handler; closing it any other way calls onDismiss. Returns the
  // sheet's handle.
  function conflictSheet(opts) {
    if (!root.unNative) {
      // Without the kit there is no sheet to put buttons in: OK loads the
      // latest, Cancel leaves the map in conflict.
      setTimeout(function () {
        if (window.confirm('This map changed on another device. Load the latest? Your changes here will be dropped.')) opts.onLoadLatest();
        else opts.onDismiss();
      }, 0);
      return { dismiss: function () {} };
    }
    var chosen = false;
    var col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 4px 12px';
    col.appendChild(el('h2', 'text-heading', 'This map changed on another device.'));
    var note = el('p', 'text-small text-muted',
      'Your latest changes here aren’t saved yet. Load the latest to see the other version, or keep yours and replace it.');
    note.style.marginBottom = '8px';
    col.appendChild(note);
    var handle = null;
    function action(cls, text, handler) {
      var b = el('button', cls, text);
      b.type = 'button';
      b.style.width = '100%';
      b.addEventListener('click', function () {
        if (chosen) return;
        chosen = true;
        if (handle) handle.dismiss();
        handler();
      });
      col.appendChild(b);
    }
    action('btn-primary', 'Load the latest', opts.onLoadLatest);
    action('btn-secondary', 'Keep mine', opts.onKeepMine);
    action('btn-secondary', 'Save mine as a copy', opts.onSaveCopy);
    handle = root.unNative.presentSheet({
      contentEl: col,
      onDismiss: function () { if (!chosen) { chosen = true; opts.onDismiss(); } },
    });
    return handle;
  }

  root.M2Canvas = {
    CanvasView: CanvasView,
    loadingEl: loadingEl,
    errorEl: errorEl,
    conflictSheet: conflictSheet,
  };
})(typeof self !== 'undefined' ? self : this);
