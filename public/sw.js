/* M2's service worker (#40): the app shell stays available offline so the
 * page can boot with no connection and open its last maps from IndexedDB.
 *
 * Rules:
 *  - Precache the app shell ONLY: index.html, tailwind.css and the app's
 *    own /js/*.js. The centrally hosted platform files (the bridge
 *    /usernode-bridge/v1/bridge.js, the native UI kit /usernode-native/v1/*,
 *    the Tailwind runtime /usernode-tailwind/*) are never fetched here and
 *    never vendored: they load from the network or the platform's own
 *    handling, not as stale copies of ours.
 *  - /api/* is NEVER served from the cache and never intercepted: reads
 *    fall back in the page's own offline store, writes always reach the
 *    network.
 *  - Navigations are network-first, falling back to the cached shell.
 *  - Precached assets are network-first: online they refresh the cache, so
 *    a deploy is never served stale; offline they fall back to the cache.
 */
'use strict';

var CACHE = 'm2-shell-v2';

var SHELL = [
  '/index.html',
  '/tailwind.css',
  '/js/map-model.js',
  '/js/map-import.js',
  '/js/map-merge.js',
  '/js/live.js',
  '/js/example-map.js',
  '/js/api.js',
  '/js/offline-store.js',
  '/js/canvas.js',
  '/js/maps-list.js',
  '/js/share-sheet.js',
  '/js/version-sheet.js',
  '/js/app.js',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (url) {
        return c.add(url).catch(function () {}); // one miss must not fail the install
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : (k.indexOf('m2-shell-') === 0 ? caches.delete(k) : null);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // writes always reach the network
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // platform files: never touched
  if (url.pathname.indexOf('/api/') === 0) return; // straight to the network
  if (url.pathname.indexOf('/usernode-') === 0) return; // platform hosted, never cached

  // Navigations: network first, cached shell when offline, whatever the query.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.open(CACHE).then(function (c) {
          return c.match('/index.html');
        });
      })
    );
    return;
  }

  // Same-origin assets: network first, refresh the cache on success, fall
  // back to it offline.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && SHELL.indexOf(url.pathname) !== -1) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.open(CACHE).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || Response.error();
        });
      });
    })
  );
});
