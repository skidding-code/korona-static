const BASE = new URL("./", self.location).pathname;

// The browser client bundle relies on DOM-only APIs such as object URLs. The
// controller's worker bundle is the service-worker-safe half of the runtime.
importScripts(`${BASE}controller/controller.sw.js`);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  try {
    if (self.$scramjetController?.shouldRoute(event)) {
      event.respondWith(self.$scramjetController.route(event));
      return;
    }
  } catch {
    // Let a just-initialized controller receive its message port before retrying the route.
  }
  const base = new URL("./", self.location).pathname;
  if (!new URL(event.request.url).pathname.startsWith(`${base}f/`)) return;
  event.respondWith(reviveRoute(event));
});

async function reviveRoute(event) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ $controller$swrevive: {} });
  for (let attempt = 0; attempt < 320; attempt += 1) {
    try {
      if (self.$scramjetController?.shouldRoute(event)) return self.$scramjetController.route(event);
    } catch {
      // The controller may still be wiring up its message channel.
    }
    await new Promise((resolve) => self.setTimeout(resolve, 25));
  }
  return new Response("Korona runtime controller was not ready.", { status: 503 });
}
