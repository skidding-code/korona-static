import { parseEmbeddedWisps } from "../src/core/singlefile/wisp-resolver";
import type { RuntimeStatus } from "../src/core/singlefile/runtime-loader";

export interface RuntimeLaunch {
  target: string;
  wisps: string[];
  apiOrigin: string;
}

export function parseRuntimeLaunch(search: string): RuntimeLaunch | null {
  if (search.length > 16_384) return null;
  const params = new URLSearchParams(search);
  const target = decodeString(params.get("target"));
  const wisps = decodeJson(params.get("wisps"));
  const apiOrigin = decodeString(params.get("api"));
  if (!target || !apiOrigin || !Array.isArray(wisps)) return null;
  try {
    const destination = new URL(target);
    const api = new URL(apiOrigin);
    if (!["https:", "http:"].includes(destination.protocol) || api.protocol !== "https:") return null;
    const endpoints = parseEmbeddedWisps(wisps.filter((value): value is string => typeof value === "string").join("\n"));
    if (endpoints.length === 0 || endpoints.length > 64) return null;
    return { target: destination.href, wisps: endpoints, apiOrigin: api.href.replace(/\/$/, "") };
  } catch {
    return null;
  }
}

export function runtimeStatus(status: RuntimeStatus["status"], value: Record<string, unknown> = {}): RuntimeStatus {
  switch (status) {
    case "ready": return { type: "korona-runtime", status, source: typeof value.source === "string" ? value.source : "" };
    case "progress": return { type: "korona-runtime", status, count: typeof value.count === "number" ? value.count : 0 };
    case "first-content": return { type: "korona-runtime", status, url: typeof value.url === "string" ? value.url : "" };
    case "navigate": return { type: "korona-runtime", status, url: typeof value.url === "string" ? value.url : "" };
    case "wisp-failed": return { type: "korona-runtime", status, endpoint: typeof value.endpoint === "string" ? value.endpoint : "" };
    case "error": return { type: "korona-runtime", status, detail: typeof value.detail === "string" ? value.detail : "Runtime error" };
  }
}

function decodeString(value: string | null): string | null {
  const decoded = decodeJson(value);
  return typeof decoded === "string" && decoded.length <= 4_096 ? decoded : null;
}

function decodeJson(value: string | null): unknown {
  if (!value || value.length > 12_000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(`${normalized}${"=".repeat((4 - normalized.length % 4) % 4)}`));
  } catch {
    return null;
  }
}
