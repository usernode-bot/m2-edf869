/* The Version history sheet (#32): the saved versions of the open map,
 * newest first, grouped by day. Tapping one fetches its doc, dismisses the
 * sheet and hands it to the page, which shows the version over the current
 * map. Owner only (every route here is), and it loads its own data, so it
 * shows honest loading, error and empty states. All text reaches the DOM
 * through textContent. */
(function (root) {
  'use strict';
  var api = root.M2Api.api;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The native kit when it loaded; plain stand-ins when it did not.
  function kit() {
    return root.unNative || {
      presentSheet: function () { console.log('sheet unavailable'); return { dismiss: function () {} }; },
      toast: function (m) { console.log('toast:', m); return { dismiss: function () {} }; },
    };
  }

  function sheetColumn() {
    var col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 4px 12px';
    return col;
  }

  // Grey rows standing in for a list while it loads.
  function skeletonList(rows) {
    var list = el('ul', 'list');
    for (var i = 0; i < rows; i++) {
      var row = el('li', 'list-row');
      var sk = el('div', 'skeleton');
      sk.style.cssText = 'height:16px;width:' + (60 - i * 12) + '%';
      row.appendChild(sk);
      list.appendChild(row);
    }
    return list;
  }

  function errorState(title, message, retry) {
    var state = el('div', 'state-error');
    state.appendChild(el('p', 'text-body font-semibold', title));
    state.appendChild(el('p', 'text-small text-muted', message));
    var btn = el('button', 'btn-secondary', 'Retry');
    btn.type = 'button';
    btn.addEventListener('click', retry);
    state.appendChild(btn);
    return state;
  }

  function dayKey(at) {
    return at.getFullYear() + '-' + at.getMonth() + '-' + at.getDate();
  }

  // A version's spoken and shown label: "today, 14:05", or the date when it
  // is further back. The viewer's own time zone throughout.
  function dayLabel(at, withTime) {
    var today = new Date();
    var yesterday = new Date(today.getTime() - 86400000);
    var name = dayKey(at) === dayKey(today) ? 'today'
      : dayKey(at) === dayKey(yesterday) ? 'yesterday'
      : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
        (at.getFullYear() !== today.getFullYear()
          ? ' ' + at.getFullYear() : '');
    return withTime ? name + ', ' + timeLabel(at) : name;
  }

  function timeLabel(at) {
    return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // What a version is called in the sheet's rows: a big delete or a restore
  // is said, an ordinary save just shows when.
  function reasonNote(reason) {
    return reason === 'big-delete' ? ', before a big delete'
      : reason === 'before-restore' ? ', before a restore'
      : '';
  }

  function VersionSheet(mapId, opts) {
    var un = kit();
    var base = '/api/maps/' + encodeURIComponent(mapId) + '/versions';
    var wrap = sheetColumn();
    wrap.appendChild(el('h2', 'text-heading', 'Version history'));
    var body = el('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    wrap.appendChild(body);
    var handle = un.presentSheet({ contentEl: wrap });
    var close = el('button', 'btn-secondary', 'Close');
    close.type = 'button';
    wrap.appendChild(close);
    close.addEventListener('click', function () { handle.dismiss(); });
    setTimeout(function () { close.focus(); }, 60);
    load();

    function setLoading() {
      body.textContent = '';
      body.appendChild(el('p', 'text-small text-muted',
        'M2 keeps one about every 10 minutes while you edit.'));
      body.appendChild(skeletonList(3));
    }

    function setError() {
      body.textContent = '';
      body.appendChild(errorState(
        'Couldn’t load Version history.',
        'Your map is safe. Check your connection and try again.',
        load
      ));
    }

    function renderLoaded(versions) {
      body.textContent = '';
      if (!versions.length) {
        body.appendChild(el('div', 'state-empty'));
        var empty = body.firstChild;
        empty.appendChild(el('p', 'text-body font-semibold', 'No earlier versions yet'));
        empty.appendChild(el('p', 'text-small text-muted',
          'M2 keeps one about every 10 minutes while you edit.'));
        return;
      }
      var day = null;
      versions.forEach(function (v) {
        var at = new Date(v.createdAt);
        if (!day || dayKey(at) !== day.key) {
          day = { key: dayKey(at) };
          body.appendChild(el('p', 'section-label', dayLabel(at, false)));
        }
        var row = el('button', 'list-row');
        row.type = 'button';
        var when = el('p', 'text-body font-semibold', timeLabel(at));
        row.appendChild(when);
        row.appendChild(el('p', 'text-small text-muted',
          v.ideaCount + ' ideas' + reasonNote(v.reason)));
        row.setAttribute('aria-label', 'Version from ' + dayLabel(at, true) +
          ', ' + v.ideaCount + ' ideas' + reasonNote(v.reason));
        row.addEventListener('click', function () { openVersion(row, v, at); });
        body.appendChild(row);
      });
    }

    function openVersion(row, v, at) {
      row.disabled = true;
      api('GET', base + '/' + encodeURIComponent(v.id)).then(function (r) {
        handle.dismiss();
        opts.onOpen(r.version, dayLabel(at, true));
      }).catch(function () {
        row.disabled = false;
        un.toast('Couldn’t open that version');
      });
    }

    function load() {
      setLoading();
      api('GET', base).then(function (r) {
        renderLoaded(r.versions);
      }).catch(setError);
    }
  }

  root.M2VersionSheet = VersionSheet;
})(typeof self !== 'undefined' ? self : this);
