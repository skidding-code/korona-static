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

function report(status: Parameters<typeof runtimeStatus>[0], value: Record<string, unknown> = {}) {
  if (window.parent !== window) window.parent.postMessage(runtimeStatus(status, value), "*");
}

function setMessage(value: string) {
  const message = document.getElementById("runtime-message");
  if (message) message.textContent = value;
}

async function activeWorker(): Promise<ServiceWorker> {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable in this browser.");
  await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Korona runtime worker did not control this page.")), 15_000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) throw new Error("Korona runtime worker is unavailable.");
  return navigator.serviceWorker.controller;
}

async function start() {
  const launch = parseRuntimeLaunch(location.search);
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
        prefix: "./f/",
        scramjetPath: "./scram/scramjet.js",
        injectPath: "./controller/controller.inject.js",
        wasmPath: "./scram/scramjet.wasm",
      },
    });
    await controller.wait();
    report("ready", { source: location.origin });
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
