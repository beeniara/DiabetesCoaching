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

export async function sendShelfAnalysisToLocalServer(
  settings: LocalServerSettings,
  payload: { caption?: string; photoDataUrl?: string; candidate?: unknown },
  mode: ShelfServerMode
): Promise<ShelfServerResult> {
  const path =
    mode === "gpt" ? "/v1/shelf-analysis/gpt" : mode === "validate" ? "/v1/shelf-analysis/validate" : "/v1/shelf-analysis/mock";
  const response = await fetch(buildEndpoint(settings.baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
      "x-request-id": `mobile_${Date.now()}`
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
    const detail = await response.text();
    throw new Error(`Local server returned ${response.status}: ${detail.slice(0, 180)}`);
  }

  const json = (await response.json()) as unknown;
  const analysis = ShelfAnalysisSchema.parse(json);
  return { analysis, endpoint: path, mode };
}
