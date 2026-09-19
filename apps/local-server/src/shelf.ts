import type { Request, Response } from "express";
import { z } from "zod";
import { ShelfAnalysisSchema, createMockShelfAnalysis } from "../../../packages/shared/src/shelf-analysis.js";
import { generateGptShelfAnalysis, GptShelfValidationError, isOpenAiConfigured } from "./gpt4o.js";
import { recordAuditEvent } from "./audit.js";

const ShelfMockRequestSchema = z.object({
  caption: z.string().trim().max(500).optional()
}).strict();

const ShelfGptRequestSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  photoDataUrl: z.string()
    .max(8.5 * 1024 * 1024)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Photo must be a JPEG, PNG, or WebP base64 data URL.")
}).strict();

function sendAudit(req: Request, res: Response, outcome: "validated" | "failed", statusCode: number, detail: string) {
  recordAuditEvent({
    at: new Date().toISOString(),
    route: req.path,
    method: req.method,
    outcome,
    requestId: typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown",
    statusCode,
    detail
  });
}

export async function handleShelfValidate(req: Request, res: Response) {
  const parsed = ShelfAnalysisSchema.safeParse(req.body);
  if (!parsed.success) {
    sendAudit(req, res, "failed", 422, "Shelf analysis payload failed schema validation.");
    return res.status(422).json({ error: "INVALID_SHELF_ANALYSIS", details: parsed.error.flatten() });
  }
  sendAudit(req, res, "validated", 200, "Shelf analysis payload validated locally.");
  return res.json(parsed.data);
}

export async function handleShelfMock(req: Request, res: Response) {
  const request = ShelfMockRequestSchema.safeParse(req.body);
  if (!request.success) {
    sendAudit(req, res, "failed", 422, "Mock shelf request failed schema validation.");
    return res.status(422).json({ error: "INVALID_MOCK_REQUEST" });
  }
  const analysis = createMockShelfAnalysis({
    caption: request.data.caption
  });
  sendAudit(req, res, "validated", 200, "Mock shelf analysis returned.");
  return res.json(analysis);
}

export async function handleShelfGpt(req: Request, res: Response) {
  if (!isOpenAiConfigured()) {
    sendAudit(req, res, "failed", 503, "OpenAI API key not configured for optional GPT shelf analysis.");
    return res.status(503).json({
      error: "GPT_NOT_CONFIGURED",
      message: "Set OPENAI_API_KEY on the local server before using GPT-backed shelf analysis."
    });
  }

  const request = ShelfGptRequestSchema.safeParse(req.body);
  if (!request.success) {
    sendAudit(req, res, "failed", 422, "GPT shelf request failed schema validation.");
    return res.status(422).json({ error: "INVALID_GPT_REQUEST", message: "Provide a supported, bounded shelf photo and optional caption." });
  }

  try {
    const candidate = await generateGptShelfAnalysis(request.data);
    sendAudit(req, res, "validated", 200, "GPT shelf analysis validated locally.");
    return res.json(candidate);
  } catch (error) {
    if (error instanceof GptShelfValidationError) {
      sendAudit(req, res, "failed", 422, "GPT shelf analysis failed strict output validation.");
      return res.status(422).json({ error: "INVALID_GPT_RESPONSE", message: "The GPT response did not match the strict shelf-analysis schema." });
    }
    sendAudit(req, res, "failed", 502, "OpenAI shelf analysis request failed upstream.");
    return res.status(502).json({ error: "GPT_UPSTREAM_FAILURE", message: "The optional AI service did not complete the analysis. Retry later or use local mock mode." });
  }
}
