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

  root.M2Api = { api: api, isDemo: isDemo };
})(typeof self !== 'undefined' ? self : this);
