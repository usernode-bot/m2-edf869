/* One fetch wrapper for every call the app makes. Reads the iframe's token
 * once, sends it as a header, and carries the preview's clock along so a
 * staging preview opened at a chosen moment stays consistent. */
(function (root) {
  'use strict';

  var token = new URLSearchParams(window.location.search).get('token');
  var isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

  // Offline (#40): which person's storage namespace the device keeps. A
  // page loaded offline carries no ?token, so the identity is remembered
  // here (localStorage `m2.offline.who`) and never cleared when the token
  // is absent — wiping it would throw away saved maps on exactly the load
  // that needs them. A new token for a different person switches without
  // deleting the old namespace. The payload is only decoded, never
  // verified: it names a storage bucket, and the server still verifies the
  // token on every call.
  var WHO_KEY = 'm2.offline.who';
  var ns = null;
  try {
    var decoded = root.M2Offline ? root.M2Offline.tokenIdentity(token) : null;
    if (decoded) {
      ns = decoded;
      localStorage.setItem(WHO_KEY, decoded);
    } else if (!token) {
      ns = localStorage.getItem(WHO_KEY);
    }
  } catch (e) { /* storage refused: offline keeps nothing, as before */ }

  function api(method, path, body) {
    var headers = {};
    if (token) headers['x-usernode-token'] = token;
    // The preview's moment, only when the bridge reports one (staging only).
    if (window.usernode && window.usernode.previewNow) {
      headers['x-usernode-now'] = window.usernode.now().toISOString();
    }
    var url = path;
    if (isDemo) url += (url.indexOf('?') === -1 ? '?' : '&') + 'demo=1';
    var opts = { method: method, headers: headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        var err = new Error('API ' + method + ' ' + path + ' failed with ' + res.status);
        err.status = res.status;
        // A 401 with no token at all is what an offline load looks like to
        // the server: it is a connection story, not a permission one.
        if (res.status === 401 && !token) err.offline = true;
        // The JSON body, when there is one: a save conflict (409) carries the
        // server's current copy of the map.
        return res.json().catch(function () { return null; }).then(function (body) {
          err.body = body;
          throw err;
        });
      }
      // A call got through: the connection works, so waiting edits may go.
      if (root.M2Offline) root.M2Offline.kick();
      if (res.status === 204) return null;
      return res.json();
    }, function (fetchErr) {
      // fetch itself refused: no connection. No status — the page reads
      // err.offline instead of err.status.
      var err = (fetchErr instanceof Error) ? fetchErr : new Error(String(fetchErr));
      err.offline = true;
      throw err;
    });
  }

  // "Just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then a date.
  // Read the staging preview clock when one is set, so demo ages match the
  // demo data. Lived in maps-list.js first, then "Edited by …" needed it on
  // the canvas too.
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

  root.M2Api = { api: api, isDemo: isDemo, relativeTime: relativeTime, ns: ns };
})(typeof self !== 'undefined' ? self : this);
