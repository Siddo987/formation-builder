/*
 * Offline support (#2058): keeps a copy of the app so Aufstellung also opens without a network.
 * Network first — online, every request goes to the server exactly as before (deploys and ?v=
 * bumps show up right away); the cache only answers when the network fails. Projects themselves
 * already live in localStorage/IndexedDB. api/ (share sync) and uploads/ are never cached.
 *
 * This file used to be a kill-switch: an app that lived at this domain before Aufstellung (a
 * login-screen SPA under /assets/) registered a worker at this path. Browsers that still have it
 * update to this file, and activate below deletes every cache that isn't ours — its old shell too.
 */

var CACHE = 'aufstellung-shell-v1';

self.addEventListener('install', function (event) {
  self.skipWaiting();
  // Precache the shell on first install: index.html plus every local file it references.
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return fetch('./', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return;
      return res.clone().text().then(function (html) {
        var urls = [];
        html.replace(/(?:src|href)="([^"#:]+)"/g, function (_m, u) { if (urls.indexOf(u) === -1) urls.push(u); });
        return cache.put('./', res).then(function () {
          return Promise.all(urls.map(function (u) { return cache.add(u).catch(function () {}); }));
        });
      });
    });
  }).catch(function () {}));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || /\/(api|uploads)\//.test(url.pathname)) return;
  // Every page of the app is index.html (?share=, ?neu …) — one cached copy serves them all.
  var shell = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
  var key = shell ? './' : req;
  event.respondWith(fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) {
        // Only the newest ?v= of each file is kept.
        return (shell ? Promise.resolve() : c.delete(req, { ignoreSearch: true })).then(function () { return c.put(key, copy); });
      }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(key).then(function (hit) { return hit || Response.error(); });
  }));
});
