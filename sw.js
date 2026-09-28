// Service worker for the hosted VIDAA build only (index.html never registers
// it on other platforms).
//
// Strategy: network first, cache as offline fallback. The TV is online
// whenever Nuvio is useful, so serving cached app code first only meant every
// update showed up one launch late, and a cached index.html could pair with a
// newer app.bundle.js (or the other way round).
var CACHE_NAME = "nuvio-vidaa-v3";

// Dist builds ship css/bundle.css; dev serving (npm run serve:vidaa) ships the
// split stylesheets. Each file is cached on its own so a path that does not
// exist in one of the two layouts cannot fail the whole precache.
var ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./boot-guard.js",
  "./core-js.bundle.js",
  "./nuvio.env.js",
  "./app.bundle.js",
  "./assets/runtime/legacy-features.js",
  "./assets/runtime/plugin-worker.js",
  "./assets/libs/qrcode-generator.js",
  "./assets/libs/quickjs-emscripten.global.js",
  "./assets/libs/ass.min.js",
  "./assets/libs/hls.min.js",
  "./assets/libs/dash.all.min.js",
  "./css/bundle.css",
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/themes.css",
  "./res/icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(
          ASSETS.map(function (asset) {
            return cache.add(new Request(asset, { cache: "reload" })).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n !== CACHE_NAME;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (req.url.indexOf(self.location.origin) !== 0) return;

  // Never touch media range requests or video stream files
  if (req.headers && req.headers.get("range")) return;
  if (/\.(mkv|mp4|m4v|webm|m3u8|ts|mpd|mov)(\?|$)/i.test(req.url)) return;

  // Cache entries are stored without the ?v= cache-buster so the offline
  // fallback still finds the last good copy after a version bump.
  var cacheKey = req.url;
  if (cacheKey.indexOf("?") !== -1) {
    var url = new URL(cacheKey);
    url.search = "";
    cacheKey = url.toString();
  }

  e.respondWith(
    fetch(req)
      .then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(cacheKey, clone);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(cacheKey).then(function (cached) {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
      })
  );
});
