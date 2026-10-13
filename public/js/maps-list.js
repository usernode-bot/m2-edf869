/* Your maps: every saved map with a small drawing of its branches, how many
 * ideas it holds and when it was last edited, newest first, then "Shared
 * with you", the maps other people added you to. Loads its own data, so it
 * shows honest loading, empty and error states. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var api = root.M2Api.api;
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
    };
    span.innerHTML = icons[name]; // static markup written here, never user text
    return span.firstChild;
  }

  // "Just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then a date.
  function relativeTime(iso) {
    var now = root.usernode && root.usernode.now ? root.usernode.now() : new Date();
    var then = new Date(iso);
    var s = Math.max(0, (now.getTime() - then.getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var days = Math.floor(s / 86400);
    var yesterday = new Date(now.getTime() - 86400000);
    var sameDay = function (a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    };
    if (days === 1 && sameDay(yesterday, then)) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return then.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  // The map's branches, drawn small: a central ink dot and one curve per
  // main idea in its colour.
  function thumbSvg(outline) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'thumb');
    svg.setAttribute('viewBox', '0 0 64 48');
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
    var guest = false;
    var demo = !!opts.demo;
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
    }

    function confirmDelete(map) {
      un.alert({
        title: 'Delete ' + map.title + '?',
        message: 'This deletes the map and its ' + map.ideaCount + ' ideas.',
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          {
            label: 'Delete',
            style: 'destructive',
            handler: function () {
              api('DELETE', '/api/maps/' + map.id).then(load).catch(function () {
                un.toast('Couldn’t delete ' + map.title);
              });
            },
          },
        ],
      });
    }

    function renameMap(map) {
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
    // the name and when it was last edited.
    function mapRow(map, meta) {
      var row = el('li', 'list-row');
      row.appendChild(thumbSvg(map.outline));
      var textCol = el('div');
      textCol.style.cssText = 'flex:1;min-width:0';
      var nameBtn = el('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer';
      var name = el('p', 'text-body font-semibold', map.title);
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nameBtn.appendChild(name);
      nameBtn.setAttribute('aria-label', 'Open ' + map.title);
      nameBtn.addEventListener('click', function () { opts.onOpen(map.id); });
      textCol.appendChild(nameBtn);
      textCol.appendChild(el('p', 'text-small text-muted', meta));
      row.appendChild(textCol);
      row.appendChild(el('span', 'text-small text-muted', relativeTime(map.updatedAt)));
      return row;
    }

    function ideasText(map) {
      return map.ideaCount + (map.ideaCount === 1 ? ' idea' : ' ideas');
    }

    // Maps other people shared with you, view only: no more-menu and no
    // swipe, since only their owner can rename or delete them.
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

    function render() {
      swipeHandles.forEach(function (h) { h.detach(); });
      swipeHandles = [];
      body.textContent = '';
      if (listData.length === 0) { setEmpty(); return; }
      if (demo) body.appendChild(el('h2', 'section-label', 'Staging demo maps'));
      var list = el('ul', 'list');
      listData.forEach(function (map) {
        var row = mapRow(map, ideasText(map));
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
        if (guest) {
          // A visitor plays with the example map, but nothing is kept.
          var doc = root.M2Example.exampleDoc();
          listData = [{
            id: 'example', title: doc.nodes[0].text, ideaCount: doc.nodes.length,
            updatedAt: new Date().toISOString(), outline: M.outline(doc),
          }];
        } else {
          listData = r.maps;
        }
        sharedData = guest ? [] : (r.shared || []);
        newBtn.hidden = guest;
        if (listData.length === 0) setEmpty(); else render();
      }).catch(function () { setError(); });
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
})(typeof self !== 'undefined' ? self : this);
