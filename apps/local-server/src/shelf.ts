import type { Request, Response } from "express";
import { ShelfAnalysisSchema, createMockShelfAnalysis } from "../../../packages/shared/src/shelf-analysis.js";
import { isOpenAiConfigured, validateGptShelfResponse } from "./gpt4o.js";
import { writeAuditEvent } from "./audit.js";

function sendAudit(req: Request, outcome: "validated" | "failed", statusCode: number, detail: string) {
  void writeAuditEvent({
    at: new Date().toISOString(),
    route: req.path,
    method: req.method,
    outcome,
    requestId: req.header("x-request-id") ?? "unknown",
    statusCode,
    detail
  });
}

export async function handleShelfValidate(req: Request, res: Response) {
  const parsed = ShelfAnalysisSchema.safeParse(req.body);
  if (!parsed.success) {
    sendAudit(req, "failed", 422, "Shelf analysis payload failed schema validation.");
    return res.status(422).json({ error: "INVALID_SHELF_ANALYSIS", details: parsed.error.flatten() });
  }
  sendAudit(req, "validated", 200, "Shelf analysis payload validated locally.");
  return res.json(parsed.data);
}

export async function handleShelfMock(req: Request, res: Response) {
  const analysis = createMockShelfAnalysis({
    caption: typeof req.body?.caption === "string" ? req.body.caption : undefined,
    photoUri: typeof req.body?.photoUri === "string" ? req.body.photoUri : undefined
  });
  sendAudit(req, "validated", 200, "Mock shelf analysis returned.");
  return res.json(analysis);
}

export async function handleShelfGpt(req: Request, res: Response) {
  if (!isOpenAiConfigured()) {
    sendAudit(req, "failed", 503, "OpenAI API key not configured for optional GPT shelf analysis.");
    return res.status(503).json({
      error: "GPT_NOT_CONFIGURED",
      message: "Set OPENAI_API_KEY on the local server before using GPT-backed shelf analysis."
    });
  }

  try {
    const candidate = await validateGptShelfResponse(req.body?.candidate);
    sendAudit(req, "validated", 200, "GPT shelf analysis validated locally.");
    return res.json(candidate);
  } catch (error) {
    sendAudit(req, "failed", 422, error instanceof Error ? error.message : "GPT shelf analysis failed validation.");
    return res.status(422).json({ error: "INVALID_GPT_RESPONSE", message: "The GPT response did not match the strict shelf-analysis schema." });
  }
}
