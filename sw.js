/* 解体サーチ Service Worker
   目的: アプリを開くたびに「最新の index.html」を取りに行く（ネット優先）。
        回線が遅い/オフラインのときだけキャッシュを使う。 */
var VERSION = "2026-09-04-r57";
var CACHE = "kaitai-shell-" + VERSION;
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-maskable.svg", "./logo.jpg"];
var HTML_NET_TIMEOUT = 4000;

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  var isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") >= 0;

  if (isHTML) {
    e.respondWith(
      caches.match("./index.html").then(function (cached) {
        var fromNet = fetch(req).then(function (res) {
          try {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put("./index.html", copy); }).catch(function () {});
          } catch (err) {}
          return res;
        });
        // 初回（キャッシュ無し）はネットを待つしかない
        if (!cached) {
          return fromNet.catch(function () {
            return caches.match("./").then(function (m) { return m || caches.match(req); });
          });
        }
        // ネットが速ければ最新を返す。遅ければキャッシュを返し、更新は裏で続行。
        var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, HTML_NET_TIMEOUT); });
        return Promise.race([fromNet.catch(function () { return null; }), timeout]).then(function (r) {
          return r || cached;
        });
      })
    );
    return;
  }

  // アイコン・manifest 等: キャッシュ優先 + 裏で更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          try {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          } catch (err) {}
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
