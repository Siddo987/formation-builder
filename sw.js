/*
 * Kill-switch service worker.
 *
 * An app deployed at this domain BEFORE Aufstellung (a login-screen SPA — "Willkommen
 * zurück / Bitte einloggen", built into /assets/*.js) registered a service worker on
 * this origin. That worker is still installed in visitors' browsers and keeps serving
 * its own cached app shell for every normal navigation — only a hard reload (Ctrl+F5)
 * bypasses it and reaches the real Aufstellung page on the server.
 *
 * This file replaces that worker. Browsers re-fetch the service-worker script on
 * navigation (and at least every 24h), notice these bytes differ, install this, and
 * then: it unregisters itself, deletes every Cache Storage entry the old worker left,
 * and reloads any open tabs against the live server.
 *
 * IMPORTANT: this only works if it sits at the SAME path the old worker was
 * registered at. Check DevTools -> Application -> Service Workers for the old script
 * URL; if it was e.g. /service-worker.js, copy this file to that name too.
 *
 * Keep this file in place (returning HTTP 200) for a good while — weeks — until
 * essentially every returning visitor has loaded the site once more. If the path
 * starts 404ing too early, browsers that haven't updated yet keep the old worker.
 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try { await self.registration.unregister(); } catch (e) {}
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) {}
    try {
      var clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (client) {
        try { client.navigate(client.url); } catch (e) {}
      });
    } catch (e) {}
  })());
});

// Nothing is served from cache anymore — every request goes straight to the network.
self.addEventListener('fetch', function () {});
