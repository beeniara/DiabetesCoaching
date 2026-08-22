import { ShelfAnalysisSchema, type ShelfAnalysis } from "../../../packages/shared/src/shelf-analysis";

export type LocalServerSettings = {
  baseUrl: string;
  apiKey: string;
};

export type ShelfServerMode = "mock" | "validate" | "gpt";

export type ShelfServerResult = {
  analysis: ShelfAnalysis;
  endpoint: string;
  mode: ShelfServerMode;
};

function buildEndpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function normalizeLocalServerBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Local server URL must use http or https.");
  if (url.username || url.password) throw new Error("Do not put credentials in the local server URL.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Enter only the local server origin, without a path, query, or fragment.");
  return url.origin;
}

async function requestLocalServer(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Local server request timed out.");
    throw new Error("Local server is unavailable. The local item was kept for retry.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendShelfAnalysisToLocalServer(
  settings: LocalServerSettings,
  payload: { caption?: string; photoDataUrl?: string; candidate?: unknown },
  mode: ShelfServerMode
): Promise<ShelfServerResult> {
  const path =
    mode === "gpt" ? "/v1/shelf-analysis/gpt" : mode === "validate" ? "/v1/shelf-analysis/validate" : "/v1/shelf-analysis/mock";
  const response = await requestLocalServer(buildEndpoint(settings.baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
      "x-request-id": `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    },
    body: JSON.stringify(
      mode === "validate"
        ? payload.candidate ?? payload
        : mode === "gpt"
          ? { caption: payload.caption, photoDataUrl: payload.photoDataUrl }
          : { caption: payload.caption }
    )
  });

  if (!response.ok) {
    let message = `Local server returned ${response.status}.`;
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === "string") message = body.message.slice(0, 180);
    } catch {
      // Do not surface unvalidated response bodies.
    }
    throw new Error(message);
  }

  const json = (await response.json()) as unknown;
  const analysis = ShelfAnalysisSchema.parse(json);
  return { analysis, endpoint: path, mode };
}

export async function testLocalServerConnection(settings: LocalServerSettings) {
  const result = await sendShelfAnalysisToLocalServer(settings, { caption: "Connection test" }, "mock");
  return result.analysis.schemaVersion === "1.0";
}
