/* Your maps: every saved map with a small drawing of its branches, how many
 * ideas it holds and when it was last edited, newest first, then "Shared
 * with you", the maps other people added you to. Loads its own data, so it
 * shows honest loading, empty and error states. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var api = root.M2Api.api;
  var Off = root.M2Offline;
  var ns = root.M2Api.ns;
  var OFFLINE_MSG = 'You’re offline. This needs a connection.';
  var COLOR_CLASSES = ['c-teal', 'c-amber', 'c-violet', 'c-rose', 'c-sky', 'c-green', 'c-orange', 'c-indigo', 'c-pink', 'c-slate'];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(name) {
    var span = el('span');
    var icons = {
      plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      more: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
      bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
      chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    };
    span.innerHTML = icons[name]; // static markup written here, never user text
    return span.firstChild;
  }

  // "Just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then a
  // date. Lives in api.js now, so the canvas's "Edited by …" says ages the
  // same way this list does.
  var relativeTime = root.M2Api.relativeTime;

  // The map's branches, drawn small: a central ink dot and one curve per
  // main idea in its colour.
  function thumbSvg(outline) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'thumb');
    svg.setAttribute('viewBox', '0 0 64 48');
    svg.setAttribute('aria-hidden', 'true'); // the row's name button says it all
    var f = M.outlineFit(outline, 64, 48, 6);
    var paths = '';
    (outline || []).forEach(function (p) {
      var mx = (32 + f(p.x, p.y)[0]) / 2;
      var c = COLOR_CLASSES[p.color == null ? 0 : p.color];
      paths += '<path class="' + c + '" d="M32 24C' + mx + ' 24, ' + mx + ' ' + f(p.x, p.y)[1] + ', ' +
        f(p.x, p.y)[0] + ' ' + f(p.x, p.y)[1] + '"/>';
    });
    svg.innerHTML = paths + '<circle class="hub" cx="32" cy="24" r="4"/>';
    return svg;
  }

  function MapsList(container, opts) {
    // The native kit when it loaded; plain stand-ins when it did not.
    var un = root.unNative || {
      alert: function (o) {
        var del = (o.buttons || []).filter(function (b) { return b.style === 'destructive'; })[0];
        if (del && window.confirm(o.title + (o.message ? ' ' + o.message : '')) && del.handler) del.handler();
        return Promise.resolve({ button: null });
      },
      toast: function (m) { console.log('toast:', m); return { dismiss: function () {} }; },
      menu: function (o) { var first = (o.items || [])[0]; if (first && first.handler) first.handler(); },
      presentSheet: function (o) { console.log('sheet unavailable'); return { dismiss: function () {} }; },
      attachSwipeActions: function () { return { close: function () {}, detach: function () {} }; },
    };
    var wrap = el('div');
    wrap.style.cssText = 'min-height:100vh;padding:16px 16px 32px';
    container.textContent = '';
    container.appendChild(wrap);
    var listData = null;
    var sharedData = [];
    var trashedCount = 0;
    var guest = false;
    var demo = !!opts.demo;
    var offline = false;
    var swipeHandles = [];

    var head = el('header');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px';
    var title = el('h1', 'text-title', 'Your maps');
    var newBtn = el('button', 'btn-primary');
    newBtn.type = 'button';
    newBtn.appendChild(icon('plus'));
    newBtn.appendChild(document.createTextNode('New map'));
    head.appendChild(title);
    head.appendChild(newBtn);
    wrap.appendChild(head);

    var body = el('div');
    wrap.appendChild(body);

    function setLoading() {
      body.textContent = '';
      var label = el('p', 'section-label', 'Loading');
      body.appendChild(label);
      var list = el('ul', 'list');
      for (var i = 0; i < 4; i++) {
        var row = el('li', 'list-row');
        var sk = el('div', 'skeleton');
        sk.style.cssText = 'width:64px;height:48px;border-radius:10px;flex:none';
        row.appendChild(sk);
        var col = el('div');
        col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px';
        col.appendChild(el('div', 'skeleton')).style.cssText = 'height:16px;width:40%';
        col.appendChild(el('div', 'skeleton')).style.cssText = 'height:12px;width:25%';
        row.appendChild(col);
        list.appendChild(row);
      }
      body.appendChild(list);
    }

    function setError(retry) {
      body.textContent = '';
      var state = el('div', 'state-error');
      state.appendChild(el('p', 'text-body font-semibold', 'Couldn’t load your maps.'));
      state.appendChild(el('p', 'text-small text-muted', 'Nothing has been lost. Check your connection and try again.'));
      var btn = el('button', 'btn-secondary', 'Retry');
      btn.type = 'button';
      btn.addEventListener('click', load);
      state.appendChild(btn);
      body.appendChild(state);
    }

    function setEmpty() {
      body.textContent = '';
      var state = el('div', 'state-empty');
      state.appendChild(el('p', 'text-heading', 'No maps yet'));
      state.appendChild(el('p', 'text-small text-muted', 'A map starts with one central idea. Add ideas around it as they come.'));
      var newEmpty = el('button', 'btn-primary', 'New map');
      newEmpty.type = 'button';
      newEmpty.addEventListener('click', openNew);
      state.appendChild(newEmpty);
      body.appendChild(state);
      renderShared();
      renderTrashRow();
    }

    function confirmDelete(map) {
      if (offline) { un.toast(OFFLINE_MSG); return; }
      un.alert({
        title: 'Delete ' + map.title + '?',
        message: 'It stays in Recently deleted for 30 days.',
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          {
            label: 'Delete',
            style: 'destructive',
            handler: function () {
              api('DELETE', '/api/maps/' + map.id).then(function () {
                // Undo puts the map straight back, sharing and all.
                un.toast('Moved to Recently deleted', {
                  action: {
                    label: 'Undo',
                    handler: function () {
                      api('POST', '/api/maps/' + map.id + '/restore').then(load).catch(function () {
                        un.toast('Couldn’t restore ' + map.title);
                      });
                    },
                  },
                });
                // The device's copy goes with it (#40).
                if (Off && ns) Off.removeMap(ns, map.id);
                load();
              }).catch(function () {
                un.toast('Couldn’t delete ' + map.title);
              });
            },
          },
        ],
      });
    }

    function renameMap(map) {
      if (offline) { un.toast(OFFLINE_MSG); return; }
      var form = el('form');
      form.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 4px 12px';
      var label = el('label', 'section-label', 'Map name');
      var input = el('input', 'field');
      input.type = 'text';
      input.maxLength = 80;
      input.value = map.title;
      label.htmlFor = input.id = 'rename-field';
      var btn = el('button', 'btn-primary', 'Save');
      btn.type = 'submit';
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(btn);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) return;
        handle.dismiss();
        // A map's name is its central idea, so both change together.
        api('GET', '/api/maps/' + map.id).then(function (r) {
          r.map.doc.nodes[0].text = v;
          return api('PUT', '/api/maps/' + map.id, { doc: r.map.doc });
        }).then(load).catch(function () {
          un.toast('Couldn’t rename ' + map.title);
        });
      });
      var handle = un.presentSheet({ contentEl: form });
      setTimeout(function () { input.focus(); input.select(); }, 60);
    }

    function moreMenu(map, anchor) {
      un.menu({
        anchorEl: anchor,
        items: [
          { label: 'Rename', handler: function () { renameMap(map); } },
          { label: 'Delete', destructive: true, handler: function () { confirmDelete(map); } },
        ],
      });
    }

    // One map's row: the thumbnail, the name that opens it, a line under
    // the name and when it was last edited. A shared row also says what you
    // may do there (a small pill by the name) and, when someone else saved
    // it since you looked, who — that line then stands in for the time.
    function mapRow(map, meta) {
      var row = el('li', 'list-row');
      row.appendChild(thumbSvg(map.outline));
      var textCol = el('div');
      textCol.style.cssText = 'flex:1;min-width:0';
      // One button carries the name and its line under it: one 44 px stop
      // that says both, instead of a name with text hanging outside it.
      var nameBtn = el('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'display:block;width:100%;min-height:44px;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer';
      var nameRow = el('div');
      nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0';
      var name = el('p', 'text-body font-semibold', map.title);
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nameRow.appendChild(name);
      if (map.role) {
        nameRow.appendChild(el('span', 'role-pill',
          map.role === 'editor' ? 'Can edit' : 'Can view'));
      }
      // Offline (#40): a row whose edits are waiting, or a map this device
      // made up, is still openable — the pill says it isn't on the server
      // yet.
      if (offline && (map.pending || map.temp)) {
        nameRow.appendChild(el('span', 'role-pill', 'Offline'));
      }
      if (map.unavailable) row.classList.add('is-unavailable');
      nameBtn.appendChild(nameRow);
      nameBtn.appendChild(el('p', 'text-small text-muted', meta));
      var spoken = 'Open ' + map.title + ', ' + meta;
      if (map.role) spoken += ', ' + (map.role === 'editor' ? 'you can edit' : 'you can view');
      var when = null;
      if (map.editedBy) {
        when = 'Edited by ' + map.editedBy + ', ' + relativeTime(map.updatedAt);
        nameBtn.appendChild(el('p', 'text-small text-muted', when));
      }
      nameBtn.setAttribute('aria-label', when ? spoken + ', ' + when : spoken);
      nameBtn.addEventListener('click', function () { opts.onOpen(map.id); });
      textCol.appendChild(nameBtn);
      row.appendChild(textCol);
      if (!when) row.appendChild(el('span', 'text-small text-muted', relativeTime(map.updatedAt)));
      return row;
    }

    function ideasText(map) {
      return map.ideaCount + (map.ideaCount === 1 ? ' idea' : ' ideas');
    }

    // Maps other people shared with you: no more-menu and no swipe, since
    // only their owner can rename or delete them. The row says what you may
    // do (the pill) and who changed it last when that wasn't you.
    function renderShared() {
      if (guest || !sharedData.length) return;
      var label = el('h2', 'section-label', 'Shared with you');
      label.style.marginTop = '20px';
      body.appendChild(label);
      var list = el('ul', 'list');
      sharedData.forEach(function (map) {
        list.appendChild(mapRow(map, ideasText(map) + ', shared by ' + map.sharedBy));
      });
      body.appendChild(list);
    }

    // The row at the bottom of Your maps that opens Recently deleted. Only
    // when something is in there, so it also shows on an otherwise empty
    // list (setEmpty).
    function renderTrashRow() {
      if (guest || trashedCount <= 0) return;
      var label = el('h2', 'section-label', 'Recently deleted');
      label.style.marginTop = '20px';
      body.appendChild(label);
      var list = el('ul', 'list');
      var li = el('li', 'list-row');
      var box = el('span');
      box.style.cssText = 'width:64px;height:48px;border-radius:10px;background:rgb(var(--panel, var(--surface)));flex:none;display:flex;align-items:center;justify-content:center';
      box.appendChild(icon('bin'));
      box.style.color = 'rgb(var(--muted))';
      var textCol = el('div');
      textCol.style.cssText = 'flex:1;min-width:0';
      textCol.appendChild(el('p', 'text-body font-semibold', 'Recently deleted'));
      textCol.appendChild(el('p', 'text-small text-muted',
        trashedCount + (trashedCount === 1 ? ' map, kept for 30 days' : ' maps, kept for 30 days')));
      var open = el('button');
      open.type = 'button';
      open.style.cssText = 'display:flex;flex:1;min-width:0;align-items:center;gap:12px;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer';
      open.setAttribute('aria-label', 'Open Recently deleted');
      open.appendChild(box);
      open.appendChild(textCol);
      open.addEventListener('click', function () { opts.onOpenTrash(); });
      li.appendChild(open);
      var chev = el('span');
      chev.style.cssText = 'width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--muted));flex:none';
      chev.appendChild(icon('chevron'));
      li.appendChild(chev);
      list.appendChild(li);
      body.appendChild(list);
    }

    // What a row says under its name: waiting edits and device-made maps
    // say so instead of just the idea count (#40); a server-only row says
    // it needs a connection.
    function metaFor(map) {
      if (map.unavailable) return 'Needs a connection';
      if (offline && (map.pending || map.temp)) return ideasText(map) + ', waiting to sync';
      return ideasText(map);
    }

    function render() {
      swipeHandles.forEach(function (h) { h.detach(); });
      swipeHandles = [];
      body.textContent = '';
      if (listData.length === 0) { setEmpty(); return; }
      if (demo) body.appendChild(el('h2', 'section-label', 'Staging demo maps'));
      var list = el('ul', 'list');
      listData.forEach(function (map) {
        var row = mapRow(map, metaFor(map));
        if (!guest) {
          var more = el('button', 'text-muted');
          more.type = 'button';
          more.setAttribute('aria-label', 'More for ' + map.title);
          more.style.cssText = 'width:44px;height:44px;border:0;background:none;display:inline-flex;align-items:center;justify-content:center;border-radius:12px;color:rgb(var(--muted));flex:none;cursor:pointer';
          more.appendChild(icon('more'));
          more.addEventListener('click', function () { moreMenu(map, more); });
          row.appendChild(more);
          try {
            swipeHandles.push(un.attachSwipeActions(row, {
              actions: [{ label: 'Delete', destructive: true, handler: function () { confirmDelete(map); } }],
            }));
          } catch (_) {}
        }
        list.appendChild(row);
      });
      body.appendChild(list);
      renderShared();
      renderTrashRow();
    }

    function renderFoot() {
      var foot = el('div');
      foot.style.cssText = 'margin-top:16px;display:flex;flex-direction:column;align-items:center;gap:12px';
      if (!guest) {
        var ex = el('button', 'btn-secondary', 'Add the example map');
        ex.type = 'button';
        ex.style.width = '100%';
        ex.addEventListener('click', function () {
          api('POST', '/api/maps', { from: 'example' })
            .then(function (r) { opts.onOpen(r.map.id); })
            .catch(function () { un.toast('Couldn’t add the example map'); });
        });
        foot.appendChild(ex);
      }
      foot.appendChild(el('p', 'text-small text-muted', guest ? 'Sign in to keep your maps.' : 'Maps save as you work.'));
      wrap.appendChild(foot);
    }

    function load() {
      setLoading();
      api('GET', '/api/maps').then(function (r) {
        guest = !!r.guest;
        demo = !!r.demo;
        offline = false;
        if (guest) {
          // A visitor plays with the example map, but nothing is kept.
          var doc = root.M2Example.exampleDoc();
          listData = [{
            id: 'example', title: doc.nodes[0].text, ideaCount: doc.nodes.length,
            updatedAt: new Date().toISOString(), outline: M.outline(doc),
          }];
        } else {
          listData = r.maps;
          // Keep the list on the device: this is what offline Your maps
          // (#40) reads when the same call later fails.
          if (Off && ns) Off.putList(ns, r.maps);
        }
        sharedData = guest ? [] : (r.shared || []);
        trashedCount = guest ? 0 : (r.trashed || 0);
        newBtn.hidden = guest;
        if (listData.length === 0) setEmpty(); else render();
      }).catch(function (err) {
        if (err.offline) { loadOffline(); return; }
        setError();
      });
    }

    // Offline (#40): the device's copy of the list, with its pending edits
    // and the maps it made up folded in, and rows that only live on the
    // server marked so.
    function loadOffline() {
      if (!Off || !ns || !Off.available()) { setError(); return; }
      root.Promise.all([Off.getList(ns), Off.localMaps(ns)]).then(function (got) {
        var rows = Off.mergeList(got[0] || [], got[1] || []);
        if (!rows.length) { setError(); return; }
        offline = true;
        listData = rows;
        sharedData = [];
        trashedCount = 0;
        newBtn.hidden = false;
        render();
      });
    }

    function openNew() {
      var form = el('form');
      form.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 4px 12px';
      var label = el('label', 'section-label', 'Central idea');
      var input = el('input', 'field');
      input.type = 'text';
      input.maxLength = 80;
      input.placeholder = 'e.g. Summer trip';
      label.htmlFor = input.id = 'new-map-field';
      var btn = el('button', 'btn-primary', 'Create map');
      btn.type = 'submit';
      btn.disabled = true;
      input.addEventListener('input', function () { btn.disabled = !input.value.trim(); });
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(btn);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) return;
        // Offline (#40): a new map starts as this device's own, with a
        // temporary id, and the sync pass gives it a real one when the
        // connection is back.
        if (root.navigator.onLine === false && Off && ns && Off.available()) {
          var offlineDoc = {
            v: 1,
            nodes: [{ id: 'root', parent: null, text: v, x: 0, y: 0 }],
            layout: { auto: true },
          };
          var rec = {
            id: Off.newTempId(), doc: offlineDoc, revision: 0, baseDoc: offlineDoc,
            access: 'owner', pending: true, temp: true, title: v, ideaCount: 1,
            openedAt: Date.now(), updatedAt: new Date().toISOString(),
          };
          Off.putMap(ns, rec).then(function () {
            handle.dismiss();
            opts.onOpen(rec.id);
          });
          return;
        }
        handle.dismiss();
        api('POST', '/api/maps', { title: v })
          .then(function (r) { opts.onOpen(r.map.id); })
          .catch(function () { un.toast('Couldn’t create the map'); });
      });
      var handle = un.presentSheet({ contentEl: form });
      setTimeout(function () { input.focus(); }, 60);
    }

    newBtn.addEventListener('click', openNew);
    renderFoot();
    load();

    return {
      el: wrap,
      destroy: function () {
        swipeHandles.forEach(function (h) { h.detach(); });
        container.textContent = '';
      },
    };
  }

  root.M2MapsList = MapsList;

  // ── Recently deleted (#30) ─────────────────────────────────────────────
  // Its own screen: the owner's trashed maps with how long each has left.
  // Restore puts a map straight back with its sharing untouched; Delete now
  // asks first, then the map is gone for good.
  function TrashList(container, opts) {
    var un = root.unNative || {
      alert: function (o) {
        var del = (o.buttons || []).filter(function (b) { return b.style === 'destructive'; })[0];
        if (del && window.confirm(o.title + (o.message ? ' ' + o.message : '')) && del.handler) del.handler();
        return Promise.resolve({ button: null });
      },
      toast: function (m) { console.log('toast:', m); return { dismiss: function () {} }; },
    };
    var wrap = el('div');
    wrap.style.cssText = 'min-height:100vh;padding:16px 16px 32px';
    container.textContent = '';
    container.appendChild(wrap);

    var back = el('button', 'btn-secondary', 'Back to maps');
    back.type = 'button';
    back.addEventListener('click', function () { opts.onBack(); });
    wrap.appendChild(back);
    wrap.appendChild(el('h1', 'text-title', 'Recently deleted')).style.cssText = 'margin:16px 0 4px';
    wrap.appendChild(el('p', 'text-small text-muted', 'Deleted maps stay here for 30 days, then they are deleted for good.'));

    var body = el('div');
    body.style.marginTop = '16px';
    wrap.appendChild(body);

    function setLoading() {
      body.textContent = '';
      var list = el('ul', 'list');
      for (var i = 0; i < 3; i++) {
        var row = el('li', 'list-row');
        var sk = el('div', 'skeleton');
        sk.style.cssText = 'width:64px;height:48px;border-radius:10px;flex:none';
        row.appendChild(sk);
        var col = el('div');
        col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px';
        col.appendChild(el('div', 'skeleton')).style.cssText = 'height:16px;width:40%';
        col.appendChild(el('div', 'skeleton')).style.cssText = 'height:12px;width:30%';
        row.appendChild(col);
        list.appendChild(row);
      }
      body.appendChild(list);
    }

    function setError() {
      body.textContent = '';
      var state = el('div', 'state-error');
      state.appendChild(el('p', 'text-body font-semibold', 'Couldn’t load Recently deleted.'));
      state.appendChild(el('p', 'text-small text-muted', 'Your maps are safe. Check your connection and try again.'));
      var btn = el('button', 'btn-secondary', 'Retry');
      btn.type = 'button';
      btn.addEventListener('click', load);
      state.appendChild(btn);
      body.appendChild(state);
    }

    function setEmpty() {
      body.textContent = '';
      var state = el('div', 'state-empty');
      state.appendChild(el('p', 'text-heading', 'Nothing in Recently deleted'));
      state.appendChild(el('p', 'text-small text-muted', 'Maps you delete stay here for 30 days.'));
      body.appendChild(state);
    }

    function restore(map, btn) {
      btn.disabled = true;
      api('POST', '/api/maps/' + map.id + '/restore').then(function () {
        un.toast('Restored ' + map.title);
        load();
      }).catch(function () {
        btn.disabled = false;
        un.toast('Couldn’t restore ' + map.title);
      });
    }

    function deleteNow(map) {
      un.alert({
        title: 'Delete ' + map.title + ' now?',
        message: 'This can’t be undone. Its ' + map.ideaCount + (map.ideaCount === 1 ? ' idea is' : ' ideas are') + ' deleted for good.',
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          {
            label: 'Delete',
            style: 'destructive',
            handler: function () {
              api('DELETE', '/api/maps/' + map.id + '/permanent').then(function () {
                un.toast('Deleted ' + map.title + ' for good');
                load();
              }).catch(function () {
                un.toast('Couldn’t delete ' + map.title);
              });
            },
          },
        ],
      });
    }

    function trashRow(map) {
      var row = el('li', 'list-row');
      row.style.alignItems = 'flex-start';
      row.appendChild(thumbSvg(map.outline));
      var col = el('div');
      col.style.cssText = 'flex:1;min-width:0';
      col.appendChild(el('p', 'text-body font-semibold', map.title));
      col.appendChild(el('p', 'text-small text-muted',
        'Deletes in ' + map.daysLeft + (map.daysLeft === 1 ? ' day' : ' days')));
      var actions = el('div');
      actions.style.cssText = 'display:flex;gap:8px;margin-top:10px';
      var keep = el('button', 'btn-secondary', 'Restore');
      keep.type = 'button';
      keep.addEventListener('click', function () { restore(map, keep); });
      var gone = el('button', 'btn-secondary', 'Delete now');
      gone.type = 'button';
      gone.style.color = 'rgb(var(--danger))';
      gone.addEventListener('click', function () { deleteNow(map); });
      actions.appendChild(keep);
      actions.appendChild(gone);
      col.appendChild(actions);
      row.appendChild(col);
      return row;
    }

    function load() {
      setLoading();
      api('GET', '/api/trash').then(function (r) {
        if (!r.maps.length) { setEmpty(); return; }
        body.textContent = '';
        var list = el('ul', 'list');
        r.maps.forEach(function (map) { list.appendChild(trashRow(map)); });
        body.appendChild(list);
      }).catch(setError);
    }

    load();

    return {
      el: wrap,
      destroy: function () { container.textContent = ''; },
    };
  }

  root.M2TrashList = TrashList;
})(typeof self !== 'undefined' ? self : this);
