/* The live connection (#34): one stream per open map, plus the presence
 * posts that say this screen is here and what it has selected.
 *
 * app.js opens it for every real map (owner or viewer, shared link or not)
 * and hands the events on: hello/doc/presence/gone/resync/bye. EventSource
 * reconnects on its own (the server suggests 3 s), and every fresh connect
 * answers with hello, which the app treats as "go and fetch the latest".
 * When the page is hidden the stream is closed and a leave is posted, so
 * nobody is shown as on the map while they cannot see it; coming back
 * reconnects, which fetches everything that happened meanwhile. */
(function (root) {
  'use strict';

  function connect(opts) {
    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');
    var share = params.get('share') || '';
    var demo = root.M2Api && root.M2Api.isDemo;
    var closedByUs = false;
    var hidden = false;

    var beat = 0; // the 15 s presence keep-alive
    var selTimer = 0; // debounce on selection changes
    var selected = null; // what has been posted so far
    var wanted = null; // the newest selection, posted on the next beat/debounce
    var es = null;
    var openTimer = 0; // the stream opens after the page's first load settles

    function url() {
      var q = token ? '?token=' + encodeURIComponent(token) : '?';
      if (share) q += '&share=' + encodeURIComponent(share);
      if (demo) q += '&demo=1';
      return '/api/maps/' + encodeURIComponent(opts.mapId) + '/events' + q;
    }

    function post(path, keepalive) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-usernode-token'] = token;
      if (root.usernode && root.usernode.previewNow) {
        headers['x-usernode-now'] = root.usernode.now().toISOString();
      }
      var q = demo ? '?demo=1' : '';
      return fetch('/api/maps/' + encodeURIComponent(opts.mapId) + '/' + path + q, {
        method: 'POST', headers: headers, keepalive: !!keepalive,
        body: JSON.stringify({ selectedId: selected, share: share }),
      }).catch(function () {});
    }

    function open() {
      if (closedByUs || hidden) return;
      if (opts.onState) opts.onState('connecting');
      es = new EventSource(url());
      es.onopen = function () { if (opts.onState) opts.onState('open'); };
      ['hello', 'doc', 'presence', 'gone', 'resync', 'bye'].forEach(function (kind) {
        es.addEventListener(kind, function (e) {
          var data = {};
          try { data = JSON.parse(e.data); } catch (err) {}
          if (kind === 'bye') { es.close(); if (opts.onState) opts.onState('off'); return; }
          if (kind === 'hello') { arrive(); } // a fresh stream: say we are here
          if (opts.onEvent) opts.onEvent(kind, data);
        });
      });
      es.onerror = function () { if (opts.onState) opts.onState('connecting'); };
    }

    // Arriving, or back from being hidden: one presence post that announces.
    function arrive() {
      selected = wanted;
      post('presence');
      startBeat();
    }

    function startBeat() {
      clearInterval(beat);
      beat = setInterval(function () {
        // Every 15 s: refresh this screen's slot. A change of selection goes
        // sooner, on its own debounce below.
        selected = wanted;
        post('presence');
      }, 15000);
    }

    // The viewer selected another idea: say so, a moment after they stop.
    function setSelection(id) {
      wanted = (typeof id === 'string' && id) ? id.slice(0, 40) : null;
      if (hidden || closedByUs) return;
      if (wanted === selected) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        selected = wanted;
        post('presence');
      }, 400);
    }

    function stopBeats() {
      clearInterval(beat); beat = 0;
      clearTimeout(selTimer); selTimer = 0;
    }

    // Hidden tab: close the stream and say we left, so the dots on other
    // screens go away while nothing here can see the map.
    function pause() {
      hidden = true;
      stopBeats();
      if (es) { es.close(); es = null; }
      selected = wanted;
      post('presence/leave', true);
      if (opts.onState) opts.onState('off');
    }

    function resume() {
      hidden = false;
      clearTimeout(openTimer); openTimer = 0;
      open(); // a fresh hello is the resync
    }
    function close() {
      closedByUs = true;
      clearTimeout(openTimer); openTimer = 0;
      stopBeats();
      if (es) { es.close(); es = null; }
      post('presence/leave', true); // keepalive: survives the navigation
      if (opts.onState) opts.onState('off');
    }

    // A pagehide (app swipe, tab close) still gets the leave out.
    window.addEventListener('pagehide', function () {
      if (!closedByUs && !hidden) { selected = wanted; post('presence/leave', true); }
    });

    // A beat after the view exists, so the page's first load is settled
    // before a connection is held open on it.
    openTimer = setTimeout(open, 1200);
    startBeat();

    return {
      setSelection: setSelection,
      pause: pause,
      resume: resume,
      close: close,
    };
  }

  root.M2Live = { connect: connect };
})(typeof self !== 'undefined' ? self : this);
