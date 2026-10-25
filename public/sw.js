// Digital Closet service worker: keeps the app itself available offline.
// It never caches Supabase traffic; the closet's data lives in IndexedDB and syncs on its own.
const VERSION = "v1";
const SHELL_CACHE = `closet-shell-${VERSION}`;
const ASSET_CACHE = `closet-assets-${VERSION}`;
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("closet-") && key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Pages: try the network for the newest version, fall back to the cached app when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy never goes stale.
  const isOwnAsset = url.origin === self.location.origin && (url.pathname.includes("/assets/") || url.pathname.includes("/icons/"));
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!isOwnAsset && !isFont) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached && isOwnAsset) return cached;
      const network = fetch(request)
        .then((response) => {
          if (response.ok || response.type === "opaque") cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      // Fonts: serve the cached copy straight away and refresh it in the background.
      return cached ?? network;
    })
  );
});
