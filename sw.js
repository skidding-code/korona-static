const BASE = new URL("./", self.location).pathname;

importScripts(`${BASE}scram/scramjet.js`, `${BASE}controller/controller.sw.js`);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  try {
    if (self.$scramjetController?.shouldRoute(event)) {
      event.respondWith(self.$scramjetController.route(event));
    }
  } catch {
    // Non-runtime requests use the browser's normal network path.
  }
});
