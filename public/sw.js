/* EGO service worker (scope /ego). Caches only static assets: /avatar/*.webp, /icons/*, /_next/static/*.
 * Never caches /api/* or HTML. Navigations are network-first and are never stored; on failure an inline
 * offline page is shown. Non-GET requests are not intercepted, so the login cookie flow is untouched. */
const CACHE = "ego-shell-v2";
const MAX_STATIC_ENTRIES = 80;
const PRECACHE = ["/icons/icon-192.png", "/icons/icon-512.png"];

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>EGO is offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f1f2;color:#1d2340;font:16px system-ui,sans-serif;text-align:center}</style></head>" +
  "<body><main><h1>EGO is offline</h1><p>Check your connection and try again.</p></main></body></html>";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Oldest entries first (cache.keys() is insertion order); keeps the cache from growing with every deploy.
async function trimCache(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i]);
}

function isStaticAsset(url) {
  return (
    (url.pathname.startsWith("/avatar/") && url.pathname.endsWith(".webp")) ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    );
    return;
  }

  if (!isStaticAsset(url)) return;
  // Hashed /_next/static files are immutable (cache-first); unhashed avatar/icon files use stale-while-revalidate.
  const immutable = url.pathname.startsWith("/_next/static/");
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit && immutable) return hit;
      const refresh = fetch(request).then((res) => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          event.waitUntil(cache.put(request, copy).then(() => trimCache(cache)));
        }
        return res;
      });
      if (hit) {
        event.waitUntil(refresh.catch(() => {}));
        return hit;
      }
      return refresh;
    }),
  );
});

// Web push. The payload is JSON { title, body, url }; the click target is limited to same-origin /ego paths.
function safeEgoUrl(url) {
  if (typeof url !== "string" || url.length > 500) return "/ego";
  if (!/^\/ego([/?#]|$)/.test(url) || url.includes("//") || url.includes("\\")) return "/ego";
  return url;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "EGO";
  const body = typeof data.body === "string" ? data.body : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: safeEgoUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeEgoUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        const path = new URL(client.url).pathname;
        if (path === "/ego" || path.startsWith("/ego/")) {
          return client.focus().then((c) => (c && "navigate" in c && target !== "/ego" ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
