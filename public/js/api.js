/* One fetch wrapper for every call the app makes. Reads the iframe's token
 * once, sends it as a header, and carries the preview's clock along so a
 * staging preview opened at a chosen moment stays consistent. */
(function (root) {
  'use strict';

  var token = new URLSearchParams(window.location.search).get('token');
  var isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

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
        // The JSON body, when there is one: a save conflict (409) carries the
        // server's current copy of the map.
        return res.json().catch(function () { return null; }).then(function (body) {
          err.body = body;
          throw err;
        });
      }
      if (res.status === 204) return null;
      return res.json();
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

  root.M2Api = { api: api, isDemo: isDemo, relativeTime: relativeTime };
})(typeof self !== 'undefined' ? self : this);
