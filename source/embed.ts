import EpoxyTransport from "@mercuryworkshop/epoxy-transport";
import { EmbeddedWispResolver } from "../src/core/singlefile/wisp-resolver";
import { parseRuntimeLaunch, runtimeStatus } from "./protocol";

interface RuntimeFrame {
  element: HTMLIFrameElement;
  go(url: string): void;
}

interface RuntimeController {
  wait(): Promise<void>;
  createFrame(element: HTMLIFrameElement): RuntimeFrame;
}

interface RuntimeControllerConstructor {
  new (options: {
    serviceworker: ServiceWorker;
    transport: EpoxyTransport;
    config: { prefix: string; scramjetPath: string; injectPath: string; wasmPath: string };
  }): RuntimeController;
}

interface RuntimeLaunchGlobals {
  __KORONA_RUNTIME_LAUNCH__?: {
    target?: unknown;
    wisps?: unknown;
    apiOrigin?: unknown;
  };
}

function report(status: Parameters<typeof runtimeStatus>[0], value: Record<string, unknown> = {}) {
  if (window.parent !== window) window.parent.postMessage(runtimeStatus(status, value), "*");
}

function setMessage(value: string) {
  const message = document.getElementById("runtime-message");
  if (message) message.textContent = value;
}

async function activeWorker(): Promise<ServiceWorker> {
  const container = workerContainer();
  if (!container) throw new Error("Service workers are unavailable in this browser.");
  const base = runtimeBase();
  const registration = await container.register(new URL("sw.js", base).href, { scope: base.href, updateViaCache: "none" });
  const active = registration.active;
  if (active?.state === "activated") return active;
  const worker = registration.installing ?? registration.waiting ?? active;
  if (!worker) throw new Error("Korona runtime worker did not begin installing.");
  return new Promise<ServiceWorker>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Korona runtime worker did not activate."));
    }, 15_000);
    const onStateChange = () => {
      if (worker.state === "activated") {
        cleanup();
        resolve(worker);
      } else if (worker.state === "redundant") {
        cleanup();
        reject(new Error("Korona runtime worker became redundant."));
      }
    };
    worker.addEventListener("statechange", onStateChange);
  });
}

function workerContainer(): ServiceWorkerContainer | null {
  try {
    if (window.parent !== window && "serviceWorker" in window.parent.navigator) {
      return window.parent.navigator.serviceWorker;
    }
  } catch {
    // A cross-origin parent cannot own the portable runtime worker.
  }
  return "serviceWorker" in navigator ? navigator.serviceWorker : null;
}

function runtimeBase(): URL {
  return new URL("./", document.baseURI);
}

function runtimePath(path: string): string {
  return new URL(path, runtimeBase()).href;
}

function runtimePrefix(): string {
  return new URL("f/", runtimeBase()).pathname;
}

function injectedLaunch(): RuntimeLaunchGlobals["__KORONA_RUNTIME_LAUNCH__"] {
  return (globalThis as RuntimeLaunchGlobals).__KORONA_RUNTIME_LAUNCH__;
}

async function start() {
  const launch = parseRuntimeLaunch(location.search, injectedLaunch());
  if (!launch) throw new Error("This Korona runtime launch was invalid.");
  const frame = document.getElementById("runtime-frame") as HTMLIFrameElement | null;
  if (!frame) throw new Error("Korona runtime frame was missing.");
  setMessage("Selecting a relay…");
  report("progress", { count: 1 });
  const resolver = new EmbeddedWispResolver({ endpoints: launch.wisps });
  let endpoint = "";
  try {
    endpoint = (await resolver.resolve()).url;
    setMessage("Starting secure browser runtime…");
    report("progress", { count: 2 });
    const transport = new EpoxyTransport({ wisp: endpoint, wisp_v2: true });
    await transport.init();
    const worker = await activeWorker();
    const controllerRuntime = (globalThis as { $scramjetController?: { Controller?: RuntimeControllerConstructor } }).$scramjetController;
    if (!controllerRuntime?.Controller) throw new Error("Korona relay controller did not load.");
    const controller = new controllerRuntime.Controller({
      serviceworker: worker,
      transport,
      config: {
        prefix: runtimePrefix(),
        scramjetPath: runtimePath("scram/scramjet.js"),
        injectPath: runtimePath("controller/controller.inject.js"),
        wasmPath: runtimePath("scram/scramjet.wasm"),
      },
    });
    await controller.wait();
    report("ready", { source: runtimeBase().origin });
    report("progress", { count: 3 });
    const runtimeFrame = controller.createFrame(frame);
    const firstContent = window.setTimeout(() => report("error", { detail: "The requested page did not produce content in time." }), 45_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(firstContent);
      resolver.confirm(endpoint);
      document.getElementById("runtime-stage")?.classList.add("ready");
      report("first-content", { url: launch.target });
    }, { once: true });
    runtimeFrame.go(launch.target);
  } catch (error) {
    if (endpoint) {
      resolver.reject(endpoint);
      report("wisp-failed", { endpoint });
    }
    throw error;
  }
}

void start().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "Korona runtime failed.";
  setMessage(detail);
  report("error", { detail });
});
