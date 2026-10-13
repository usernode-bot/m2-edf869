/* App shell: the hash router, the start flow and autosave.
 *
 * Routes: #/maps (Your maps), #/map/<id> (one map). With no hash, a shared
 * link decides first: ?share=<token> opens a map by its secret link and
 * ?map=<id> opens one by id. Otherwise the start flow decides what to open:
 * guests get the example in memory, a first visit is welcomed with the
 * example map, and anyone else reopens the map they edited most recently.
 * Every change to your own map saves on its own; a map someone shared with
 * you opens view only. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var api = root.M2Api.api;
  var isDemo = root.M2Api.isDemo;
  var app = document.getElementById('app');
  var view = null;
  var params = new URLSearchParams(window.location.search);
  var shareParam = params.get('share');
  var mapParam = params.get('map');

  function destroyView() {
    if (view) { view.destroy(); view = null; }
  }

  function render(el) {
    destroyView();
    app.textContent = '';
    app.appendChild(el);
    return el;
  }

  // ── Autosave ─────────────────────────────────────────────────────────
  // Every change marks the doc dirty and starts a 700 ms debounce, with at
  // most one PUT in flight; the latest doc is sent next. On failure: Not
  // saved with Retry, and automatic retries after 2, 5 and 10 s, then every
  // 10 s. The doc is validated here before it is sent.
  //
  // Each save names the revision it was made from (#12). When the map was
  // saved somewhere else in the meantime, the server refuses with 409 and its
  // own copy: the saver stops, the status reads Changed elsewhere, and
  // opts.onConflict(server) lets the page ask which version to keep. Nothing
  // more is sent until keepMine() or drop().
  var save = null;

  function makeSaver(opts) {
    var state = {
      dirty: false, timer: 0, inFlight: false, doc: null, failures: 0, dead: false,
      base: typeof opts.revision === 'number' ? opts.revision : 0,
      conflict: false, server: null,
    };
    var BACKOFF = [2000, 5000, 10000];
    var setStatus = opts.setStatus;

    function schedule(ms) {
      clearTimeout(state.timer);
      state.timer = setTimeout(send, ms == null ? 700 : ms);
    }

    function saved(r) {
      if (r && typeof r.revision === 'number') state.base = r.revision;
    }

    function enterConflict(server) {
      clearTimeout(state.timer);
      state.timer = 0;
      state.conflict = true;
      state.dirty = true; // what is on screen is not saved
      if (server) state.server = server;
      setStatus('conflict');
      opts.onConflict(state.server);
    }

    function send() {
      clearTimeout(state.timer);
      state.timer = 0;
      if (!state.dirty || state.inFlight || state.dead || state.conflict) return;
      var why = M.validate(state.doc);
      if (why) { setStatus('error'); return; }
      state.inFlight = true;
      state.dirty = false; // the snapshot below is the whole send
      var snapshot = JSON.parse(JSON.stringify(state.doc));
      api('PUT', '/api/maps/' + opts.mapId, { doc: snapshot, baseRevision: state.base }).then(function (r) {
        state.inFlight = false;
        state.failures = 0;
        saved(r);
        if (state.dead) return;
        if (state.dirty) schedule(0);
        else setStatus('saved');
      }).catch(function (err) {
        state.inFlight = false;
        if (state.dead) return;
        if (err.status === 404) {
          // The map was deleted while a save waited; drop it quietly.
          state.dead = true;
          state.dirty = false;
          return;
        }
        if (err.status === 409) { enterConflict(err.body); return; }
        state.failures++;
        setStatus('error');
        var wait = state.failures <= BACKOFF.length ? BACKOFF[state.failures - 1] : 10000;
        schedule(wait);
      });
    }

    return {
      changed: function (doc) {
        state.doc = doc;
        state.dirty = true;
        if (state.dead) return;
        if (state.conflict) {
          // Still undecided: keep the edit, and ask again.
          setStatus('conflict');
          opts.onConflict(state.server);
          return;
        }
        setStatus('saving');
        schedule();
      },
      flushNow: function () {
        // For pagehide and leaving the map: one last attempt that survives
        // navigation. Its answer is still read when the page stays, so a
        // later save starts from the right revision, and a refusal is
        // reported rather than lost.
        if (!state.dirty || !state.doc || state.dead || state.conflict) return;
        var token = new URLSearchParams(window.location.search).get('token');
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['x-usernode-token'] = token;
        if (root.usernode && root.usernode.previewNow) {
          headers['x-usernode-now'] = root.usernode.now().toISOString();
        }
        var url = '/api/maps/' + opts.mapId + (isDemo ? '?demo=1' : '');
        clearTimeout(state.timer);
        state.timer = 0;
        state.dirty = false;
        state.inFlight = true;
        fetch(url, {
          method: 'PUT', headers: headers, keepalive: true,
          body: JSON.stringify({ doc: JSON.parse(JSON.stringify(state.doc)), baseRevision: state.base }),
        }).then(function (res) {
          return res.json().catch(function () { return null; }).then(function (body) {
            state.inFlight = false;
            if (state.dead) return;
            if (res.ok) {
              saved(body);
              if (state.dirty) schedule(0);
              else setStatus('saved');
            } else if (res.status === 404) {
              state.dead = true;
              state.dirty = false;
            } else if (res.status === 409) {
              enterConflict(body);
            } else {
              state.dirty = true;
              schedule(BACKOFF[0]);
            }
          });
        }).catch(function () {
          state.inFlight = false;
          if (state.dead) return;
          state.dirty = true;
          schedule(BACKOFF[0]);
        });
      },
      hasUnsaved: function () { return state.dirty || state.inFlight; },
      isDirty: function () { return state.dirty; },
      inConflict: function () { return state.conflict; },
      busy: function () { return state.inFlight || state.conflict; },
      revision: function () { return state.base; },
      // A newer copy was found without a refused save (coming back to the
      // tab with unsaved edits): same state as a 409.
      showConflict: function (server) { enterConflict(server); },
      // Keep mine: save this screen's doc over the server's revision.
      keepMine: function (revision) {
        state.base = revision;
        state.conflict = false;
        state.dirty = true;
        state.failures = 0;
        setStatus('saving');
        send();
      },
      // Stop for good: the screen is being replaced or left.
      drop: function () {
        clearTimeout(state.timer);
        state.timer = 0;
        state.dead = true;
        state.dirty = false;
        state.conflict = false;
      },
    };
  }

  // ── One map ──────────────────────────────────────────────────────────
  var saverRef = null;
  var current = null; // { map, withoutMaps, saver } for the open owner map
  var conflictOpen = false; // the conflict sheet is on screen

  function toast(message) {
    if (root.unNative) root.unNative.toast(message);
    else console.log('toast:', message);
  }

  // mode: 'owner' edits and saves; 'viewer' reads someone else's map, view
  // only; 'guest' plays with the example map in memory. A guest reading a
  // shared map is a viewer withoutMaps: no Maps button, since Your maps has
  // nothing of theirs.
  function showMap(map, mode, withoutMaps) {
    var owner = mode === 'owner';
    var guest = mode === 'guest';
    var v = null;
    var saver = owner ? makeSaver({
      mapId: map.id,
      revision: map.revision,
      setStatus: function (kind) { if (v) v.setStatus(kind); },
      onConflict: function (server) { onConflict(saver, map, withoutMaps, server); },
    }) : null;
    saverRef = saver;
    current = owner ? { map: map, withoutMaps: withoutMaps, saver: saver } : null;
    conflictOpen = false;
    var el = render(root.M2Canvas.loadingEl());
    v = root.M2Canvas.CanvasView(el, {
      doc: map.doc,
      demo: isDemo,
      readOnly: mode === 'viewer',
      initialStatus: guest ? 'guest' : 'none',
      onOpenMaps: withoutMaps ? null : function () { location.hash = '#/maps'; },
      onShare: owner ? function () { root.M2ShareSheet(map.id, map.doc.nodes[0].text.trim()); } : null,
      onDeleteMap: function () {
        api('DELETE', '/api/maps/' + map.id).then(function () {
          location.hash = '#/maps';
        }).catch(function () {
          if (v) v.setStatus('error');
        });
      },
      onChange: function () {
        if (saver) saver.changed(map.doc);
      },
    });
    view = v;
    if (guest) v.setStatus('guest');
    window.addEventListener('pagehide', onPageHide);
  }

  function onPageHide() {
    if (saverRef) saverRef.flushNow();
  }

  // ── When the map changed somewhere else (#12) ───────────────────────────
  // The server's copy, as a 409 carried it, or fetched when it didn't.
  function serverCopy(mapId, server) {
    if (server && server.doc && typeof server.revision === 'number') return Promise.resolve(server);
    return api('GET', '/api/maps/' + encodeURIComponent(mapId)).then(function (r) { return r.map; });
  }

  function onConflict(saver, map, withoutMaps, server) {
    var title = map.doc.nodes[0].text.trim();
    if (saverRef !== saver) {
      // A last save sent while leaving this map was turned down; the newer
      // copy stays where it is.
      saver.drop();
      toast('Your last change to ' + title + ' wasn’t saved. It changed on another device.');
      return;
    }
    if (conflictOpen) return;
    conflictOpen = true;
    root.M2Canvas.conflictSheet({
      onLoadLatest: function () {
        conflictOpen = false;
        serverCopy(map.id, server).then(function (latest) {
          if (saverRef !== saver) return;
          saver.drop();
          showMap({ id: map.id, doc: latest.doc, revision: latest.revision }, 'owner', withoutMaps);
        }).catch(function () {
          toast('Couldn’t load the latest version');
        });
      },
      onKeepMine: function () {
        conflictOpen = false;
        serverCopy(map.id, server).then(function (latest) {
          if (saverRef === saver) saver.keepMine(latest.revision);
        }).catch(function () {
          toast('Couldn’t load the latest version');
        });
      },
      onSaveCopy: function () {
        conflictOpen = false;
        var copy = JSON.parse(JSON.stringify(map.doc));
        var named = copy.nodes[0].text.trim() + ' (copy)';
        if (named.length <= M.MAX_ROOT_TEXT) copy.nodes[0].text = named;
        api('POST', '/api/maps', { doc: copy }).then(function (r) {
          saver.drop();
          toast('Saved a copy');
          location.hash = '#/map/' + r.map.id;
        }).catch(function () {
          toast('Couldn’t save a copy');
          if (saverRef === saver) onConflict(saver, map, withoutMaps, server);
        });
      },
      onDismiss: function () { conflictOpen = false; },
    });
  }

  // Coming back to the tab: if the map was saved somewhere else meanwhile,
  // load it quietly when nothing here is unsaved, or ask which to keep.
  function checkForNewer() {
    var c = current;
    if (!c || saverRef !== c.saver) return;
    var s = c.saver;
    if (s.inConflict()) { onConflict(s, c.map, c.withoutMaps, null); return; }
    if (s.busy()) return;
    api('GET', '/api/maps/' + encodeURIComponent(c.map.id)).then(function (r) {
      if (current !== c || saverRef !== s || s.busy() || r.access !== 'owner') return;
      if (!(r.map.revision > s.revision())) return;
      if (s.isDirty()) {
        s.showConflict(r.map);
      } else {
        s.drop();
        showMap(r.map, 'owner', c.withoutMaps);
      }
    }).catch(function () {});
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForNewer();
  });
  // The shell can keep this app loaded but hidden; it says when it shows it.
  window.addEventListener('usernode:visibility-changed', function (e) {
    if (e.detail && e.detail.hidden === false) checkForNewer();
  });

  // A 404 is the same for a deleted map, a private one, a reset link and
  // a removed reader: the server never says which.
  function mapError(err, retry) {
    var gone = err.status === 404;
    render(root.M2Canvas.errorEl({
      title: gone ? 'This map isn’t available' : 'Couldn’t open this map.',
      message: gone ? 'It may be private now, or it was deleted.' : 'Your other maps are safe.',
      retry: gone ? null : retry,
      back: function () { location.hash = '#/maps'; },
    }));
    view = { destroy: function () { app.textContent = ''; } };
  }

  function openMapById(id) {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/maps/' + encodeURIComponent(id)).then(function (r) {
      showMap(r.map, r.access === 'owner' ? 'owner' : 'viewer', false);
    }).catch(function (err) {
      mapError(err, function () { openMapById(id); });
    });
  }

  // A secret link; guests may open these too.
  function openShared(token) {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/shared/' + encodeURIComponent(token)).then(function (r) {
      // A dead link answers { map: null } rather than a 404 (see server.js).
      if (!r.map) { mapError({ status: 404 }); return; }
      showMap(r.map, r.access === 'owner' ? 'owner' : 'viewer', !!r.guest);
    }).catch(function (err) {
      mapError(err, function () { openShared(token); });
    });
  }

  // ── Your maps ────────────────────────────────────────────────────────
  function showMaps() {
    var el = render(document.createElement('div'));
    view = root.M2MapsList(el, {
      demo: isDemo,
      onOpen: function (id) { location.hash = '#/map/' + id; },
    });
  }

  // ── Start flow, with no hash ─────────────────────────────────────────
  function startFlow() {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/maps').then(function (r) {
      if (r.guest) {
        // A visitor plays with the example map, but nothing is kept.
        showMap({ id: 'example', doc: root.M2Example.exampleDoc() }, 'guest', false);
        return;
      }
      if (!r.welcomed && !r.demo) {
        api('POST', '/api/welcome').then(function (w) {
          if (w.map) showMap(w.map, 'owner', false);
          else if (r.maps.length) openMapById(r.maps[0].id);
          else location.hash = '#/maps';
        }).catch(function () { startError(); });
        return;
      }
      // The staging demo opens on its Lisbon map while it exists, whatever
      // else this account touched since: maps[0] is the latest edited, and a
      // welcome map made on a plain visit would otherwise come first.
      var lisbon = r.demo && r.maps.filter(function (m) { return /^demo-.+-lisbon$/.test(m.id); })[0];
      if (lisbon) openMapById(lisbon.id);
      else if (r.maps.length) openMapById(r.maps[0].id);
      else location.hash = '#/maps';
    }).catch(function () { startError(); });
  }

  // The doc of maps[0] is not in the list response, so open it by id.
  function openFirst(id) { openMapById(id); }

  function startError() {
    render(root.M2Canvas.errorEl({
      title: 'Couldn’t load your maps.',
      message: 'Nothing has been lost. Check your connection and try again.',
      retry: startFlow,
      back: function () { location.hash = '#/maps'; },
    }));
    view = { destroy: function () { app.textContent = ''; } };
  }

  // ── Router ───────────────────────────────────────────────────────────
  window.addEventListener('hashchange', function () {
    if (saverRef && saverRef.hasUnsaved()) saverRef.flushNow();
    route();
  });
  window.addEventListener('beforeunload', function (e) {
    if (saverRef && saverRef.hasUnsaved()) {
      saverRef.flushNow();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function route() {
    saverRef = null;
    current = null;
    var hash = location.hash;
    if (hash === '#/maps') { showMaps(); }
    else if (hash.indexOf('#/map/') === 0) { openMapById(decodeURIComponent(hash.slice(6))); }
    else if (shareParam) { openShared(shareParam); }
    else if (mapParam) { openMapById(mapParam); }
    else { startFlow(); }
  }

  route();
})(typeof self !== 'undefined' ? self : this);
