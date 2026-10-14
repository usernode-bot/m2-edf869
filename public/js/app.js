/* App shell: the hash router, the start flow and autosave.
 *
 * Routes: #/maps (Your maps), #/map/<id> (one map), #/trash (Recently
 * deleted). With no hash, a shared
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

  // ── Offline (#40) ────────────────────────────────────────────────────
  // The device keeps the app shell (a service worker: page, styles, the
  // app's own scripts — never /api, never the platform's hosted files) and
  // the last 20 maps this person opened (IndexedDB, via M2Offline). When
  // the connection is away, maps open from the device's copy, edits wait
  // there, and a sync pass sends them when it comes back. `ns` is whose
  // maps they are (api.js remembers it, since an offline page carries no
  // token) and Off is the store, absent when the browser refuses it.
  var Off = root.M2Offline;
  var ns = root.M2Api.ns;
  var OFFLINE_MSG = 'You’re offline. This needs a connection.';

  try {
    if (root.navigator && 'serviceWorker' in root.navigator) {
      root.navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
  } catch (e) { /* no worker: the app works online-only, as before */ }

  function destroyView() {
    if (liveRef) { liveRef.close(); liveRef = null; }
    closeVersion();
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
      // The copy the base revision holds (#34): the middle of the three-way
      // merge when a change made elsewhere arrives while edits sit here.
      // An offline open names it explicitly (#40): the doc on screen may
      // already hold edits the server has not seen.
      baseDoc: opts.baseDoc
        ? JSON.parse(JSON.stringify(opts.baseDoc))
        : (opts.doc ? JSON.parse(JSON.stringify(opts.doc)) : null),
      // Set while this screen holds edits the server has not seen (#40),
      // so a later 409 is answered with the merge, not the conflict sheet.
      offlineEdits: !!(opts.local && opts.local.pending),
      conflict: false, server: null,
    };
    var BACKOFF = [2000, 5000, 10000];
    var setStatus = opts.setStatus;

    // The device's copy of this map (#40), rewritten on every change and
    // on every answered save, so what waits offline is always the whole
    // screen. Nothing here blocks the send.
    var local = !!opts.local && Off && Off.available();
    function putLocal(doc, pending) {
      if (!local) return Promise.resolve(null);
      var rec = Object.assign({}, opts.local || {}, {
        id: opts.mapId,
        doc: JSON.parse(JSON.stringify(doc)),
        revision: typeof state.base === 'number' ? state.base : 0,
        baseDoc: state.baseDoc ? JSON.parse(JSON.stringify(state.baseDoc)) : null,
        access: opts.access || 'owner',
        pending: pending !== false,
        temp: opts.temp === true,
        title: doc.nodes && doc.nodes[0] ? doc.nodes[0].text.trim() : '',
        ideaCount: doc.nodes ? doc.nodes.length : 0,
        updatedAt: new Date().toISOString(),
        openedAt: (opts.local && opts.local.openedAt) || Date.now(),
      });
      if (opts.shareToken) rec.shareToken = opts.shareToken;
      return Off.putMap(ns, rec);
    }

    function schedule(ms) {
      clearTimeout(state.timer);
      state.timer = setTimeout(send, ms == null ? 700 : ms);
    }

    function saved(r, snapshot) {
      if (r && typeof r.revision === 'number') state.base = r.revision;
      // What the server now holds at that revision: the merge's base.
      if (snapshot) state.baseDoc = snapshot;
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
      if (opts.temp) {
        // A map the device made up offline (#40): there is nothing to PUT
        // until the server knows it. The sync pass creates it with a POST
        // and retargets this screen; until then the paper reads Saving (a
        // connection) or Saved on this device (none).
        if (root.navigator.onLine) { setStatus('saving'); syncAll(); }
        else { setStatus('local'); if (opts.setOffline) opts.setOffline(true); }
        return;
      }
      state.inFlight = true;
      state.dirty = false; // the snapshot below is the whole send
      var snapshot = JSON.parse(JSON.stringify(state.doc));
      api('PUT', '/api/maps/' + opts.mapId, { doc: snapshot, baseRevision: state.base }).then(function (r) {
        state.inFlight = false;
        state.failures = 0;
        saved(r, snapshot);
        if (local) putLocal(snapshot, false);
        var wasOffline = state.offlineEdits;
        state.offlineEdits = false;
        if (state.dead) return;
        if (state.dirty) schedule(0);
        else {
          setStatus('saved');
          if (wasOffline && opts.setOffline) opts.setOffline(false);
        }
      }).catch(function (err) {
        state.inFlight = false;
        if (state.dead) return;
        if (err.status === 404) {
          // The map was deleted while a save waited; drop it quietly. An
          // editor it happened to, though, is still looking at a live map:
          // reopen it, which lands them back where their access allows.
          state.dead = true;
          state.dirty = false;
          if (opts.onGone) opts.onGone();
          return;
        }
        if (err.status === 409) {
          // The map moved on while these edits waited — often because they
          // were made offline (#40). The three-way merge decides: merged
          // edits go on the server's revision; a tangle it cannot untie
          // asks which copy to keep, as any other conflict does.
          if (state.offlineEdits && root.M2Merge && err.body && err.body.doc) {
            var m = root.M2Merge.merge(state.baseDoc, state.doc, err.body.doc);
            if (m && m.doc) {
              state.offlineEdits = false;
              if (opts.onMerged) opts.onMerged(m.doc, err.body.revision);
              return;
            }
          }
          enterConflict(err.body);
          return;
        }
        state.failures++;
        if (err.offline) {
          // The connection is away: the edit already went onto the
          // device, so the paper says so instead of Not saved, and the
          // save tries again on the same clock as any other failure.
          state.offlineEdits = true;
          putLocal(state.doc, true).then(function (ok) {
            if (state.dead) return;
            setStatus(ok ? 'local' : 'error');
            if (ok && opts.setOffline) opts.setOffline(true);
          });
        } else {
          setStatus('error');
        }
        var wait = state.failures <= BACKOFF.length ? BACKOFF[state.failures - 1] : 10000;
        schedule(wait);
      });
    }

    return {
      changed: function (doc) {
        state.doc = doc;
        state.dirty = true;
        putLocal(doc, true); // the device's copy first, so nothing is lost (#40)
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
        if (opts.temp) return; // nothing to send until the server knows it (#40)
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
        var body = JSON.parse(JSON.stringify(state.doc));
        fetch(url, {
          method: 'PUT', headers: headers, keepalive: true,
          body: JSON.stringify({ doc: body, baseRevision: state.base }),
        }).then(function (res) {
          return res.json().catch(function () { return null; }).then(function (resp) {
            state.inFlight = false;
            if (state.dead) return;
            if (res.ok) {
              saved(resp, body);
              if (state.dirty) schedule(0);
              else setStatus('saved');
            } else if (res.status === 404) {
              state.dead = true;
              state.dirty = false;
              if (opts.onGone) opts.onGone();
            } else if (res.status === 409) {
              enterConflict(resp);
            } else {
              state.dirty = true;
              schedule(BACKOFF[0]);
            }
          });
        }).catch(function () {
          state.inFlight = false;
          if (state.dead) return;
          state.dirty = true;
          putLocal(state.doc, true); // the device keeps it while offline (#40)
          schedule(BACKOFF[0]);
        });
      },
      hasUnsaved: function () { return state.dirty || state.inFlight; },
      isDirty: function () { return state.dirty; },
      inConflict: function () { return state.conflict; },
      busy: function () { return state.inFlight || state.conflict; },
      revision: function () { return state.base; },
      baseDoc: function () { return state.baseDoc; },
      // The merge settled on the server's copy as the new base (#34): what
      // the screen keeps unsaved now sits on top of that revision.
      adopt: function (revision, doc) {
        if (typeof revision === 'number') state.base = revision;
        state.baseDoc = JSON.parse(JSON.stringify(doc));
      },
      // The map was restored over this screen's copy: adopt the server's
      // revision without sending anything (the restore already saved).
      rebase: function (revision) {
        state.base = revision;
        state.conflict = false;
        state.failures = 0;
      },
      // A newer copy was found without a refused save (coming back to the
      // tab with unsaved edits): same state as a 409.
      showConflict: function (server) { enterConflict(server); },
      // Offline, with edits waiting: the paper says the device has them
      // (the sync pass asks this when its own send finds no connection).
      markLocal: function () {
        setStatus('local');
        if (opts.setOffline) opts.setOffline(true);
      },
      // A map created offline got its real id from the server (#40): the
      // screen keeps working under the new id, on the new revision.
      retarget: function (newId, revision, doc) {
        opts.mapId = newId;
        opts.temp = false;
        if (typeof revision === 'number') state.base = revision;
        state.baseDoc = JSON.parse(JSON.stringify(doc));
        if (opts.local) { opts.local.id = newId; opts.local.temp = false; }
        if (state.dirty) schedule(0); // edits made since the send go next
        else setStatus('saved');
      },
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

  // ── Offline sync (#40) ───────────────────────────────────────────────
  // One pass sends every edit the device kept while offline: an edit waits
  // on its record (pending), a map the device made up goes up whole with a
  // POST. The pass runs after the first successful API call of a session
  // and after every later one (kick), whenever the connection comes back,
  // and whenever a temp map's save fires while online. One pass at a time;
  // a network failure ends it, and the next kick or 'online' tries again.
  var syncing = false;

  function syncAll() {
    if (syncing || !ns || !Off || !Off.available()) return;
    syncing = true;
    Off.pending(ns).then(function (list) {
      var i = 0;
      function step() {
        if (i >= list.length) return Promise.resolve();
        return syncOne(list[i++]).then(function (go) {
          return go === false ? null : step();
        });
      }
      return step();
    }).catch(function () { /* the pass stops; the next trigger tries again */ })
      .then(function () { syncing = false; });
  }

  function syncOne(rec) {
    // The screen's own saver is already sending (or deciding) this map —
    // except a temp one, whose only way up is this pass.
    if (openRef && openRef.id === rec.id && saverRef && !rec.temp) return null;
    var title = rec.title || (rec.doc && rec.doc.nodes && rec.doc.nodes[0]
      ? rec.doc.nodes[0].text.trim() : '') || 'A map';
    var call = rec.temp
      ? api('POST', '/api/maps', { doc: rec.doc })
      : api('PUT', '/api/maps/' + encodeURIComponent(rec.id),
          { doc: rec.doc, baseRevision: typeof rec.revision === 'number' ? rec.revision : 0 });
    return call.then(function (r) {
      return keepSynced(rec, rec.temp ? r.map.id : rec.id,
        rec.temp ? r.map.revision : r.revision, rec.doc, rec.temp ? rec.doc : rec.baseDoc);
    }).catch(function (err) {
      if (err.offline) {
        // The connection dropped mid-pass: stop here, try on the next kick.
        if (openRef && openRef.id === rec.id && saverRef && saverRef.markLocal) saverRef.markLocal();
        return false;
      }
      if (err.status === 404) {
        // Deleted or unshared while its edits waited: the device's copy
        // goes too, and a toast says why it left.
        return Off.removeMap(ns, rec.id).then(function () {
          toast(title + ' was removed from this device. It was deleted or isn’t shared with you any more.');
        });
      }
      if (err.status === 409 && err.body && err.body.doc && root.M2Merge) {
        // The map moved on meanwhile: the same three-way merge the screen
        // uses decides whether these edits can still land.
        var m = root.M2Merge.merge(rec.baseDoc || rec.doc, rec.doc, err.body.doc);
        if (m && m.doc) {
          var call2 = rec.temp
            ? api('POST', '/api/maps', { doc: m.doc })
            : api('PUT', '/api/maps/' + encodeURIComponent(rec.id),
                { doc: m.doc, baseRevision: err.body.revision });
          return call2.then(function (r2) {
            return keepSynced(rec, rec.temp ? r2.map.id : rec.id,
              rec.temp ? r2.map.revision : r2.revision, m.doc, m.doc);
          }).catch(function (err2) {
            if (err2.offline) return false;
            return giveUpSync(rec);
          });
        }
      }
      // Unmergeable, or refused for another reason: stop waiting to send
      // this one. The next open fetches the server's copy, and the
      // conflict sheet decides which way the map goes.
      return giveUpSync(rec);
    });
  }

  // The record after a sent save: no longer waiting, on the revision the
  // server answered. A temp one leaves its device id behind for the real
  // one, and a screen working under the temp id follows.
  function keepSynced(rec, id, revision, doc, baseDoc) {
    var keep = {
      id: id,
      doc: doc,
      revision: typeof revision === 'number' ? revision : 0,
      baseDoc: baseDoc || doc,
      access: rec.access,
      shareToken: rec.shareToken,
      title: rec.title,
      ideaCount: rec.ideaCount,
      outline: rec.outline,
      openedAt: rec.openedAt,
      updatedAt: new Date().toISOString(),
      pending: false,
      temp: false,
    };
    var done = Off.putMap(ns, keep);
    if (rec.temp) done = done.then(function () { return Off.removeMap(ns, rec.id); });
    return done.then(function () { retargetTemp(rec, keep); });
  }

  function retargetTemp(rec, keep) {
    if (!Off.isTempId(rec.id)) return;
    if (!openRef || openRef.id !== rec.id || !saverRef || !saverRef.retarget) return;
    openRef.id = keep.id;
    openRef.fetchPath = '/api/maps/' + encodeURIComponent(keep.id);
    if (current && current.map) current.map.id = keep.id;
    saverRef.retarget(keep.id, keep.revision, keep.doc);
    try { history.replaceState(null, '', '#/map/' + encodeURIComponent(keep.id)); } catch (e) { /* keep the old hash */ }
  }

  function giveUpSync(rec) {
    return Off.getMap(ns, rec.id).then(function (cur) {
      if (!cur) return null;
      return Off.putMap(ns, Object.assign({}, cur, { pending: false }));
    });
  }

  // The device's record for a map being opened (#40), so an offline open
  // has it later. The store keeps the last 20 opened and evicts the rest.
  function rememberLocal(map, mode) {
    if (!Off || !ns || !Off.available() || mode === 'guest') return;
    var rec = {
      id: map.id,
      doc: map.doc,
      revision: typeof map.revision === 'number' ? map.revision : 0,
      baseDoc: map.doc,
      access: mode,
      openedAt: Date.now(),
      updatedAt: map.updatedAt || null,
      pending: false,
      title: map.doc.nodes && map.doc.nodes[0] ? map.doc.nodes[0].text.trim() : '',
      ideaCount: map.doc.nodes ? map.doc.nodes.length : 0,
    };
    if (shareParam && mode === 'viewer') rec.shareToken = shareParam;
    Off.putMap(ns, rec);
  }

  // ── One map ──────────────────────────────────────────────────────────
  var saverRef = null;
  var current = null; // { map, withoutMaps, saver, mode } for the open owner or editor map
  var openRef = null; // { id, doc, mode, withoutMaps, saver, fetchPath } for the map on screen
  var conflictOpen = false; // the conflict sheet is on screen
  var liveRef = null; // the map's live stream, when one is open
  var pulling = false; // one latest-version fetch at a time
  var versionView = null; // the version being viewed over the open map
  var versionHost = null;
  var versionMode = null; // { map, saver, label } while a version is open

  function toast(message, opts) {
    if (root.unNative) root.unNative.toast(message, opts);
    else console.log('toast:', message);
  }

  // mode: 'owner' edits and saves; 'viewer' reads someone else's map, view
  // only; 'guest' plays with the example map in memory. A guest reading a
  // shared map is a viewer withoutMaps: no Maps button, since Your maps has
  // nothing of theirs.
  function showMap(map, mode, withoutMaps, localRec, offlineNow) {
    var owner = mode === 'owner';
    var editor = mode === 'editor';
    var guest = mode === 'guest';
    // A temp map (#40) exists only on this device until the sync pass
    // creates it; it has no live stream and nothing to share yet.
    var isTemp = !!(Off && Off.isTempId(map.id));
    var v = null;
    var saver = (owner || editor) ? makeSaver({
      mapId: map.id,
      revision: map.revision,
      baseDoc: map.baseDoc || null,
      temp: isTemp,
      access: mode,
      local: localRec || (guest ? null : {
        id: map.id,
        revision: map.revision,
        baseDoc: map.doc,
        access: mode,
        openedAt: Date.now(),
      }),
      // An editor whose map disappears (the owner trashed it, or took their
      // access away) reopens it: they land back where their access now
      // allows. An owner's own deleted map is today's quiet drop.
      onGone: editor ? function () {
        if (saverRef === saver) openMapById(map.id);
      } : null,
      doc: map.doc,
      setStatus: function (kind) { if (v) v.setStatus(kind); },
      setOffline: function (on) { if (v) v.setOffline(on); },
      onConflict: function (server) { onConflict(saver, map, withoutMaps, server, mode); },
      onMerged: function (mergedDoc, revision) {
        // Edits that waited offline fit the server's newer copy (#40): the
        // screen takes the merged doc, and whatever the server has not
        // saved yet saves on the new revision — as a live merge does.
        if (view && view.applyRemote) view.applyRemote(mergedDoc);
        saver.adopt(revision, mergedDoc);
        saver.changed(map.doc);
      },
    }) : null;
    saverRef = saver;
    current = (owner || editor)
      ? { map: map, withoutMaps: withoutMaps, saver: saver, mode: mode }
      : null;
    openRef = guest ? null : {
      id: map.id,
      doc: map.doc,
      mode: mode,
      withoutMaps: withoutMaps,
      saver: saver,
      // A map opened through a secret link is read through that link; one
      // opened by id (or owned) through the map routes.
      fetchPath: shareParam && mode === 'viewer'
        ? '/api/shared/' + encodeURIComponent(shareParam)
        : '/api/maps/' + encodeURIComponent(map.id),
    };
    conflictOpen = false;
    var el = render(root.M2Canvas.loadingEl());
    v = root.M2Canvas.CanvasView(el, {
      doc: map.doc,
      demo: isDemo,
      // Only a real map keeps its viewport between visits; the guest's
      // example has no id to save under.
      mapId: guest ? null : map.id,
      readOnly: mode === 'viewer',
      initialStatus: guest ? 'guest' : 'none',
      // Who the paper says edited it last, for "Edited by …" on a map
      // someone else just saved.
      editedBy: map.editedBy && map.updatedAt
        ? { name: map.editedBy, at: map.updatedAt } : null,
      onOpenMaps: withoutMaps ? null : function () { location.hash = '#/maps'; },
      onShare: owner ? function () {
        if (!root.navigator.onLine) { toast(OFFLINE_MSG); return; }
        if (isTemp) { toast('This map isn’t saved online yet. Try again in a moment.'); return; }
        root.M2ShareSheet(map.id, map.doc.nodes[0].text.trim());
      } : null,
      onSelect: guest ? null : function (id) { if (liveRef) liveRef.setSelection(id); },
      onVersionHistory: owner ? function () {
        if (!root.navigator.onLine) { toast(OFFLINE_MSG); return; }
        if (isTemp) { toast('This map isn’t saved online yet. Try again in a moment.'); return; }
        root.M2VersionSheet(map.id, { onOpen: showVersion });
      } : null,
      onDeleteMap: owner ? function () {
        if (!root.navigator.onLine) { toast(OFFLINE_MSG); return; }
        if (isTemp) {
          // The server never knew this map: deleting it is local only.
          if (saver) saver.drop();
          if (Off && ns) Off.removeMap(ns, map.id);
          location.hash = '#/maps';
          return;
        }
        // Anything still unsaved goes first, so the trashed copy has it.
        if (saver) saver.flushNow();
        api('DELETE', '/api/maps/' + map.id).then(function () {
          if (Off && ns) Off.removeMap(ns, map.id);
          location.hash = '#/maps';
          toast('Moved to Recently deleted', {
            action: {
              label: 'Undo',
              handler: function () {
                api('POST', '/api/maps/' + map.id + '/restore').then(function () {
                  if (location.hash === '#/maps') route();
                }).catch(function () {
                  toast('Couldn’t restore ' + map.doc.nodes[0].text.trim());
                });
              },
            },
          });
        }).catch(function (err) {
          if (err.offline) { toast(OFFLINE_MSG); if (v) v.setOffline(true); return; }
          if (v) v.setStatus('error');
        });
      } : null,
      onChange: function () {
        if (saver) saver.changed(map.doc);
      },
    });
    view = v;
    if (guest) v.setStatus('guest');
    // The paper knows when the connection is away (#40): the pill shows,
    // and the status says where the edits sit.
    if (offlineNow && !guest) v.setOffline(true);
    // The device keeps the maps this person opens (#40), so one is there
    // when the connection is not. A record passed in (a pending one) is
    // already right; the guest's example is never kept.
    if (!localRec && !guest && !isTemp && Off && ns && Off.available()) {
      rememberLocal(map, mode);
    }
    // The live stream: everyone on a real map, owner or viewer. The guest's
    // example exists only in memory here, so there is nothing to join, and
    // a temp map is not on the server yet.
    if (!guest && !isTemp) {
      liveRef = root.M2Live.connect({
        mapId: map.id,
        onState: function (state) { if (view === v) v.setLive(state); },
        onEvent: onLiveEvent,
      });
    }
    window.addEventListener('pagehide', onPageHide);
  }

  // ── Viewing and restoring an earlier version (#32) ───────────────────
  // The owner map's view stays alive but hidden, so Undo and the saver keep
  // their state; the version renders read-only in a host beside it.

  function closeVersion() {
    if (!versionView) return;
    versionView.destroy();
    versionView = null;
    if (versionHost && versionHost.parentNode) versionHost.parentNode.removeChild(versionHost);
    versionHost = null;
    if (versionMode && versionMode.ownerEl) versionMode.ownerEl.hidden = false;
    versionMode = null;
  }

  function showVersion(version, label) {
    var ownerEl = app.firstElementChild;
    if (!ownerEl || !current || !saverRef) return;
    closeVersion();
    ownerEl.hidden = true;
    versionMode = { map: current.map, label: label, versionId: version.id, ownerEl: ownerEl };
    var merged = M.compareVersion(version.doc, current.map.doc);
    versionHost = document.createElement('div');
    app.appendChild(versionHost);
    versionView = root.M2Canvas.CanvasView(versionHost, {
      doc: merged.doc,
      demo: isDemo,
      mapId: null, // a version keeps no viewport of its own
      readOnly: true,
      initialStatus: 'none',
      version: {
        label: label,
        ideaCount: version.ideaCount,
        ghostIds: merged.ghostIds,
        onRestore: tryRestore,
        onBack: closeVersion,
      },
    });
  }

  function tryRestore() {
    var s = saverRef;
    if (!versionMode || !s || s.inConflict()) return;
    if (s.hasUnsaved()) {
      toast('Still saving your latest changes. Try again in a moment.');
      return;
    }
    var label = versionMode.label;
    var un = root.unNative;
    function go() {
      if (!versionMode) return;
      api('POST', '/api/maps/' + encodeURIComponent(versionMode.map.id) +
        '/versions/' + encodeURIComponent(versionMode.versionId) + '/restore',
        { baseRevision: s.revision() }).then(function (r) {
          if (!versionMode) return;
          closeVersion();
          s.rebase(r.map.revision);
          if (view) view.replaceDoc(r.map.doc, 'restore version');
          toast('Restored the version from ' + label);
        }).catch(function (err) {
          if (!versionMode) return;
          if (err.status === 409) {
            closeVersion();
            toast('This map changed on another device, so nothing was restored.');
            s.drop();
            showMap({ id: versionMode.map.id, doc: err.body.doc, revision: err.body.revision },
              'owner', current ? current.withoutMaps : false);
          } else if (err.status === 404) {
            closeVersion();
            toast('That version isn’t available any more.');
          } else {
            toast('Couldn’t restore this version');
          }
        });
    }
    if (un && un.alert) {
      un.alert({
        title: 'Restore this version?',
        message: 'The map goes back to how it was on ' + label +
          '. Your map as it is now is kept in Version history, and Undo brings it back.',
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          { label: 'Restore', style: 'destructive', handler: go },
        ],
      });
    } else if (window.confirm('Restore the version from ' + label + '?')) {
      go();
    }
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

  function onConflict(saver, map, withoutMaps, server, mode) {
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
      who: server && server.editedBy,
      onLoadLatest: function () {
        conflictOpen = false;
        serverCopy(map.id, server).then(function (latest) {
          if (saverRef !== saver) return;
          saver.drop();
          showMap({
            id: map.id, doc: latest.doc, revision: latest.revision,
            updatedAt: latest.updatedAt, editedBy: latest.editedBy,
          }, mode, withoutMaps);
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
          if (saverRef === saver) onConflict(saver, map, withoutMaps, server, mode);
        });
      },
      onDismiss: function () { conflictOpen = false; },
    });
  }

  // ── Live co-editing (#34) ─────────────────────────────────────────────
  // The stream says a newer copy exists (doc), that everything should be
  // fetched again (resync, hello), that someone arrived or moved (presence)
  // or that the map is gone. A doc event is answered with one fetch, and
  // the fetch is answered with the merge — never with a whole-screen
  // reload, so nothing the reader is doing is disturbed.
  function onLiveEvent(kind, data) {
    var c = openRef;
    if (!c) return;
    if (kind === 'presence') {
      // The server's sheet holds this screen too; take it out, the view
      // only shows the others.
      var people = (data.people || []).filter(function (p) {
        return !c.you || p.id !== c.you;
      });
      if (view && view.setPresence) view.setPresence(people);
      return;
    }
    if (kind === 'gone') {
      if (Off && ns) Off.removeMap(ns, c.id); // the device's copy goes with it (#40)
      destroyView();
      mapError({ status: 404 });
      return;
    }
    if (kind === 'hello') {
      c.you = data.you || null; // this screen's own id, so its presence dot is not drawn
      pullLatest();
      return;
    }
    if (kind === 'doc' || kind === 'resync') pullLatest();
  }

  function pullLatest() {
    var c = openRef;
    if (!c || pulling) return;
    pulling = true;
    api('GET', c.fetchPath).then(function (r) {
      pulling = false;
      if (openRef !== c) return; // the screen moved on meanwhile
      var server = r.map;
      if (!server || !server.doc) return;
      if (c.mode !== 'owner' && c.mode !== 'editor') {
        // View only: whatever the server holds is what everyone sees.
        if (view && view.applyRemote) view.applyRemote(server.doc);
        return;
      }
      mergeIn(c, server);
    }).catch(function () {
      pulling = false;
    });
  }

  // This screen's doc (mine) meets the server's newer copy (theirs), over
  // the copy both started from (base). Unsaved local edits win field by
  // field; the answer goes onto the screen and, when it holds anything the
  // server has not saved, straight into the autosave on the newer base.
  function mergeIn(c, server) {
    var s = c.saver;
    if (s.busy()) return; // a save or the conflict sheet is deciding
    var mine = c.doc;
    var r = root.M2Merge.merge(s.baseDoc(), mine, server.doc);
    if (!r.doc) {
      // Not a map anyone can open: the sheet asks which copy to keep.
      s.showConflict(server);
      return;
    }
    var redraw = r.changed;
    var needsSave = !root.M2Merge.sameDoc(r.doc, server.doc);
    if (redraw && view && view.applyRemote) view.applyRemote(r.doc);
    s.adopt(server.revision, server.doc);
    if (needsSave) s.changed(c.doc);
  }

  // Coming back to the tab, or told to resync: same answer as a doc event.
  function checkForNewer() {
    var c = openRef;
    if (!c || pulling) return;
    var s = c.saver;
    if (s && s.inConflict()) { onConflict(s, { doc: c.doc, id: c.id }, c.withoutMaps, null, c.mode); return; }
    if (s && s.busy()) return;
    pullLatest();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (liveRef) liveRef.resume(); // the fresh hello pulls the latest
      else checkForNewer();
    } else if (liveRef) {
      liveRef.pause(); // closed stream, leave posted: not on the map
    }
  });
  // The shell can keep this app loaded but hidden; it says when it shows it.
  window.addEventListener('usernode:visibility-changed', function (e) {
    var hidden = !(e.detail && e.detail.hidden === false);
    if (hidden && liveRef) liveRef.pause();
    else if (!hidden) {
      if (liveRef) liveRef.resume();
      else checkForNewer();
    }
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

  // ── Opening a map, with the device's copy as the fallback (#40) ──────
  function openMapById(id) {
    // A map the device made up offline still has its device id: its local
    // record is the whole map, and the sync pass gives it a real one.
    if (Off && Off.isTempId(id)) { openLocalRecord(id); return; }
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/maps/' + encodeURIComponent(id)).then(function (r) {
      var mode = r.access === 'owner' || r.access === 'editor' ? r.access : 'viewer';
      function openIt(doc, revision, baseDoc, local) {
        showMap({
          id: r.map.id,
          doc: doc,
          revision: revision,
          baseDoc: baseDoc || null,
          updatedAt: r.map.updatedAt,
          editedBy: r.map.editedBy,
        }, mode, false, local);
      }
      if (!Off || !ns || !Off.available()) { openIt(r.map.doc, r.map.revision, null, null); return; }
      Off.getMap(ns, r.map.id).then(function (rec) {
        if (rec && rec.pending && rec.doc) {
          // This device holds edits the server has not seen: open on
          // those, against the revision they were made from, so the save
          // meets whatever moved on the server through the merge.
          openIt(rec.doc, typeof rec.revision === 'number' ? rec.revision : 0,
            rec.baseDoc || rec.doc, rec);
        } else {
          openIt(r.map.doc, r.map.revision, null, null);
        }
      });
    }).catch(function (err) {
      if (err.offline) {
        openLocalOr(id, err, function () { mapError(err, function () { openMapById(id); }); });
        return;
      }
      // The map is gone for everyone; the device's copy of it goes too.
      if (err.status === 404 && Off && ns) Off.removeMap(ns, id);
      mapError(err, function () { openMapById(id); });
    });
  }

  // A map straight from the device's copy (#40), online or not.
  function showLocal(rec, offlineNow) {
    var mode = rec.access === 'editor' ? 'editor' : rec.access === 'viewer' ? 'viewer' : 'owner';
    showMap({
      id: rec.id,
      doc: rec.doc,
      revision: typeof rec.revision === 'number' ? rec.revision : 0,
      baseDoc: rec.baseDoc || rec.doc,
    }, mode, false, rec, offlineNow);
  }

  // The device's copy of one map, or the usual error when there is none.
  function openLocalOr(id, err, fail) {
    if (!Off || !ns || !Off.available()) { fail(); return; }
    Off.getMap(ns, id).then(function (rec) {
      if (rec && rec.doc) showLocal(rec, true);
      else fail();
    });
  }

  function openLocalRecord(id) {
    render(root.M2Canvas.loadingEl());
    if (!Off || !ns || !Off.available()) { mapError({ status: 404 }); return; }
    Off.getMap(ns, id).then(function (rec) {
      if (!rec || !rec.doc) { mapError({ status: 404 }); return; }
      showLocal(rec, !root.navigator.onLine);
    });
  }

  // A secret link; guests may open these too.
  function openShared(token) {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/shared/' + encodeURIComponent(token)).then(function (r) {
      // A dead link answers { map: null } rather than a 404 (see server.js).
      if (!r.map) { mapError({ status: 404 }); return; }
      showMap(r.map, r.access === 'owner' || r.access === 'editor' ? r.access : 'viewer',
        !!r.guest, null);
    }).catch(function (err) {
      if (err.offline && Off && ns && Off.available()) {
        // The link's map, from the device's copy, found by its share token.
        Off.localMaps(ns).then(function (recs) {
          var hit = (recs || []).filter(function (rec) { return rec.shareToken === token; })[0];
          if (hit) showLocal(hit, true);
          else mapError(err, function () { openShared(token); });
        });
        return;
      }
      mapError(err, function () { openShared(token); });
    });
  }

  // ── Your maps ────────────────────────────────────────────────────────
  function showMaps() {
    var el = render(document.createElement('div'));
    view = root.M2MapsList(el, {
      demo: isDemo,
      onOpen: function (id) { location.hash = '#/map/' + id; },
      onOpenTrash: function () { location.hash = '#/trash'; },
    });
  }

  // ── Recently deleted ─────────────────────────────────────────────────
  function showTrash() {
    var el = render(document.createElement('div'));
    view = root.M2TrashList(el, {
      onBack: function () { location.hash = '#/maps'; },
    });
  }

  // ── Start flow, with no hash ─────────────────────────────────────────
  function startFlow() {
    render(root.M2Canvas.loadingEl());
    // Offline (#40): with no remembered identity there is nothing on this
    // device to open, so the load genuinely fails.
    if (root.navigator.onLine === false) {
      startOffline();
      return;
    }
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
    }).catch(function (err) {
      if (err.offline) { startOffline(); return; }
      startError();
    });
  }

  // Offline start (#40): a guest still gets the in-memory example; anyone
  // else gets the newest map saved on this device, or the list's offline
  // copy, which shows what is on the device and needs a connection for
  // anything else.
  function startOffline() {
    if (!Off || !ns || !Off.available()) { startError(); return; }
    Off.getList(ns).then(function (list) {
      var recs = (list || []);
      if (!recs.length) { startError(); return; }
      recs.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      Off.getMap(ns, recs[0].id).then(function (rec) {
        if (!rec || !rec.doc) { startError(); return; }
        showLocal(rec, true);
      });
    });
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
  // A successful call means the connection is back (#40): the kick fires
  // from api.js, and the browser's online event covers coming back without
  // making a call. The boot pass itself rides on the first successful call.
  if (Off) {
    Off.onKick(function () { syncAll(); });
    window.addEventListener('online', function () { syncAll(); });
  }
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
    openRef = null;
    current = null;
    var hash = location.hash;
    if (hash === '#/maps') { showMaps(); }
    else if (hash === '#/trash') { showTrash(); }
    else if (hash.indexOf('#/map/') === 0) { openMapById(decodeURIComponent(hash.slice(6))); }
    else if (shareParam) { openShared(shareParam); }
    else if (mapParam) { openMapById(mapParam); }
    else { startFlow(); }
  }

  route();
})(typeof self !== 'undefined' ? self : this);
